import { describe, expect, test } from "bun:test";
import { and, eq, isNull } from "drizzle-orm";
import { categories, categoryRules, transactions } from "../schema";
import { createTestDb, createTestUser } from "../test-db";
import { SYSTEM_CATEGORIES, seedSystemCategories } from "./system-categories";

const systemCategory = (db: ReturnType<typeof createTestDb>, name: string) =>
  db
    .select()
    .from(categories)
    .where(and(isNull(categories.userId), eq(categories.name, name)))
    .get();

describe("seedSystemCategories", () => {
  test("is idempotent", async () => {
    const db = createTestDb();
    expect(seedSystemCategories(db)).toBe(44);
    expect(seedSystemCategories(db)).toBe(0);
    expect(await db.$count(categories)).toBe(44);
  });

  test("links children to their parent of the same type", async () => {
    const db = createTestDb();
    seedSystemCategories(db);
    const bills = systemCategory(db, "Bills");
    expect(systemCategory(db, "Gas bill")?.parentId).toBe(bills?.id ?? -1);
    expect(systemCategory(db, "Salary")?.parentId).toBeNull();
    expect(await db.$count(categories, eq(categories.type, "debt_loan"))).toBe(4);
  });

  test("merges a user's copy into a newly created system category", async () => {
    const db = createTestDb();
    const userId = createTestUser(db);
    const copy = db
      .insert(categories)
      .values({ userId, name: "Coffee", icon: "☕", type: "expense" })
      .returning()
      .get();
    const sameNameOtherType = db
      .insert(categories)
      .values({ userId, name: "Coffee", icon: "☕", type: "income" })
      .returning()
      .get();
    const occurredAt = new Date("2026-11-20T03:00:00Z");
    const base = {
      userId,
      bankCode: "manual",
      direction: "out" as const,
      amount: 30000,
      occurredAt,
    };
    db.insert(transactions)
      .values([
        { ...base, categoryId: copy.id },
        { ...base, categoryId: copy.id, deletedAt: new Date() },
      ])
      .run();
    db.insert(categoryRules)
      .values({ userId, matchField: "counterparty", matchValue: "highlands", categoryId: copy.id })
      .run();

    seedSystemCategories(db);

    const coffee = systemCategory(db, "Coffee");
    expect(coffee).toBeDefined();
    expect(await db.$count(categories, eq(categories.id, copy.id))).toBe(0);
    expect(await db.$count(transactions, eq(transactions.categoryId, coffee?.id ?? -1))).toBe(2);
    expect(db.select().from(categoryRules).get()?.categoryId).toBe(coffee?.id ?? -1);
    expect(await db.$count(categories, eq(categories.id, sameNameOtherType.id))).toBe(1);
  });

  test("leaves user copies alone when the system category already existed", async () => {
    const db = createTestDb();
    seedSystemCategories(db);
    const userId = createTestUser(db);
    db.insert(categories).values({ userId, name: "Coffee", type: "expense" }).run();
    seedSystemCategories(db);
    expect(await db.$count(categories)).toBe(SYSTEM_CATEGORIES.length + 1);
  });
});
