import { type QueryClient, useQuery } from "@tanstack/react-query";
import { Outlet, type ParsedLocation, redirect, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Navigation } from "../components/navigation";
import { useExitDemo } from "../lib/demo";
import { sessionQuery } from "../lib/queries";

/**
 * `beforeLoad` of the signed-in layout route: sends visitors without a session to the login page,
 * remembering where they were going.
 */
export async function requireSession({
  context,
  location,
}: {
  context: { queryClient: QueryClient };
  location: ParsedLocation;
}) {
  const session = await context.queryClient.ensureQueryData(sessionQuery);
  if (!session) {
    throw redirect({ href: `/login?redirect=${encodeURIComponent(location.href)}` });
  }
  return { session };
}

/** The demo banner shows only where demo data is on screen. */
const DEMO_PAGES = ["/transactions", "/reports"];

/** Signed-in screens: the mobile column, the demo banner and the bottom navigation. */
export function AppLayout() {
  const { t } = useTranslation();
  const { data: session } = useQuery(sessionQuery);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const exitDemo = useExitDemo();
  const showDemoBanner =
    session?.user.viewingDemo === true && DEMO_PAGES.some((page) => pathname.startsWith(page));

  return (
    <>
      <div className="mx-auto min-h-screen max-w-lg overflow-x-clip bg-white pb-24">
        {showDemoBanner ? (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-amber-100 px-4 py-2 text-sm text-amber-900"
          >
            <p>{t("You are viewing demo data, they can't be updated.")}</p>
            <button
              type="button"
              onClick={() => exitDemo.mutate()}
              disabled={exitDemo.isPending}
              className="inline-flex min-h-11 items-center font-semibold underline focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
            >
              {t("Exit demo mode")}
            </button>
          </div>
        ) : null}

        <main className="px-4 py-4">
          <Outlet />
        </main>
      </div>
      <Navigation />
    </>
  );
}
