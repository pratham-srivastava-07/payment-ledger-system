import { randomUUID } from "crypto";
import { PaymentProvider, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../config/prisma";
import { PaymentAdapter, ProcessorResult } from "../adapters/paymentAdapter";
import { MockPaymentAdapter } from "../adapters/mockPaymentAdapter";
import { serializable } from "../db/transaction";
import { parseCurrency, parseMinor } from "../domain/money";
import { fingerprint, identifier, parseProvider, parseScenario } from "../domain/operation";
import { DomainError } from "../errors/domainError";
import { LedgerService } from "./LedgerService.service";
import { OutboxService } from "./OutboxService.service";

type Kind = "Payment" | "Refund";
const pending = ["CREATED", "PROCESSING", "UNKNOWN"] as const;

interface Dependencies {
  db?: PrismaClient;
  ledger?: LedgerService;
  outbox?: OutboxService;
  adapter?: (provider: PaymentProvider) => PaymentAdapter;
  retryDelayMs?: number;
}

export class PaymentService {
  private db: PrismaClient;
  private ledger: LedgerService;
  private outbox: OutboxService;
  private adapter: (provider: PaymentProvider) => PaymentAdapter;
  private retryDelayMs: number;

  constructor(deps: Dependencies = {}) {
    this.db = deps.db ?? prisma;
    this.ledger = deps.ledger ?? new LedgerService(this.db);
    this.outbox = deps.outbox ?? new OutboxService();
    this.adapter = deps.adapter ?? ((provider) => new MockPaymentAdapter(provider, this.db));
    this.retryDelayMs = deps.retryDelayMs ?? 1000;
  }

  async processPayment(
    data: {
      paymentId?: unknown;
      amountMinor: unknown;
      provider: unknown;
      currency?: unknown;
      scenario?: unknown;
    },
    idempotencyKey: string,
    scope = "operator",
  ) {
    identifier(idempotencyKey, "idempotency key");
    const amountMinor = parseMinor(data.amountMinor);
    const provider = parseProvider(data.provider);
    const currency = parseCurrency(data.currency);
    const scenario = parseScenario(data.scenario);
    const requestedId =
      data.paymentId === undefined ? undefined : identifier(data.paymentId, "paymentId");
    const requestHash = fingerprint([
      requestedId ?? null,
      amountMinor.toString(),
      provider,
      currency,
      scenario,
    ]);

    let payment;
    try {
      payment = await serializable(this.db, async (tx) => {
        const existing = await tx.payment.findUnique({
          where: { scope_idempotencyKey: { scope, idempotencyKey } },
        });
        if (existing) {
          this.checkHash(existing.requestHash, requestHash);
          return existing;
        }
        // Legacy events have no recoverable attempt identity: never silently charge them again.
        if (
          await tx.paymentEvent.findUnique({
            where: { idempotencyKey: requestedId ?? idempotencyKey },
          })
        ) {
          throw new DomainError(
            "LEGACY_PAYMENT",
            "Legacy payment requires manual reconciliation before migration",
            409,
          );
        }
        const id = requestedId ?? randomUUID();
        return tx.payment.create({
          data: {
            id,
            scope,
            idempotencyKey,
            requestHash,
            amountMinor,
            currency,
            provider,
            scenario,
            processingAttempts: { create: { provider, providerIdempotencyKey: `payment:${id}` } },
          },
        });
      });
    } catch (error) {
      if (!this.isUniqueConflict(error)) throw error;
      payment = await this.db.payment.findUnique({
        where: { scope_idempotencyKey: { scope, idempotencyKey } },
      });
      if (!payment)
        throw new DomainError(
          "PAYMENT_ID_CONFLICT",
          "Payment ID already belongs to another request",
          409,
        );
      this.checkHash(payment.requestHash, requestHash);
    }
    await this.resume("Payment", payment.id);
    return this.getPayment(payment.id, scope);
  }

  async processRefund(
    data: {
      paymentId: unknown;
      amountMinor: unknown;
      provider?: unknown;
      scenario?: unknown;
    },
    idempotencyKey: string,
    scope = "operator",
  ) {
    identifier(idempotencyKey, "idempotency key");
    const paymentId = identifier(data.paymentId, "paymentId");
    const amountMinor = parseMinor(data.amountMinor);
    const scenario = parseScenario(data.scenario);
    const suppliedProvider = data.provider === undefined ? undefined : parseProvider(data.provider);
    const requestHash = fingerprint([
      paymentId,
      amountMinor.toString(),
      suppliedProvider ?? null,
      scenario,
    ]);
    let refund;
    try {
      refund = await serializable(this.db, async (tx) => {
        const existing = await tx.refund.findUnique({
          where: { scope_idempotencyKey: { scope, idempotencyKey } },
        });
        if (existing) {
          this.checkHash(existing.requestHash, requestHash);
          return existing;
        }
        // Serialize capacity reservations for this payment, including uncertain outcomes.
        await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
        const payment = await tx.payment.findFirst({ where: { id: paymentId, scope } });
        if (!payment) throw new DomainError("PAYMENT_NOT_FOUND", "Payment not found", 404);
        if (payment.status !== "SUCCEEDED")
          throw new DomainError("NOT_REFUNDABLE", "Only a succeeded payment can be refunded", 409);
        if (suppliedProvider && suppliedProvider !== payment.provider) {
          throw new DomainError("PROVIDER_MISMATCH", "Refund provider must match the payment", 409);
        }
        const reserved = await tx.refund.aggregate({
          where: { paymentId, status: { not: "FAILED" } },
          _sum: { amountMinor: true },
        });
        if ((reserved._sum.amountMinor ?? 0n) + amountMinor > payment.amountMinor) {
          throw new DomainError(
            "OVER_REFUND",
            "Refund exceeds the unreserved captured amount",
            409,
          );
        }
        const id = randomUUID();
        return tx.refund.create({
          data: {
            id,
            scope,
            idempotencyKey,
            requestHash,
            paymentId,
            amountMinor,
            scenario,
            processingAttempts: {
              create: { provider: payment.provider, providerIdempotencyKey: `refund:${id}` },
            },
          },
        });
      });
    } catch (error) {
      if (!this.isUniqueConflict(error)) throw error;
      refund = await this.db.refund.findUnique({
        where: { scope_idempotencyKey: { scope, idempotencyKey } },
      });
      if (!refund) throw error;
      this.checkHash(refund.requestHash, requestHash);
    }
    await this.resume("Refund", refund.id);
    return this.getRefund(refund.id, scope);
  }

  async getPayment(id: string, scope?: string) {
    const row = await this.db.payment.findFirst({
      where: { id, ...(scope ? { scope } : {}) },
      include: { processingAttempts: true },
    });
    if (!row) throw new DomainError("PAYMENT_NOT_FOUND", "Payment not found", 404);
    return {
      paymentId: row.id,
      status: row.status,
      amountMinor: row.amountMinor.toString(),
      currency: row.currency,
      provider: row.provider,
      transactionId: row.ledgerTransactionId,
      externalRef: row.processingAttempts[0]?.externalRef ?? null,
      error: row.status === "FAILED" ? row.lastError : null,
    };
  }

  async getRefund(id: string, scope?: string) {
    const row = await this.db.refund.findFirst({
      where: { id, ...(scope ? { scope } : {}) },
      include: { payment: true, processingAttempts: true },
    });
    if (!row) throw new DomainError("REFUND_NOT_FOUND", "Refund not found", 404);
    return {
      refundId: row.id,
      paymentId: row.paymentId,
      status: row.status,
      amountMinor: row.amountMinor.toString(),
      currency: row.payment.currency,
      provider: row.payment.provider,
      transactionId: row.ledgerTransactionId,
      externalRef: row.processingAttempts[0]?.externalRef ?? null,
      error: row.status === "FAILED" ? row.lastError : null,
    };
  }

  private checkHash(actual: string, expected: string) {
    if (actual !== expected)
      throw new DomainError(
        "IDEMPOTENCY_CONFLICT",
        "Key reused with different request contents",
        409,
      );
  }

  private isUniqueConflict(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
  }

  async resume(kind: Kind, id: string): Promise<void> {
    const token = randomUUID();
    const claimed = await serializable(this.db, async (tx) => {
      const now = new Date();
      const where = {
        id,
        status: { in: [...pending] },
        nextAttemptAt: { lte: now },
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
      };
      const data = {
        status: "PROCESSING" as const,
        leaseToken: token,
        leaseUntil: new Date(now.getTime() + 30000),
      };
      const result =
        kind === "Payment"
          ? await tx.payment.updateMany({ where, data })
          : await tx.refund.updateMany({ where, data });
      if (!result.count) return null;
      const attempt = await tx.processorAttempt.update({
        where: kind === "Payment" ? { paymentId: id } : { refundId: id },
        data: { invocations: { increment: 1 } },
      });
      if (kind === "Payment") {
        const payment = await tx.payment.findUniqueOrThrow({ where: { id } });
        return {
          attempt,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          scenario: payment.scenario,
          originalExternalRef: null,
        };
      }
      const refund = await tx.refund.findUniqueOrThrow({
        where: { id },
        include: { payment: { include: { processingAttempts: true } } },
      });
      return {
        attempt,
        amountMinor: refund.amountMinor,
        currency: refund.payment.currency,
        scenario: refund.scenario,
        originalExternalRef: refund.payment.processingAttempts[0]?.externalRef ?? null,
      };
    });
    if (!claimed) return;

    try {
      const adapter = this.adapter(claimed.attempt.provider);
      let result = await adapter.lookup(claimed.attempt.providerIdempotencyKey);
      if (!result) {
        const request = {
          amountMinor: claimed.amountMinor,
          currency: claimed.currency,
          idempotencyKey: claimed.attempt.providerIdempotencyKey,
          scenario: parseScenario(claimed.scenario),
          invocation: claimed.attempt.invocations,
        };
        if (kind === "Refund" && !claimed.originalExternalRef)
          throw new Error("Missing original processor reference");
        result =
          kind === "Payment"
            ? await adapter.charge(request)
            : await adapter.refund({
                ...request,
                originalExternalRef: claimed.originalExternalRef!,
              });
      }
      await this.finalize(kind, id, token, result);
    } catch (error) {
      // A network/DB exception does not prove that the provider failed to move money.
      const message =
        error instanceof Error ? error.message.slice(0, 1000) : "Unknown processing error";
      console.error(
        JSON.stringify({ event: "operation_pending_recovery", kind, id, error: message }),
      );
      await serializable(this.db, async (tx) => {
        const data = {
          status: "UNKNOWN" as const,
          leaseToken: null,
          leaseUntil: null,
          lastError: message,
          nextAttemptAt: new Date(
            Date.now() +
              Math.min(
                60000,
                this.retryDelayMs * 2 ** Math.min(claimed.attempt.invocations - 1, 6),
              ),
          ),
        };
        const changed =
          kind === "Payment"
            ? await tx.payment.updateMany({
                where: { id, leaseToken: token, status: "PROCESSING" },
                data,
              })
            : await tx.refund.updateMany({
                where: { id, leaseToken: token, status: "PROCESSING" },
                data,
              });
        if (changed.count)
          await tx.processorAttempt.update({
            where: { id: claimed.attempt.id },
            data: { status: "UNKNOWN", lastError: message },
          });
      });
    }
  }

  private async finalize(kind: Kind, id: string, token: string, result: ProcessorResult) {
    await serializable(this.db, async (tx) => {
      const operation =
        kind === "Payment"
          ? await tx.payment.findUniqueOrThrow({ where: { id } })
          : await tx.refund.findUniqueOrThrow({ where: { id } });
      if (operation.leaseToken !== token || operation.status !== "PROCESSING") return;
      const payment =
        kind === "Payment"
          ? await tx.payment.findUniqueOrThrow({ where: { id } })
          : await tx.payment.findUniqueOrThrow({
              where: { id: (operation as { paymentId: string }).paymentId },
            });
      let transactionId: string | null = null;
      if (result.status === "SUCCEEDED") {
        const providerAccount = await this.ledger.getSystemAccount(
          tx,
          "PROVIDER",
          `${payment.provider}_HOLDING`,
          payment.currency,
        );
        const revenueAccount = await this.ledger.getSystemAccount(
          tx,
          "PLATFORM",
          "REVENUE_ACCOUNT",
          payment.currency,
        );
        const refund = kind === "Refund";
        const journal = await this.ledger.recordTransaction(tx, {
          type: refund ? "REFUND" : "PAYMENT",
          externalRef: `${kind.toLowerCase()}:${id}`,
          amountMinor: operation.amountMinor,
          currency: payment.currency,
          reversalOfId: refund ? payment.ledgerTransactionId! : undefined,
          entries: [
            {
              accountId: providerAccount.id,
              debitMinor: refund ? 0n : operation.amountMinor,
              creditMinor: refund ? operation.amountMinor : 0n,
            },
            {
              accountId: revenueAccount.id,
              debitMinor: refund ? operation.amountMinor : 0n,
              creditMinor: refund ? 0n : operation.amountMinor,
            },
          ],
        });
        transactionId = journal.id;
      }
      const data = {
        status: result.status,
        ledgerTransactionId: transactionId,
        leaseToken: null,
        leaseUntil: null,
        lastError: result.status === "FAILED" ? result.error : null,
      };
      if (kind === "Payment") await tx.payment.update({ where: { id }, data });
      else await tx.refund.update({ where: { id }, data });
      await tx.processorAttempt.update({
        where: kind === "Payment" ? { paymentId: id } : { refundId: id },
        data: { status: result.status, externalRef: result.externalRef, lastError: data.lastError },
      });
      await this.outbox.createEvent(tx, {
        aggregateType: kind,
        aggregateId: id,
        eventType:
          kind === "Payment"
            ? result.status === "SUCCEEDED"
              ? "PAYMENT_SUCCEEDED"
              : "PAYMENT_FAILED"
            : result.status === "SUCCEEDED"
              ? "REFUND_SUCCEEDED"
              : "REFUND_FAILED",
        payload: {
          paymentId: payment.id,
          ...(kind === "Refund" ? { refundId: id } : {}),
          transactionId,
          amountMinor: operation.amountMinor.toString(),
          currency: payment.currency,
          provider: payment.provider,
          status: result.status,
          externalRef: result.externalRef,
          occurredAt: new Date().toISOString(),
        },
      });
    });
  }

  async recoverPending(limit = 25) {
    const now = new Date();
    const where = {
      status: { in: [...pending] },
      nextAttemptAt: { lte: now },
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
    };
    const payments = await this.db.payment.findMany({
      where,
      take: limit,
      orderBy: { nextAttemptAt: "asc" },
    });
    const refunds = await this.db.refund.findMany({
      where,
      take: limit,
      orderBy: { nextAttemptAt: "asc" },
    });
    for (const payment of payments) await this.resume("Payment", payment.id);
    for (const refund of refunds) await this.resume("Refund", refund.id);
    return payments.length + refunds.length;
  }
}
