import { z } from "zod";

import { persianText } from "#/lib/persian-text";
import { m } from "#/paraglide/messages";

/*===== Sign In =====*/
// Written for the form's messages. The server (Better-Auth) is the final authority.
export const signInSchema = z.object({
  email: z.email({ error: () => m.auth_form_email_invalid() }),
  password: z.string().min(1, { error: () => m.auth_form_password_required() }),
});

export type SignInValues = z.infer<typeof signInSchema>;

/*===== Sign Up =====*/
// The password limits are Better-Auth's defaults. Only the name is free text: the email and password are sent
// exactly as typed. The server normalizes the name again (`databaseHooks` in `src/lib/auth.server.ts`).
const NAME_MAX_LENGTH = 60;
export const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

export const signUpSchema = z.object({
  name: persianText()
    .min(1, { error: () => m.auth_form_name_required() })
    .max(NAME_MAX_LENGTH, { error: () => m.auth_form_name_too_long({ max: NAME_MAX_LENGTH }) }),
  email: z.email({ error: () => m.auth_form_email_invalid() }),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, { error: () => m.auth_form_password_too_short({ min: PASSWORD_MIN_LENGTH }) })
    .max(PASSWORD_MAX_LENGTH, { error: () => m.auth_form_password_too_long({ max: PASSWORD_MAX_LENGTH }) }),
});

export type SignUpValues = z.infer<typeof signUpSchema>;
