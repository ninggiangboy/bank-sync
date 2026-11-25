import { createRootRoute, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: () => (
    <main className="min-h-dvh bg-slate-50 text-slate-900">
      <Outlet />
    </main>
  ),
});
