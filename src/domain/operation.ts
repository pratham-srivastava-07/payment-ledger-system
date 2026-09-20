import { createHash } from "crypto";
import { PaymentProvider } from "@prisma/client";
import { DomainError } from "../errors/domainError";

export type Scenario = "SUCCESS" | "DECLINE" | "TIMEOUT_BEFORE" | "TIMEOUT_AFTER";

export function fingerprint(values: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

export function identifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(value)) {
    throw new DomainError("INVALID_IDENTIFIER", `${name} must contain 1-128 letters, digits, _, ., : or -`);
  }
  return value;
}

export function parseProvider(value: unknown): PaymentProvider {
  if (!Object.values(PaymentProvider).includes(value as PaymentProvider)) {
    throw new DomainError("INVALID_PROVIDER", "Unsupported payment provider");
  }
  return value as PaymentProvider;
}

export function parseScenario(value: unknown = "SUCCESS"): Scenario {
  if (!["SUCCESS", "DECLINE", "TIMEOUT_BEFORE", "TIMEOUT_AFTER"].includes(value as string)) {
    throw new DomainError("INVALID_SCENARIO", "Unsupported mock processor scenario");
  }
  return value as Scenario;
}
