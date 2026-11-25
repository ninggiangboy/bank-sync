import { LOCALES, type Locale, THEMES, type Theme } from "@bank-sync/shared";
import { eq } from "drizzle-orm";
import { env } from "../config/env";
import type { Db } from "../db/client";
import { userSettings } from "../db/schema";

export type Settings = { locale: Locale; theme: Theme };

const asLocale = (value: unknown): Locale | null =>
  LOCALES.find((locale) => locale === value) ?? null;
const asTheme = (value: unknown): Theme | null => THEMES.find((theme) => theme === value) ?? null;

/**
 * The values in effect: the saved settings of a signed-in user, else the cookies of a signed-out
 * visitor, else the defaults (the app locale and the system theme).
 */
export function effectiveSettings(
  db: Db,
  userId: string | null,
  cookies: { locale?: string | null; theme?: string | null },
): Settings {
  const saved = userId
    ? db.select().from(userSettings).where(eq(userSettings.userId, userId)).get()
    : undefined;
  return {
    locale: saved?.locale ?? asLocale(cookies.locale) ?? env.APP_LOCALE,
    theme: saved?.theme ?? asTheme(cookies.theme) ?? "system",
  };
}

/** Saves the given fields for a user, creating the row on first use. */
export function saveSettings(db: Db, userId: string, patch: Partial<Settings>): void {
  db.insert(userSettings)
    .values({ userId, ...patch })
    .onConflictDoUpdate({ target: userSettings.userId, set: { ...patch, updatedAt: new Date() } })
    .run();
}
