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
import { demo } from "./demo";

export interface Connection {
  mode: "demo" | "live";
  token: string;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export function client(connection: Connection) {
  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`/api/v1${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${connection.token}`,
        ...options.headers,
      },
      signal: AbortSignal.timeout(20000),
    });
    const body = await response.json().catch(() => null);
    // A definitive decline is a valid operation result, not a transport error.
    if (response.status === 422 && body?.status === "FAILED") return body as T;
    if (!response.ok)
      throw new ApiError(
        response.status === 401
          ? "Your session has expired. Reconnect with a valid operator token."
          : (body?.error?.message ?? "Could not reach the API. Check that the backend is running."),
        response.status,
      );
    if (!body && response.status !== 204)
      throw new Error("The API returned an unexpected response.");
    return body as T;
  }
  const sample = connection.mode === "demo";
  return {
    overview: (currency: Currency, days: number) =>
      sample
        ? demo.overview(currency, days)
        : request<Overview>(`/console/overview?currency=${currency}&days=${days}`),
    list: (currency: Currency, days: number, status: string, search: string, page: number) =>
      sample
        ? demo.list(currency, days, status, search, page)
        : request<PaymentList>(
            `/console/payments?${new URLSearchParams({ currency, days: String(days), status, search, page: String(page) })}`,
          ),
    detail: (id: string) =>
      sample
        ? demo.detail(id)
        : request<PaymentDetail>(`/console/payments/${encodeURIComponent(id)}`),
    create: (input: PaymentInput, key: string) =>
      sample
        ? demo.create(input, key)
        : request<{ paymentId: string; status: Status }>("/payments", {
            method: "POST",
            headers: { "x-idempotency-key": key },
            body: JSON.stringify(input),
          }),
    refund: (paymentId: string, amountMinor: string, key: string) =>
      sample
        ? demo.refund(paymentId, amountMinor, key)
        : request<{ refundId: string; status: Status }>("/refunds", {
            method: "POST",
            headers: { "x-idempotency-key": key },
            body: JSON.stringify({ paymentId, amountMinor }),
          }),
    outbox: () => (sample ? demo.outbox() : request<OutboxEvent[]>("/outbox")),
    activity: () => (sample ? demo.activity() : request<Activity[]>("/activity")),
    retry: (id: string) =>
      sample
        ? demo.retry(id)
        : request<{ requeued: boolean }>(`/outbox/${encodeURIComponent(id)}/retry`, {
            method: "POST",
          }),
    accounts: (currency: Currency) =>
      sample
        ? demo.accounts(currency)
        : request<Account[]>(`/console/accounts?currency=${currency}`),
    ledger: (id: string, currency: Currency) =>
      sample ? demo.ledger(id, currency) : request<Ledger>(`/ledger/${encodeURIComponent(id)}`),
    latestReport: () =>
      sample ? demo.latestReport() : request<Report | null>("/reconciliation/report"),
    reconcile: (provider: Provider, currency: Currency) =>
      sample
        ? demo.reconcile(provider, currency)
        : request<Report>("/reconciliation/trigger", {
            method: "POST",
            body: JSON.stringify({ provider, currency }),
          }),
    capabilities: () =>
      sample
        ? Promise.resolve({ mockScenarios: true, transport: "Sample inbox" })
        : request<{ mockScenarios: boolean; transport: string }>("/console/capabilities"),
  };
}
export type Client = ReturnType<typeof client>;
