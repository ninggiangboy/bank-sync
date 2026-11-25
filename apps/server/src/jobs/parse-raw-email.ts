import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { rawEmails, transactions } from "../db/schema";
import { apply } from "../domain/category-matcher";
import { makeParsedEmailInput } from "../parsing/email-input";
import { findParser } from "../parsing/parser-registry";
import { type ParsedTransaction, UnparseableEmailError } from "../parsing/types";

export type ParseRawEmailPayload = { rawEmailId: number };

/** Parses one stored email into a transaction. Parse failures are recorded on the row, not thrown. */
export function parseRawEmail(db: Db, { rawEmailId }: ParseRawEmailPayload): void {
  const raw = db.select().from(rawEmails).where(eq(rawEmails.id, rawEmailId)).get();
  if (!raw) return;

  const parser = findParser(raw.fromAddress, raw.subject);
  if (!parser) {
    db.update(rawEmails)
      .set({ parseError: "unsupported_sender", parsedAt: null })
      .where(eq(rawEmails.id, raw.id))
      .run();
    return;
  }

  const bankCode = parser.bankCode();
  let result: ParsedTransaction | null;
  try {
    result = parser.parse(
      makeParsedEmailInput(
        raw.fromAddress,
        raw.subject,
        raw.bodyHtml,
        raw.bodyText,
        raw.receivedAt,
      ),
    );
  } catch (error) {
    const reason =
      error instanceof UnparseableEmailError
        ? error.reason
        : `parser_error: ${error instanceof Error ? error.constructor.name : "Unknown"}`;
    db.update(rawEmails)
      .set({ bankCode, parseError: reason, parsedAt: null })
      .where(eq(rawEmails.id, raw.id))
      .run();
    // Ids and the reason only; never the email body.
    console.warn("Bank email could not be parsed", { rawEmailId: raw.id, bankCode, reason });
    return;
  }

  db.transaction(
    (tx) => {
      tx.update(rawEmails)
        .set({ bankCode, parseError: null, parsedAt: new Date() })
        .where(eq(rawEmails.id, raw.id))
        .run();
      if (!result) return;

      const fields = {
        userId: raw.userId,
        bankCode,
        direction: result.direction,
        amount: result.amount,
        currency: result.currency,
        originalAmount: result.originalAmount,
        amountEstimated: result.amountEstimated,
        unverified: raw.verification === "unverified",
        counterparty: result.counterparty,
        counterpartyAccount: result.counterpartyAccount,
        description: result.description,
        reference: result.reference,
        occurredAt: result.occurredAt,
      };
      // Includes soft-deleted rows, so a reparse never resurrects or duplicates a deleted transaction.
      // Category and note are left alone on reparse.
      const row = tx
        .insert(transactions)
        .values({ rawEmailId: raw.id, ...fields })
        .onConflictDoUpdate({ target: transactions.rawEmailId, set: fields })
        .returning()
        .get();
      if (row.categoryId === null) apply(tx, row);
    },
    { behavior: "immediate" },
  );
}
