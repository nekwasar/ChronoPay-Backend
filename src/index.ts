import express, { Request, Response, NextFunction } from "express";import cors from "cors";
import {
  BookingIntentError,
  BookingIntentService,
  parseCreateBookingIntentBody,
} from "./modules/booking-intents/booking-intent-service.js";
import { InMemoryBookingIntentRepository } from "./modules/booking-intents/booking-intent-repository.js";
import { InMemorySlotRepository } from "./modules/slots/slot-repository.js";
import { requireAuthenticatedActor, type AuthenticatedRequest } from "./middleware/auth.js";
import checkoutRouter from "./routes/checkout.js";
import slotsRouter, { resetSlotStore } from "./routes/slots.js";

export function __resetSlotsForTests(): void {
  resetSlotStore();
}

export function createApp(options?: {
  slotRepository?: InMemorySlotRepository;
  bookingIntentService?: BookingIntentService;
}) {
  const app = express();
  const slotRepository = options?.slotRepository ?? new InMemorySlotRepository();
  const bookingIntentService =
    options?.bookingIntentService ??
    new BookingIntentService(new InMemoryBookingIntentRepository(), slotRepository);

  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "chronopay-backend",
    });
  });

  app.get("/ready", (_req, res) => {
    res.json({ status: "ready", service: "chronopay-backend" });
  });

  app.get("/live", (_req, res) => {
    res.json({ status: "alive", service: "chronopay-backend" });
  });

  app.use("/api/v1/slots", slotsRouter);

  app.post(
    "/api/v1/booking-intents",
    requireAuthenticatedActor(),
    (req: Request, res: Response) => {
      try {
        const authReq = req as AuthenticatedRequest;
        const input = parseCreateBookingIntentBody(req.body);
        const intent = bookingIntentService.createIntent(input, authReq.auth!);
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

  return app;
}

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "chronopay-backend",
  });
});

app.get("/ready", (_req, res) => {
  res.json({ status: "ready", service: "chronopay-backend" });
});

app.get("/live", (_req, res) => {
  res.json({ status: "alive", service: "chronopay-backend" });
});

// Slots routes (GET /, POST /, GET /:id)
app.use("/api/v1/slots", slotsRouter);

// Checkout routes (POST /sessions with idempotency)
app.use("/api/v1/checkout", checkoutRouter);

// Booking intents route
app.post(
  "/api/v1/booking-intents",
  requireAuthenticatedActor(),
  (req: Request, res: Response) => {
    const bookingIntentService = new BookingIntentService(
      new InMemoryBookingIntentRepository(),
      new InMemorySlotRepository(),
    );
    try {
      const authReq = req as AuthenticatedRequest;
      const input = parseCreateBookingIntentBody(req.body);
      const intent = bookingIntentService.createIntent(input, authReq.auth!);
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

// Auth verify route
app.post("/api/v1/auth/verify", (_req, res) => {
  res.status(200).json({ success: true });
});

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, error: "Not found" });
});

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({ success: false, error: err.message || "Internal server error" });
});

export default app;
