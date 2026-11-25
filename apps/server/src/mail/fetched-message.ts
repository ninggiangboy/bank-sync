import { simpleParser } from "mailparser";

export type FetchedMessage = {
  messageId: string;
  /** Lowercase address only. */
  from: string;
  subject: string;
  receivedAt: Date;
  html: string | null;
  text: string | null;
};

/** Parses raw MIME. Without a Message-ID the id is a sha1 of the sender, date, subject and bodies. */
export async function fromEml(raw: Uint8Array | string): Promise<FetchedMessage> {
  const parsed = await simpleParser(typeof raw === "string" ? Buffer.from(raw) : Buffer.from(raw));
  const from = (parsed.from?.value[0]?.address ?? "").toLowerCase();
  const subject = (parsed.subject ?? "").trim();
  const html = typeof parsed.html === "string" ? parsed.html : null;
  // mailparser invents a wrapped plain text for HTML-only mail; keep only a real text/plain part.
  const text = html !== null && !hasTextPart(raw) ? null : (parsed.text ?? null);
  const receivedAt = parsed.date ?? new Date();
  const messageId = parsed.messageId?.trim();

  return {
    messageId:
      messageId || `sha1-${sha1([from, parsed.date?.toISOString() ?? "", subject, html, text])}`,
    from,
    subject,
    receivedAt,
    html,
    text,
  };
}

function hasTextPart(raw: Uint8Array | string): boolean {
  const source = typeof raw === "string" ? raw : Buffer.from(raw).toString("latin1");
  return /^content-type:\s*text\/plain/im.test(source);
}

function sha1(parts: unknown[]): string {
  return new Bun.CryptoHasher("sha1").update(JSON.stringify(parts)).digest("hex");
}
