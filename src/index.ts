import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import swaggerJsdoc from "swagger-jsdoc";
import { validateRequiredFields } from "./middleware/validation.js";
import { authenticateToken } from "./middleware/auth.js";

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

const swaggerOptions = {
  swaggerDefinition: {
    openapi: "3.0.0",
    info: { title: "ChronoPay API", version: "1.0.0" },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
  },
  apis: ["./src/routes/*.ts"],
};

const specs = swaggerJsdoc(swaggerOptions);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs));

// Public routes — no authentication required
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "chronopay-backend" });
});

// Protected routes — authenticateToken must pass before reaching the handler
app.get("/api/v1/slots", authenticateToken, (_req, res) => {
  res.json({ slots: [] });
});

app.post(
  "/api/v1/slots",
  authenticateToken, // auth first: reject unauthenticated requests before validation
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

/* istanbul ignore next — app.listen is never reached in NODE_ENV=test */
if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`ChronoPay API listening on http://localhost:${PORT}`);
  });
}

export default app;
