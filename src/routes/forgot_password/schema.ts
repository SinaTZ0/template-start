import { z } from "zod";

import { emailField } from "#/lib/auth-form-fields";

/*===== Forgot Password =====*/
export const forgotPasswordSchema = z.object({ email: emailField() });

export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;
