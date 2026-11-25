import { decodeHTML } from "entities";

export function nfc(text: string): string {
  return text.normalize("NFC");
}

/**
 * Converts an HTML body into plain text: one line per block or table row, cells separated by a
 * single space, whitespace collapsed.
 */
export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<(head|style|script|title)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|tbody|thead)>/gi, "\n")
    .replace(/<(td|th)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "");
  return clean(decodeHTML(stripped));
}

export function clean(text: string): string {
  return nfc(text)
    .replace(/\r\n?/g, "\n")
    .replace(/[   ​\t ]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join("\n");
}

/** Lowercase, strip Vietnamese diacritics, collapse whitespace. Used for rule matching. */
export function fold(text: string | null | undefined): string {
  if (text == null) return "";
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}+/gu, "")
    .replaceAll("đ", "d")
    .replace(/\s+/gu, " ")
    .trim();
}
