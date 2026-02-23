import { Request, Response } from "express";
import { LedgerService } from "../services/LedgerService.service";

export class LedgerController {
  constructor(private ledgerService: LedgerService) {}

  getLedgerForAccount = async (req: Request, res: Response) => {
    try {

      const { accountId } = req.params;

      if (typeof accountId !== "string") {
        return res.status(400).json({ error: "AccountId is required and must be a string" });
      }

      const entries = await this.ledgerService.getLedgerForAccount(accountId);

      const balance = await this.ledgerService.getAccountBalance(accountId);
      
      res.json({ accountId, balance, entries });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };
}
