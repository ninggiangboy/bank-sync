import { eq, max, sql } from "drizzle-orm";
import { env } from "../config/env";
import type { Db } from "../db/client";
import { rawEmails, transactions, user } from "../db/schema";

const DAY_MS = 86_400_000;

/** Calendar day of an instant in a time zone, as days since the epoch. */
function localDay(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day")) / DAY_MS;
}

/**
 * Shifts every demo transaction (hidden ones included) and raw email by whole days so the newest
 * transaction falls on today in the display time zone. Returns the days moved (0 when current).
 */
export function refreshDemo(
  db: Db,
  { now = Date.now(), timeZone = env.APP_TIMEZONE, email = env.DEMO_USER_EMAIL } = {},
): { days: number; moved: number } {
  const demo = db.select({ id: user.id }).from(user).where(eq(user.email, email)).get();
  if (!demo) return { days: 0, moved: 0 };

  const newest = db
    .select({ value: max(transactions.occurredAt) })
    .from(transactions)
    .where(eq(transactions.userId, demo.id))
    .get()?.value;
  if (!newest) return { days: 0, moved: 0 };

  const days = localDay(now, timeZone) - localDay(newest.getTime(), timeZone);
  if (days === 0) return { days: 0, moved: 0 };

  const shift = days * DAY_MS;
  return db.transaction(
    (tx) => {
      const moved = tx
        .update(transactions)
        .set({ occurredAt: sql`${transactions.occurredAt} + ${shift}` })
        .where(eq(transactions.userId, demo.id))
        .returning({ id: transactions.id })
        .all().length;
      tx.update(rawEmails)
        .set({ receivedAt: sql`${rawEmails.receivedAt} + ${shift}` })
        .where(eq(rawEmails.userId, demo.id))
        .run();
      return { days, moved };
    },
    { behavior: "immediate" },
  );
}
