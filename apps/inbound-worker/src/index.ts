import { BANK_SENDERS } from "./senders.generated";

export type Env = {
  /** Public URL of the server's inbound endpoint. */
  INBOUND_URL: string;
  /** Shared HMAC secret; must equal the server's INBOUND_WEBHOOK_SECRET. */
  INBOUND_WEBHOOK_SECRET: string;
  /** Largest message to forward, in bytes. */
  INBOUND_MAX_BYTES?: string;
};

/** The parts of Cloudflare's `ForwardableEmailMessage` this Worker uses. */
export type InboundMessage = {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  setReject(reason: string): void;
};

const GMAIL_FORWARDING_SENDER = "forwarding-noreply@google.com";
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = new Set([...BANK_SENDERS, GMAIL_FORWARDING_SENDER]);

/** "Name <a@b.c>" becomes "a@b.c", lowercased. */
const address = (value: string | null) =>
  (value?.match(/<([^>]+)>/)?.[1] ?? value ?? "").trim().toLowerCase();

const toHex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

async function sign(secret: string, timestamp: string, body: Uint8Array): Promise<string> {
  const bodyHash = toHex(await crypto.subtle.digest("SHA-256", body));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${bodyHash}`),
  );
  return toHex(mac);
}

async function readCapped(
  stream: ReadableStream<Uint8Array>,
  max: number,
): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > max) return null;
    chunks.push(chunk);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * Forwards mail from a bank (or Gmail's forwarding confirmation) to the server, signed with an
 * HMAC. Mail from anyone else is accepted and dropped without a bounce. A failure to reach the
 * server throws so Cloudflare reports the delivery as failed instead of silently losing it. The
 * message content and headers are never logged.
 */
export async function handleEmail(
  message: InboundMessage,
  env: Env,
  send: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<void> {
  const known =
    ALLOWED.has(address(message.from)) || ALLOWED.has(address(message.headers.get("from")));
  if (!known) return;

  const max = Number(env.INBOUND_MAX_BYTES) || DEFAULT_MAX_BYTES;
  const body = message.rawSize > max ? null : await readCapped(message.raw, max);
  if (!body) {
    message.setReject("Message too large");
    return;
  }

  const timestamp = String(Math.floor(now() / 1000));
  const response = await send(env.INBOUND_URL, {
    method: "POST",
    headers: {
      "content-type": "message/rfc822",
      "x-inbound-timestamp": timestamp,
      "x-inbound-signature": await sign(env.INBOUND_WEBHOOK_SECRET, timestamp, body),
      "x-inbound-recipient": message.to,
    },
    body,
  });

  if (response.status === 404) {
    message.setReject("Unknown address");
    return;
  }
  if (!response.ok) throw new Error(`Inbound endpoint answered HTTP ${response.status}`);
}

export default {
  async email(message: InboundMessage, env: Env): Promise<void> {
    await handleEmail(message, env);
  },
};
