import { PaymentProvider } from "@prisma/client";
import { Scenario } from "../domain/operation";

export interface ChargeData {
  amountMinor: bigint;
  currency: string;
  idempotencyKey: string;
  scenario: Scenario;
  invocation: number;
}

export interface RefundData extends ChargeData {
  originalExternalRef: string;
}

export type ProcessorResult =
  | { status: "SUCCEEDED"; externalRef: string }
  | { status: "FAILED"; externalRef: string; error: string };

export interface PaymentAdapter {
  charge(data: ChargeData): Promise<ProcessorResult>;
  refund(data: RefundData): Promise<ProcessorResult>;
  lookup(idempotencyKey: string): Promise<ProcessorResult | null>;
  fetchBalance(currency: string): Promise<bigint>;
  getProvider(): PaymentProvider;
}
