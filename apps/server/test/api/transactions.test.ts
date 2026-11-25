import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { categoryRules, rawEmails, transactions } from "../../src/db/schema";
import { formatMonth, monthOf } from "../../src/domain/time";
import { createApiApp } from "./helpers";

const thisMonth = () => formatMonth(monthOf(new Date()));
// The 15th at noon UTC is inside the current local month for any time zone.
const midMonth = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15, 5));
};

describe("GET /api/transactions", () => {
  test("requires a session", async () => {
    const { app } = createApiApp();
    const response = await app.handle(new Request("http://localhost/api/transactions"));
    expect(response.status).toBe(401);
  });

  test("totals exclude hidden and unverified rows but the list shows them with flags", async () => {
    const api = createApiApp();
    const me = await api.register();
    const at = midMonth();
    api.addTransaction(me.id, { amount: 1_000, occurredAt: at });
    api.addTransaction(me.id, { amount: 2_000, occurredAt: at, direction: "in" });
    api.addTransaction(me.id, { amount: 4_000, occurredAt: at, deletedAt: new Date() });
    api.addTransaction(me.id, { amount: 8_000, occurredAt: at, unverified: true });

    const { body } = await me.json("/api/transactions");
    expect(body.spent).toBe(1_000);
    expect(body.income).toBe(2_000);
    expect(body.unverifiedCount).toBe(1);
    const rows = body.days.flatMap((day: { transactions: unknown[] }) => day.transactions);
    expect(rows).toHaveLength(4);
    expect(rows.filter((row: { hidden: boolean }) => row.hidden)).toHaveLength(1);
    expect(rows.filter((row: { unverified: boolean }) => row.unverified)).toHaveLength(1);
    expect(body.hasAnyTransactions).toBe(true);
  });

  test("filters by direction, uncategorized, category with children and payee", async () => {
    const api = createApiApp();
    const me = await api.register();
    const at = midMonth();
    api.addTransaction(me.id, { direction: "in", counterparty: "ACME", occurredAt: at });
    api.addTransaction(me.id, {
      categoryId: api.categoryId("Coffee"),
      counterparty: "HIGHLANDS",
      occurredAt: at,
    });
    api.addTransaction(me.id, {
      categoryId: api.categoryId("Food & drink"),
      counterparty: "COM",
      occurredAt: at,
    });
    const count = async (query: string) => {
      const { body } = await me.json(`/api/transactions?${query}`);
      return body.days.flatMap((day: { transactions: unknown[] }) => day.transactions).length;
    };
    expect(await count("filter=in")).toBe(1);
    expect(await count("filter=out")).toBe(2);
    expect(await count("filter=uncategorized")).toBe(1);
    expect(await count(`category=${api.categoryId("Food & drink")}`)).toBe(2);
    expect(await count(`category=${api.categoryId("Coffee")}`)).toBe(1);
    expect(await count("payee=HIGHLANDS")).toBe(1);
    expect(await count("filter=bogus")).toBe(3);
  });

  test("unknown category is 404 category_not_found", async () => {
    const api = createApiApp();
    const me = await api.register();
    const { status, body } = await me.json("/api/transactions?category=999999");
    expect(status).toBe(404);
    expect(body.error.code).toBe("category_not_found");
  });

  test("orders newest first, groups by local day and points at the latest month when empty", async () => {
    const api = createApiApp();
    const me = await api.register();
    const old = new Date(Date.UTC(2024, 4, 10, 5));
    api.addTransaction(me.id, { occurredAt: old, counterparty: "A" });
    api.addTransaction(me.id, {
      occurredAt: new Date(old.getTime() + 3_600_000),
      counterparty: "B",
    });
    api.addTransaction(me.id, {
      occurredAt: new Date(old.getTime() + 86_400_000),
      counterparty: "C",
    });

    const { body } = await me.json("/api/transactions?month=2024-05");
    expect(body.days.map((day: { date: string }) => day.date)).toEqual([
      "2024-05-11",
      "2024-05-10",
    ]);
    expect(
      body.days[1].transactions.map((row: { counterparty: string }) => row.counterparty),
    ).toEqual(["B", "A"]);

    const empty = await me.json("/api/transactions?month=2024-07");
    expect(empty.body.days).toEqual([]);
    expect(empty.body.latestMonth).toBe("2024-05");
    expect(empty.body.hasAnyTransactions).toBe(true);
  });

  test("an invalid month means the current month", async () => {
    const api = createApiApp();
    const me = await api.register();
    const { body } = await me.json("/api/transactions?month=2024-13");
    expect(body.month).toBe(thisMonth());
  });

  test("forwarding summary reports address and received mail without creating an address", async () => {
    const api = createApiApp();
    const me = await api.register();
    let { body } = await me.json("/api/transactions");
    expect(body.forwarding).toEqual({ hasAddress: false, hasReceived: false });
    await me.json("/api/forwarding");
    api.addRawEmail(me.id);
    ({ body } = await me.json("/api/transactions"));
    expect(body.forwarding).toEqual({ hasAddress: true, hasReceived: true });
  });
});

describe("transaction detail and mutations", () => {
  test("detail carries rule target, verification and raw email meta, never bodies", async () => {
    const api = createApiApp();
    const me = await api.register();
    const raw = api.addRawEmail(me.id, { verification: "unverified", dkimDomain: null });
    const row = api.addTransaction(me.id, {
      rawEmailId: raw.id,
      categoryId: api.categoryId("Coffee"),
      counterpartyAccount: "123456",
      unverified: true,
    });
    api.addTransaction(me.id, { counterpartyAccount: "123456" });

    const { status, body } = await me.json(`/api/transactions/${row.id}`);
    expect(status).toBe(200);
    expect(body.verification).toBe("unverified");
    expect(body.bankName).toBe("Vietcombank");
    expect(body.ruleTarget).toEqual({ field: "account", counterparty: "SHOP", account: "123456" });
    expect(body.followsRule).toBe(false);
    expect(body.backfillCount).toBe(1);
    expect(body.rawEmail.fromAddress).toBe("vcbdigibank@info.vietcombank.com.vn");
    expect(JSON.stringify(body)).not.toContain("SECRET");
    expect(body.categories.every((c: { type: string }) => c.type !== "income")).toBe(true);
  });

  test("setting a category validates the direction and reports followsRule after remembering", async () => {
    const api = createApiApp();
    const me = await api.register();
    const row = api.addTransaction(me.id, { direction: "out" });

    const bad = await me.json(`/api/transactions/${row.id}/category`, {
      method: "PUT",
      json: { categoryId: api.categoryId("Salary") },
    });
    expect(bad.status).toBe(404);

    const ok = await me.json(`/api/transactions/${row.id}/category`, {
      method: "PUT",
      json: { categoryId: api.categoryId("Coffee") },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.followsRule).toBe(false);

    const remembered = await me.json(`/api/transactions/${row.id}/rule`, {
      method: "PUT",
      json: { enabled: true },
    });
    expect(remembered.body.followsRule).toBe(true);
    expect(api.db.select().from(categoryRules).all()).toHaveLength(1);

    const forgotten = await me.json(`/api/transactions/${row.id}/rule`, {
      method: "PUT",
      json: { enabled: false },
    });
    expect(forgotten.body.followsRule).toBe(false);
    expect(api.db.select().from(categoryRules).all()).toHaveLength(0);
  });

  test("a rule needs a category first", async () => {
    const api = createApiApp();
    const me = await api.register();
    const row = api.addTransaction(me.id);
    const { status, body } = await me.json(`/api/transactions/${row.id}/rule`, {
      method: "PUT",
      json: { enabled: true },
    });
    expect(status).toBe(422);
    expect(body.error.code).toBe("rule_unavailable");
  });

  test("backfill fills only uncategorized matches and returns the count", async () => {
    const api = createApiApp();
    const me = await api.register();
    const coffee = api.categoryId("Coffee");
    const source = api.addTransaction(me.id, { counterparty: "KATINAT", categoryId: coffee });
    api.addTransaction(me.id, { counterparty: "KATINAT" });
    api.addTransaction(me.id, { counterparty: "KATINAT" });
    api.addTransaction(me.id, { counterparty: "OTHER" });
    const { body } = await me.json(`/api/transactions/${source.id}/backfill`, { method: "POST" });
    expect(body.count).toBe(2);
    const filled = api.db
      .select()
      .from(transactions)
      .where(eq(transactions.categoryId, coffee))
      .all();
    expect(filled).toHaveLength(3);
  });

  test("notes are trimmed, capped at 1000 characters and empty becomes null", async () => {
    const api = createApiApp();
    const me = await api.register();
    const row = api.addTransaction(me.id);
    const save = (note: string) =>
      me.json(`/api/transactions/${row.id}/note`, { method: "PUT", json: { note } });
    expect((await save("  hello  ")).body.note).toBe("hello");
    expect((await save("   ")).body.note).toBeNull();
    const long = await save("x".repeat(1001));
    expect(long.status).toBe(422);
    expect(long.body.error.fields.note).toEqual(["max"]);
  });

  test("hide and show toggles the soft delete", async () => {
    const api = createApiApp();
    const me = await api.register();
    const row = api.addTransaction(me.id);
    const hidden = await me.json(`/api/transactions/${row.id}/toggle-hidden`, { method: "POST" });
    expect(hidden.body.hidden).toBe(true);
    expect((await me.json(`/api/transactions/${row.id}`)).status).toBe(200);
    const shown = await me.json(`/api/transactions/${row.id}/toggle-hidden`, { method: "POST" });
    expect(shown.body.hidden).toBe(false);
  });

  test("only manual transactions can be deleted", async () => {
    const api = createApiApp();
    const me = await api.register();
    const synced = api.addTransaction(me.id);
    const manual = api.addTransaction(me.id, {
      bankCode: "manual",
      occurredAt: new Date(Date.UTC(2024, 4, 10, 5)),
    });
    expect((await me.json(`/api/transactions/${synced.id}`, { method: "DELETE" })).status).toBe(
      404,
    );
    const done = await me.json(`/api/transactions/${manual.id}`, { method: "DELETE" });
    expect(done.status).toBe(200);
    expect(done.body.month).toBe("2024-05");
    expect(
      api.db.select().from(transactions).where(eq(transactions.id, manual.id)).all(),
    ).toHaveLength(0);
  });

  test("confirming an unverified row makes it count and marks the raw email", async () => {
    const api = createApiApp();
    const me = await api.register();
    const raw = api.addRawEmail(me.id, { verification: "unverified" });
    const row = api.addTransaction(me.id, {
      rawEmailId: raw.id,
      unverified: true,
      amount: 5_000,
      occurredAt: midMonth(),
    });
    const before = await me.json("/api/transactions");
    expect(before.body.spent).toBe(0);

    expect((await me.json(`/api/transactions/${row.id}/confirm`, { method: "POST" })).status).toBe(
      200,
    );
    const after = await me.json("/api/transactions");
    expect(after.body.spent).toBe(5_000);
    expect(
      api.db.select().from(rawEmails).where(eq(rawEmails.id, raw.id)).get()?.verification,
    ).toBe("user_confirmed");
    const again = await me.json(`/api/transactions/${row.id}/confirm`, { method: "POST" });
    expect(again.status).toBe(409);
  });

  test("raw email is exposed as normalized text only", async () => {
    const api = createApiApp();
    const me = await api.register();
    const raw = api.addRawEmail(me.id);
    const row = api.addTransaction(me.id, { rawEmailId: raw.id });
    const { body } = await me.json(`/api/transactions/${row.id}/raw`);
    expect(body.text).toContain("SECRET-HTML");
    expect(body.text).not.toContain("<p>");
    const manual = api.addTransaction(me.id, { bankCode: "manual" });
    expect((await me.json(`/api/transactions/${manual.id}/raw`)).body.error.code).toBe(
      "raw_email_not_found",
    );
  });
});

describe("manual transactions", () => {
  const form = (overrides: Record<string, unknown> = {}) => ({
    direction: "out",
    amount: "1.250.000",
    occurredAt: "2026-03-05T08:30",
    counterparty: "  Quán cà phê  ",
    note: "",
    ...overrides,
  });

  test("adds a manual row in local time and runs the matcher when uncategorized", async () => {
    const api = createApiApp();
    const me = await api.register();
    api.db
      .insert(categoryRules)
      .values({
        userId: me.id,
        matchField: "counterparty",
        matchValue: "quan ca phe",
        categoryId: api.categoryId("Coffee"),
      })
      .run();
    const created = await me.json("/api/transactions", { json: form() });
    expect(created.status).toBe(200);
    const row = api.db
      .select()
      .from(transactions)
      .where(eq(transactions.id, created.body.id))
      .get();
    expect(row?.amount).toBe(1_250_000);
    expect(row?.bankCode).toBe("manual");
    expect(row?.counterparty).toBe("Quán cà phê");
    expect(row?.note).toBeNull();
    expect(row?.categoryId).toBe(api.categoryId("Coffee"));
    // 08:30 in Asia/Ho_Chi_Minh (UTC+7).
    expect(row?.occurredAt.toISOString()).toBe("2026-03-05T01:30:00.000Z");
  });

  test("validates amount, date, counterparty and category fit", async () => {
    const api = createApiApp();
    const me = await api.register();
    const post = (overrides: Record<string, unknown>) =>
      me.json("/api/transactions", { json: form(overrides) });
    expect((await post({ amount: "0" })).body.error.fields.amount).toEqual(["amount"]);
    expect((await post({ amount: "12.34" })).status).toBe(422);
    expect((await post({ counterparty: "   " })).body.error.fields.counterparty).toBeDefined();
    expect((await post({ occurredAt: "2026-02-31T10:00" })).body.error.fields.occurredAt).toEqual([
      "invalid",
    ]);
    expect(
      (await post({ categoryId: api.categoryId("Salary") })).body.error.fields.categoryId,
    ).toEqual(["invalid"]);
    expect((await post({ categoryId: api.categoryId("Salary"), direction: "in" })).status).toBe(
      200,
    );
  });

  test("edits manual rows only", async () => {
    const api = createApiApp();
    const me = await api.register();
    const manual = api.addTransaction(me.id, { bankCode: "manual" });
    const synced = api.addTransaction(me.id);
    const edit = (id: number) =>
      me.json(`/api/transactions/${id}`, { method: "PUT", json: form({ amount: "50.000" }) });
    expect((await edit(manual.id)).status).toBe(200);
    expect(
      api.db.select().from(transactions).where(eq(transactions.id, manual.id)).get()?.amount,
    ).toBe(50_000);
    expect((await edit(synced.id)).status).toBe(404);
  });
});

describe("categories", () => {
  test("lists categories that fit the direction, in order", async () => {
    const api = createApiApp();
    const me = await api.register();
    const out = await me.json("/api/categories?direction=out");
    const names = out.body.map((c: { name: string }) => c.name);
    expect(names).toContain("Lending");
    expect(names).not.toContain("Salary");
    const incoming = await me.json("/api/categories?direction=in");
    expect(incoming.body.map((c: { name: string }) => c.name)).toContain("Salary");
  });
});
