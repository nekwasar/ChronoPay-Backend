import express from "express";
import cors from "cors";
import { logInfo } from "./utils/logger.js";
import { createRequestLogger, errorLoggerMiddleware } from "./middleware/requestLogger.js";
import { validateRequiredFields } from "./middleware/validation.js";
import { loadEnvConfig } from "./config/env.js";
import {
  InMemorySmsProvider,
  SmsNotificationService,
} from "./services/smsNotification.js";

const config = loadEnvConfig();
const PORT = config.port;

const app = express();

app.use(cors());
app.use(express.json());
app.use(createRequestLogger());

// ─── Health ───────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  logInfo("Health check endpoint called", { endpoint: "/health" });
  res.json({ status: "ok", service: "chronopay-backend" });
});

// ─── Slots ────────────────────────────────────────────────────────────────────

app.get("/api/v1/slots", (_req, res) => {
  logInfo("Slots endpoint called", { endpoint: "/api/v1/slots" });
  res.json({ slots: [] });
});

// ─── SMS notifications ────────────────────────────────────────────────────────

const smsService = new SmsNotificationService(new InMemorySmsProvider());

app.post(
  "/api/v1/notifications/sms",
  validateRequiredFields(["to", "message"]),
  async (req, res) => {
    const { to, message } = req.body as { to: string; message: string };
    const result = await smsService.send(to, message);
    if (!result.success) {
      return res.status(502).json({ success: false, error: result.error });
    }
    return res.json({
      success: true,
      provider: result.provider,
      providerMessageId: result.providerMessageId,
    });
  },
);

// ─── Error handling ───────────────────────────────────────────────────────────

app.use(errorLoggerMiddleware);

// ─── Server startup ───────────────────────────────────────────────────────────

if (config.nodeEnv !== "test") {
  app.listen(PORT, () => {
    logInfo(`ChronoPay API listening on http://localhost:${PORT}`, {
      port: PORT,
      environment: config.nodeEnv,
    });
  });
}

export default app;
