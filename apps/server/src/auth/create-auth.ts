import type { Locale } from "@bank-sync/shared";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { eq } from "drizzle-orm";
import { env } from "../config/env";
import type { Db } from "../db/client";
import * as schema from "../db/schema";
import { effectiveSettings } from "../domain/user-settings";
import { readCookie } from "../http/cookies";
import type { Mailer } from "../mail/mailer";
import { resetPassword } from "../mail/templates/reset-password";
import { verifyEmail } from "../mail/templates/verify-email";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_NAME_LENGTH = 255;
/** Vite dev server, which proxies /api to this server. */
const DEV_ORIGIN = "http://localhost:5173";

export type AuthDeps = { db: Db; mailer: Mailer };

/** Language for an email: the user's saved locale, else the visitor's cookie, else the default. */
function localeFor(db: Db, userId: string, request?: Request): Locale {
  return effectiveSettings(db, userId, {
    locale: readCookie(request?.headers.get("cookie"), "locale"),
  }).locale;
}

/**
 * Better Auth on the shared Drizzle database. Sessions last a year (login is always remembered),
 * passwords need 8 characters, email verification is sent but not required to use the app, and
 * signing out clears the demo-viewing flag.
 */
export function createAuth({ db, mailer }: AuthDeps) {
  const mail = (
    kind: typeof verifyEmail,
    user: { id: string; name: string; email: string },
    url: string,
    request?: Request,
  ) =>
    mailer.send(
      kind({
        to: user.email,
        name: user.name,
        url,
        locale: localeFor(db, user.id, request),
        appName: env.APP_NAME,
      }),
    );

  return betterAuth({
    appName: env.APP_NAME,
    baseURL: env.APP_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: env.NODE_ENV === "development" ? [DEV_ORIGIN] : [],
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      requireEmailVerification: false,
      autoSignIn: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }, request) => {
        await mail(resetPassword, user, url, request);
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }, request) => {
        await mail(verifyEmail, user, url, request);
      },
    },
    // Explicit so the origin (CSRF) check also runs under test, where Better Auth skips it by default.
    advanced: { disableOriginCheck: false },
    session: { expiresIn: ONE_YEAR_SECONDS, updateAge: 60 * 60 * 24 },
    user: {
      additionalFields: {
        viewingDemo: { type: "boolean", required: true, defaultValue: false, input: false },
      },
      deleteUser: { enabled: true },
    },
    // Sign-in is throttled per email and address by the auth plugin, so Better Auth's own 3-per-10s
    // sign-in rule is switched off; every other endpoint is limited per address. The limiter keeps
    // its counters in process memory and is off under test, where requests have no address.
    rateLimit: {
      enabled: env.NODE_ENV !== "test",
      storage: "memory",
      window: 60,
      max: 100,
      customRules: { "/sign-in/email": false },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email") return;
        const name = (ctx.body as { name?: unknown } | undefined)?.name;
        if (typeof name === "string" && name.length > MAX_NAME_LENGTH) {
          throw new APIError("UNPROCESSABLE_ENTITY", {
            code: "NAME_TOO_LONG",
            message: "Name is too long",
          });
        }
      }),
    },
    databaseHooks: {
      session: {
        delete: {
          after: async (session) => {
            db.update(schema.user)
              .set({ viewingDemo: false })
              .where(eq(schema.user.id, session.userId))
              .run();
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
