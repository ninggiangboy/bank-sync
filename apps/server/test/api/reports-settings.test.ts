import { describe, expect, test } from "bun:test";
import { categories } from "../../src/db/schema";
import { monthlyReport } from "../../src/domain/reports";
import { createApiApp } from "./helpers";

const at = (year: number, month: number, day: number, hour = 5) =>
  new Date(Date.UTC(year, month - 1, day, hour));

describe("GET /api/reports", () => {
  test("rolls children into their parent and ranks by spend; hidden and unverified rows are excluded", async () => {
    const api = createApiApp();
    const me = await api.register();
    const may = at(2024, 5, 10);
    const tx = (values: object) => api.addTransaction(me.id, { occurredAt: may, ...values });
    tx({ amount: 30_000, categoryId: api.categoryId("Coffee"), counterparty: "A" });
    tx({ amount: 20_000, categoryId: api.categoryId("Restaurants"), counterparty: "B" });
    tx({ amount: 40_000, categoryId: api.categoryId("Taxi"), counterparty: "A" });
    tx({ amount: 5_000, counterparty: "C" });
    tx({ amount: 99_000, categoryId: api.categoryId("Coffee"), deletedAt: new Date() });
    tx({ amount: 77_000, categoryId: api.categoryId("Coffee"), unverified: true });
    tx({ amount: 1_000_000, direction: "in", categoryId: api.categoryId("Salary") });

    const { body } = await me.json("/api/reports?month=2024-05");
    expect(body.total).toBe(95_000);
    expect(
      body.byCategory.map((row: { category: { name: string } | null; total: number }) => [
        row.category?.name ?? null,
        row.total,
      ]),
    ).toEqual([
      ["Food & drink", 50_000],
      ["Transport", 40_000],
      [null, 5_000],
    ]);
    expect(body.byCategory[0].count).toBe(2);
    expect(
      body.topCounterparties.map((row: { counterparty: string; total: number }) => [
        row.counterparty,
        row.total,
      ]),
    ).toEqual([
      ["A", 70_000],
      ["B", 20_000],
      ["C", 5_000],
    ]);
    expect(body.change).toBeNull();
  });

  test("keeps only the top five counterparties", async () => {
    const api = createApiApp();
    const me = await api.register();
    for (const [index, name] of ["a", "b", "c", "d", "e", "f"].entries()) {
      api.addTransaction(me.id, {
        occurredAt: at(2024, 5, 10),
        counterparty: name,
        amount: (index + 1) * 1000,
      });
    }
    const { body } = await me.json("/api/reports?month=2024-05");
    expect(body.topCounterparties).toHaveLength(5);
    expect(body.topCounterparties[0].counterparty).toBe("f");
  });

  test("compares a finished month with the whole previous month", async () => {
    const api = createApiApp();
    const me = await api.register();
    api.addTransaction(me.id, { occurredAt: at(2024, 4, 20), amount: 100_000 });
    api.addTransaction(me.id, { occurredAt: at(2024, 5, 3), amount: 150_000 });
    const { body } = await me.json("/api/reports?month=2024-05");
    expect(body.change).toBe(50);
    expect(body.comparedTo).toBe("full_month");
  });

  test("compares the current month with the same stretch of the previous month", async () => {
    const api = createApiApp();
    const me = await api.register();
    // "Now" is the 10th at noon local; only April 1-10 counts as the comparison.
    const now = Date.UTC(2024, 4, 10, 5);
    api.addTransaction(me.id, { occurredAt: at(2024, 4, 5), amount: 100_000 });
    api.addTransaction(me.id, { occurredAt: at(2024, 4, 25), amount: 900_000 });
    api.addTransaction(me.id, { occurredAt: at(2024, 5, 2), amount: 50_000 });
    const report = monthlyReport(api.db, me.id, { year: 2024, month: 5 }, now);
    expect(report.comparedTo).toBe("same_period");
    expect(report.change).toBe(-50);
  });

  test("an unverified row counts once confirmed", async () => {
    const api = createApiApp();
    const me = await api.register();
    const row = api.addTransaction(me.id, {
      occurredAt: at(2024, 5, 3),
      amount: 10_000,
      unverified: true,
    });
    expect((await me.json("/api/reports?month=2024-05")).body.total).toBe(0);
    await me.json(`/api/transactions/${row.id}/confirm`, { method: "POST" });
    expect((await me.json("/api/reports?month=2024-05")).body.total).toBe(10_000);
  });
});

describe("settings", () => {
  test("summary counts available categories, rules and forwarding state", async () => {
    const api = createApiApp();
    const me = await api.register();
    const before = await me.json("/api/settings/summary");
    expect(before.body.categoryCount).toBe(44);
    expect(before.body.ruleCount).toBe(0);
    expect(before.body.forwarding).toEqual({ hasAddress: false, hasReceived: false });
  });

  test("adds, renames and deletes own categories with validation", async () => {
    const api = createApiApp();
    const me = await api.register();
    const post = (json: unknown) => me.json("/api/settings/categories", { json });

    expect((await post({ name: "", type: "expense" })).body.error.fields.name).toEqual([
      "required",
    ]);
    expect((await post({ name: "x".repeat(51), type: "expense" })).body.error.fields.name).toEqual([
      "max",
    ]);
    expect((await post({ name: "Pets", icon: "🐶".repeat(17), type: "expense" })).status).toBe(422);
    expect((await post({ name: "Pets", type: "debt_loan" })).status).toBe(422);
    expect(
      (await post({ name: "Pets", type: "expense", parentId: api.categoryId("Salary") })).body.error
        .fields.parentId,
    ).toEqual(["invalid"]);
    // A child cannot be a parent.
    expect(
      (await post({ name: "Pets", type: "expense", parentId: api.categoryId("Coffee") })).status,
    ).toBe(422);

    const created = await post({
      name: "Pets",
      icon: "🐶",
      type: "expense",
      parentId: api.categoryId("Shopping"),
    });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      name: "Pets",
      icon: "🐶",
      system: false,
      editable: true,
      parentId: api.categoryId("Shopping"),
    });

    const renamed = await me.json(`/api/settings/categories/${created.body.id}`, {
      method: "PATCH",
      json: { name: "Cats", icon: "" },
    });
    expect(renamed.body).toMatchObject({ name: "Cats", icon: null });

    const list = await me.json("/api/settings/categories?type=expense");
    const names = list.body.map((c: { name: string }) => c.name);
    expect(names.indexOf("Cats")).toBeGreaterThan(names.indexOf("Shopping"));
    expect(list.body.find((c: { name: string }) => c.name === "Coffee").editable).toBe(false);

    expect(
      (await me.json(`/api/settings/categories/${created.body.id}`, { method: "DELETE" })).status,
    ).toBe(204);
    expect(
      api.db
        .select()
        .from(categories)
        .all()
        .some((c) => c.name === "Cats"),
    ).toBe(false);
  });

  test("lists parents followed by their children with visible transaction counts", async () => {
    const api = createApiApp();
    const me = await api.register();
    api.addTransaction(me.id, { categoryId: api.categoryId("Coffee") });
    api.addTransaction(me.id, { categoryId: api.categoryId("Coffee"), deletedAt: new Date() });
    const { body } = await me.json("/api/settings/categories?type=expense");
    const names = body.map((c: { name: string }) => c.name);
    expect(names.indexOf("Coffee")).toBe(names.indexOf("Food & drink") + 1);
    expect(body.find((c: { name: string }) => c.name === "Coffee").transactionCount).toBe(1);
  });

  test("rules list newest first and can be deleted", async () => {
    const api = createApiApp();
    const me = await api.register();
    const first = api.addTransaction(me.id, {
      counterparty: "ONE",
      categoryId: api.categoryId("Coffee"),
    });
    const second = api.addTransaction(me.id, {
      counterparty: "TWO",
      categoryId: api.categoryId("Taxi"),
    });
    await me.json(`/api/transactions/${first.id}/rule`, { method: "PUT", json: { enabled: true } });
    await me.json(`/api/transactions/${second.id}/rule`, {
      method: "PUT",
      json: { enabled: true },
    });
    const { body } = await me.json("/api/settings/rules");
    expect(body.map((rule: { matchValue: string }) => rule.matchValue)).toEqual(["two", "one"]);
    expect(body[0].category.name).toBe("Taxi");
    expect((await me.json(`/api/settings/rules/${body[0].id}`, { method: "DELETE" })).status).toBe(
      204,
    );
    expect((await me.json("/api/settings/rules")).body).toHaveLength(1);
  });
});

describe("public config", () => {
  test("is available without a session", async () => {
    const { app } = createApiApp();
    const response = await app.handle(new Request("http://localhost/api/public/config"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.appName).toBe("Bank Sync");
    expect(body.banks.map((bank: { bankCode: string }) => bank.bankCode).sort()).toEqual([
      "CAKE",
      "VCB",
      "VPB",
    ]);
    expect(typeof body.sourceUrl).toBe("string");
  });
});

describe("edge cases", () => {
  test("report change rounds halves away from zero", () => {
    const api = createApiApp();
    return api.register().then((me) => {
      api.addTransaction(me.id, { occurredAt: at(2024, 4, 20), amount: 200_000 });
      api.addTransaction(me.id, { occurredAt: at(2024, 5, 3), amount: 175_000 });
      expect(monthlyReport(api.db, me.id, { year: 2024, month: 5 }).change).toBe(-13);
    });
  });

  test("manual amounts beyond safe integers are rejected", async () => {
    const api = createApiApp();
    const me = await api.register();
    const { status, body } = await me.json("/api/transactions", {
      json: {
        direction: "out",
        amount: "12345678901234567890",
        occurredAt: "2026-03-05T08:30",
        counterparty: "x",
      },
    });
    expect(status).toBe(422);
    expect(body.error.fields.amount).toEqual(["amount"]);
  });
});
