import { lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { inboundReceipts } from "../db/schema";
import type { InboxFiles } from "../inbound/inbox-files";

const DAY_MS = 86_400_000;

/** Removes replay receipts and pending message files older than a day; the Worker never retries that late. */
export function purgeInbound(db: Db, files: InboxFiles, now = Date.now()) {
  const receipts = db
    .delete(inboundReceipts)
    .where(lt(inboundReceipts.receivedAt, new Date(now - DAY_MS)))
    .returning({ id: inboundReceipts.id })
    .all().length;
  return { receipts, files: files.purgeOlderThan(DAY_MS, now) };
}
