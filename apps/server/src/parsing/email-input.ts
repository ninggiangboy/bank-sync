import { clean, htmlToText } from "./text-normalizer";
import type { ParsedEmailInput } from "./types";

/** Builds the normalized text from HTML when present, otherwise from the plain-text part. */
export function makeParsedEmailInput(
  from: string,
  subject: string,
  html: string | null,
  text: string | null,
  receivedAt: Date,
): ParsedEmailInput {
  return {
    from: from.trim().toLowerCase(),
    subject: clean(subject),
    html,
    text: html?.trim() ? htmlToText(html) : clean(text ?? ""),
    receivedAt,
  };
}
