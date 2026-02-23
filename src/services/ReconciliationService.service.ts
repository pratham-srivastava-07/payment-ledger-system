import { LedgerService } from "./LedgerService.service";
import { PaymentAdapterFactory } from "../factories/paymentAdapterFactory";
import { PrismaClass } from "../singletons/db";
import { PaymentProvider, Prisma } from "@prisma/client";

export class ReconciliationService {
  private ledgerService = new LedgerService();
  private prisma = PrismaClass.getInstance();

  async performReconciliation(provider: PaymentProvider) {
    // 1. Fetch External Balance from Adapter
    const adapter = PaymentAdapterFactory.create(provider);
    const actualBalance = await adapter.fetchBalance();

    // 2. Fetch Internal Balance from Ledger
    const providerAccount = await this.ledgerService.getSystemAccount(
      "PROVIDER",
      `${provider}_HOLDING`,
    );

    // For Provider accounts (Assets), Debit - Credit is the balance
    // Wait, earlier I did Credit - Debit for liability/revenue.
    // Let's be consistent: Assets = Debit - Credit. Liabilities/Equity/Revenue = Credit - Debit.
    // LedgerEntry result was _sum: { debit, credit }

    const result = await this.prisma.ledgerEntry.aggregate({
      where: { accountId: providerAccount.id },
      _sum: {
        debit: true,
        credit: true,
      },
    });

    const debit = result._sum.debit?.toNumber() || 0;
    const credit = result._sum.credit?.toNumber() || 0;
    const expectedBalance = debit - credit;

    const discrepancy = actualBalance - expectedBalance;

    // 3. Store Reconciliation Report
    const report = await this.prisma.reconciliationReport.create({
      data: {
        provider,
        expectedBalance: new Prisma.Decimal(expectedBalance),
        actualBalance: new Prisma.Decimal(actualBalance),
        discrepancy: new Prisma.Decimal(discrepancy),
      },
    });

    return report;
  }

  async getLatestReport() {
    return await this.prisma.reconciliationReport.findFirst({
      orderBy: { createdAt: "desc" },
    });
  }
}
