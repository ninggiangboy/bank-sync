import { Outlet } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Brand } from "../components/brand";

/** Sign-in, registration and password screens: the brand above a narrow form column. */
export function GuestLayout() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-lg px-4 pt-16 pb-8 [scrollbar-gutter:stable] sm:pt-24">
      <div className="mb-8">
        <Brand size="lg" />
        <p className="mt-3 text-slate-600">{t("Auto-sync your spending from bank emails.")}</p>
      </div>
      <Outlet />
    </div>
  );
}
