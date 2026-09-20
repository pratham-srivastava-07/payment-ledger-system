import { PaymentProvider, PrismaClient } from "@prisma/client";
import { ChargeData, PaymentAdapter, ProcessorResult, RefundData } from "./paymentAdapter";
import { prisma } from "../config/prisma";
import { fingerprint } from "../domain/operation";

export class MockPaymentAdapter implements PaymentAdapter {
  constructor(
    private provider: PaymentProvider,
    private db: PrismaClient = prisma,
  ) {}

  getProvider() {
    return this.provider;
  }

  charge(data: ChargeData) {
    return this.execute("CHARGE", data);
  }

  refund(data: RefundData) {
    return this.execute("REFUND", data, data.originalExternalRef);
  }

  async lookup(key: string): Promise<ProcessorResult | null> {
    const row = await this.db.mockProcessorOperation.findUnique({ where: { id: key } });
    if (!row || row.provider !== this.provider) return null;
    return row.outcome === "SUCCEEDED"
      ? { status: "SUCCEEDED", externalRef: row.externalRef }
      : {
          status: "FAILED",
          externalRef: row.externalRef,
          error: "Mock processor declined operation",
        };
  }

  private async execute(
    kind: string,
    data: ChargeData,
    originalRef?: string,
  ): Promise<ProcessorResult> {
    const requestHash = fingerprint([
      this.provider,
      kind,
      data.amountMinor.toString(),
      data.currency,
      originalRef ?? null,
    ]);
    if (data.scenario === "TIMEOUT_BEFORE" && data.invocation === 1) {
      throw new Error("Mock timeout before processor execution");
    }
    // This is a separate committed write, just as a real provider owns separate durable state.
    await this.db.mockProcessorOperation.createMany({
      data: [
        {
          id: data.idempotencyKey,
          provider: this.provider,
          kind,
          requestHash,
          amountMinor: data.amountMinor,
          currency: data.currency,
          externalRef: `mock_${fingerprint([this.provider, data.idempotencyKey]).slice(0, 32)}`,
          outcome: data.scenario === "DECLINE" ? "FAILED" : "SUCCEEDED",
        },
      ],
      skipDuplicates: true,
    });
    const row = await this.db.mockProcessorOperation.findUniqueOrThrow({
      where: { id: data.idempotencyKey },
    });
    if (row.requestHash !== requestHash)
      throw new Error("Processor key reused for a different operation");
    if (data.scenario === "TIMEOUT_AFTER" && data.invocation === 1) {
      throw new Error("Mock response lost after processor execution");
    }
    return (await this.lookup(data.idempotencyKey))!;
  }

  async fetchBalance(currency: string): Promise<bigint> {
    const rows = await this.db.mockProcessorOperation.groupBy({
      by: ["kind"],
      where: { provider: this.provider, currency, outcome: "SUCCEEDED" },
      _sum: { amountMinor: true },
    });
    return rows.reduce(
      (sum, row) => sum + (row.kind === "CHARGE" ? 1n : -1n) * (row._sum.amountMinor ?? 0n),
      0n,
    );
  }
}
