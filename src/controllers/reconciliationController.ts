import { Request, Response } from "express";
import { ReconciliationService } from "../services/ReconciliationService.service";
import { PaymentProvider } from "@prisma/client";

export class ReconciliationController {
  constructor(private reconciliationService: ReconciliationService) { }

  /**
   * @openapi
   * /reconciliation/report:
   *   get:
   *     tags: [Reconciliation]
   *     summary: Get the latest reconciliation report
   *     responses:
   *       200:
   *         description: Latest report retrieved successfully
   *       500:
   *         description: Server error
   */
  getLatestReport = async (req: Request, res: Response) => {
    try {
      const result = await this.reconciliationService.getLatestReport();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };

  /**
   * @openapi
   * /reconciliation/trigger:
   *   post:
   *     tags: [Reconciliation]
   *     summary: Trigger a reconciliation process for a provider
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - provider
   *             properties:
   *               provider:
   *                 type: string
   *                 enum: [STRIPE, PAYPAL]
   *     responses:
   *       200:
   *         description: Reconciliation completed
   *       400:
   *         description: Provider is required
   *       500:
   *         description: Server error
   */
  triggerReconciliation = async (req: Request, res: Response) => {
    try {
      const { provider } = req.body;
      if (!provider) {
        return res.status(400).json({ error: "Provider is required" });
      }
      const result = await this.reconciliationService.performReconciliation(
        provider as PaymentProvider,
        req.body.currency ?? "USD",
      );
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };
}
