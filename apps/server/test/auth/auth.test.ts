import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { LOGIN_MAX_ATTEMPTS } from "../../src/auth/plugin";
import { env } from "../../src/config/env";
import { cache, session, user } from "../../src/db/schema";
import { createAuthApp, PASSWORD } from "./helpers";

const linkIn = (text: string) => text.match(/https?:\/\/\S+/)?.[0] ?? "";

describe("registration", () => {
  test("creates the account with a lowercase email, signs in and sends a verification email", async () => {
    const { register, mails, db } = createAuthApp();
    const me = await register("Mixed.Case@Example.com", { name: "Nguyễn An" });

    expect(me.result.status).toBe(200);
    expect(db.select().from(user).get()).toMatchObject({
      email: "mixed.case@example.com",
      name: "Nguyễn An",
      emailVerified: false,
      viewingDemo: false,
    });
    const current = await me.json("/api/auth/get-session");
    expect(current.body.user.email).toBe("mixed.case@example.com");

    expect(mails).toHaveLength(1);
    expect(mails[0]?.to).toBe("mixed.case@example.com");
    expect(mails[0]?.subject).toContain("Xác minh");
    expect(linkIn(mails[0]?.text ?? "")).toContain("/api/auth/verify-email?token=");
  });

  test("the session lasts a year and the cookie is long-lived", async () => {
    const { register, db } = createAuthApp();
    await register();
    const [row] = db.select().from(session).all();
    const days = ((row?.expiresAt.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(360);
  });

  test("rejects a password under 8 characters, a duplicate email and a name over 255 characters", async () => {
    const { register, browser } = createAuthApp();
    expect((await register("a@example.com", { password: "short" })).result.status).toBe(400);
    expect((await register("b@example.com", { password: "12345678" })).result.status).toBe(200);
    expect((await register("b@example.com")).result.status).toBe(422);
    const long = await browser().json("/api/auth/sign-up/email", {
      json: { name: "x".repeat(256), email: "c@example.com", password: PASSWORD },
    });
    expect(long.status).toBe(422);
    expect(long.body.code).toBe("NAME_TOO_LONG");
  });

  test("a signed-in POST from another origin is refused", async () => {
    const { register } = createAuthApp();
    const me = await register();
    const res = await me.json("/api/auth/sign-out", {
      json: {},
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
    expect((await me.json("/api/auth/get-session")).body.user.id).toBe(me.id);
  });

  test("the verification link verifies the email", async () => {
    const { register, mails, db } = createAuthApp();
    const me = await register();
    const response = await me.request(
      new URL(linkIn(mails[0]?.text ?? "")).pathname + new URL(linkIn(mails[0]?.text ?? "")).search,
    );
    expect(response.status).toBe(302);
    expect(db.select().from(user).where(eq(user.id, me.id)).get()?.emailVerified).toBe(true);
  });
});

describe("login", () => {
  test("signs in with the right password and out again", async () => {
    const { register, browser } = createAuthApp();
    const me = await register("me@example.com");
    const other = browser();
    const ok = await other.json("/api/auth/sign-in/email", {
      json: { email: "ME@example.com", password: PASSWORD },
    });
    expect(ok.status).toBe(200);
    expect((await other.json("/api/auth/get-session")).body.user.id).toBe(me.id);

    expect((await other.json("/api/auth/sign-out", { json: {} })).status).toBe(200);
    expect((await other.json("/api/auth/get-session")).body).toBeNull();
  });

  test("a wrong password and an unknown email give the same generic error", async () => {
    const { register, browser } = createAuthApp();
    await register("me@example.com");
    const wrong = await browser().json("/api/auth/sign-in/email", {
      json: { email: "me@example.com", password: "nope-nope" },
    });
    const unknown = await browser().json("/api/auth/sign-in/email", {
      json: { email: "ghost@example.com", password: "nope-nope" },
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.code).toBe("INVALID_EMAIL_OR_PASSWORD");
    expect(unknown.body).toEqual(wrong.body);
  });

  test("is throttled after five failures, even for the right password, per email", async () => {
    const { register, browser, db } = createAuthApp();
    await register("me@example.com");
    const attempt = (email: string, password: string) =>
      browser().json("/api/auth/sign-in/email", { json: { email, password } });

    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++)
      expect((await attempt("me@example.com", "wrong-wrong")).status).toBe(401);
    const locked = await attempt("me@example.com", PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe("auth.throttle");
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);

    expect((await attempt("other@example.com", "wrong-wrong")).status).toBe(401);

    // Once the window passes the right password works and clears the counter.
    db.update(cache)
      .set({ expiresAt: Date.now() - 1 })
      .run();
    expect((await attempt("me@example.com", PASSWORD)).status).toBe(200);
    expect(
      db
        .select()
        .from(cache)
        .all()
        .filter((row) => row.key.startsWith("login:me@")),
    ).toHaveLength(0);
  });

  test("parallel wrong guesses cannot get around the limit", async () => {
    const { register, browser } = createAuthApp();
    await register("me@example.com");
    const guesses = await Promise.all(
      Array.from({ length: 20 }, () =>
        browser().json("/api/auth/sign-in/email", {
          json: { email: "me@example.com", password: "wrong-wrong" },
        }),
      ),
    );
    expect(guesses.filter((r) => r.status === 401)).toHaveLength(LOGIN_MAX_ATTEMPTS);
    expect(guesses.filter((r) => r.status === 429)).toHaveLength(20 - LOGIN_MAX_ATTEMPTS);
  });

  test("signing out clears the demo-viewing flag", async () => {
    const { register, db } = createAuthApp();
    const me = await register();
    db.update(user).set({ viewingDemo: true }).where(eq(user.id, me.id)).run();
    await me.json("/api/auth/sign-out", { json: {} });
    expect(db.select().from(user).where(eq(user.id, me.id)).get()?.viewingDemo).toBe(false);
  });
});

describe("password reset", () => {
  test("a captured reset email lets the user choose a new password", async () => {
    const { register, browser, mails } = createAuthApp();
    await register("me@example.com");
    mails.length = 0;

    const asked = await browser().json("/api/auth/request-password-reset", {
      json: { email: "me@example.com", redirectTo: "/reset-password" },
    });
    expect(asked.status).toBe(200);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.subject).toContain("Đặt lại mật khẩu");

    const token = linkIn(mails[0]?.text ?? "").match(/reset-password\/([^?\s]+)/)?.[1];
    expect(token).toBeTruthy();
    const reset = await browser().json("/api/auth/reset-password", {
      json: { newPassword: "a brand new pass", token },
    });
    expect(reset.status).toBe(200);

    expect(
      (
        await browser().json("/api/auth/sign-in/email", {
          json: { email: "me@example.com", password: PASSWORD },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await browser().json("/api/auth/sign-in/email", {
          json: { email: "me@example.com", password: "a brand new pass" },
        })
      ).status,
    ).toBe(200);
  });

  test("an unknown email sends nothing, and a bad token is refused", async () => {
    const { browser, mails } = createAuthApp();
    await browser().json("/api/auth/request-password-reset", {
      json: { email: "ghost@example.com", redirectTo: "/reset-password" },
    });
    expect(mails).toHaveLength(0);
    const bad = await browser().json("/api/auth/reset-password", {
      json: { newPassword: "a brand new pass", token: "bogus" },
    });
    expect(bad.status).toBe(400);
  });

  test("the email follows the cookie language", async () => {
    const { register, browser, mails } = createAuthApp();
    await register("me@example.com");
    mails.length = 0;
    await browser().json("/api/auth/request-password-reset", {
      json: { email: "me@example.com", redirectTo: "/reset-password" },
      headers: { cookie: "locale=en" },
    });
    expect(mails[0]?.subject).toContain("Reset your password");
  });
});

describe("built-in endpoints that skip our guards", () => {
  test("are not reachable", async () => {
    const { register, db } = createAuthApp();
    const me = await register();
    for (const path of [
      "/delete-user",
      "/delete-user/callback",
      "/update-user",
      "/change-password",
      "/change-email",
      "/send-verification-email",
    ]) {
      const res = await me.json(`/api/auth${path}`, {
        json: { password: PASSWORD, name: "x", newPassword: "abcdefgh", currentPassword: PASSWORD },
      });
      expect([path, res.status]).toEqual([path, 404]);
    }
    expect(db.select().from(user).where(eq(user.id, me.id)).get()?.name).toBe("Test User");
  });
});

describe("cookies", () => {
  test("a malformed cookie is ignored", async () => {
    const { browser } = createAuthApp();
    const res = await browser().json("/api/settings", {
      headers: { cookie: "locale=%; theme=%E0%A4%A" },
    });
    expect(res).toMatchObject({ status: 200, body: { locale: "vi", theme: "system" } });
  });
});

describe("authenticated routes", () => {
  test("answer 401 without a session", async () => {
    const { browser } = createAuthApp();
    const anonymous = browser();
    for (const [method, path] of [
      ["PATCH", "/api/profile"],
      ["POST", "/api/profile/verification"],
      ["PUT", "/api/profile/password"],
      ["POST", "/api/profile/delete-data"],
      ["DELETE", "/api/profile"],
      ["PUT", "/api/settings"],
    ] as const) {
      const res = await anonymous.json(path, { method, json: {} });
      expect([method, path, res.status, res.body]).toEqual([
        method,
        path,
        401,
        { error: { code: "unauthenticated" } },
      ]);
    }
  });

  test("the seeded demo account cannot be changed", async () => {
    const { register } = createAuthApp();
    const demo = await register(env.DEMO_USER_EMAIL);
    for (const [method, path, json] of [
      ["PATCH", "/api/profile", { name: "x" }],
      [
        "PUT",
        "/api/profile/password",
        { currentPassword: PASSWORD, newPassword: "abcdefgh", newPasswordConfirmation: "abcdefgh" },
      ],
      ["POST", "/api/profile/delete-data", { password: PASSWORD }],
      ["DELETE", "/api/profile", { password: PASSWORD }],
    ] as const) {
      const res = await demo.json(path, { method, json });
      expect([path, res.status, res.body]).toEqual([
        path,
        403,
        { error: { code: "demo_read_only" } },
      ]);
    }
  });
});
