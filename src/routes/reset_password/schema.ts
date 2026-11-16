import { z } from "zod";

import { newPasswordField } from "#/lib/auth-form-fields";

/*===== Search =====*/
// What Better-Auth's link check sends the browser here with (`/api/auth/reset-password/<token>`): the token when the
// link is good, `error=INVALID_TOKEN` when it isn't. Either can be missing or edited by hand.
export const resetPasswordSearchSchema = z.object({
  token: z.string().min(1).optional().catch(undefined),
  error: z.string().optional().catch(undefined),
});

/*===== Form =====*/
export const resetPasswordSchema = z.object({ password: newPasswordField() });

export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
