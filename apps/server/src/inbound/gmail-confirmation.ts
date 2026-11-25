import { decodeHTML } from "entities";
import { htmlToText } from "../parsing/text-normalizer";

export const GMAIL_FORWARDING_SENDER = "forwarding-noreply@google.com";

const CONFIRMATION_HOSTS = new Set(["mail.google.com", "mail-settings.google.com"]);

export type GmailConfirmation = {
  /** The Gmail address that asked to forward. */
  gmailAddress: string;
  code: string;
  confirmUrl: string;
};

/** Only an https link on a Google mail host is accepted; anything else could point anywhere. */
function safeConfirmUrl(candidate: string): string | null {
  try {
    const url = new URL(decodeHTML(candidate).replace(/[.,;)\]]+$/, ""));
    return url.protocol === "https:" && CONFIRMATION_HOSTS.has(url.hostname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * Reads Gmail's forwarding confirmation mail: the numeric code, the confirmation link and the
 * address that asked to forward. The link is only ever shown to the user, never fetched here.
 */
export function parseGmailConfirmation(message: {
  subject: string;
  html: string | null;
  text: string | null;
}): GmailConfirmation | null {
  const body = message.html ? htmlToText(message.html) : (message.text ?? "");
  const haystack = `${message.subject}\n${body}`;

  const code =
    body.match(/(?:confirmation code|mã xác nhận)\D{0,30}(\d{6,12})/i)?.[1] ??
    message.subject.match(/#\s*(\d{6,12})/)?.[1];
  const gmailAddress =
    message.subject.match(/(?:Receive Mail from|Nhận thư từ)\s+([^\s]+@[^\s]+)/i)?.[1] ??
    body.match(/([^\s<>]+@[^\s<>]+)\s+(?:has requested|đã yêu cầu)/i)?.[1];

  const candidates = [
    ...(message.html?.matchAll(/href\s*=\s*["']([^"']+)["']/gi) ?? []),
    ...haystack.matchAll(/https:\/\/[^\s"'<>]+/g),
  ].map((m) => m[1] ?? m[0]);
  const confirmUrl = candidates.map(safeConfirmUrl).find((url) => url !== null);

  if (!code || !gmailAddress || !confirmUrl) return null;
  return { gmailAddress: gmailAddress.toLowerCase(), code, confirmUrl };
}
