import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { env } from "../../src/config/env";
import { categoryRules, rawEmails, transactions, user } from "../../src/db/schema";
import { seedDemo } from "../../src/db/seed/demo";
import { DemoLedger } from "../../src/db/seed/demo-ledger";
import { Mt19937 } from "../../src/db/seed/mt19937";
import { seedSystemCategories } from "../../src/db/seed/system-categories";
import { createTestDb } from "../../src/db/test-db";
import { FIXTURES } from "../helpers";

describe("Mt19937", () => {
  test("matches the reference sequence for the default seed", () => {
    const random = new Mt19937(5489);
    expect([random.next32(), random.next32(), random.next32()]).toEqual([
      3499211612, 581869302, 3890346734,
    ]);
  });

  test("getInt stays in range and is deterministic", () => {
    const draw = (seed: number) => {
      const random = new Mt19937(seed);
      return Array.from({ length: 200 }, () => random.getInt(3, 9));
    };
    const values = draw(2026);
    expect(values).toEqual(draw(2026));
    expect(Math.min(...values)).toBe(3);
    expect(Math.max(...values)).toBe(9);
  });
});

describe("DemoLedger", () => {
  const until = new Date("2026-11-25T10:00:00Z");

  test("builds the same ledger on every run, ending on the last day", () => {
    const a = new DemoLedger().build(until);
    const b = new DemoLedger().build(until);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(200);
    expect(Math.max(...a.map((row) => row.occurredAt.getTime()))).toBeLessThanOrEqual(
      until.getTime() + 24 * 3_600_000,
    );
    expect(
      new Date(Math.min(...a.map((row) => row.occurredAt.getTime()))).toISOString(),
    ).toStartWith("2026-08-01T");
    expect(
      a.filter((row) => row.bankCode === "manual").every((row) => row.description === null),
    ).toBe(true);
  });
});

describe("seedDemo", () => {
  test("creates the read-only demo account from fixtures and the ledger", async () => {
    const db = createTestDb();
    seedSystemCategories(db);
    const { userId, ledgerRows } = await seedDemo(db, { fixtures: FIXTURES });

    const demo = db
      .select()
      .from(user)
      .where(eq(user.email, env.DEMO_USER_EMAIL.toLowerCase()))
      .get();
    expect(demo?.id).toBe(userId);
    expect(demo?.emailVerified).toBe(true);
    expect(
      db.select().from(categoryRules).where(eq(categoryRules.userId, userId)).all(),
    ).toHaveLength(11);
    expect(
      db.select().from(rawEmails).where(eq(rawEmails.userId, userId)).all().length,
    ).toBeGreaterThanOrEqual(20);

    const rows = db.select().from(transactions).where(eq(transactions.userId, userId)).all();
    expect(rows.length).toBeGreaterThanOrEqual(ledgerRows + 10);
    const hidden = rows.filter((row) => row.deletedAt !== null);
    expect(hidden.length).toBeGreaterThanOrEqual(3);
    expect(hidden.every((row) => row.note !== null)).toBe(true);
    // The newest transaction was moved to today.
    const newest = Math.max(...rows.map((row) => row.occurredAt.getTime()));
    expect(Math.abs(newest - Date.now())).toBeLessThan(2 * 24 * 3_600_000);

    // Re-running replaces the account instead of piling up rows.
    await seedDemo(db, { fixtures: FIXTURES });
    expect(
      db.select().from(user).where(eq(user.email, env.DEMO_USER_EMAIL.toLowerCase())).all(),
    ).toHaveLength(1);
    expect(db.select().from(transactions).all().length).toBe(rows.length);
  });
});
