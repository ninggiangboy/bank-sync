import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import vi from "./vi.json";

/**
 * Keys are the English source strings, as in the original app, so English needs only the few lines
 * whose wording differs from their key. Vietnamese is the default language.
 */
void i18n.use(initReactI18next).init({
  resources: { vi: { translation: vi }, en: { translation: en } },
  lng: document.documentElement.lang === "en" ? "en" : "vi",
  fallbackLng: "en",
  keySeparator: false,
  nsSeparator: false,
  returnEmptyString: false,
  interpolation: { escapeValue: false },
  react: { transKeepBasicHtmlNodesFor: ["em", "strong", "br"] },
});

export default i18n;
