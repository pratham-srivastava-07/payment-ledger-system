import express from "express";
import cors from "cors";
import { router } from "./routes";
import { PaymentHandler } from "./events/handlers/paymentHandler";

const app = express();

app.use(express.json());
app.use(cors());

// Initialize Event Handlers
new PaymentHandler();

app.use("/api/v1", router);

export default app;
