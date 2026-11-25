import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { jobs } from "../db/schema";

export type JobHandler = (payload: never) => void | Promise<void>;
export type JobHandlers = Record<string, JobHandler>;

export type WorkerOptions = {
  db: Db;
  handlers: JobHandlers;
  pollMs?: number;
  /** A job running longer than this is abandoned and retried. */
  timeoutMs?: number;
  /** Delay before attempt `n + 1` after attempt `n` failed. */
  backoffMs?: (attempts: number) => number;
  log?: (message: string, fields: Record<string, unknown>) => void;
};

type Claimed = {
  id: number;
  name: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
};

const defaultBackoff = (attempts: number) => Math.min(60_000 * 2 ** (attempts - 1), 15 * 60_000);

/**
 * Polls the jobs table and runs one job at a time. A claim is a single synchronous immediate
 * transaction, so two workers never take the same job. A reservation older than the timeout
 * belonged to a crashed run and is claimed again.
 */
export function createWorker(options: WorkerOptions) {
  const {
    db,
    handlers,
    pollMs = 1000,
    timeoutMs = 60_000,
    backoffMs = defaultBackoff,
    log = (message, fields) => console.warn(message, fields),
  } = options;
  let running = false;
  let loop: Promise<void> | null = null;
  let wake: (() => void) | null = null;

  function claim(): Claimed | null {
    return db.transaction(
      (tx) => {
        const now = Date.now();
        const row = tx
          .select()
          .from(jobs)
          .where(
            and(
              isNull(jobs.failedAt),
              lte(jobs.availableAt, new Date(now)),
              or(isNull(jobs.reservedAt), lte(jobs.reservedAt, new Date(now - timeoutMs * 2))),
            ),
          )
          .orderBy(asc(jobs.availableAt), asc(jobs.id))
          .limit(1)
          .get();
        if (!row) return null;
        tx.update(jobs)
          .set({ reservedAt: new Date(now), attempts: row.attempts + 1 })
          .where(eq(jobs.id, row.id))
          .run();
        return {
          id: row.id,
          name: row.name,
          payload: row.payload,
          attempts: row.attempts + 1,
          maxAttempts: row.maxAttempts,
        };
      },
      { behavior: "immediate" },
    );
  }

  function fail(job: Claimed, error: unknown) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const exhausted = job.attempts >= job.maxAttempts;
    log("Job failed", { job: job.name, jobId: job.id, attempts: job.attempts, exhausted });
    db.update(jobs)
      .set(
        exhausted
          ? { failedAt: new Date(), reservedAt: null, lastError: message }
          : {
              reservedAt: null,
              lastError: message,
              availableAt: new Date(Date.now() + backoffMs(job.attempts)),
            },
      )
      .where(eq(jobs.id, job.id))
      .run();
  }

  /** Runs the next due job. Returns false when there was nothing to do. */
  async function runOnce(): Promise<boolean> {
    const job = claim();
    if (!job) return false;

    const handler = handlers[job.name];
    if (!handler) {
      fail({ ...job, attempts: job.maxAttempts }, new Error(`No handler for job "${job.name}"`));
      return true;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(() => handler(job.payload as never)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Job timed out")), timeoutMs);
        }),
      ]);
      db.delete(jobs).where(eq(jobs.id, job.id)).run();
    } catch (error) {
      fail(job, error);
    } finally {
      clearTimeout(timer);
    }
    return true;
  }

  async function run() {
    while (running) {
      let worked = false;
      try {
        worked = await runOnce();
      } catch (error) {
        log("Worker error", { error: error instanceof Error ? error.message : String(error) });
      }
      if (!worked && running) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, pollMs);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        wake = null;
      }
    }
  }

  return {
    runOnce,
    /** Runs jobs until none are due. Used by tests and the CLI. */
    async drain() {
      while (await runOnce());
    },
    start() {
      if (running) return;
      running = true;
      loop = run();
    },
    /** Finishes the job in progress, then stops polling. */
    async stop() {
      running = false;
      wake?.();
      await loop;
      loop = null;
    },
  };
}

export type Worker = ReturnType<typeof createWorker>;
