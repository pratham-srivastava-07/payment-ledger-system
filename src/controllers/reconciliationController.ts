import { Request, Response } from "express";
import { ReconciliationService } from "../services/ReconciliationService.service";
import { parseProvider } from "../domain/operation";
import { parseCurrency } from "../domain/money";

export class ReconciliationController {
  constructor(private reconciliationService: ReconciliationService) {}

  getLatestReport = async (_req: Request, res: Response) => {
    res.json(await this.reconciliationService.getLatestReport());
  };

  triggerReconciliation = async (req: Request, res: Response) => {
    res.json(
      await this.reconciliationService.performReconciliation(
        parseProvider(req.body?.provider),
        parseCurrency(req.body?.currency),
      ),
    );
  };
}
