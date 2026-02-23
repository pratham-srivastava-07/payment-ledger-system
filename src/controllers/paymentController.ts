import { Request, Response } from "express";
import { PaymentService } from "../services/PaymentService.service";

export class PaymentController {
  constructor(private paymentService: PaymentService) {}

  createPayment = async (req: Request, res: Response) => {
    try {
      const { paymentId, amount, provider, currency } = req.body;
      if (!paymentId || !amount || !provider) {
        return res
          .status(400)
          .json({ error: "Missing required fields: paymentId, amount, provider" });
      }
      const result = await this.paymentService.processPayment({
        paymentId,
        amount,
        provider,
        currency,
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };

  refundPayment = async (req: Request, res: Response) => {
    try {
      const { paymentId, provider, amount } = req.body;
      if (!paymentId || !provider || !amount) {
        return res
          .status(400)
          .json({ error: "Missing required fields: paymentId, provider, amount" });
      }
      const result = await this.paymentService.processRefund({ paymentId, provider, amount });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };
}
