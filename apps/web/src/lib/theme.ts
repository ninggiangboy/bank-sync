import type { Locale, Theme } from "@bank-sync/shared";
import i18n from "../i18n";

/** `system` leaves the choice to the browser; light and dark pin it with data-theme. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
}

export async function applyLocale(locale: Locale) {
  document.documentElement.lang = locale;
  if (i18n.language !== locale) await i18n.changeLanguage(locale);
}

export async function applySettings(settings: { locale: Locale; theme: Theme }) {
  applyTheme(settings.theme);
  await applyLocale(settings.locale);
}
