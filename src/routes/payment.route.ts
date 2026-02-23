import express from "express";
import { PaymentController } from "../controllers/paymentController";
import { PaymentService } from "../services/PaymentService.service";

export const paymentRoute = express.Router();

const paymentService = new PaymentService();
const paymentController = new PaymentController(paymentService);

paymentRoute.post("/", paymentController.createPayment);
paymentRoute.post("/refund", paymentController.refundPayment);
