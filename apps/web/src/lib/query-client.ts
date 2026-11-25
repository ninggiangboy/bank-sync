import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";
import { showDemoReadOnly } from "./toast";

/**
 * One place for errors every screen shares: writes refused on demo data show the read-only notice,
 * and a session that ended sends the user to the login page.
 */
export function createQueryClient(onUnauthenticated: () => void) {
  const handle = (error: unknown) => {
    if (!(error instanceof ApiError)) return;
    if (error.code === "demo_read_only") showDemoReadOnly();
    // Only the API's own "no session" answer: a wrong password at sign-in is a 401 too.
    if (error.status === 401 && error.code === "unauthenticated") onUnauthenticated();
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError: handle }),
    mutationCache: new MutationCache({ onError: handle }),
    defaultOptions: {
      queries: {
        // Data is stale at once, so a page shown again (including through back/forward) refetches
        // while it shows the cached copy: changes made on another page never stay hidden.
        staleTime: 0,
        // A 4xx answer will not change on retry.
        retry: (count, error) =>
          !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      },
    },
  });
}
