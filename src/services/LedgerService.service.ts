import { AccountType, Prisma, PrismaClient, TransactionType } from "@prisma/client";
import { prisma } from "../config/prisma";
import { DomainError } from "../errors/domainError";
import { MAX_MINOR, parseCurrency, parseMinor } from "../domain/money";

export interface JournalInput {
  type: TransactionType;
  amountMinor: bigint;
  currency: string;
  externalRef: string;
  reversalOfId?: string;
  entries: { accountId: string; debitMinor: bigint; creditMinor: bigint }[];
}

export class LedgerService {
  constructor(private db: PrismaClient = prisma) {}

  // The caller owns the transaction, including payment state and outbox writes.
  async recordTransaction(tx: Prisma.TransactionClient, data: JournalInput) {
    parseMinor(data.amountMinor);
    parseCurrency(data.currency);
    if (data.entries.length < 2)
      throw new DomainError("INVALID_JOURNAL", "At least two entries are required");
    let debit = 0n;
    let credit = 0n;
    for (const entry of data.entries) {
      if (
        entry.debitMinor < 0n ||
        entry.creditMinor < 0n ||
        entry.debitMinor > MAX_MINOR ||
        entry.creditMinor > MAX_MINOR ||
        entry.debitMinor > 0n === entry.creditMinor > 0n
      )
        throw new DomainError(
          "INVALID_JOURNAL",
          "Each entry requires exactly one positive debit or credit",
        );
      debit += entry.debitMinor;
      credit += entry.creditMinor;
    }
    if (debit !== credit || debit !== data.amountMinor) {
      throw new DomainError(
        "UNBALANCED_JOURNAL",
        "Debits and credits must both equal the journal amount",
      );
    }
    const ids = [...new Set(data.entries.map((entry) => entry.accountId))];
    const accounts = await tx.account.findMany({ where: { id: { in: ids } } });
    if (
      accounts.length !== ids.length ||
      accounts.some((account) => account.currency !== data.currency)
    ) {
      throw new DomainError(
        "INVALID_ACCOUNT",
        "All accounts must exist and use the journal currency",
      );
    }
    return tx.transaction.create({
      data: {
        type: data.type,
        amountMinor: data.amountMinor,
        currency: data.currency,
        externalRef: data.externalRef,
        reversalOfId: data.reversalOfId,
        status: "COMPLETED",
        entries: { create: data.entries },
      },
      include: { entries: true },
    });
  }

  async getSystemAccount(
    tx: Prisma.TransactionClient,
    type: AccountType,
    name: string,
    currency: string,
  ) {
    return tx.account.upsert({
      where: { type_name_currency: { type, name, currency } },
      create: { type, name, currency },
      update: {},
    });
  }

  async getAccountBalance(
    accountId: string,
    tx: Prisma.TransactionClient = this.db,
  ): Promise<bigint> {
    const account = await tx.account.findUnique({ where: { id: accountId } });
    if (!account) throw new DomainError("ACCOUNT_NOT_FOUND", "Account not found", 404);
    const sum = await tx.ledgerEntry.aggregate({
      where: { accountId },
      _sum: { debitMinor: true, creditMinor: true },
    });
    const netDebit = (sum._sum.debitMinor ?? 0n) - (sum._sum.creditMinor ?? 0n);
    return account.type === "PROVIDER" ? netDebit : -netDebit;
  }

  async getLedgerForAccount(accountId: string) {
    return this.db.$transaction(
      async (tx) => {
        const account = await tx.account.findUnique({ where: { id: accountId } });
        if (!account) throw new DomainError("ACCOUNT_NOT_FOUND", "Account not found", 404);
        const balanceMinor = await this.getAccountBalance(accountId, tx);
        const entries = await tx.ledgerEntry.findMany({
          where: { accountId },
          include: { transaction: true },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 100,
        });
        return { accountId, currency: account.currency, balanceMinor, entries, limit: 100 };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
}
