import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { api, unwrap } from "./api";
import { authClient } from "./auth-client";

export const sessionQuery = queryOptions({
  queryKey: ["session"],
  queryFn: async () => (await authClient.getSession()).data ?? null,
  staleTime: 5 * 60 * 1000,
});

/** Locale and theme in effect: the saved settings when signed in, else the visitor's cookies. */
export const settingsQuery = queryOptions({
  queryKey: ["settings"],
  queryFn: () => unwrap(api.settings.get()),
  staleTime: Number.POSITIVE_INFINITY,
});

export const configQuery = queryOptions({
  queryKey: ["config"],
  queryFn: () => unwrap(api.public.config.get()),
  staleTime: Number.POSITIVE_INFINITY,
});

export type PublicConfig = Awaited<ReturnType<NonNullable<typeof configQuery.queryFn>>>;

const APP_STATE = new Set(["session", "settings", "config"]);

/**
 * Marks every data query stale after a change, the way Livewire re-rendered the whole page: a new
 * category, for example, shows up in the list, the reports and the settings counts. Active queries
 * refetch right away; the rest when they are next shown.
 */
export const invalidateData = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({
    predicate: (query) => !APP_STATE.has(String(query.queryKey[0])),
  });
