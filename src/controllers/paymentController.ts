import { Request, Response } from "express";
import { PaymentService } from "../services/PaymentService.service";

/**
 * @openapi
 * components:
 *   schemas:
 *     PaymentRequest:
 *       type: object
 *       required:
 *         - paymentId
 *         - amount
 *         - provider
 *       properties:
 *         paymentId:
 *           type: string
 *           description: Unique ID for the payment (idempotency key)
 *         amount:
 *           type: number
 *           description: Amount to charge
 *         provider:
 *           type: string
 *           enum: [STRIPE, PAYPAL]
 *           description: Payment provider to use
 *         currency:
 *           type: string
 *           default: USD
 *           description: Currency for the payment
 *     RefundRequest:
 *       type: object
 *       required:
 *         - paymentId
 *         - provider
 *         - amount
 *       properties:
 *         paymentId:
 *           type: string
 *           description: Original payment ID to refund
 *         provider:
 *           type: string
 *           enum: [STRIPE, PAYPAL]
 *         amount:
 *           type: number
 */
export class PaymentController {
  constructor(private paymentService: PaymentService) { }

  /**
   * @openapi
   * /payments:
   *   post:
   *     tags: [Payments]
   *     summary: Process a new payment
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/PaymentRequest'
   *     responses:
   *       200:
   *         description: Payment processed successfully
   *       400:
   *         description: Missing required fields
   *       500:
   *         description: Server error
   */
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

  /**
   * @openapi
   * /refunds:
   *   post:
   *     tags: [Payments]
   *     summary: Process a refund
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/RefundRequest'
   *     responses:
   *       200:
   *         description: Refund processed successfully
   *       400:
   *         description: Missing required fields
   *       500:
   *         description: Server error
   */
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
