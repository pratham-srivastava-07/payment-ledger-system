import type {
  Account,
  Activity,
  Currency,
  Ledger,
  OutboxEvent,
  Overview,
  PaymentDetail,
  PaymentInput,
  PaymentList,
  Provider,
  Report,
  Status,
} from "../types";

const now = Date.now();
const payments: PaymentDetail[] = [];
const events: OutboxEvent[] = [];
const keys = new Map<string, { hash: string; id: string }>();
let report: Report | null = null;
const providers: Provider[] = ["STRIPE", "RAZORPAY", "PAYPAL"];
const stamp = (offset: number) => new Date(now - offset).toISOString();
const accountId = (provider: Provider, currency: Currency) => `account_${provider}_${currency}`;
const revenueId = (currency: Currency) => `account_REVENUE_${currency}`;

function post(payment: PaymentDetail) {
  payment.status = "SUCCEEDED";
  payment.transactionId = `journal_${payment.paymentId}`;
  payment.externalRef = `mock_${payment.paymentId}`;
  payment.error = null;
  payment.lastError = null;
  payment.refundableMinor = (
    BigInt(payment.amountMinor) - BigInt(payment.reservedMinor)
  ).toString();
  payment.attempts[0] = {
    ...payment.attempts[0],
    status: "SUCCEEDED",
    externalRef: payment.externalRef,
    updatedAt: payment.createdAt,
  };
  payment.journal = {
    id: payment.transactionId,
    createdAt: payment.createdAt,
    entries: [
      {
        id: `${payment.paymentId}_debit`,
        accountId: accountId(payment.provider, payment.currency),
        debitMinor: payment.amountMinor,
        creditMinor: "0",
        account: { name: `${payment.provider}_HOLDING`, type: "PROVIDER" },
      },
      {
        id: `${payment.paymentId}_credit`,
        accountId: revenueId(payment.currency),
        debitMinor: "0",
        creditMinor: payment.amountMinor,
        account: { name: "REVENUE_ACCOUNT", type: "PLATFORM" },
      },
    ],
  };
}

function eventFor(payment: PaymentDetail, published = true) {
  const existing = events.find((event) => event.aggregateId === payment.paymentId);
  if (existing) return existing;
  const event: OutboxEvent = {
    id: `evt_${payment.paymentId}`,
    aggregateId: payment.paymentId,
    aggregateType: "Payment",
    eventType: payment.status === "FAILED" ? "PAYMENT_FAILED" : "PAYMENT_SUCCEEDED",
    status: published ? "PUBLISHED" : "PENDING",
    attempts: published ? 1 : 0,
    lastError: null,
    createdAt: payment.createdAt,
    publishedAt: published ? payment.createdAt : null,
    availableAt: payment.createdAt,
    payload: {
      paymentId: payment.paymentId,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      status: payment.status,
    },
  };
  events.unshift(event);
  payment.events = [event];
  return event;
}

function makePayment(
  id: string,
  input: PaymentInput,
  createdAt: string,
  key: string,
): PaymentDetail {
  const row: PaymentDetail = {
    paymentId: id,
    ...input,
    status: "CREATED",
    transactionId: null,
    externalRef: null,
    error: null,
    createdAt,
    refundedMinor: "0",
    reservedMinor: "0",
    refundableMinor: "0",
    idempotencyKey: key,
    lastError: null,
    attempts: [
      {
        id: `attempt_${id}`,
        status: "CREATED",
        externalRef: null,
        invocations: 1,
        createdAt,
        updatedAt: createdAt,
      },
    ],
    refunds: [],
    journal: null,
    events: [],
  };
  return row;
}

const amounts = [
  "248000",
  "84900",
  "120000",
  "32900",
  "168000",
  "72000",
  "42500",
  "198000",
  "56900",
  "96000",
  "215000",
  "78500",
  "142000",
  "64500",
  "36700",
  "124900",
  "87500",
  "194000",
  "45300",
  "168900",
  "234000",
  "92400",
  "132000",
  "45800",
  "186500",
  "75600",
  "264000",
  "128000",
];
amounts.forEach((amountMinor, index) => {
  const row = makePayment(
    `pay_${["a8f2c9", "b4e7d1", "c9a3f6", "d2b8e4", "e6c1a9", "f3d7b2"][index % 6]}${(840 + index).toString(16)}`,
    {
      amountMinor,
      currency: "USD",
      provider: providers[index % 3],
      scenario: "SUCCESS",
    },
    stamp(index < 6 ? (index * 11 + 2) * 60000 : Math.floor(index / 4) * 86400000 + index * 240000),
    `idem_sample_${index + 1}`,
  );
  if (index === 2 || index === 15) {
    row.status = "UNKNOWN";
    row.lastError = "Processor response timed out. The operation is awaiting recovery.";
    row.attempts[0].status = "UNKNOWN";
  } else if (index === 4 || index === 18) {
    row.status = "FAILED";
    row.error = "Mock processor declined operation";
    row.attempts[0].status = "FAILED";
    eventFor(row);
  } else {
    post(row);
    eventFor(row, index !== 1);
  }
  payments.push(row);
});
// One demonstrative failed delivery is independent of a successful financial operation.
const failedEvent = events.find((event) => event.aggregateId === payments[5].paymentId)!;
failedEvent.status = "FAILED";
failedEvent.attempts = 8;
failedEvent.publishedAt = null;
failedEvent.lastError = "Destination unavailable. Delivery attempts exhausted.";

const clone = <T>(value: T): T => structuredClone(value);
const since = (days: number) => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - days + 1);
};
const wait = () => new Promise<void>((resolve) => window.setTimeout(resolve, 320));

export const demo = {
  async overview(currency: Currency, days: number): Promise<Overview> {
    const selected = payments.filter(
      (p) => p.currency === currency && Date.parse(p.createdAt) >= since(days),
    );
    const succeeded = selected.filter((p) => p.status === "SUCCEEDED");
    return {
      currency,
      days,
      totalPayments: selected.length,
      succeeded: succeeded.length,
      failed: selected.filter((p) => p.status === "FAILED").length,
      pending: selected.filter((p) => ["CREATED", "PROCESSING", "UNKNOWN"].includes(p.status))
        .length,
      volumeMinor: succeeded.reduce((sum, p) => sum + BigInt(p.amountMinor), 0n).toString(),
      refundedMinor: selected.reduce((sum, p) => sum + BigInt(p.refundedMinor), 0n).toString(),
      journalCount:
        succeeded.length +
        selected.reduce((n, p) => n + p.refunds.filter((r) => r.status === "SUCCEEDED").length, 0),
      unbalancedJournals: 0,
      outbox: {
        pending: events.filter((e) => e.status === "PENDING").length,
        published: events.filter((e) => e.status === "PUBLISHED").length,
        failed: events.filter((e) => e.status === "FAILED").length,
      },
      series: Array.from({ length: days }, (_, i) => {
        const date = new Date(since(days) + i * 86400000).toISOString().slice(0, 10);
        const rows = succeeded.filter((p) => p.createdAt.startsWith(date));
        return {
          date,
          count: rows.length,
          amountMinor: rows.reduce((sum, p) => sum + BigInt(p.amountMinor), 0n).toString(),
        };
      }),
      checkedAt: new Date().toISOString(),
    };
  },
  async list(
    currency: Currency,
    days: number,
    status: string,
    search: string,
    page: number,
  ): Promise<PaymentList> {
    const rows = payments.filter(
      (p) =>
        p.currency === currency &&
        Date.parse(p.createdAt) >= since(days) &&
        (status === "ALL" || p.status === status) &&
        `${p.paymentId} ${p.idempotencyKey}`.toLowerCase().includes(search.toLowerCase()),
    );
    return clone({
      items: rows.slice((page - 1) * 12, page * 12),
      total: rows.length,
      page,
      pageSize: 12,
    });
  },
  async detail(id: string): Promise<PaymentDetail> {
    const payment = payments.find((p) => p.paymentId === id);
    if (!payment) throw new Error("Sample payment not found.");
    return clone(payment);
  },
  async create(input: PaymentInput, key: string) {
    await wait();
    const hash = JSON.stringify(input);
    const previous = keys.get(key);
    if (previous) {
      if (previous.hash !== hash)
        throw new Error("Idempotency key reused with a different request.");
      return this.detail(previous.id);
    }
    const payment = makePayment(
      `pay_${crypto.randomUUID().slice(0, 8)}`,
      input,
      new Date().toISOString(),
      key,
    );
    keys.set(key, { hash, id: payment.paymentId });
    payments.unshift(payment);
    if (input.scenario === "DECLINE") {
      payment.status = "FAILED";
      payment.error = "Mock processor declined operation";
      payment.attempts[0].status = "FAILED";
      eventFor(payment);
    } else if (input.scenario.startsWith("TIMEOUT")) {
      payment.status = "UNKNOWN";
      payment.lastError = "The processor outcome is being resolved.";
      payment.attempts[0].status = "UNKNOWN";
      window.setTimeout(() => {
        post(payment);
        payment.attempts[0].invocations = 2;
        eventFor(payment);
      }, 4200);
    } else {
      post(payment);
      eventFor(payment);
    }
    return clone(payment);
  },
  async refund(paymentId: string, amountMinor: string, key: string) {
    await wait();
    const payment = payments.find((p) => p.paymentId === paymentId)!;
    const previous = keys.get(`refund:${key}`);
    const hash = JSON.stringify([paymentId, amountMinor]);
    if (previous) {
      if (previous.hash !== hash) throw new Error("Conflicting refund request.");
      return { refundId: previous.id, status: "SUCCEEDED" as Status };
    }
    if (payment.status !== "SUCCEEDED" || BigInt(amountMinor) > BigInt(payment.refundableMinor))
      throw new Error("Refund exceeds the available amount.");
    const id = `ref_${crypto.randomUUID().slice(0, 8)}`;
    const createdAt = new Date().toISOString();
    payment.refunds.unshift({
      id,
      status: "SUCCEEDED",
      amountMinor,
      createdAt,
      ledgerTransactionId: `journal_${id}`,
    });
    payment.refundedMinor = (BigInt(payment.refundedMinor) + BigInt(amountMinor)).toString();
    payment.reservedMinor = payment.refundedMinor;
    payment.refundableMinor = (
      BigInt(payment.amountMinor) - BigInt(payment.reservedMinor)
    ).toString();
    keys.set(`refund:${key}`, { hash, id });
    const event: OutboxEvent = {
      id: `evt_${id}`,
      aggregateId: id,
      aggregateType: "Refund",
      eventType: "REFUND_SUCCEEDED",
      status: "PUBLISHED",
      attempts: 1,
      lastError: null,
      createdAt,
      availableAt: createdAt,
      publishedAt: createdAt,
      payload: { paymentId, refundId: id, amountMinor, currency: payment.currency },
    };
    events.unshift(event);
    payment.events.unshift(event);
    return { refundId: id, status: "SUCCEEDED" as Status };
  },
  async outbox() {
    return clone([...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100));
  },
  async activity(): Promise<Activity[]> {
    return clone(
      events
        .filter((e) => e.status === "PUBLISHED")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 100)
        .map((e) => ({
          id: e.id,
          eventType: e.eventType,
          aggregateId: e.aggregateId,
          createdAt: e.createdAt,
          payload: e.payload,
        })),
    );
  },
  async retry(id: string) {
    await wait();
    const event = events.find((e) => e.id === id)!;
    if (event.status !== "FAILED") throw new Error("Only failed events can be retried.");
    event.status = "PENDING";
    event.attempts = 0;
    event.lastError = null;
    window.setTimeout(() => {
      event.status = "PUBLISHED";
      event.attempts = 1;
      event.publishedAt = new Date().toISOString();
    }, 2000);
    return { requeued: true };
  },
  async accounts(currency: Currency): Promise<Account[]> {
    const selected = payments.filter((p) => p.currency === currency && p.status === "SUCCEEDED");
    if (!selected.length) return [];
    const rows = providers.map((provider) => {
      const rows = selected.filter((p) => p.provider === provider);
      return {
        id: accountId(provider, currency),
        name: `${provider}_HOLDING`,
        type: "PROVIDER",
        currency,
        balanceMinor: rows
          .reduce((sum, p) => sum + BigInt(p.amountMinor) - BigInt(p.refundedMinor), 0n)
          .toString(),
        entryCount: rows.length + rows.reduce((n, p) => n + p.refunds.length, 0),
      };
    });
    return [
      ...rows,
      {
        id: revenueId(currency),
        name: "REVENUE_ACCOUNT",
        type: "PLATFORM",
        currency,
        balanceMinor: rows.reduce((sum, r) => sum + BigInt(r.balanceMinor), 0n).toString(),
        entryCount: rows.reduce((sum, r) => sum + r.entryCount, 0),
      },
    ];
  },
  async ledger(id: string, currency: Currency): Promise<Ledger> {
    const accounts = await this.accounts(currency);
    const account = accounts.find((a) => a.id === id)!;
    const entries = payments
      .flatMap((p) => {
        const original =
          p.journal?.entries
            .filter((e) => e.accountId === id)
            .map((e) => ({
              ...e,
              transaction: {
                id: p.journal!.id,
                type: "PAYMENT",
                externalRef: p.paymentId,
                createdAt: p.createdAt,
              },
            })) ?? [];
        const reversals = p.refunds
          .filter((r) => r.status === "SUCCEEDED")
          .flatMap((r) =>
            original.map((e) => ({
              ...e,
              id: `${r.id}_${id}`,
              debitMinor: e.debitMinor === "0" ? r.amountMinor : "0",
              creditMinor: e.creditMinor === "0" ? r.amountMinor : "0",
              transaction: {
                id: r.ledgerTransactionId!,
                type: "REFUND",
                externalRef: r.id,
                createdAt: r.createdAt,
              },
            })),
          );
        return [...original, ...reversals];
      })
      .sort((a, b) => b.transaction.createdAt.localeCompare(a.transaction.createdAt));
    return clone({
      accountId: id,
      currency,
      balanceMinor: account?.balanceMinor ?? "0",
      entries: entries.slice(0, 100),
      limit: 100,
    });
  },
  async latestReport() {
    return clone(report);
  },
  async reconcile(provider: Provider, currency: Currency): Promise<Report> {
    await wait();
    const account = (await this.accounts(currency)).find((a) => a.name === `${provider}_HOLDING`);
    report = {
      id: `rec_${crypto.randomUUID().slice(0, 8)}`,
      provider,
      currency,
      expectedBalance: account?.balanceMinor ?? "0",
      actualBalance: account?.balanceMinor ?? "0",
      discrepancy: "0",
      createdAt: new Date().toISOString(),
    };
    return clone(report);
  },
};
