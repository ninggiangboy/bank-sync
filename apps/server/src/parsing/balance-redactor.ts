import { nfc } from "./text-normalizer";

export const MASK = "***";

const LABEL = [
  String.raw`Số dư(?:\s+khả\s+dụng|\s+cuối|\s+sau\s+giao\s+dịch)?(?:\s*\/\s*Balance)?\s*:?`,
  String.raw`(?<![\p{L}\d])SD\s*:`,
  String.raw`(?<![\p{L}\d])Balance\s*:`,
].join("|");
/** Whitespace, &nbsp; or tags between the label and the amount. */
const GAP = String.raw`(?:\s|&nbsp;|<[^>]*>)*`;
const AMOUNT = String.raw`(?:VND\s*)?[+-]?\d[\d.,]*(?:\s*(?:VND|đ))?`;

const PATTERN = new RegExp(`((?:${LABEL})${GAP})${AMOUNT}`, "giu");

/**
 * Masks the account balance in a bank email body so it is never stored. Keeps the label
 * ("Số dư cuối:", "SD:") and replaces only the amount with ***.
 */
export function redact(body: string): string;
export function redact(body: string | null): string | null;
export function redact(body: string | null): string | null {
  if (body === null) return null;
  return nfc(body).replace(PATTERN, `$1${MASK}`);
}
