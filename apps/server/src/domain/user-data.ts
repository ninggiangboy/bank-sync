import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  categories,
  categoryRules,
  forwardingConfirmations,
  inboundAddresses,
  rawEmails,
  transactions,
} from "../db/schema";

/**
 * Wipes everything the user collected except the login: transactions (hidden ones too), rules, the
 * user's own categories, raw emails, forwarding confirmations and inbound addresses. The user gets a
 * fresh address afterwards, so a Gmail filter still pointing at the old one stops delivering.
 */
export function deleteUserData(db: Db, userId: string): void {
  db.transaction(
    (tx) => {
      tx.delete(transactions).where(eq(transactions.userId, userId)).run();
      tx.delete(categoryRules).where(eq(categoryRules.userId, userId)).run();
      tx.delete(categories).where(eq(categories.userId, userId)).run();
      tx.delete(rawEmails).where(eq(rawEmails.userId, userId)).run();
      tx.delete(forwardingConfirmations).where(eq(forwardingConfirmations.userId, userId)).run();
      tx.delete(inboundAddresses).where(eq(inboundAddresses.userId, userId)).run();
    },
    { behavior: "immediate" },
  );
}
