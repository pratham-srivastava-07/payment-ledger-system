import { prisma } from "../config/prisma";
import { TransactionType, TransactionStatus, Prisma, AccountType } from "@prisma/client";

export class LedgerService {

  async recordTransaction(data: {
    type: TransactionType;
    amount: number;
    currency: string;
    externalRef?: string;
    description?: string;
    entries: { accountId: string; debit: number; credit: number }[];
  }) {
    // Enforce double-entry balance
    const totalDebit = data.entries.reduce((sum, entry) => sum + entry.debit, 0);
    const totalCredit = data.entries.reduce((sum, entry) => sum + entry.credit, 0);

    if (Math.abs(totalDebit - totalCredit) > 0.0001) {
      throw new Error(`Unbalanced ledger entry: Debit(${totalDebit}) != Credit(${totalCredit})`);
    }

    return await prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.create({
        data: {
          type: data.type,
          amount: new Prisma.Decimal(data.amount),
          currency: data.currency,
          externalRef: data.externalRef,
          status: TransactionStatus.COMPLETED,
          entries: {
            create: data.entries.map((entry) => ({
              accountId: entry.accountId,
              debit: new Prisma.Decimal(entry.debit),
              credit: new Prisma.Decimal(entry.credit),
            })),
          },
        },
        include: {
          entries: true,
        },
      });

      return transaction;
    });
  }

  async getAccountBalance(accountId: string): Promise<number> {
    const result = await prisma.ledgerEntry.aggregate({
      where: { accountId },
      _sum: {
        debit: true,
        credit: true,
      },
    });

    const debit = result._sum.debit?.toNumber() || 0;
    const credit = result._sum.credit?.toNumber() || 0;

    // Balance calculation depends on account type (Asset vs Liability/Equity)
    // For simplicity: credit - debit (positive is positive balance for liability/equity)
    return credit - debit;
  }

  async getLedgerForAccount(accountId: string) {
    return await prisma.ledgerEntry.findMany({
      where: { accountId },
      include: { transaction: true },
      orderBy: { createdAt: "desc" },
    });
  }

  // Helper to find or create system accounts
  async getSystemAccount(type: AccountType, name: string, currency: string = "USD") {
    let account = await prisma.account.findFirst({
      where: { type, name, currency },
    });

    if (!account) {
      account = await prisma.account.create({
        data: { name, type, currency },
      });
    }

    return account;
  }
}
