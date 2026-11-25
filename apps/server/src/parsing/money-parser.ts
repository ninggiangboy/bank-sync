import { nfc } from "./text-normalizer";

const DASHES = /[−–]/g;

type Money = { amount: number; currency: string };

function split(
  raw: string,
): { sign: string | undefined; integer: string; fraction: string } | null {
  const match = raw.match(/([+-])?\s*\$?\s*(\d[\d.,\s]*)/u);
  if (!match) return null;
  const number = (match[2] ?? "").replace(/[.,\s]+$/, "").replace(/\s+/g, "");
  const parts = number.match(/^(.*\d)[.,](\d{1,2})$/);
  return parts
    ? { sign: match[1], integer: parts[1] ?? "", fraction: parts[2] ?? "" }
    : { sign: match[1], integer: number, fraction: "" };
}

const digits = (value: string) => Number(value.replace(/\D/g, "") || "0");

/**
 * Parses a VND amount into a signed integer. Handles "1,250,000 VND", "-1.250.000 VND",
 * "+500,000đ", "1.250.000,00" and "1,250,000.00". A 2-digit fraction rounds half up.
 */
export function parse(value: string): number | null {
  const parts = split(nfc(value).replace(DASHES, "-"));
  if (!parts) return null;
  let integer = digits(parts.integer);
  if (parts.fraction !== "" && Number(parts.fraction.padEnd(2, "0")) >= 50) integer++;
  return parts.sign === "-" ? -integer : integer;
}

/** First currency marker wins, so "12.50 USD (325,000 VND)" is USD; no marker means VND. */
function currency(value: string): string {
  const marker = value.match(/VN[DĐ]|[đ₫]|\$|\b[A-Z]{3}\b/u)?.[0];
  if (!marker) return "VND";
  if (marker.includes("$")) return "USD";
  if (/^(VN[DĐ]|[đ₫])$/u.test(marker)) return "VND";
  return marker;
}

/**
 * Signed amount plus ISO currency. VND (or no marker) gives whole dong; any other currency gives
 * minor units, so "12.50 USD" is 1250. JPY and KRW have no minor unit but are stored times 100
 * like every foreign currency; the display layer reverses that.
 */
export function parseWithCurrency(value: string): Money | null {
  const code = currency(nfc(value));
  if (code === "VND") {
    const amount = parse(value);
    return amount === null ? null : { amount, currency: "VND" };
  }
  const parts = split(value.replace(DASHES, "-"));
  if (!parts) return null;
  const minor = digits(parts.integer) * 100 + Number(parts.fraction.padEnd(2, "0") || "0");
  return { amount: parts.sign === "-" ? -minor : minor, currency: code };
}
