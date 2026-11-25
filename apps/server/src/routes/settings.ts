import { LOCALES, THEMES } from "@bank-sync/shared";
import { Elysia, status } from "elysia";
import { z } from "zod";
import type { Auth } from "../auth/create-auth";
import type { AuthPlugin } from "../auth/plugin";
import { env } from "../config/env";
import type { Db } from "../db/client";
import { effectiveSettings, saveSettings } from "../domain/user-settings";
import { readCookie } from "../http/cookies";
import { validate } from "../http/validate";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

const bodySchema = z
  .object({
    locale: z.enum(LOCALES, { error: "invalid" }).optional(),
    theme: z.enum(THEMES, { error: "invalid" }).optional(),
  })
  .refine((value) => value.locale !== undefined || value.theme !== undefined, {
    error: "required",
  });

type CookieJar = Record<string, { set(options: object): unknown }>;

/** Mirrors the settings to cookies so signed-out pages and the first paint can read them. */
function mirror(cookie: CookieJar, values: { locale?: string; theme?: string }) {
  for (const [name, value] of Object.entries(values)) {
    cookie[name]?.set({
      value,
      maxAge: ONE_YEAR_SECONDS,
      path: "/",
      sameSite: "lax",
      secure: env.APP_URL.startsWith("https:"),
      httpOnly: false,
    });
  }
}

export const settingsRoutes = ({ db, auth, authed }: { db: Db; auth: Auth; authed: AuthPlugin }) =>
  new Elysia()
    .use(authed)
    .get("/settings", async ({ request }) => {
      const session = await auth.api.getSession({ headers: request.headers });
      const header = request.headers.get("cookie");
      return effectiveSettings(db, session?.user.id ?? null, {
        locale: readCookie(header, "locale"),
        theme: readCookie(header, "theme"),
      });
    })
    .put(
      "/settings",
      ({ user, body, cookie }) => {
        const patch = validate(bodySchema, body);
        saveSettings(db, user.id, patch);
        const saved = effectiveSettings(db, user.id, {});
        mirror(cookie as unknown as CookieJar, saved);
        return saved;
      },
      { auth: true },
    )
    // Works signed out: the cookie alone carries the choice; a signed-in user's setting is saved too.
    .put("/locale/:locale", async ({ params, request, cookie }) => {
      const locale = LOCALES.find((value) => value === params.locale);
      if (!locale) throw status(404, "not_found");
      const session = await auth.api.getSession({ headers: request.headers });
      if (session) saveSettings(db, session.user.id, { locale });
      mirror(cookie as unknown as CookieJar, { locale });
      return { locale };
    });
