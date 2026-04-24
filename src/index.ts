import "dotenv/config";
import express from "express";
import cors from "cors";
import { logInfo } from "./utils/logger.js";
import {
  createRequestLogger,
  errorLoggerMiddleware,
} from "./middleware/requestLogger.js";
import { validateRequiredFields } from "./middleware/validation.js";
import rateLimiter from "./middleware/rateLimiter.js";
import { errorHandler } from "./middleware/errorHandler.js";

import { loadEnvConfig, type EnvConfig } from "./config/env.js";
import {
  requireAuthenticatedActor,
  type AuthenticatedRequest,
} from "./middleware/auth.js";
import {
  BookingIntentError,
  BookingIntentService,
} from "./modules/booking-intents/booking-intent-service.js";
import { InMemoryBookingIntentRepository } from "./modules/booking-intents/booking-intent-repository.js";
import { InMemorySlotRepository } from "./modules/slots/slot-repository.js";
import checkoutRouter from "./routes/checkout.js";

const app = express();

// Request logging middleware (must be first)
app.use(createRequestLogger());

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "chronopay-backend" });
});

// Register checkout routes
app.use("/api/v1/checkout", checkoutRouter);

// Error handling middleware (must be last)
app.use(errorLoggerMiddleware);
app.use(errorHandler);

const PORT = process.env.PORT || 3001;

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    logInfo(`ChronoPay API listening on http://localhost:${PORT}`, {
      port: PORT,
      environment: process.env.NODE_ENV || "development",
    });
  });
}

export default app;
