import { describe, expect, test } from "bun:test";
import { and } from "drizzle-orm";
import { categories } from "../db/schema";
import { seedSystemCategories } from "../db/seed/system-categories";
import { createTestDb, createTestUser } from "../db/test-db";
import { availableTo, color, fits, fitting, ordered } from "./categories";

function setup() {
  const db = createTestDb();
  seedSystemCategories(db);
  const alice = createTestUser(db);
  const bob = createTestUser(db);
  db.insert(categories)
    .values([
      { userId: alice, name: "Pets", type: "expense" },
      { userId: alice, name: "Side gig", type: "income" },
      { userId: bob, name: "Bob only", type: "expense" },
    ])
    .run();
  return { db, alice };
}

describe("category scopes", () => {
  test("availableTo returns system categories plus the user's own", () => {
    const { db, alice } = setup();
    const names = db
      .select({ name: categories.name })
      .from(categories)
      .where(availableTo(alice))
      .all()
      .map((row) => row.name);
    expect(names).toHaveLength(46);
    expect(names).toContain("Pets");
    expect(names).not.toContain("Bob only");
  });

  test("fitting(out) returns expenses plus outgoing debt/loan categories", () => {
    const { db, alice } = setup();
    const rows = db
      .select()
      .from(categories)
      .where(and(availableTo(alice), fitting("out")))
      .all();
    const debtLoan = rows.filter((row) => row.type === "debt_loan").map((row) => row.name);
    expect(debtLoan.sort()).toEqual(["Debt repayment", "Lending"]);
    expect(rows.some((row) => row.type === "income")).toBe(false);
    expect(rows.map((row) => row.name)).toContain("Pets");
  });

  test("fitting(in) returns income plus incoming debt/loan categories", () => {
    const { db, alice } = setup();
    const rows = db
      .select()
      .from(categories)
      .where(and(availableTo(alice), fitting("in")))
      .all();
    const debtLoan = rows.filter((row) => row.type === "debt_loan").map((row) => row.name);
    expect(debtLoan.sort()).toEqual(["Borrowing", "Debt collection"]);
    expect(rows.some((row) => row.type === "expense")).toBe(false);
    expect(rows.map((row) => row.name)).toContain("Side gig");
  });

  test("ordered puts higher order first, then system before user rows, then oldest", () => {
    const { db, alice } = setup();
    const rows = db
      .select()
      .from(categories)
      .where(availableTo(alice))
      .orderBy(...ordered())
      .all();
    expect(rows[0]?.name).toBe("Food & drink");
    const zeroOrder = rows.filter((row) => row.order === 0).map((row) => row.name);
    expect(zeroOrder.slice(-2)).toEqual(["Pets", "Side gig"]);
  });
});

describe("fits", () => {
  test("matches expense to out and income to in", () => {
    expect(fits({ userId: null, name: "Coffee", type: "expense" }, "out")).toBe(true);
    expect(fits({ userId: null, name: "Coffee", type: "expense" }, "in")).toBe(false);
    expect(fits({ userId: "u", name: "Side gig", type: "income" }, "in")).toBe(true);
  });

  test("matches system debt/loan categories by their direction only", () => {
    expect(fits({ userId: null, name: "Lending", type: "debt_loan" }, "out")).toBe(true);
    expect(fits({ userId: null, name: "Lending", type: "debt_loan" }, "in")).toBe(false);
    expect(fits({ userId: null, name: "Borrowing", type: "debt_loan" }, "in")).toBe(true);
    expect(fits({ userId: "u", name: "Lending", type: "debt_loan" }, "out")).toBe(false);
  });
});

test("color cycles through 8 chart colors", () => {
  expect([1, 7, 8, 16].map(color)).toEqual([2, 8, 1, 1]);
});
