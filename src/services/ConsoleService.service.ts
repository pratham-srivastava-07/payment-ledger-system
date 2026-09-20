import { PaymentStatus, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../config/prisma";
import { parseCurrency } from "../domain/money";
import { DomainError } from "../errors/domainError";

export class ConsoleService {
  constructor(private db: PrismaClient = prisma) {}

  async listPayments(
    scope: string,
    input: { currency?: string; status?: string; search?: string; page?: string; days?: string },
  ) {
    const currency = parseCurrency(input.currency);
    const page = Number(input.page ?? 1);
    if (!Number.isInteger(page) || page < 1 || page > 10000)
      throw new DomainError("INVALID_PAGE", "Invalid page");
    const days = this.days(input.days);
    const search = (input.search ?? "").slice(0, 128);
    let status: PaymentStatus | undefined;
    if (input.status && input.status !== "ALL") {
      if (!Object.values(PaymentStatus).includes(input.status as PaymentStatus))
        throw new DomainError("INVALID_STATUS", "Invalid status");
      status = input.status as PaymentStatus;
    }
    const where: Prisma.PaymentWhereInput = {
      scope,
      currency,
      status,
      createdAt: { gte: this.since(days) },
      ...(search
        ? {
            OR: [
              { id: { contains: search, mode: "insensitive" } },
              { idempotencyKey: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    return this.db.$transaction(
      async (tx) => {
        const total = await tx.payment.count({ where });
        const rows = await tx.payment.findMany({
          where,
          take: 12,
          skip: (page - 1) * 12,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          include: {
            processingAttempts: true,
            refunds: { select: { amountMinor: true, status: true } },
          },
        });
        return { items: rows.map((row) => this.paymentView(row)), total, page, pageSize: 12 };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }

  async detail(scope: string, id: string) {
    return this.db.$transaction(
      async (tx) => {
        const row = await tx.payment.findFirst({
          where: { id, scope },
          include: {
            processingAttempts: true,
            refunds: { orderBy: { createdAt: "desc" } },
            ledgerTransaction: { include: { entries: { include: { account: true } } } },
          },
        });
        if (!row) throw new DomainError("PAYMENT_NOT_FOUND", "Payment not found", 404);
        const view = this.paymentView(row);
        const events = await tx.outboxEvent.findMany({
          where: {
            OR: [
              { aggregateType: "Payment", aggregateId: id },
              { aggregateType: "Refund", aggregateId: { in: row.refunds.map((r) => r.id) } },
            ],
          },
          orderBy: { createdAt: "desc" },
          take: 100,
        });
        return {
          ...view,
          idempotencyKey: row.idempotencyKey,
          scenario: row.scenario,
          lastError: row.lastError,
          refundableMinor:
            row.status === "SUCCEEDED"
              ? (row.amountMinor - BigInt(view.reservedMinor)).toString()
              : "0",
          attempts: row.processingAttempts.map((attempt) => ({
            id: attempt.id,
            status: attempt.status,
            invocations: attempt.invocations,
            externalRef: attempt.externalRef,
            createdAt: attempt.createdAt,
            updatedAt: attempt.updatedAt,
          })),
          refunds: row.refunds.map((refund) => ({
            id: refund.id,
            status: refund.status,
            amountMinor: refund.amountMinor.toString(),
            createdAt: refund.createdAt,
            ledgerTransactionId: refund.ledgerTransactionId,
          })),
          journal: row.ledgerTransaction
            ? {
                id: row.ledgerTransaction.id,
                createdAt: row.ledgerTransaction.createdAt,
                entries: row.ledgerTransaction.entries.map((entry) => ({
                  id: entry.id,
                  accountId: entry.accountId,
                  debitMinor: entry.debitMinor.toString(),
                  creditMinor: entry.creditMinor.toString(),
                  account: { name: entry.account.name, type: entry.account.type },
                })),
              }
            : null,
          events,
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }

  async overview(scope: string, currencyInput?: string, daysInput?: string) {
    const currency = parseCurrency(currencyInput);
    const days = this.days(daysInput);
    const since = this.since(days);
    return this.db.$transaction(
      async (tx) => {
        const groups = await tx.payment.groupBy({
          by: ["status"],
          where: { scope, currency, createdAt: { gte: since } },
          _count: true,
          _sum: { amountMinor: true },
        });
        const refunds = await tx.refund.aggregate({
          where: { scope, status: "SUCCEEDED", payment: { currency }, createdAt: { gte: since } },
          _sum: { amountMinor: true },
        });
        // Delivery is explicitly a system-wide diagnostic for trusted operators.
        const delivery = await tx.outboxEvent.groupBy({ by: ["status"], _count: true });
        const buckets = await tx.$queryRaw<
          { date: string; amount: Prisma.Decimal; count: bigint }[]
        >`
        SELECT to_char("createdAt", 'YYYY-MM-DD') AS date, SUM("amountMinor") AS amount, COUNT(*) AS count
        FROM "Payment" WHERE scope = ${scope} AND currency = ${currency}
          AND status = 'SUCCEEDED' AND "createdAt" >= ${since}
        GROUP BY to_char("createdAt", 'YYYY-MM-DD') ORDER BY date`;
        const journalCounts = await tx.$queryRaw<{ total: bigint; invalid: bigint }[]>`
        SELECT COUNT(*) AS total,
          COUNT(*) FILTER (WHERE n < 2 OR debits <> amount OR credits <> amount) AS invalid
        FROM (
          SELECT t.id, t.amount, COUNT(e.id) AS n, COALESCE(SUM(e.debit), 0) AS debits,
            COALESCE(SUM(e.credit), 0) AS credits
          FROM "Transaction" t LEFT JOIN "LedgerEntry" e ON e."transactionId" = t.id
          WHERE t.currency = ${currency} AND t."createdAt" >= ${since} AND (
            EXISTS (SELECT 1 FROM "Payment" p WHERE p."ledgerTransactionId" = t.id AND p.scope = ${scope}) OR
            EXISTS (SELECT 1 FROM "Refund" r WHERE r."ledgerTransactionId" = t.id AND r.scope = ${scope})
          ) GROUP BY t.id
        ) journals`;
        const count = (status: PaymentStatus) =>
          groups.find((g) => g.status === status)?._count ?? 0;
        const series = Array.from({ length: days }, (_, index) => {
          const date = new Date(since.getTime() + index * 86400000).toISOString().slice(0, 10);
          const bucket = buckets.find((b) => b.date === date);
          return {
            date,
            amountMinor: bucket?.amount.toFixed(0) ?? "0",
            count: Number(bucket?.count ?? 0),
          };
        });
        return {
          currency,
          days,
          totalPayments: groups.reduce((total, group) => total + group._count, 0),
          succeeded: count("SUCCEEDED"),
          failed: count("FAILED"),
          pending: count("CREATED") + count("PROCESSING") + count("UNKNOWN"),
          volumeMinor: (
            groups.find((g) => g.status === "SUCCEEDED")?._sum.amountMinor ?? 0n
          ).toString(),
          refundedMinor: (refunds._sum.amountMinor ?? 0n).toString(),
          journalCount: Number(journalCounts[0]?.total ?? 0),
          unbalancedJournals: Number(journalCounts[0]?.invalid ?? 0),
          series,
          outbox: {
            pending: delivery.find((d) => d.status === "PENDING")?._count ?? 0,
            published: delivery.find((d) => d.status === "PUBLISHED")?._count ?? 0,
            failed: delivery.find((d) => d.status === "FAILED")?._count ?? 0,
          },
          checkedAt: new Date().toISOString(),
        };
      },
      { isolationLevel: "RepeatableRead", timeout: 10000 },
    );
  }

  async accounts(currencyInput?: string) {
    const currency = parseCurrency(currencyInput);
    return this.db.$transaction(
      async (tx) => {
        const rows = await tx.account.findMany({
          where: { currency },
          orderBy: { name: "asc" },
          take: 100,
        });
        const sums = await tx.ledgerEntry.groupBy({
          by: ["accountId"],
          where: { accountId: { in: rows.map((r) => r.id) } },
          _sum: { debitMinor: true, creditMinor: true },
          _count: true,
        });
        return rows.map((account) => {
          const sum = sums.find((s) => s.accountId === account.id);
          const debit = (sum?._sum.debitMinor ?? 0n) - (sum?._sum.creditMinor ?? 0n);
          return {
            ...account,
            balanceMinor: (account.type === "PROVIDER" ? debit : -debit).toString(),
            entryCount: sum?._count ?? 0,
          };
        });
      },
      { isolationLevel: "RepeatableRead" },
    );
  }

  private days(input?: string) {
    const days = Number(input ?? 7);
    if (![1, 7, 30].includes(days))
      throw new DomainError("INVALID_PERIOD", "Choose 1, 7 or 30 days");
    return days;
  }

  private since(days: number) {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days + 1));
  }

  private paymentView(row: {
    id: string;
    status: string;
    amountMinor: bigint;
    currency: string;
    provider: string;
    ledgerTransactionId: string | null;
    createdAt: Date;
    lastError: string | null;
    processingAttempts: { externalRef: string | null }[];
    refunds: { status: string; amountMinor: bigint }[];
  }) {
    return {
      paymentId: row.id,
      status: row.status,
      amountMinor: row.amountMinor.toString(),
      currency: row.currency,
      provider: row.provider,
      transactionId: row.ledgerTransactionId,
      externalRef: row.processingAttempts[0]?.externalRef ?? null,
      error: row.status === "FAILED" ? row.lastError : null,
      createdAt: row.createdAt,
      refundedMinor: row.refunds
        .filter((r) => r.status === "SUCCEEDED")
        .reduce((sum, r) => sum + r.amountMinor, 0n)
        .toString(),
      reservedMinor: row.refunds
        .filter((r) => r.status !== "FAILED")
        .reduce((sum, r) => sum + r.amountMinor, 0n)
        .toString(),
    };
  }
}
