import { describe, expect, test } from "bun:test";
import { env } from "../../src/config/env";
import { categories, categoryRules, inboundAddresses } from "../../src/db/schema";
import { assertWritable, demoUserId } from "../../src/domain/demo";
import { findActiveByToken, getOrCreateActiveAddress } from "../../src/domain/inbound-addresses";
import { createApiApp } from "./helpers";

async function twoUsers() {
  const api = createApiApp();
  const alice = await api.register();
  const bob = await api.register();
  const raw = api.addRawEmail(alice.id);
  const row = api.addTransaction(alice.id, {
    rawEmailId: raw.id,
    categoryId: api.categoryId("Coffee"),
  });
  return { api, alice, bob, row };
}

describe("tenant isolation", () => {
  test("another user gets 404 for every route that takes a transaction id", async () => {
    const { bob, row } = await twoUsers();
    const id = row.id;
    const attempts: [string, string, unknown?][] = [
      ["GET", `/api/transactions/${id}`],
      ["GET", `/api/transactions/${id}/raw`],
      [
        "PUT",
        `/api/transactions/${id}`,
        { direction: "out", amount: "1.000", occurredAt: "2026-03-05T08:30", counterparty: "x" },
      ],
      ["DELETE", `/api/transactions/${id}`],
      ["POST", `/api/transactions/${id}/confirm`],
      ["PUT", `/api/transactions/${id}/category`, { categoryId: 1 }],
      ["PUT", `/api/transactions/${id}/rule`, { enabled: true }],
      ["POST", `/api/transactions/${id}/backfill`],
      ["PUT", `/api/transactions/${id}/note`, { note: "mine now" }],
      ["POST", `/api/transactions/${id}/toggle-hidden`],
    ];
    for (const [method, path, json] of attempts) {
      const response = await bob.json(path, { method, ...(json === undefined ? {} : { json }) });
      expect([method, path, response.status]).toEqual([method, path, 404]);
    }
  });

  test("another user's transactions never appear in lists or reports", async () => {
    const { api, alice, bob } = await twoUsers();
    api.addTransaction(alice.id);
    const list = await bob.json("/api/transactions");
    expect(list.body.days).toEqual([]);
    expect(list.body.hasAnyTransactions).toBe(false);
    expect((await bob.json("/api/reports")).body.total).toBe(0);
  });

  test("a user cannot use or change another user's categories and rules", async () => {
    const { api, alice, bob, row } = await twoUsers();
    const custom = api.db
      .insert(categories)
      .values({ userId: alice.id, name: "Pets", type: "expense" })
      .returning()
      .get();
    const rule = api.db
      .insert(categoryRules)
      .values({
        userId: alice.id,
        matchField: "counterparty",
        matchValue: "x",
        categoryId: custom.id,
      })
      .returning()
      .get();
    const bobsRow = api.addTransaction(bob.id);

    const use = await bob.json(`/api/transactions/${bobsRow.id}/category`, {
      method: "PUT",
      json: { categoryId: custom.id },
    });
    expect(use.status).toBe(404);
    expect(
      (
        await bob.json(`/api/settings/categories/${custom.id}`, {
          method: "PATCH",
          json: { name: "Mine" },
        })
      ).status,
    ).toBe(404);
    expect(
      (await bob.json(`/api/settings/categories/${custom.id}`, { method: "DELETE" })).status,
    ).toBe(404);
    expect((await bob.json(`/api/settings/rules/${rule.id}`, { method: "DELETE" })).status).toBe(
      404,
    );
    expect((await bob.json(`/api/transactions?category=${custom.id}`)).body.error.code).toBe(
      "category_not_found",
    );
    expect((await bob.json("/api/settings/rules")).body).toEqual([]);
    expect(row.id).toBeGreaterThan(0);
  });

  test("system categories cannot be changed", async () => {
    const api = createApiApp();
    const me = await api.register();
    const response = await me.json(`/api/settings/categories/${api.categoryId("Coffee")}`, {
      method: "PATCH",
      json: { name: "Hacked" },
    });
    expect(response.status).toBe(404);
  });

  test("forwarding shows only the caller's address and confirmations", async () => {
    const { alice, bob } = await twoUsers();
    const a = await alice.json("/api/forwarding");
    const b = await bob.json("/api/forwarding");
    expect(a.body.address).not.toBe(b.body.address);
    expect(a.body.confirmation).toBeNull();
  });
});

// Routes that stay open to the demo account or viewer: auth, the unauthenticated webhook, the demo
// switch itself, language/appearance cookies and profile (guarded and tested with the auth routes).
const EXEMPT = [
  /\/auth\/\*$/,
  /^\/api\/auth\//,
  /^\/api\/inbound\//,
  /^\/api\/demo\/?$/,
  /^\/api\/locale\//,
  /^\/api\/settings\/?$/,
  /^\/api\/profile/,
];

describe("demo read-only", () => {
  async function setup() {
    const api = createApiApp();
    const demo = await api.demoUser();
    const demoRow = api.addTransaction(demo.id);
    const viewer = await api.register();
    return { api, demo, demoRow, viewer };
  }

  const mutating = (api: ReturnType<typeof createApiApp>) =>
    api.app.routes
      .filter((route) => !["GET", "HEAD", "OPTIONS"].includes(route.method))
      .filter((route) => !EXEMPT.some((pattern) => pattern.test(route.path)));

  test("every mutating route refuses while viewing demo and while signed in as the demo user", async () => {
    const { api, demo, demoRow, viewer } = await setup();
    expect((await viewer.json("/api/demo", { method: "POST" })).body.viewingDemo).toBe(true);

    const routes = mutating(api);
    expect(routes.length).toBeGreaterThanOrEqual(12);
    for (const actor of [viewer, demo]) {
      for (const route of routes) {
        const path = route.path.replace(":id", String(demoRow.id));
        const response = await actor.json(path, { method: route.method, json: {} });
        expect([route.method, path, response.status, response.body?.error?.code]).toEqual([
          route.method,
          path,
          403,
          "demo_read_only",
        ]);
      }
    }
  });

  test("viewing demo reads the demo account, and leaving shows the user's own data again", async () => {
    const { api, demoRow, viewer } = await setup();
    api.addTransaction(viewer.id, { counterparty: "MINE" });
    expect((await viewer.json(`/api/transactions/${demoRow.id}`)).status).toBe(404);

    await viewer.json("/api/demo", { method: "POST" });
    expect((await viewer.json(`/api/transactions/${demoRow.id}`)).status).toBe(200);
    const demoList = await viewer.json("/api/transactions");
    expect(demoList.body.hasAnyTransactions).toBe(true);
    expect(JSON.stringify(demoList.body)).not.toContain("MINE");

    expect((await viewer.json("/api/demo", { method: "DELETE" })).body.viewingDemo).toBe(false);
    expect((await viewer.json(`/api/transactions/${demoRow.id}`)).status).toBe(404);
  });

  test("the demo switch is unavailable without a demo account", async () => {
    const api = createApiApp();
    const me = await api.register();
    const response = await me.json("/api/demo", { method: "POST" });
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("demo_unavailable");
  });

  test("background jobs and the CLI can still write demo rows", async () => {
    const { api, demo } = await setup();
    expect(demoUserId(api.db)).toBe(demo.id);
    expect(() => assertWritable(api.db, { actor: "system", ownerId: demo.id })).not.toThrow();
    expect(() =>
      assertWritable(api.db, { actor: { id: demo.id, viewingDemo: false }, ownerId: demo.id }),
    ).toThrow();
    expect(env.DEMO_USER_EMAIL).toBeTruthy();
  });

  test("a signed-in user's own data stays writable", async () => {
    const { api, viewer } = await setup();
    const row = api.addTransaction(viewer.id);
    const response = await viewer.json(`/api/transactions/${row.id}/toggle-hidden`, {
      method: "POST",
    });
    expect(response.status).toBe(200);
  });
});

describe("response shape", () => {
  test("no endpoint returns email bodies", async () => {
    const api = createApiApp();
    const me = await api.register();
    const raw = api.addRawEmail(me.id);
    const row = api.addTransaction(me.id, {
      rawEmailId: raw.id,
      categoryId: api.categoryId("Coffee"),
    });
    getOrCreateActiveAddress(api.db, me.id);

    const paths = api.app.routes
      .filter((route) => route.method === "GET")
      .map((route) => route.path)
      .filter((path) => !/^\/api\/(auth|inbound)/.test(path) && !path.endsWith("/raw"))
      .map((path) => path.replace(":id", String(row.id)).replace(/\*$/, ""));
    expect(paths.length).toBeGreaterThan(8);
    for (const path of paths) {
      const response = await me.request(path);
      const text = await response.text();
      for (const forbidden of [
        "SECRET-HTML",
        "SECRET-TEXT",
        "body_html",
        "body_text",
        "bodyHtml",
        "bodyText",
      ]) {
        expect([path, text.includes(forbidden)]).toEqual([path, false]);
      }
    }
    expect(findActiveByToken(api.db, "nope")).toBeNull();
  });
});

describe("demo account reads", () => {
  test("the demo user cannot create a forwarding address through GET routes", async () => {
    const api = createApiApp();
    const demo = await api.demoUser();
    for (const path of ["/api/forwarding", "/api/forwarding/filter.xml"]) {
      const response = await demo.json(path);
      expect([path, response.status, response.body?.error?.code]).toEqual([
        path,
        403,
        "demo_read_only",
      ]);
    }
    expect(api.db.select().from(inboundAddresses).all()).toHaveLength(0);
  });
});
