import { Request, Response } from "express";
import { ReconciliationService } from "../services/ReconciliationService.service";
import { PaymentProvider } from "@prisma/client";

export class ReconciliationController {
  constructor(private reconciliationService: ReconciliationService) {}

  getLatestReport = async (req: Request, res: Response) => {
    try {
      const result = await this.reconciliationService.getLatestReport();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };

  triggerReconciliation = async (req: Request, res: Response) => {
    try {
      const { provider } = req.body;
      if (!provider) {
        return res.status(400).json({ error: "Provider is required" });
      }
      const result = await this.reconciliationService.performReconciliation(
        provider as PaymentProvider,
      );
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };
}
