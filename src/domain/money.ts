import { DomainError } from "../errors/domainError";

export const currencyExponents: Record<string, number> = {
  USD: 2,
  INR: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,
  KWD: 3,
};
export const MAX_MINOR = 9223372036854775807n;

export function parseMinor(value: unknown): bigint {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new DomainError(
      "INVALID_AMOUNT",
      "amountMinor must be a positive safe integer or digit string",
    );
  }
  if (
    !(typeof value === "number" || typeof value === "string" || typeof value === "bigint") ||
    !/^[1-9][0-9]*$/.test(String(value))
  ) {
    throw new DomainError(
      "INVALID_AMOUNT",
      "amountMinor must be a positive integer in minor units",
    );
  }
  const amount = BigInt(value);
  if (amount > MAX_MINOR)
    throw new DomainError("INVALID_AMOUNT", "amountMinor exceeds int64 range");
  return amount;
}

export function parseCurrency(value: unknown = "USD"): string {
  if (typeof value !== "string" || !Object.hasOwn(currencyExponents, value)) {
    throw new DomainError("INVALID_CURRENCY", "Supported currencies: USD, INR, EUR, GBP, JPY, KWD");
  }
  return value;
}
