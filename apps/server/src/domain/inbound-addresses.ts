import { and, eq, isNull } from "drizzle-orm";
import { env } from "../config/env";
import type { Db } from "../db/client";
import { inboundAddresses } from "../db/schema";
import { newInboundToken } from "../lib/tokens";

export type InboundAddressRow = typeof inboundAddresses.$inferSelect;

/** `<token>@INBOUND_DOMAIN`, the address a user's Gmail filter forwards to. */
export const addressOf = (token: string, domain = env.INBOUND_DOMAIN) => `${token}@${domain}`;

/** The user's active address, created on first use. */
export function getOrCreateActiveAddress(db: Db, userId: string): InboundAddressRow {
  return db.transaction(
    (tx) => {
      const active = tx
        .select()
        .from(inboundAddresses)
        .where(and(eq(inboundAddresses.userId, userId), isNull(inboundAddresses.replacedAt)))
        .get();
      if (active) return active;
      return tx
        .insert(inboundAddresses)
        .values({ userId, token: newInboundToken() })
        .returning()
        .get();
    },
    { behavior: "immediate" },
  );
}

/** Retires the active address and issues a new one; mail sent to the old one is rejected from now on. */
export function rotateAddress(db: Db, userId: string): InboundAddressRow {
  return db.transaction(
    (tx) => {
      tx.update(inboundAddresses)
        .set({ replacedAt: new Date() })
        .where(and(eq(inboundAddresses.userId, userId), isNull(inboundAddresses.replacedAt)))
        .run();
      return tx
        .insert(inboundAddresses)
        .values({ userId, token: newInboundToken() })
        .returning()
        .get();
    },
    { behavior: "immediate" },
  );
}

export function findActiveByToken(db: Db, token: string): InboundAddressRow | null {
  return (
    db
      .select()
      .from(inboundAddresses)
      .where(and(eq(inboundAddresses.token, token), isNull(inboundAddresses.replacedAt)))
      .get() ?? null
  );
}
