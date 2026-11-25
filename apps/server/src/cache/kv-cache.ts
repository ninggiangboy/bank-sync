import { eq, lte } from "drizzle-orm";
import type { Db } from "../db/client";
import { cache } from "../db/schema";

/**
 * Rate-limit counters over the `cache` table. `hit` counts one attempt; the window starts at the
 * first hit and the counter disappears `decaySeconds` later.
 */
export function createKvCache(db: Db, now: () => number = Date.now) {
  function live(key: string) {
    const row = db.select().from(cache).where(eq(cache.key, key)).get();
    if (!row) return null;
    if (row.expiresAt <= now()) {
      db.delete(cache).where(eq(cache.key, key)).run();
      return null;
    }
    return row;
  }

  return {
    /** Counts an attempt and returns the new total. */
    hit(key: string, decaySeconds = 60): number {
      return db.transaction(
        (tx) => {
          const row = tx.select().from(cache).where(eq(cache.key, key)).get();
          const current = row && row.expiresAt > now() ? row : null;
          const count = (current ? Number(current.value) : 0) + 1;
          const expiresAt = current ? current.expiresAt : now() + decaySeconds * 1000;
          tx.insert(cache)
            .values({ key, value: String(count), expiresAt })
            .onConflictDoUpdate({ target: cache.key, set: { value: String(count), expiresAt } })
            .run();
          return count;
        },
        { behavior: "immediate" },
      );
    },
    tooManyAttempts(key: string, maxAttempts: number): boolean {
      const row = live(key);
      return row !== null && Number(row.value) >= maxAttempts;
    },
    /** Seconds until the counter resets; 0 when there is none. */
    availableIn(key: string): number {
      const row = live(key);
      return row ? Math.max(0, Math.ceil((row.expiresAt - now()) / 1000)) : 0;
    },
    clear(key: string) {
      db.delete(cache).where(eq(cache.key, key)).run();
    },
    purgeExpired(): number {
      return db.delete(cache).where(lte(cache.expiresAt, now())).returning({ key: cache.key }).all()
        .length;
    },
  };
}
