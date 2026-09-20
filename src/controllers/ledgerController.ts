import { Request, Response } from "express";
import { LedgerService } from "../services/LedgerService.service";
import { identifier } from "../domain/operation";

export class LedgerController {
  constructor(private ledgerService: LedgerService) {}

  getLedgerForAccount = async (req: Request, res: Response) => {
    res.json(
      await this.ledgerService.getLedgerForAccount(identifier(req.params.accountId, "accountId")),
    );
  };
}
