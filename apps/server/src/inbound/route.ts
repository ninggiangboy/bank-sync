import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { Elysia, status } from "elysia";
import type { Db } from "../db/client";
import { inboundReceipts } from "../db/schema";
import { findActiveByToken } from "../domain/inbound-addresses";
import { dispatch } from "../queue/queue";
import type { InboxFiles } from "./inbox-files";

export const MAX_CLOCK_SKEW_SECONDS = 300;

export type InboundRouteDeps = {
  db: Db;
  files: InboxFiles;
  secret: string;
  domain: string;
  maxBytes: number;
  now?: () => number;
};

/** Hex HMAC-SHA256 of `timestamp + "." + sha256(body)`, the value of `X-Inbound-Signature`. */
export function signInbound(secret: string, timestamp: string, body: Uint8Array): string {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  return createHmac("sha256", secret).update(`${timestamp}.${bodyHash}`).digest("hex");
}

/** Reads the request body, giving up as soon as it passes the cap. */
async function readCapped(request: Request, max: number): Promise<Uint8Array | null> {
  if (Number(request.headers.get("content-length")) > max) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body) {
    for await (const chunk of request.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > max) return null;
      chunks.push(chunk);
    }
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function signatureMatches(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * `POST /inbound/email`: the Cloudflare Email Worker pushes raw MIME here. The request only
 * authenticates, deduplicates and stores the message; parsing happens in a queued job.
 */
export const inboundRoutes = ({
  db,
  files,
  secret,
  domain,
  maxBytes,
  now = Date.now,
}: InboundRouteDeps) =>
  new Elysia({ prefix: "/inbound" }).post(
    "/email",
    async ({ request }) => {
      // Cheap checks first, so an unauthenticated caller cannot make the server buffer a large body.
      const timestamp = request.headers.get("x-inbound-timestamp") ?? "";
      const signature = request.headers.get("x-inbound-signature") ?? "";
      const age = Math.abs(now() / 1000 - Number(timestamp));
      if (!/^\d+$/.test(timestamp) || age > MAX_CLOCK_SKEW_SECONDS || signature === "") {
        throw status(401, "unauthorized");
      }
      const bytes = await readCapped(request, maxBytes);
      if (!bytes) throw status(413, "payload_too_large");
      if (!signatureMatches(signInbound(secret, timestamp, bytes), signature)) {
        throw status(401, "unauthorized");
      }

      const recipient = (request.headers.get("x-inbound-recipient") ?? "").trim().toLowerCase();
      const at = recipient.lastIndexOf("@");
      const address =
        at > 0 && recipient.slice(at + 1) === domain.toLowerCase()
          ? findActiveByToken(db, recipient.slice(0, at))
          : null;
      if (!address) throw status(404, "unknown_address");

      // Keyed by message and address: one email forwarded to two users is two receipts.
      const hash = createHash("sha256").update(bytes).digest("hex");
      const key = `${hash}-${address.id}`;
      if (db.select().from(inboundReceipts).where(eq(inboundReceipts.id, key)).get()) {
        return { status: "duplicate" as const };
      }

      // The file goes first, and the receipt and job are one transaction: a crash in between
      // leaves a file for the daily purge, never a receipt without a job.
      files.write(`${key}.eml`, bytes);
      db.transaction((tx) => {
        const fresh = tx
          .insert(inboundReceipts)
          .values({ id: key, receivedAt: new Date(now()) })
          .onConflictDoNothing()
          .returning({ id: inboundReceipts.id })
          .all();
        if (fresh.length === 0) return;
        dispatch(
          tx,
          "ingest-email",
          { file: `${key}.eml`, inboundAddressId: address.id },
          { maxAttempts: 5 },
        );
      });
      return { status: "accepted" as const };
    },
    { parse: "none" },
  );
