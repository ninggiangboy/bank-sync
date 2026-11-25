import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { newInboundToken } from "../lib/tokens";
import {
  categories,
  categoryRules,
  inboundAddresses,
  rawEmails,
  transactions,
  user,
  userSettings,
} from "./schema";
import { createTestDb, createTestUser } from "./test-db";

const rawEmail = (userId: string, messageId: string) => ({
  userId,
  source: "forward" as const,
  verification: "dkim_pass" as const,
  messageId,
  fromAddress: "info@vcbdigibank.vn",
  receivedAt: new Date(),
});

describe("schema constraints", () => {
  test("a user has at most one active inbound address", async () => {
    const db = createTestDb();
    const userId = createTestUser(db);
    const first = db
      .insert(inboundAddresses)
      .values({ userId, token: newInboundToken() })
      .returning()
      .get();
    expect(() =>
      db.insert(inboundAddresses).values({ userId, token: newInboundToken() }).run(),
    ).toThrow(/UNIQUE/);

    db.update(inboundAddresses)
      .set({ replacedAt: new Date() })
      .where(eq(inboundAddresses.id, first.id))
      .run();
    db.insert(inboundAddresses).values({ userId, token: newInboundToken() }).run();
    expect(await db.$count(inboundAddresses, eq(inboundAddresses.userId, userId))).toBe(2);
  });

  test("inbound tokens are unique across users", async () => {
    const db = createTestDb();
    const token = newInboundToken();
    db.insert(inboundAddresses)
      .values({ userId: createTestUser(db), token })
      .run();
    expect(() =>
      db
        .insert(inboundAddresses)
        .values({ userId: createTestUser(db), token })
        .run(),
    ).toThrow(/UNIQUE/);
  });

  test("raw emails are unique per user and message id", async () => {
    const db = createTestDb();
    const alice = createTestUser(db);
    const bob = createTestUser(db);
    db.insert(rawEmails).values(rawEmail(alice, "<m1@bank>")).run();
    expect(() => db.insert(rawEmails).values(rawEmail(alice, "<m1@bank>")).run()).toThrow(/UNIQUE/);
    db.insert(rawEmails).values(rawEmail(bob, "<m1@bank>")).run();
  });

  test("a raw email backs at most one transaction", async () => {
    const db = createTestDb();
    const userId = createTestUser(db);
    const email = db.insert(rawEmails).values(rawEmail(userId, "<m1@bank>")).returning().get();
    const row = {
      userId,
      rawEmailId: email.id,
      bankCode: "VCB",
      direction: "in" as const,
      amount: 1000,
      occurredAt: new Date(),
    };
    db.insert(transactions).values(row).run();
    expect(() => db.insert(transactions).values(row).run()).toThrow(/UNIQUE/);
  });

  test("transaction amounts cannot be negative", async () => {
    const db = createTestDb();
    const userId = createTestUser(db);
    const row = {
      userId,
      bankCode: "manual",
      direction: "out" as const,
      amount: 1000,
      occurredAt: new Date(),
    };
    expect(() =>
      db
        .insert(transactions)
        .values({ ...row, amount: -1 })
        .run(),
    ).toThrow(/CHECK/);
    expect(() =>
      db
        .insert(transactions)
        .values({ ...row, originalAmount: -5 })
        .run(),
    ).toThrow(/CHECK/);
    db.insert(transactions)
      .values({ ...row, amount: 0, originalAmount: null })
      .run();
    expect(await db.$count(transactions)).toBe(1);
  });

  test("timestamps default in SQL for inserts made outside Drizzle", () => {
    const db = createTestDb();
    const before = Date.now();
    db.$client.exec("INSERT INTO categories (name) VALUES ('Raw')");
    const row = db.select().from(categories).get();
    expect(row?.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(row?.updatedAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  test("category rules are unique per user, field and value", async () => {
    const db = createTestDb();
    const userId = createTestUser(db);
    const category = db.insert(categories).values({ userId, name: "Coffee" }).returning().get();
    const rule = {
      userId,
      matchField: "counterparty" as const,
      matchValue: "highlands",
      categoryId: category.id,
    };
    db.insert(categoryRules).values(rule).run();
    expect(() => db.insert(categoryRules).values(rule).run()).toThrow(/UNIQUE/);
  });

  test("user settings are unique per user and default to vi and system", async () => {
    const db = createTestDb();
    const userId = createTestUser(db);
    const settings = db.insert(userSettings).values({ userId }).returning().get();
    expect(settings).toMatchObject({ locale: "vi", theme: "system" });
    expect(() => db.insert(userSettings).values({ userId }).run()).toThrow(/UNIQUE/);
  });

  test("deleting a category clears it from transactions and removes its rules", async () => {
    const db = createTestDb();
    const userId = createTestUser(db);
    const category = db.insert(categories).values({ userId, name: "Coffee" }).returning().get();
    const tx = db
      .insert(transactions)
      .values({
        userId,
        bankCode: "manual",
        direction: "out",
        amount: 1,
        occurredAt: new Date(),
        categoryId: category.id,
      })
      .returning()
      .get();
    db.insert(categoryRules)
      .values({ userId, matchField: "description", matchValue: "cafe", categoryId: category.id })
      .run();

    db.delete(categories).where(eq(categories.id, category.id)).run();

    expect(
      db.select().from(transactions).where(eq(transactions.id, tx.id)).get()?.categoryId,
    ).toBeNull();
    expect(await db.$count(categoryRules)).toBe(0);
  });

  test("deleting a user cascades to their data", async () => {
    const db = createTestDb();
    const userId = createTestUser(db);
    db.insert(userSettings).values({ userId }).run();
    db.insert(inboundAddresses).values({ userId, token: newInboundToken() }).run();
    db.insert(rawEmails).values(rawEmail(userId, "<m1@bank>")).run();
    db.insert(categories).values({ userId, name: "Mine" }).run();

    db.delete(user).where(eq(user.id, userId)).run();

    for (const table of [userSettings, inboundAddresses, rawEmails, categories]) {
      expect(await db.$count(table)).toBe(0);
    }
  });
});
