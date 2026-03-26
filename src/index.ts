import "dotenv/config";
import express from "express";
import cors from "cors";
import { validateRequiredFields } from "./middleware/validation.js";

import { initDB, closePool } from "./db/pool.js";

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

if (process.env.NODE_ENV !== "test" && !process.env.JEST_WORKER_ID) {
  // Initialize Database connection on start
  initDB()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`ChronoPay API listening on http://localhost:${PORT}`);
      });
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });

  const shutdown = async () => {
    await closePool();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

export default app;
