export type Status = "CREATED" | "PROCESSING" | "UNKNOWN" | "SUCCEEDED" | "FAILED";
export type Currency = "USD" | "INR" | "EUR" | "GBP" | "JPY" | "KWD";
export type Provider = "STRIPE" | "PAYPAL" | "RAZORPAY";
export type Scenario = "SUCCESS" | "DECLINE" | "TIMEOUT_BEFORE" | "TIMEOUT_AFTER";
export type Page = "overview" | "payments" | "ledger" | "delivery" | "reconciliation";
export interface Payment {
  paymentId: string;
  amountMinor: string;
  currency: Currency;
  provider: Provider;
  status: Status;
  transactionId: string | null;
  externalRef: string | null;
  error: string | null;
  createdAt: string;
  refundedMinor: string;
  reservedMinor: string;
}
export interface Refund {
  id: string;
  amountMinor: string;
  status: Status;
  createdAt: string;
  ledgerTransactionId: string | null;
}
export interface Entry {
  id: string;
  accountId: string;
  debitMinor: string;
  creditMinor: string;
  account?: { name: string; type: string };
  transaction?: { id: string; type: string; createdAt: string; externalRef: string };
}
export interface PaymentDetail extends Payment {
  idempotencyKey: string;
  scenario: Scenario;
  lastError: string | null;
  refundableMinor: string;
  attempts: {
    id: string;
    status: Status;
    externalRef: string | null;
    invocations: number;
    createdAt: string;
    updatedAt: string;
  }[];
  refunds: Refund[];
  journal: { id: string; createdAt: string; entries: Entry[] } | null;
  events: OutboxEvent[];
}
export interface OutboxEvent {
  id: string;
  eventType: string;
  aggregateId: string;
  aggregateType: string;
  status: "PENDING" | "PUBLISHED" | "FAILED";
  attempts: number;
  lastError: string | null;
  availableAt: string;
  publishedAt: string | null;
  createdAt: string;
  payload: Record<string, unknown>;
}
export interface Activity {
  id: string;
  eventType: string;
  aggregateId: string;
  createdAt: string;
  payload: Record<string, unknown>;
}
export interface Overview {
  currency: Currency;
  days: number;
  totalPayments: number;
  succeeded: number;
  failed: number;
  pending: number;
  volumeMinor: string;
  refundedMinor: string;
  journalCount: number;
  unbalancedJournals: number;
  outbox: { pending: number; published: number; failed: number };
  series: { date: string; amountMinor: string; count: number }[];
  checkedAt: string;
}
export interface Account {
  id: string;
  name: string;
  type: string;
  currency: Currency;
  balanceMinor: string;
  entryCount: number;
}
export interface Ledger {
  accountId: string;
  currency: Currency;
  balanceMinor: string;
  entries: Entry[];
  limit: number;
}
export interface Report {
  id: string;
  provider: Provider;
  currency: Currency;
  expectedBalance: string;
  actualBalance: string;
  discrepancy: string;
  createdAt: string;
}
export interface PaymentInput {
  amountMinor: string;
  provider: Provider;
  currency: Currency;
  scenario: Scenario;
}
export interface PaymentList {
  items: Payment[];
  total: number;
  page: number;
  pageSize: number;
}
