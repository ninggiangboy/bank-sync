import { type QueryClient, useQuery } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { Toaster } from "../components/toaster";
import { settingsQuery } from "../lib/queries";
import { applySettings } from "../lib/theme";

export type RouterContext = { queryClient: QueryClient };

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Root,
});

function Root() {
  const { data: settings } = useQuery(settingsQuery);
  // Signing in, or changing a setting, can switch language and theme.
  useEffect(() => {
    if (settings) void applySettings(settings);
  }, [settings]);

  return (
    <>
      <Outlet />
      <Toaster />
    </>
  );
}
