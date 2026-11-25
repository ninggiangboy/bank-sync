import { useRouterState } from "@tanstack/react-router";
import { useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AppLink } from "./app-link";
import { Icon, type IconName } from "./icon";

/** Route, label, icon, path prefixes that mark the item active, and whether the month carries over. */
const ITEMS: [string, string, IconName, string[], boolean][] = [
  ["/transactions", "Transactions", "list", ["/transactions"], true],
  ["/reports", "Reports", "chart-no-axes-column", ["/reports"], true],
  ["/settings", "Settings", "settings", ["/settings", "/profile", "/connect"], false],
];

const offset = (index: number) => `translateX(calc(${index} * (100% + 0.25rem)))`;

/**
 * Bottom navigation. A highlight slides to the active item; Transactions and Reports keep the month
 * being viewed, so switching between them stays on the same month.
 */
export function Navigation() {
  const { t } = useTranslation();
  const { pathname, month } = useRouterState({
    select: (state) => ({
      pathname: state.location.pathname,
      month: (state.location.search as { month?: unknown }).month,
    }),
  });
  const active = ITEMS.findIndex(([, , , prefixes]) =>
    prefixes.some((prefix) => pathname.startsWith(prefix)),
  );
  const highlight = useRef<HTMLSpanElement>(null);
  const previous = useRef(active);

  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = active;
    if (from === active || from === -1 || active === -1) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    highlight.current?.animate([{ transform: offset(from) }, { transform: offset(active) }], {
      duration: 450,
      easing: "cubic-bezier(0.32, 0.72, 0, 1)",
    });
  }, [active]);

  return (
    <nav
      className="pointer-events-none fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]"
      aria-label={t("Main navigation")}
    >
      <div className="pointer-events-auto relative grid grid-cols-3 gap-1 rounded-full bg-white p-1 shadow">
        {active !== -1 ? (
          <span
            ref={highlight}
            aria-hidden="true"
            className="absolute inset-y-1 left-1 w-[calc((100%-1rem)/3)] rounded-full bg-slate-950/10"
            style={{ transform: offset(active) }}
          />
        ) : null}
        {ITEMS.map(([path, label, icon, , keepsMonth], index) => {
          const href =
            keepsMonth && typeof month === "string"
              ? `${path}?month=${encodeURIComponent(month)}`
              : path;
          const current = index === active;
          return (
            <AppLink
              key={path}
              href={href}
              aria-current={current ? "page" : undefined}
              className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-full text-xs font-medium transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${current ? "text-slate-950" : "text-slate-500 hover:text-slate-800"}`}
            >
              <Icon name={icon} className="h-5 w-5" />
              {t(label)}
            </AppLink>
          );
        })}
      </div>
    </nav>
  );
}
