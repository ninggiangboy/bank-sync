import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setDisplayTimeZone } from "./lib/format";
import { installKeyboardHandoff } from "./lib/keyboard";
import { configQuery, sessionQuery, settingsQuery } from "./lib/queries";
import { createQueryClient } from "./lib/query-client";
import { applySettings } from "./lib/theme";
import { routeTree } from "./routeTree.gen";
import "./styles/app.css";

const queryClient = createQueryClient(() => {
  // The session ended (signed out elsewhere, or the account was deleted).
  queryClient.setQueryData(sessionQuery.queryKey, null);
  const here = window.location.pathname + window.location.search;
  void router.navigate({ href: `/login?redirect=${encodeURIComponent(here)}` });
});

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  // Loaders hand data to TanStack Query, which decides freshness.
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Language, theme and the display time zone are known before the first render, so nothing flips.
const [config, settings] = await Promise.all([
  queryClient.fetchQuery(configQuery).catch(() => null),
  queryClient.fetchQuery(settingsQuery).catch(() => null),
]);
if (config) setDisplayTimeZone(config.timeZone);
if (settings) await applySettings(settings);

installKeyboardHandoff(router);

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
