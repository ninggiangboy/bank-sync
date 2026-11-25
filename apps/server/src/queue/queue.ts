import { and, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { jobs } from "../db/schema";

export type DispatchOptions = {
  /** At most one pending job per key; a repeat while one is pending is dropped. */
  uniqueKey?: string;
  delayMs?: number;
  maxAttempts?: number;
};

/** Adds a job. Returns false when a pending job with the same unique key already exists. */
export function dispatch(
  db: DbOrTx,
  name: string,
  payload: unknown,
  options: DispatchOptions = {},
): boolean {
  const result = db
    .insert(jobs)
    .values({
      name,
      payload,
      uniqueKey: options.uniqueKey ?? null,
      maxAttempts: options.maxAttempts ?? 3,
      availableAt: new Date(Date.now() + (options.delayMs ?? 0)),
    })
    .onConflictDoNothing()
    .returning({ id: jobs.id })
    .all();
  return result.length > 0;
}

/** Removes a pending job by its unique key, e.g. after the work was done inline. */
export function cancelPending(db: DbOrTx, uniqueKey: string): void {
  db.delete(jobs)
    .where(and(eq(jobs.uniqueKey, uniqueKey), isNull(jobs.reservedAt), isNull(jobs.failedAt)))
    .run();
}
