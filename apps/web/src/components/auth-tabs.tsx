import { useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AppLink } from "./app-link";

const TABS = [
  ["/login", "Log in"],
  ["/register", "Register"],
] as const;

export function AuthTabs() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <nav className="tabs mb-6" aria-label={t("Account")}>
      {TABS.map(([href, label]) => (
        <AppLink
          key={href}
          href={href}
          aria-current={pathname === href ? "page" : undefined}
          className="tab"
        >
          {t(label)}
        </AppLink>
      ))}
    </nav>
  );
}
