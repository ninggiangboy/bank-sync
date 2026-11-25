import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createKvCache } from "../../src/cache/kv-cache";
import { jobs } from "../../src/db/schema";
import { createTestDb } from "../../src/db/test-db";
import { cancelPending, dispatch } from "../../src/queue/queue";
import { createWorker, type JobHandlers } from "../../src/queue/worker";

function setup(handlers: JobHandlers, extra: { timeoutMs?: number } = {}) {
  const db = createTestDb();
  const worker = createWorker({ db, handlers, log: () => {}, backoffMs: () => 0, ...extra });
  return { db, worker };
}

const allJobs = (db: ReturnType<typeof createTestDb>) => db.select().from(jobs).all();

describe("queue", () => {
  test("dispatch collapses pending jobs with the same unique key", () => {
    const { db } = setup({});
    expect(dispatch(db, "a", { n: 1 }, { uniqueKey: "k" })).toBe(true);
    expect(dispatch(db, "a", { n: 2 }, { uniqueKey: "k" })).toBe(false);
    expect(dispatch(db, "a", { n: 3 })).toBe(true);
    expect(dispatch(db, "a", { n: 4 })).toBe(true);
    expect(allJobs(db)).toHaveLength(3);
  });

  test("a running job does not block a new one with the same key", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { db, worker } = setup({ slow: () => gate });
    dispatch(db, "slow", {}, { uniqueKey: "k" });
    const running = worker.runOnce();
    expect(dispatch(db, "slow", {}, { uniqueKey: "k" })).toBe(true);
    release();
    await running;
  });

  test("cancelPending removes only the pending job", () => {
    const { db } = setup({});
    dispatch(db, "a", {}, { uniqueKey: "k" });
    cancelPending(db, "k");
    expect(allJobs(db)).toHaveLength(0);
  });

  test("a successful job passes its payload and is deleted", async () => {
    const seen: unknown[] = [];
    const { db, worker } = setup({ echo: (payload: unknown) => void seen.push(payload) });
    dispatch(db, "echo", { hello: "world" });
    expect(await worker.runOnce()).toBe(true);
    expect(seen).toEqual([{ hello: "world" }]);
    expect(allJobs(db)).toHaveLength(0);
    expect(await worker.runOnce()).toBe(false);
  });

  test("a delayed job waits until it is due", async () => {
    const { db, worker } = setup({ a: () => {} });
    dispatch(db, "a", {}, { delayMs: 60_000 });
    expect(await worker.runOnce()).toBe(false);
  });

  test("a failing job is retried and then marked failed with its error", async () => {
    let calls = 0;
    const { db, worker } = setup({
      boom: () => {
        calls++;
        throw new Error("nope");
      },
    });
    dispatch(db, "boom", {}, { maxAttempts: 3 });
    await worker.drain();
    expect(calls).toBe(3);
    const [job] = allJobs(db);
    expect(job).toMatchObject({ attempts: 3, lastError: "Error: nope", reservedAt: null });
    expect(job?.failedAt).not.toBeNull();
    expect(await worker.runOnce()).toBe(false);
  });

  test("a retry waits for its backoff", async () => {
    const db = createTestDb();
    const worker = createWorker({
      db,
      handlers: {
        boom: () => {
          throw new Error("x");
        },
      },
      log: () => {},
      backoffMs: () => 60_000,
    });
    dispatch(db, "boom", {});
    expect(await worker.runOnce()).toBe(true);
    expect(await worker.runOnce()).toBe(false);
  });

  test("a job that fails then succeeds is deleted", async () => {
    let calls = 0;
    const { db, worker } = setup({
      flaky: () => {
        if (++calls === 1) throw new Error("once");
      },
    });
    dispatch(db, "flaky", {});
    await worker.drain();
    expect(calls).toBe(2);
    expect(allJobs(db)).toHaveLength(0);
  });

  test("a job without a handler fails at once", async () => {
    const { db, worker } = setup({});
    dispatch(db, "ghost", {});
    await worker.drain();
    expect(allJobs(db)[0]?.failedAt).not.toBeNull();
  });

  test("a job that runs too long is abandoned and retried", async () => {
    const { db, worker } = setup({ hang: () => new Promise(() => {}) }, { timeoutMs: 20 });
    dispatch(db, "hang", {}, { maxAttempts: 1 });
    await worker.runOnce();
    expect(allJobs(db)[0]).toMatchObject({ lastError: "Error: Job timed out" });
  });

  test("a stale reservation from a crashed run is claimed again", async () => {
    const seen: number[] = [];
    const { db, worker } = setup({ a: (n: number) => void seen.push(n) }, { timeoutMs: 1000 });
    dispatch(db, "a", 7);
    db.update(jobs)
      .set({ reservedAt: new Date(Date.now() - 10_000), attempts: 1 })
      .run();
    await worker.drain();
    expect(seen).toEqual([7]);
  });

  test("a fresh reservation is left alone", async () => {
    const { db, worker } = setup({ a: () => {} }, { timeoutMs: 60_000 });
    dispatch(db, "a", {});
    db.update(jobs).set({ reservedAt: new Date() }).run();
    expect(await worker.runOnce()).toBe(false);
  });

  test("two claims never take the same job", async () => {
    const calls: number[] = [];
    const { db, worker } = setup({ a: (n: number) => void calls.push(n) });
    dispatch(db, "a", 1);
    const [first, second] = await Promise.all([worker.runOnce(), worker.runOnce()]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(calls).toEqual([1]);
  });

  test("start and stop process jobs and shut down cleanly", async () => {
    const seen: number[] = [];
    const db = createTestDb();
    const worker = createWorker({
      db,
      handlers: { a: (n: number) => void seen.push(n) },
      pollMs: 5,
      log: () => {},
    });
    worker.start();
    dispatch(db, "a", 1);
    await Bun.sleep(60);
    await worker.stop();
    expect(seen).toEqual([1]);
    expect(db.select().from(jobs).where(eq(jobs.name, "a")).all()).toHaveLength(0);
  });
});

describe("kv cache", () => {
  test("counts attempts inside a window and resets after it", () => {
    let now = 1_000_000;
    const cache = createKvCache(createTestDb(), () => now);
    expect(cache.hit("login:a", 60)).toBe(1);
    expect(cache.hit("login:a", 60)).toBe(2);
    expect(cache.tooManyAttempts("login:a", 3)).toBe(false);
    expect(cache.hit("login:a", 60)).toBe(3);
    expect(cache.tooManyAttempts("login:a", 3)).toBe(true);
    expect(cache.availableIn("login:a")).toBe(60);
    now += 30_000;
    expect(cache.availableIn("login:a")).toBe(30);
    now += 31_000;
    expect(cache.tooManyAttempts("login:a", 3)).toBe(false);
    expect(cache.availableIn("login:a")).toBe(0);
    expect(cache.hit("login:a", 60)).toBe(1);
  });

  test("keys are independent and can be cleared", () => {
    const cache = createKvCache(createTestDb());
    cache.hit("a");
    cache.hit("b");
    cache.clear("a");
    expect(cache.availableIn("a")).toBe(0);
    expect(cache.availableIn("b")).toBeGreaterThan(0);
  });
});
