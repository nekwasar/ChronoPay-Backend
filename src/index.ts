import express from "express";
import { logInfo } from "./utils/logger.js";
import { loadEnvConfig } from "./config/env.js";
import { getCORSConfig, validateCORSConfig } from "./config/cors.js";
import { createCORSMiddleware } from "./middleware/cors.js";
import { createRequestLogger, errorLoggerMiddleware } from "./middleware/requestLogger.js";
import rateLimiter from "./middleware/rateLimiter.js";
import { idempotencyMiddleware } from "./middleware/idempotency.js";
import {
  featureFlagContextMiddleware,
  initializeFeatureFlagsFromEnv,
  requireFeatureFlag,
} from "./middleware/featureFlags.js";
import { notFoundMiddleware, errorHandler } from "./middleware/errorHandler.js";
import { register, metricsMiddleware } from "./metrics.js";
import { requireAuthenticatedActor, type AuthenticatedRequest } from "./middleware/auth.js";
import { validateRequiredFields } from "./middleware/validation.js";
import {
  BookingIntentService,
  BookingIntentError,
  parseCreateBookingIntentBody,
} from "./modules/booking-intents/booking-intent-service.js";
import { InMemoryBookingIntentRepository } from "./modules/booking-intents/booking-intent-repository.js";
import { InMemorySlotRepository } from "./modules/slots/slot-repository.js";
import slotsRouter, { resetSlotStore } from "./routes/slots.js";
import checkoutRouter from "./routes/checkout.js";
import { startScheduler } from "./scheduler/reminderScheduler.js";

// ─── Environment & feature flags ─────────────────────────────────────────────

const config = loadEnvConfig();
initializeFeatureFlagsFromEnv();

const PORT = config.port ?? 3001;

// ─── App factory (used by tests to inject dependencies) ──────────────────────

export interface CreateAppOptions {
  slotRepository?: InMemorySlotRepository;
  bookingIntentService?: BookingIntentService;
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express();

  const corsConfig = getCORSConfig();
  validateCORSConfig(corsConfig);

  app.use(createRequestLogger());
  app.use(createCORSMiddleware(corsConfig));
  app.use(express.json());
  app.use(rateLimiter);
  app.use(metricsMiddleware);
  app.use(featureFlagContextMiddleware);

  // ── Metrics ────────────────────────────────────────────────────────────────
  app.get("/metrics", async (_req, res) => {
    try {
      res.set("Content-Type", register.contentType);
      res.end(await register.metrics());
    } catch (err) {
      res.status(500).end(err);
    }
  });

  // ── Health / readiness / liveness ─────────────────────────────────────────
  const healthBody = () => ({
    service: "chronopay-backend",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", ...healthBody() });
  });

  app.get("/ready", (_req, res) => {
    res.json({ status: "ready", ...healthBody() });
  });

  app.get("/live", (_req, res) => {
    res.json({ status: "alive", ...healthBody() });
  });

  // ── Slots ──────────────────────────────────────────────────────────────────
  app.use("/api/v1/slots", slotsRouter);

  // ── Checkout ───────────────────────────────────────────────────────────────
  app.use("/api/v1/checkout", checkoutRouter);

  // ── Booking intents ────────────────────────────────────────────────────────
  const bookingIntentService =
    options.bookingIntentService ??
    new BookingIntentService(
      new InMemoryBookingIntentRepository(),
      options.slotRepository ?? new InMemorySlotRepository(),
    );

  app.post(
    "/api/v1/booking-intents",
    requireAuthenticatedActor(),
    validateRequiredFields(["slotId"]),
    async (req: AuthenticatedRequest, res) => {
      try {
        const input = parseCreateBookingIntentBody(req.body);
        const intent = bookingIntentService.createIntent(input, req.auth!);
        res.status(201).json({ success: true, bookingIntent: intent });
      } catch (err) {
        if (err instanceof BookingIntentError) {
          res.status(err.status).json({ success: false, error: err.message });
        } else {
          res.status(500).json({ success: false, error: "Internal server error" });
        }
      }
    },
  );

  // ── Error handling (must be last) ─────────────────────────────────────────
  app.use(errorLoggerMiddleware);
  app.use(notFoundMiddleware);
  app.use(errorHandler);

  return app;
}

// ─── Singleton app (used by most tests via `import app from "../index.js"`) ──

const app = createApp();
export default app;

/** Test helper — resets the in-memory slot store between tests. */
export function __resetSlotsForTests(): void {
  resetSlotStore();
}

/** Exported for startup-env tests that need to invoke the listen step manually. */
export function startServer(
  server: { listen(port: number, callback?: () => void): unknown },
  cfg: { nodeEnv: string; port: number },
): void {
  server.listen(cfg.port, () => {
    console.log(`ChronoPay API listening on http://localhost:${cfg.port}`);
  });
}

// ─── Server startup ───────────────────────────────────────────────────────────

if (config.nodeEnv !== "test") {
  startScheduler();

  const server = app.listen(PORT, () => {
    logInfo(`ChronoPay API listening on http://localhost:${PORT}`, {
      port: PORT,
      environment: config.nodeEnv,
    });
  });

  const shutdown = async (signal: string) => {
    logInfo(`[shutdown] ${signal} received — closing server and Redis`);
    server.close(async () => {
      const { closeRedisClient } = await import("./utils/redis.js");
      await closeRedisClient();
      process.exit(0);
    });
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}
