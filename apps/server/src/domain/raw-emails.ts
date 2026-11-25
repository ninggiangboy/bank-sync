import type { EmailSource, Verification } from "@bank-sync/shared";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { rawEmails } from "../db/schema";
import type { FetchedMessage } from "../mail/fetched-message";
import { redact } from "../parsing/balance-redactor";
import { dispatch } from "../queue/queue";

export type RawEmailRow = typeof rawEmails.$inferSelect;

export type StoreEmailInput = {
  userId: string;
  inboundAddressId?: number | null;
  source: EmailSource;
  verification: Verification;
  dkimDomain?: string | null;
  message: FetchedMessage;
};

const MAX_FIELD = 250;
const limit = (value: string) => value.slice(0, MAX_FIELD);

/**
 * Stores a message once per (user, message id), with the account balance masked in both bodies,
 * and queues parsing only when the row is new. The whole step is one synchronous transaction.
 */
export function storeEmail(db: Db, input: StoreEmailInput): { row: RawEmailRow; created: boolean } {
  const { message } = input;
  return db.transaction(
    (tx) => {
      const messageId = limit(message.messageId);
      const inserted = tx
        .insert(rawEmails)
        .values({
          userId: input.userId,
          inboundAddressId: input.inboundAddressId ?? null,
          source: input.source,
          verification: input.verification,
          dkimDomain: input.dkimDomain ?? null,
          messageId,
          fromAddress: limit(message.from),
          subject: limit(message.subject),
          receivedAt: message.receivedAt,
          bodyHtml: message.html === null ? null : redact(message.html),
          bodyText: message.text === null ? null : redact(message.text),
        })
        .onConflictDoNothing()
        .returning()
        .get();

      if (inserted) {
        dispatch(
          tx,
          "parse-raw-email",
          { rawEmailId: inserted.id },
          { uniqueKey: `parse-raw-email:${inserted.id}` },
        );
        return { row: inserted, created: true };
      }

      const existing = tx
        .select()
        .from(rawEmails)
        .where(and(eq(rawEmails.userId, input.userId), eq(rawEmails.messageId, messageId)))
        .get();
      if (!existing) throw new Error("Raw email vanished during insert");
      return { row: existing, created: false };
    },
    { behavior: "immediate" },
  );
}
