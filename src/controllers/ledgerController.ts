import { Request, Response } from "express";
import { LedgerService } from "../services/LedgerService.service";

export class LedgerController {
  constructor(private ledgerService: LedgerService) { }

  /**
   * @openapi
   * /ledger/{accountId}:
   *   get:
   *     tags: [Ledger]
   *     summary: Get ledger entries and balance for a specific account
   *     parameters:
   *       - in: path
   *         name: accountId
   *         required: true
   *         schema:
   *           type: string
   *         description: The account ID to retrieve ledger for
   *     responses:
   *       200:
   *         description: Ledger data retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 accountId:
   *                   type: string
   *                 balance:
   *                   type: number
   *                 entries:
   *                   type: array
   *                   items:
   *                     type: object
   *       400:
   *         description: Invalid account ID
   *       500:
   *         description: Server error
   */
  getLedgerForAccount = async (req: Request, res: Response) => {
    try {

      const { accountId } = req.params;

      if (typeof accountId !== "string") {
        return res.status(400).json({ error: "AccountId is required and must be a string" });
      }

      res.json(await this.ledgerService.getLedgerForAccount(accountId));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };
}
