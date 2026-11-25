import { describe, expect, test } from "bun:test";
import { count, eq } from "drizzle-orm";
import {
  account,
  categories,
  categoryRules,
  forwardingConfirmations,
  inboundAddresses,
  rawEmails,
  session,
  transactions,
  user,
  userSettings,
} from "../../src/db/schema";
import { getOrCreateActiveAddress } from "../../src/domain/inbound-addresses";
import { createAuthApp, PASSWORD } from "./helpers";

type Setup = ReturnType<typeof createAuthApp>;

/** Gives a user one of everything that "delete data" must remove. */
function populate(db: Setup["db"], userId: string) {
  const address = getOrCreateActiveAddress(db, userId);
  const own = db
    .insert(categories)
    .values({ userId, name: "Mine", type: "expense" })
    .returning()
    .get();
  const raw = db
    .insert(rawEmails)
    .values({
      userId,
      inboundAddressId: address.id,
      source: "forward",
      verification: "unverified",
      messageId: `m-${userId}`,
      fromAddress: "a@b",
      receivedAt: new Date(),
    })
    .returning()
    .get();
  db.insert(transactions)
    .values([
      {
        userId,
        rawEmailId: raw.id,
        bankCode: "VCB",
        direction: "out",
        amount: 1,
        occurredAt: new Date(),
        categoryId: own.id,
      },
      {
        userId,
        bankCode: "manual",
        direction: "in",
        amount: 2,
        occurredAt: new Date(),
        deletedAt: new Date(),
      },
    ])
    .run();
  db.insert(categoryRules)
    .values({ userId, matchField: "counterparty", matchValue: "x", categoryId: own.id })
    .run();
  db.insert(forwardingConfirmations)
    .values({
      userId,
      inboundAddressId: address.id,
      gmailAddress: "g@gmail.com",
      code: "1",
      confirmUrl: "https://mail.google.com/x",
      receivedAt: new Date(),
    })
    .run();
  return address;
}

const rowCounts = (db: Setup["db"], userId: string) => ({
  transactions: db
    .select({ n: count() })
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .get()?.n,
  rules: db.select({ n: count() }).from(categoryRules).where(eq(categoryRules.userId, userId)).get()
    ?.n,
  categories: db.select({ n: count() }).from(categories).where(eq(categories.userId, userId)).get()
    ?.n,
  rawEmails: db.select({ n: count() }).from(rawEmails).where(eq(rawEmails.userId, userId)).get()?.n,
  confirmations: db
    .select({ n: count() })
    .from(forwardingConfirmations)
    .where(eq(forwardingConfirmations.userId, userId))
    .get()?.n,
  addresses: db
    .select({ n: count() })
    .from(inboundAddresses)
    .where(eq(inboundAddresses.userId, userId))
    .get()?.n,
});

describe("profile", () => {
  test("the name can be updated, trimmed, and is validated", async () => {
    const { register, db } = createAuthApp();
    const me = await register();
    const ok = await me.json("/api/profile", { method: "PATCH", json: { name: "  Test User  " } });
    expect(ok).toMatchObject({ status: 200, body: { name: "Test User" } });
    expect(db.select().from(user).where(eq(user.id, me.id)).get()?.name).toBe("Test User");

    const empty = await me.json("/api/profile", { method: "PATCH", json: { name: " " } });
    expect(empty).toMatchObject({
      status: 422,
      body: { error: { code: "validation_failed", fields: { name: ["required"] } } },
    });
    const long = await me.json("/api/profile", {
      method: "PATCH",
      json: { name: "x".repeat(256) },
    });
    expect(long.body.error.fields).toEqual({ name: ["max"] });
    const missing = await me.json("/api/profile", { method: "PATCH", json: {} });
    expect(missing.body.error.fields).toEqual({ name: ["required"] });
  });

  test("the email cannot be changed here", async () => {
    const { register, db } = createAuthApp();
    const me = await register("me@example.com");
    await me.json("/api/profile", {
      method: "PATCH",
      json: { name: "A", email: "other@example.com" },
    });
    expect(db.select().from(user).where(eq(user.id, me.id)).get()?.email).toBe("me@example.com");
  });

  test("resending the verification email is rate limited and skipped once verified", async () => {
    const { register, mails, db } = createAuthApp();
    const me = await register();
    mails.length = 0;
    for (let i = 0; i < 6; i++) {
      expect(
        (await me.json("/api/profile/verification", { method: "POST", json: {} })).body,
      ).toEqual({ status: "sent" });
    }
    expect(mails).toHaveLength(6);
    const limited = await me.json("/api/profile/verification", { method: "POST", json: {} });
    expect(limited).toMatchObject({ status: 429, body: { error: { code: "auth.throttle" } } });

    db.update(user).set({ emailVerified: true }).where(eq(user.id, me.id)).run();
    const done = await me.json("/api/profile/verification", { method: "POST", json: {} });
    expect(done.body).toEqual({ status: "already-verified" });
    expect(mails).toHaveLength(6);
  });

  test("the password changes only with the right current password and a matching confirmation", async () => {
    const { register, browser } = createAuthApp();
    const me = await register("me@example.com");
    const change = (body: object) =>
      me.json("/api/profile/password", { method: "PUT", json: body });

    const wrong = await change({
      currentPassword: "not mine",
      newPassword: "another good one",
      newPasswordConfirmation: "another good one",
    });
    expect(wrong).toMatchObject({
      status: 422,
      body: { error: { fields: { currentPassword: ["current_password"] } } },
    });

    const mismatch = await change({
      currentPassword: PASSWORD,
      newPassword: "another good one",
      newPasswordConfirmation: "different",
    });
    expect(mismatch.body.error.fields).toEqual({ newPassword: ["confirmed"] });

    const short = await change({
      currentPassword: PASSWORD,
      newPassword: "short",
      newPasswordConfirmation: "short",
    });
    expect(short.body.error.fields.newPassword).toContain("min");

    expect(
      (
        await change({
          currentPassword: PASSWORD,
          newPassword: "another good one",
          newPasswordConfirmation: "another good one",
        })
      ).body,
    ).toEqual({ status: "updated" });
    const login = (password: string) =>
      browser().json("/api/auth/sign-in/email", { json: { email: "me@example.com", password } });
    expect((await login(PASSWORD)).status).toBe(401);
    expect((await login("another good one")).status).toBe(200);
  });

  test("delete data keeps the login and wipes everything owned, leaving other users alone", async () => {
    const { register, db } = createAuthApp();
    const me = await register();
    const other = await register();
    const oldAddress = populate(db, me.id);
    populate(db, other.id);
    db.insert(userSettings).values({ userId: me.id, locale: "en" }).run();

    const wrong = await me.json("/api/profile/delete-data", {
      method: "POST",
      json: { password: "wrong" },
    });
    expect(wrong).toMatchObject({
      status: 422,
      body: { error: { fields: { password: ["current_password"] } } },
    });
    expect(rowCounts(db, me.id).transactions).toBe(2);

    expect(
      (await me.json("/api/profile/delete-data", { method: "POST", json: { password: PASSWORD } }))
        .body,
    ).toEqual({ status: "deleted" });
    expect(rowCounts(db, me.id)).toEqual({
      transactions: 0,
      rules: 0,
      categories: 0,
      rawEmails: 0,
      confirmations: 0,
      addresses: 0,
    });
    expect(rowCounts(db, other.id)).toEqual({
      transactions: 2,
      rules: 1,
      categories: 1,
      rawEmails: 1,
      confirmations: 1,
      addresses: 1,
    });

    expect(db.select().from(user).where(eq(user.id, me.id)).get()).toBeDefined();
    expect((await me.json("/api/auth/get-session")).body.user.id).toBe(me.id);
    expect(db.select().from(userSettings).where(eq(userSettings.userId, me.id)).get()?.locale).toBe(
      "en",
    );
    expect(getOrCreateActiveAddress(db, me.id).token).not.toBe(oldAddress.token);
  });

  test("delete account needs the password, then removes everything and signs out", async () => {
    const { register, db } = createAuthApp();
    const me = await register();
    const other = await register();
    populate(db, me.id);
    populate(db, other.id);

    const wrong = await me.json("/api/profile", { method: "DELETE", json: { password: "wrong" } });
    expect(wrong.status).toBe(422);
    expect(db.select().from(user).where(eq(user.id, me.id)).get()).toBeDefined();

    const done = await me.request("/api/profile", {
      method: "DELETE",
      json: { password: PASSWORD },
    });
    expect(done.status).toBe(204);
    expect(db.select().from(user).where(eq(user.id, me.id)).get()).toBeUndefined();
    expect(rowCounts(db, me.id)).toEqual({
      transactions: 0,
      rules: 0,
      categories: 0,
      rawEmails: 0,
      confirmations: 0,
      addresses: 0,
    });
    expect(db.select().from(session).where(eq(session.userId, me.id)).all()).toHaveLength(0);
    expect(db.select().from(account).where(eq(account.userId, me.id)).all()).toHaveLength(0);
    expect((await me.json("/api/auth/get-session")).body).toBeNull();
    expect(me.jar.size).toBe(0);

    expect(db.select().from(user).where(eq(user.id, other.id)).get()).toBeDefined();
    expect(rowCounts(db, other.id).transactions).toBe(2);
  });
});

describe("settings", () => {
  test("a signed-out visitor gets the defaults, or what their cookies say", async () => {
    const { browser } = createAuthApp();
    expect((await browser().json("/api/settings")).body).toEqual({ locale: "vi", theme: "system" });
    const cookies = await browser().json("/api/settings", {
      headers: { cookie: "locale=en; theme=dark" },
    });
    expect(cookies.body).toEqual({ locale: "en", theme: "dark" });
    const junk = await browser().json("/api/settings", {
      headers: { cookie: "locale=xx; theme=pink" },
    });
    expect(junk.body).toEqual({ locale: "vi", theme: "system" });
  });

  test("a signed-in user's values are saved, mirrored to year-long cookies and win over cookies", async () => {
    const { register, db } = createAuthApp();
    const me = await register();
    const saved = await me.json("/api/settings", {
      method: "PUT",
      json: { locale: "en", theme: "dark" },
    });
    expect(saved.body).toEqual({ locale: "en", theme: "dark" });
    expect(me.jar.get("locale")).toBe("en");
    expect(me.jar.get("theme")).toBe("dark");
    const setCookie = (
      await me.request("/api/settings", { method: "PUT", json: { theme: "light" } })
    ).headers
      .getSetCookie()
      .join("\n");
    expect(setCookie).toMatch(/theme=light/);
    expect(setCookie).toMatch(/Max-Age=31536000/);

    expect(
      db.select().from(userSettings).where(eq(userSettings.userId, me.id)).get(),
    ).toMatchObject({ locale: "en", theme: "light" });
    me.jar.set("locale", "vi");
    expect((await me.json("/api/settings")).body).toEqual({ locale: "en", theme: "light" });
  });

  test("a partial update keeps the other value, and invalid values are rejected", async () => {
    const { register } = createAuthApp();
    const me = await register();
    await me.json("/api/settings", { method: "PUT", json: { locale: "en" } });
    expect(
      (await me.json("/api/settings", { method: "PUT", json: { theme: "dark" } })).body,
    ).toEqual({ locale: "en", theme: "dark" });
    expect(
      (await me.json("/api/settings", { method: "PUT", json: { locale: "fr" } })).body.error.fields,
    ).toEqual({ locale: ["invalid"] });
    expect((await me.json("/api/settings", { method: "PUT", json: {} })).status).toBe(422);
  });

  test("the locale endpoint works signed out (cookie only) and signed in (saved too)", async () => {
    const { browser, register, db } = createAuthApp();
    const visitor = browser();
    const res = await visitor.json("/api/locale/en", { method: "PUT" });
    expect(res.body).toEqual({ locale: "en" });
    expect(visitor.jar.get("locale")).toBe("en");
    expect(db.select().from(userSettings).all()).toHaveLength(0);
    expect((await visitor.json("/api/locale/fr", { method: "PUT" })).status).toBe(404);

    const me = await register();
    await me.json("/api/locale/en", { method: "PUT" });
    expect(db.select().from(userSettings).where(eq(userSettings.userId, me.id)).get()?.locale).toBe(
      "en",
    );
  });
});
