import { and, count, desc, eq, gte, isNotNull, isNull, max } from "drizzle-orm";
import { env } from "../config/env";
import type { Db } from "../db/client";
import { forwardingConfirmations, rawEmails, transactions } from "../db/schema";
import { BANKS } from "../parsing/banks-config";
import { gmailFilterXml } from "./gmail-filter-xml";
import { addressOf, getOrCreateActiveAddress } from "./inbound-addresses";

export const CONFIRMATION_WINDOW_MS = 24 * 60 * 60 * 1000;

export const bankSenders = () =>
  Object.entries(BANKS).map(([code, bank]) => ({
    bankCode: code,
    name: bank.name,
    senders: [...bank.senders],
  }));

export function forwardingState(db: Db, userId: string, now = Date.now()) {
  const active = getOrCreateActiveAddress(db, userId);

  const confirmation = db
    .select()
    .from(forwardingConfirmations)
    .where(
      and(
        eq(forwardingConfirmations.userId, userId),
        eq(forwardingConfirmations.inboundAddressId, active.id),
        gte(forwardingConfirmations.receivedAt, new Date(now - CONFIRMATION_WINDOW_MS)),
      ),
    )
    .orderBy(desc(forwardingConfirmations.receivedAt), desc(forwardingConfirmations.id))
    .get();

  const received = new Map(
    db
      .select({ bankCode: rawEmails.bankCode, at: max(rawEmails.receivedAt) })
      .from(rawEmails)
      .where(and(eq(rawEmails.userId, userId), isNotNull(rawEmails.bankCode)))
      .groupBy(rawEmails.bankCode)
      .all()
      .map((row) => [row.bankCode, row.at]),
  );

  const unverifiedCount =
    db
      .select({ value: count() })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.unverified, true),
          isNull(transactions.deletedAt),
        ),
      )
      .get()?.value ?? 0;

  return {
    address: addressOf(active.token),
    confirmation: confirmation
      ? {
          gmailAddress: confirmation.gmailAddress,
          code: confirmation.code,
          confirmUrl: confirmation.confirmUrl,
          receivedAt: confirmation.receivedAt.toISOString(),
        }
      : null,
    banks: bankSenders().map((bank) => ({
      ...bank,
      lastReceivedAt: received.get(bank.bankCode)?.toISOString() ?? null,
    })),
    unverifiedCount,
  };
}

export function filterXml(db: Db, userId: string): string {
  const active = getOrCreateActiveAddress(db, userId);
  return gmailFilterXml({
    senders: bankSenders().flatMap((bank) => bank.senders),
    forwardTo: addressOf(active.token),
    label: env.APP_NAME,
  });
}
