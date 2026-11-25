import { and, desc, eq, notInArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { forwardingConfirmations, inboundAddresses } from "../db/schema";
import { storeEmail } from "../domain/raw-emails";
import { type DnsResolver, verifyDkim } from "../inbound/dkim";
import { GMAIL_FORWARDING_SENDER, parseGmailConfirmation } from "../inbound/gmail-confirmation";
import type { InboxFiles } from "../inbound/inbox-files";
import { fromEml } from "../mail/fetched-message";
import { findParser } from "../parsing/parser-registry";

export type IngestEmailPayload = { file: string; inboundAddressId: number };

export type IngestDeps = {
  db: Db;
  files: InboxFiles;
  resolver?: DnsResolver;
};

const KEPT_CONFIRMATIONS = 5;

/**
 * Handles one message the Email Worker delivered: a Gmail forwarding confirmation is saved for the
 * user, a bank email is DKIM-checked and stored, anything else is dropped. Nothing about the
 * content is logged. The pending file is removed once the message is handled; if handling throws,
 * the file stays so the retry can read it again (the daily purge removes leftovers).
 */
export async function ingestEmail(
  { db, files, resolver }: IngestDeps,
  { file, inboundAddressId }: IngestEmailPayload,
  meta: { attempt: number; maxAttempts: number } = { attempt: 1, maxAttempts: 1 },
): Promise<void> {
  const raw = files.read(file);
  if (!raw) return;

  const address = db
    .select()
    .from(inboundAddresses)
    .where(eq(inboundAddresses.id, inboundAddressId))
    .get();
  if (!address) {
    files.remove(file);
    return;
  }

  const message = await fromEml(raw);

  if (message.from === GMAIL_FORWARDING_SENDER) {
    // Only mail Google itself signed is trusted; anyone can write this From address.
    const signed = await verifyDkim(raw, resolver ? { resolver } : {});
    if (signed.temporaryFailure && meta.attempt < meta.maxAttempts) {
      throw new Error("DKIM lookup failed temporarily");
    }
    const confirmation =
      signed.pass && signed.from === message.from ? parseGmailConfirmation(message) : null;
    if (confirmation) saveConfirmation(db, address, confirmation, message.receivedAt);
    files.remove(file);
    return;
  }

  if (!findParser(message.from, message.subject)) {
    console.info("Inbound mail dropped", { inboundAddressId, reason: "not_bank_sender" });
    files.remove(file);
    return;
  }

  const dkim = await verifyDkim(raw, resolver ? { resolver } : {});
  // On the last attempt a lookup that still fails stores the mail as unverified instead of losing it.
  if (dkim.temporaryFailure && meta.attempt < meta.maxAttempts) {
    throw new Error("DKIM lookup failed temporarily");
  }

  // Both parsers must agree on who the sender is, or the signature proves nothing about it.
  const verified = dkim.pass && dkim.from === message.from;

  storeEmail(db, {
    userId: address.userId,
    inboundAddressId: address.id,
    source: "forward",
    verification: verified ? "dkim_pass" : "unverified",
    dkimDomain: verified ? (dkim.domain ?? null) : null,
    message,
  });
  files.remove(file);
}

function saveConfirmation(
  db: Db,
  address: typeof inboundAddresses.$inferSelect,
  confirmation: { gmailAddress: string; code: string; confirmUrl: string },
  receivedAt: Date,
) {
  db.transaction(
    (tx) => {
      tx.insert(forwardingConfirmations)
        .values({
          userId: address.userId,
          inboundAddressId: address.id,
          gmailAddress: confirmation.gmailAddress,
          code: confirmation.code,
          confirmUrl: confirmation.confirmUrl,
          receivedAt,
        })
        .onConflictDoNothing()
        .run();
      const keep = tx
        .select({ id: forwardingConfirmations.id })
        .from(forwardingConfirmations)
        .where(eq(forwardingConfirmations.userId, address.userId))
        .orderBy(desc(forwardingConfirmations.receivedAt), desc(forwardingConfirmations.id))
        .limit(KEPT_CONFIRMATIONS)
        .all()
        .map((row) => row.id);
      tx.delete(forwardingConfirmations)
        .where(
          and(
            eq(forwardingConfirmations.userId, address.userId),
            notInArray(forwardingConfirmations.id, keep),
          ),
        )
        .run();
    },
    { behavior: "immediate" },
  );
}
