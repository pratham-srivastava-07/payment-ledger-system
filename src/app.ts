import express from "express";
import cors from "cors";
import { router } from "./routes";
import { PaymentHandler } from "./events/handlers/paymentHandler";
import swaggerUi from "swagger-ui-express";
import { specs } from "./config/swagger";

const app = express();

app.use(express.json());
app.use(cors());

// Swagger Documentation
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs));

// Initialize Event Handlers
new PaymentHandler();

app.use("/api/v1", router);

export default app;
