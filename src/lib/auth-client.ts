import { createAuthClient } from "better-auth/react";

import { LOCALE_HEADER } from "#/lib/locale";
import { getLocale } from "#/paraglide/runtime";

/*===== Auth Client =====*/
/**
 * Browser client for Better-Auth endpoints (`/api/auth/*`). It talks to the current origin, so no base URL is
 * configured here. Every request names the page's locale in `x-locale`, as the API client does: `/api/auth/*` paths
 * carry none, and the emails these requests send (a confirmation link, a password reset) go out in it.
 */
export const authClient = createAuthClient({
  fetchOptions: {
    onRequest: (context) => {
      context.headers.set(LOCALE_HEADER, getLocale());
    },
  },
});
