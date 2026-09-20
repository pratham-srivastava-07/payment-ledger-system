import type { Currency } from "../types";

export const currencies: Currency[] = ["USD", "INR", "EUR", "GBP", "JPY", "KWD"];
export const exponents: Record<Currency, number> = {
  USD: 2,
  INR: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,
  KWD: 3,
};
const symbols: Record<Currency, string> = {
  USD: "$",
  INR: "\u20B9",
  EUR: "\u20AC",
  GBP: "\u00A3",
  JPY: "\u00A5",
  KWD: "KD ",
};

export function money(minor: string, currency: Currency = "USD", withSymbol = true) {
  const value = BigInt(minor);
  const absolute = value < 0n ? -value : value;
  const exponent = exponents[currency];
  const factor = 10n ** BigInt(exponent);
  const integer = new Intl.NumberFormat("en-US").format(absolute / factor);
  const fraction = exponent ? `.${(absolute % factor).toString().padStart(exponent, "0")}` : "";
  return `${value < 0n ? "-" : ""}${withSymbol ? symbols[currency] : ""}${integer}${fraction}`;
}

export function toMinor(input: string, currency: Currency) {
  const exponent = exponents[currency];
  if (
    !new RegExp(`^\\d+(?:\\.\\d{1,${Math.max(exponent, 1)}})?$`).test(input) ||
    (exponent === 0 && input.includes("."))
  ) {
    throw new Error(`Enter a positive amount with up to ${exponent} decimal places.`);
  }
  const [whole, fraction = ""] = input.split(".");
  const value =
    BigInt(whole) * 10n ** BigInt(exponent) + BigInt(fraction.padEnd(exponent, "0") || "0");
  if (value <= 0n || value > 9223372036854775807n)
    throw new Error("Enter an amount greater than zero within the supported range.");
  return value.toString();
}

export function relativeTime(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export const shortId = (id: string) =>
  id.length > 22 ? `${id.slice(0, 10)}\u2026${id.slice(-6)}` : id;
export const friendly = (value: string) =>
  value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (s) => s.toUpperCase());
