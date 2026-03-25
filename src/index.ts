import express from "express";
import cors from "cors";
import { validateRequiredFields } from "./middleware/validation";

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

import swaggerUi from "swagger-ui-express";
import swaggerJsdoc from "swagger-jsdoc";

const options = {
  swaggerDefinition: {
    openapi: "3.0.0",
    info: { title: "ChronoPay API", version: "1.0.0" },
  },
  apis: ["./src/routes/*.ts"], // adjust if needed
};

const specs = swaggerJsdoc(options);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "chronopay-backend" });
});

app.get("/api/v1/slots", (_req, res) => {
  res.json({ slots: [] });
});

app.post(
  "/api/v1/slots",
  validateRequiredFields(["professional", "startTime", "endTime"]),
  (req, res) => {
    const { professional, startTime, endTime } = req.body;

    res.status(201).json({
      success: true,
      slot: {
        id: 1,
        professional,
        startTime,
        endTime,
      },
    });
  },
);

// SMS notification endpoint (implements BE-031 requirement)
import { InMemorySmsProvider, SmsNotificationService } from "./services/smsNotification";

const smsService = new SmsNotificationService(new InMemorySmsProvider());

app.post(
  "/api/v1/notifications/sms",
  validateRequiredFields(["to", "message"]),
  async (req, res) => {
    const { to, message } = req.body;

    const result = await smsService.send(to, message);

    if (result.success) {
      return res.status(200).json({
        success: true,
        provider: result.provider,
        providerMessageId: result.providerMessageId,
      });
    }

    return res.status(502).json({
      success: false,
      error: result.error,
    });
  },
);


if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`ChronoPay API listening on http://localhost:${PORT}`);
  });
}

export default app;
