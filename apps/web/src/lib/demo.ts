import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "./api";
import { invalidateData, sessionQuery } from "./queries";
import { dismissDemoReadOnly } from "./toast";

/** Switches back from the demo account's data to the user's own. */
export function useExitDemo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.demo.delete()),
    onSuccess: async () => {
      dismissDemoReadOnly();
      queryClient.setQueryData(sessionQuery.queryKey, (session) =>
        session ? { ...session, user: { ...session.user, viewingDemo: false } } : session,
      );
      await invalidateData(queryClient);
    },
  });
}
