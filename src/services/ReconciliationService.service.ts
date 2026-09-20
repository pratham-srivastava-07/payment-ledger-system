import { PaymentProvider, Prisma } from "@prisma/client";
import { LedgerService } from "./LedgerService.service";
import { PaymentAdapterFactory } from "../factories/paymentAdapterFactory";
import { prisma } from "../config/prisma";
import { parseCurrency, currencyExponents } from "../domain/money";
import { parseProvider } from "../domain/operation";

export class ReconciliationService {
  private ledgerService = new LedgerService();

  async performReconciliation(provider: PaymentProvider, currency = "USD") {
    parseProvider(provider);
    parseCurrency(currency);
    const actualBalance = await PaymentAdapterFactory.create(provider).fetchBalance(currency);
    const account = await prisma.account.findUnique({
      where: { type_name_currency: { type: "PROVIDER", name: `${provider}_HOLDING`, currency } },
    });
    const expectedBalance = account ? await this.ledgerService.getAccountBalance(account.id) : 0n;
    const report = await prisma.reconciliationReport.create({
      data: {
        provider,
        currency,
        expectedBalance: new Prisma.Decimal(expectedBalance.toString()),
        actualBalance: new Prisma.Decimal(actualBalance.toString()),
        discrepancy: new Prisma.Decimal((actualBalance - expectedBalance).toString()),
      },
    });
    return { ...report, unit: "minor", currencyExponent: currencyExponents[currency] };
  }

  getLatestReport() {
    return prisma.reconciliationReport.findFirst({ orderBy: { createdAt: "desc" } });
  }
}
