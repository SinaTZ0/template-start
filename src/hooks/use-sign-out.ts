import { hashKey, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { toast } from "#/components/primitive/toast/toast";
import { authClient } from "#/lib/auth-client";
import { setReportedUser } from "#/lib/error-reporting.browser";
import { orpc } from "#/orpc/client";
import { m } from "#/paraglide/messages";

/*===== Sign Out =====*/
/** Signs out and goes home, then forgets this account's cached data. */
export function useSignOut() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { error } = await authClient.signOut();
      if (error) throw new Error(error.message ?? "Sign-out failed");
    },
    onSuccess: async () => {
      setReportedUser(null);
      await navigate({ to: "/" });
      // The header reads the viewer from the cache: set it rather than remove it, so the layout doesn't suspend.
      const viewerKey = orpc.session.viewer.queryKey();
      queryClient.setQueryData(viewerKey, null);
      // The next account on this device must not see this one's cached data. Removed after leaving: removing a query
      // while its page is mounted would refetch it without a session.
      queryClient.removeQueries({ predicate: (query) => query.queryHash !== hashKey(viewerKey) });
    },
    onError: () => {
      toast.add({ title: m.nav_sign_out_failed(), type: "error" });
    },
  });
}
