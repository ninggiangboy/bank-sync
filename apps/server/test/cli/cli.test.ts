import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { type CliContext, parseArgs, runCli } from "../../src/cli/commands";
import { env } from "../../src/config/env";
import { rawEmails, transactions, user } from "../../src/db/schema";
import { seedSystemCategories } from "../../src/db/seed/system-categories";
import { createTestDb, createTestUser } from "../../src/db/test-db";
import { refreshDemo } from "../../src/jobs/refresh-demo";
import { EXCHANGE_RATES_URL } from "../../src/jobs/update-exchange-rates";
import { vndPer } from "../../src/parsing/exchange-rates";
import { allTransactions, FIXTURES } from "../helpers";

function setup(fetcher?: typeof fetch) {
  const db = createTestDb();
  seedSystemCategories(db);
  const out: string[] = [];
  const err: string[] = [];
  const ctx: CliContext = {
    db,
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    ...(fetcher ? { fetcher } : {}),
  };
  return { db, out, err, run: (...argv: string[]) => runCli(argv, ctx) };
}

describe("parseArgs", () => {
  test("handles flags in both value forms", () => {
    expect(parseArgs(["a", "--failed", "--bank=vcb", "b"], ["bank"])).toEqual({
      positional: ["a", "b"],
      flags: { failed: true, bank: "vcb" },
    });
    expect(parseArgs(["--bank", "VCB"], ["bank"]).flags).toEqual({ bank: "VCB" });
  });
});

describe("cli", () => {
  test("import-eml imports a folder once and parses everything", async () => {
    const { db, out, run } = setup();
    createTestUser(db, "me@example.com");

    expect(await run("import-eml", "me@example.com", FIXTURES)).toBe(0);
    expect(out.at(-1)).toBe("Imported 20 of 20 files.");
    expect(allTransactions(db)).toHaveLength(15);
    expect(
      db
        .select()
        .from(rawEmails)
        .all()
        .filter((row) => row.parsedAt === null),
    ).toHaveLength(0);

    out.length = 0;
    await run("import-eml", "me@example.com", FIXTURES);
    expect(out.at(-1)).toBe("Imported 0 of 20 files.");
    expect(out.filter((line) => line.includes("already imported"))).toHaveLength(20);
    expect(allTransactions(db)).toHaveLength(15);
  });

  test("import-eml also takes a single file and a user id", async () => {
    const { db, run } = setup();
    const id = createTestUser(db);
    expect(await run("import-eml", id, join(FIXTURES, "CAKE/01_transfer_in.eml"))).toBe(0);
    expect(allTransactions(db)).toHaveLength(1);
  });

  test("import-eml fails for unknown users and empty paths", async () => {
    const { db, err, run } = setup();
    createTestUser(db, "me@example.com");
    expect(await run("import-eml", "ghost@example.com", FIXTURES)).toBe(1);
    expect(err.at(-1)).toBe("User not found.");
    expect(await run("import-eml", "me@example.com", join(FIXTURES, "nothing"))).toBe(1);
  });

  test("parse-stats shows a full success rate for the fixtures", async () => {
    const { db, out, run } = setup();
    expect(await run("parse-stats")).toBe(0);
    expect(out).toEqual(["No raw emails yet."]);
    createTestUser(db, "me@example.com");
    await run("import-eml", "me@example.com", FIXTURES);
    out.length = 0;
    await run("parse-stats");
    expect(out).toEqual([
      "Bank\tTotal\tParsed\tFailed\tSuccess",
      "CAKE\t4\t4\t0\t100%",
      "VCB\t12\t12\t0\t100%",
      "VPB\t4\t4\t0\t100%",
    ]);
  });

  test("reparse --failed fixes emails after a parser fix and keeps the category", async () => {
    const { db, out, run } = setup();
    createTestUser(db, "me@example.com");
    await run("import-eml", "me@example.com", join(FIXTURES, "VCB/08_card_usd.eml"));
    // USD card alerts need a rate; with none known and no fallback the email fails.
    db.update(rawEmails).set({ parseError: "currency_unsupported", parsedAt: null }).run();
    const food = db.query.categories.findFirst().sync();
    db.update(transactions)
      .set({ categoryId: food?.id ?? null })
      .run();

    out.length = 0;
    expect(await run("reparse", "--failed")).toBe(0);
    expect(out.at(-1)).toBe("Reparsed 1 emails, 0 failed.");
    expect(allTransactions(db)[0]?.categoryId).toBe(food?.id ?? null);

    out.length = 0;
    await run("reparse", "--bank=CAKE");
    expect(out.at(-1)).toBe("Reparsed 0 emails, 0 failed.");
    await run("reparse", "--bank", "vcb");
    expect(out.at(-1)).toBe("Reparsed 1 emails, 0 failed.");
  });

  test("inbound-address prints the same active address each time", async () => {
    const { db, out, run } = setup();
    createTestUser(db, "me@example.com");
    await run("inbound-address", "me@example.com");
    await run("inbound-address", "me@example.com");
    expect(out[0]).toMatch(
      new RegExp(`^[a-z2-7]{26}@${env.INBOUND_DOMAIN.replaceAll(".", "\\.")}$`),
    );
    expect(out[1]).toBe(out[0]);
  });

  test("key:generate prints two different 32-byte secrets", async () => {
    const { out, run } = setup();
    await run("key:generate");
    const [auth, inbound] = out.map((line) => line.split("=")[1] ?? "");
    expect(out[0]).toStartWith("BETTER_AUTH_SECRET=");
    expect(out[1]).toStartWith("INBOUND_WEBHOOK_SECRET=");
    expect(auth).not.toBe(inbound);
    expect(Buffer.from(auth ?? "", "base64url")).toHaveLength(32);
  });

  test("an unknown command prints usage and fails", async () => {
    const { err, run } = setup();
    expect(await run("nope")).toBe(2);
    expect(err[0]).toContain("key:generate");
  });
});

describe("demo refresh", () => {
  const NOW = Date.parse("2026-11-20T05:00:00Z"); // 12:00 in Ho Chi Minh

  function demo() {
    const db = createTestDb();
    const demoId = createTestUser(db, env.DEMO_USER_EMAIL);
    const insert = (occurredAt: string, extra: Partial<typeof transactions.$inferInsert> = {}) =>
      db
        .insert(transactions)
        .values({
          userId: demoId,
          bankCode: "VCB",
          direction: "out",
          amount: 1,
          occurredAt: new Date(occurredAt),
          ...extra,
        })
        .run();
    return { db, demoId, insert };
  }

  test("shifts transactions, hidden ones and raw emails by whole days", () => {
    const { db, demoId, insert } = demo();
    insert("2026-11-10T09:00:00Z");
    insert("2026-11-05T09:00:00Z", { deletedAt: new Date() });
    db.insert(rawEmails)
      .values({
        userId: demoId,
        source: "upload",
        verification: "user_upload",
        messageId: "m",
        fromAddress: "a@b",
        receivedAt: new Date("2026-11-10T09:00:00Z"),
      })
      .run();
    const stranger = createTestUser(db);
    db.insert(transactions)
      .values({
        userId: stranger,
        bankCode: "VCB",
        direction: "out",
        amount: 1,
        occurredAt: new Date("2026-01-01T00:00:00Z"),
      })
      .run();

    expect(refreshDemo(db, { now: NOW })).toEqual({ days: 10, moved: 2 });
    const times = db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, demoId))
      .all()
      .map((t) => t.occurredAt.toISOString())
      .sort();
    expect(times).toEqual(["2026-11-15T09:00:00.000Z", "2026-11-20T09:00:00.000Z"]);
    expect(db.select().from(rawEmails).get()?.receivedAt.toISOString()).toBe(
      "2026-11-20T09:00:00.000Z",
    );
    expect(
      db
        .select()
        .from(transactions)
        .where(eq(transactions.userId, stranger))
        .get()
        ?.occurredAt.toISOString(),
    ).toBe("2026-01-01T00:00:00.000Z");
    expect(refreshDemo(db, { now: NOW })).toEqual({ days: 0, moved: 0 });
  });

  test("a transaction late in the evening there counts as that local day", () => {
    const { db, insert } = demo();
    insert("2026-11-19T20:00:00Z"); // 03:00 on the 20th in Ho Chi Minh
    expect(refreshDemo(db, { now: NOW })).toEqual({ days: 0, moved: 0 });
  });

  test("does nothing without a demo user or transactions", () => {
    const db = createTestDb();
    expect(refreshDemo(db, { now: NOW })).toEqual({ days: 0, moved: 0 });
    createTestUser(db, env.DEMO_USER_EMAIL);
    expect(refreshDemo(db, { now: NOW })).toEqual({ days: 0, moved: 0 });
    expect(db.select().from(user).all()).toHaveLength(1);
  });
});

describe("exchange rates", () => {
  let dir: string;
  const original = env.STORAGE_PATH;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fx-"));
    (env as { STORAGE_PATH: string }).STORAGE_PATH = dir;
  });
  afterEach(() => {
    (env as { STORAGE_PATH: string }).STORAGE_PATH = original;
    rmSync(dir, { recursive: true, force: true });
  });

  const respond = (body: unknown, status = 200) =>
    (async (url: string) => {
      expect(url).toBe(EXCHANGE_RATES_URL);
      return Response.json(body, { status });
    }) as unknown as typeof fetch;

  test("saves VND per unit and requeues emails that failed for a missing rate", async () => {
    const { db, out, run } = setup(
      respond({ result: "success", rates: { USD: 1, VND: 26000, EUR: 0.5, BAD: 0 } }),
    );
    createTestUser(db, "me@example.com");
    await run("import-eml", "me@example.com", join(FIXTURES, "VCB/08_card_usd.eml"));
    db.update(rawEmails).set({ parseError: "currency_unsupported", parsedAt: null }).run();

    expect(await run("update-exchange-rates")).toBe(0);
    expect(out.at(-1)).toBe(
      "Saved rates for 3 currencies. Queued 1 emails that failed for a missing rate.",
    );
    expect(JSON.parse(readFileSync(join(dir, "fx-rates.json"), "utf8"))).toEqual({
      USD: 26000,
      VND: 1,
      EUR: 52000,
    });
    expect(vndPer("EUR")).toBe(52000);
  });

  test("a failed download keeps the old rates and exits non-zero", async () => {
    const { err, run } = setup(respond({ result: "error" }, 500));
    const { saveRates } = await import("../../src/parsing/exchange-rates");
    saveRates({ EUR: 30000 });
    const sleep = Bun.sleep;
    (Bun as { sleep: unknown }).sleep = async () => {};
    try {
      expect(await run("update-exchange-rates")).toBe(1);
    } finally {
      (Bun as { sleep: unknown }).sleep = sleep;
    }
    expect(err.at(-1)).toBe("Could not download exchange rates; keeping the previous ones.");
    expect(vndPer("EUR")).toBe(30000);
  });

  test("USD falls back to FX_USD_VND until a table exists", () => {
    expect(vndPer("USD")).toBe(env.FX_USD_VND);
    expect(vndPer("EUR")).toBeNull();
  });
});
