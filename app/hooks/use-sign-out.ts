import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRevalidator } from "react-router";

import { toast } from "~/components/primitive/toast/toast";
import { authClient } from "~/lib/auth-client";

/*===== Sign Out =====*/
/** Signs out and goes home, then forgets this account's cached data. */
export function useSignOut() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const revalidator = useRevalidator();

  return useMutation({
    mutationFn: async () => {
      const { error } = await authClient.signOut();
      if (error) throw new Error(error.message ?? "Sign-out failed");
    },
    onSuccess: async () => {
      await navigate("/");
      // A plain navigation keeps the mounted layout's loader data, so the header would still show the account.
      await revalidator.revalidate();
      // The next account on this device must not see this one's cached data. Cleared after leaving: clearing while a
      // page is mounted would refetch its queries without a session.
      queryClient.clear();
    },
    onError: () => {
      toast.add({ title: "خروج انجام نشد. دوباره امتحان کنید.", type: "error" });
    },
  });
}
