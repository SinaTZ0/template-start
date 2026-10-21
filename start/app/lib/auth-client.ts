import { createAuthClient } from "better-auth/react";

/*===== Auth Client =====*/
/**
 * Browser client for Better-Auth endpoints (`/api/auth/*`). It talks to the current origin, so no
 * base URL is configured here.
 */
export const authClient = createAuthClient();
