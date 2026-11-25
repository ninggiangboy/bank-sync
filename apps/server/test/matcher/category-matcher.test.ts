import { describe, expect, test } from "bun:test";
import { and, eq, isNull } from "drizzle-orm";
import { categories, categoryRules, transactions } from "../../src/db/schema";
import { seedSystemCategories } from "../../src/db/seed/system-categories";
import { createTestDb, createTestUser } from "../../src/db/test-db";
import {
  apply,
  backfill,
  backfillCount,
  draft,
  follows,
  forget,
  match,
  remember,
  ruleFor,
} from "../../src/domain/category-matcher";

function setup() {
  const db = createTestDb();
  seedSystemCategories(db);
  const userId = createTestUser(db);
  const category = (name: string) => {
    const row = db
      .select()
      .from(categories)
      .where(and(isNull(categories.userId), eq(categories.name, name)))
      .get();
    if (!row) throw new Error(`no category ${name}`);
    return row;
  };
  const food = category("Food & drink");
  const bills = category("Bills");
  const addRule = (
    matchField: "account" | "counterparty" | "description",
    matchValue: string,
    categoryId: number,
    owner = userId,
  ) =>
    db
      .insert(categoryRules)
      .values({ userId: owner, matchField, matchValue, categoryId })
      .returning()
      .get();
  const addTransaction = (values: Partial<typeof transactions.$inferInsert> = {}) =>
    db
      .insert(transactions)
      .values({
        userId,
        bankCode: "VCB",
        direction: "out",
        amount: 1000,
        occurredAt: new Date(),
        ...values,
      })
      .returning()
      .get();
  return { db, userId, food, bills, category, addRule, addTransaction };
}

describe("category matcher", () => {
  test("counterparty rules match ignoring case and accents", () => {
    const { db, food, addRule, addTransaction } = setup();
    addRule(
      "counterparty",
      "Bún Bò Huế Cô Ba"
        .normalize("NFD")
        .replace(/\p{Mn}/gu, "")
        .toLowerCase(),
      food.id,
    );
    const row = addTransaction({ counterparty: "BUN BO HUE CO BA" });
    expect(match(db, row)?.categoryId).toBe(food.id);
  });

  test("counterparty rules need the whole name, description rules a substring", () => {
    const { db, bills, addRule, addTransaction } = setup();
    addRule("counterparty", "evn", bills.id);
    addRule("description", "tien dien", bills.id);
    const partial = addTransaction({ counterparty: "EVN HCMC", description: "abc" });
    const description = addTransaction({
      counterparty: null,
      description: "Thanh toan TIEN DIEN T10",
    });
    expect(match(db, partial)).toBeNull();
    expect(match(db, description)?.categoryId).toBe(bills.id);
  });

  test("counterparty rules win over description rules, account rules over both", () => {
    const { db, food, bills, addRule, addTransaction } = setup();
    addRule("description", "grab", bills.id);
    addRule("counterparty", "grab vietnam", food.id);
    const row = addTransaction({ counterparty: "Grab Vietnam", description: "GRAB FOOD" });
    expect(match(db, row)?.categoryId).toBe(food.id);

    addRule("counterparty", "quan an nhat", bills.id);
    addRule("account", "0451000555666", food.id);
    const renamed = addTransaction({
      counterparty: "QUAN AN NHAT",
      counterpartyAccount: "0451000555666",
    });
    const other = addTransaction({
      counterparty: "NHAT FOOD CO",
      counterpartyAccount: "0451000555666",
    });
    expect(match(db, renamed)?.categoryId).toBe(food.id);
    expect(match(db, other)?.categoryId).toBe(food.id);
  });

  test("remember prefers the account number, then the name, then the description", () => {
    const { db, food, addTransaction } = setup();
    const byAccount = remember(
      db,
      addTransaction({ counterparty: "TRAN THI BICH", counterpartyAccount: "5600000003" }),
      food.id,
    );
    expect(byAccount).toMatchObject({ matchField: "account", matchValue: "5600000003" });

    const byName = remember(
      db,
      addTransaction({ counterparty: "TRAN THI BICH", counterpartyAccount: "VCB-5600000003" }),
      food.id,
    );
    expect(byName).toMatchObject({ matchField: "counterparty", matchValue: "tran thi bich" });

    const byDescription = remember(
      db,
      addTransaction({ counterparty: null, description: "THANH TOAN QR BUN BO" }),
      food.id,
    );
    expect(byDescription).toMatchObject({
      matchField: "description",
      matchValue: "thanh toan qr bun bo",
    });
  });

  test("remember keeps one rule per counterparty and updates its category", () => {
    const { db, food, bills, addTransaction } = setup();
    const row = addTransaction({ counterparty: "Trần Thị Bích" });
    remember(db, row, food.id);
    const rule = remember(db, row, bills.id);
    expect(db.select().from(categoryRules).all()).toHaveLength(1);
    expect(rule.categoryId).toBe(bills.id);
  });

  test("another user's rules never apply", () => {
    const { db, food, addRule, addTransaction } = setup();
    addRule("counterparty", "shopee", food.id, createTestUser(db));
    const row = addTransaction({ counterparty: "Shopee" });
    expect(apply(db, row)).toBe(false);
    expect(
      db.select().from(transactions).where(eq(transactions.id, row.id)).get()?.categoryId,
    ).toBeNull();
  });

  test("apply sets the category from the matching rule", () => {
    const { db, food, addRule, addTransaction } = setup();
    addRule("counterparty", "pho 24", food.id);
    const row = addTransaction({ counterparty: "PHO 24" });
    expect(apply(db, row)).toBe(true);
    expect(
      db.select().from(transactions).where(eq(transactions.id, row.id)).get()?.categoryId,
    ).toBe(food.id);
  });

  test("forget deletes the rule only when it points at the transaction's category", () => {
    const { db, food, bills, addTransaction } = setup();
    const row = addTransaction({ counterparty: "Quan A" });
    remember(db, row, food.id);
    forget(db, { ...row, categoryId: bills.id });
    expect(ruleFor(db, row)).not.toBeNull();
    expect(follows(db, { ...row, categoryId: food.id })).toBe(true);
    expect(follows(db, { ...row, categoryId: bills.id })).toBe(false);
    forget(db, { ...row, categoryId: food.id });
    expect(ruleFor(db, row)).toBeNull();
  });

  test("backfill only touches the owner's uncategorized matching transactions", () => {
    const { db, food, bills, addRule, addTransaction } = setup();
    const rule = addRule("counterparty", "tran thi bich", food.id);
    const matching = addTransaction({ counterparty: "TRAN THI BICH" });
    const set = addTransaction({ counterparty: "TRAN THI BICH", categoryId: bills.id });
    const different = addTransaction({ counterparty: "LE VAN A" });
    const deleted = addTransaction({ counterparty: "TRAN THI BICH", deletedAt: new Date() });
    const stranger = addTransaction({ userId: createTestUser(db), counterparty: "TRAN THI BICH" });

    expect(backfill(db, rule)).toBe(1);
    const category = (id: number) =>
      db.select().from(transactions).where(eq(transactions.id, id)).get()?.categoryId;
    expect(category(matching.id)).toBe(food.id);
    expect(category(set.id)).toBe(bills.id);
    expect(category(different.id)).toBeNull();
    expect(category(deleted.id)).toBeNull();
    expect(category(stranger.id)).toBeNull();
  });

  test("draft and backfillCount change nothing", () => {
    const { db, food, bills, addTransaction } = setup();
    const source = addTransaction({ counterparty: "TRAN THI BICH", categoryId: food.id });
    const target = addTransaction({ counterparty: "Trần Thị Bích" });
    addTransaction({ counterparty: "TRAN THI BICH", categoryId: bills.id });
    addTransaction({ counterparty: "TRAN THI BICH", direction: "in" });
    addTransaction({ counterparty: "LE VAN A" });

    const rule = draft(source);
    expect(rule).toMatchObject({
      matchField: "counterparty",
      matchValue: "tran thi bich",
      categoryId: food.id,
    });
    const saved = { ...rule, id: 0, createdAt: new Date(), updatedAt: new Date() };
    expect(backfillCount(db, saved)).toBe(1);
    expect(
      db.select().from(transactions).where(eq(transactions.id, target.id)).get()?.categoryId,
    ).toBeNull();
    expect(db.select().from(categoryRules).all()).toHaveLength(0);
    expect(backfill(db, saved)).toBe(1);
    expect(backfillCount(db, saved)).toBe(0);
  });

  test("rules never assign a category of the wrong kind", () => {
    const { db, food, addRule, addTransaction } = setup();
    const rule = addRule("description", "grab", food.id);
    const payment = addTransaction({ description: "GRAB FOOD" });
    const refund = addTransaction({ description: "GRAB HOAN TIEN", direction: "in" });
    expect(match(db, payment)?.categoryId).toBe(food.id);
    expect(match(db, refund)).toBeNull();
    expect(backfill(db, rule)).toBe(1);
  });

  test("debt and loan rules only match the direction their category moves money", () => {
    const { db, category, addRule, addTransaction } = setup();
    const borrowing = category("Borrowing");
    addRule("counterparty", "nguyen van an", borrowing.id);
    expect(match(db, addTransaction({ counterparty: "NGUYEN VAN AN" }))).toBeNull();
    expect(
      match(db, addTransaction({ counterparty: "NGUYEN VAN AN", direction: "in" }))?.categoryId,
    ).toBe(borrowing.id);
  });

  test("a rule with an empty value never matches", () => {
    const { db, food, addRule, addTransaction } = setup();
    addRule("description", "", food.id);
    expect(match(db, addTransaction({ description: "anything" }))).toBeNull();
  });
});
