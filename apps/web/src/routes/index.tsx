import { createFileRoute } from "@tanstack/react-router";
import { api } from "../lib/api";

export const Route = createFileRoute("/")({
  loader: async () => {
    const { data, error } = await api.up.get();
    return { healthy: data?.status === "ok" && !error };
  },
  component: Home,
});

function Home() {
  const { healthy } = Route.useLoaderData();
  return (
    <div className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-semibold">Bank Sync</h1>
      <p className="mt-2" data-testid="api-health">
        API: {healthy ? "ok" : "unreachable"}
      </p>
    </div>
  );
}
