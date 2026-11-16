import { z } from "zod";

import { NAME_MAX_LENGTH } from "#/lib/auth-constants";
import { emailField, newPasswordField } from "#/lib/auth-form-fields";
import { persianText } from "#/lib/persian-text";
import { m } from "#/paraglide/messages";

/*===== Sign In =====*/
// Written for the form's messages. The server (Better-Auth) is the final authority.
export const signInSchema = z.object({
  email: emailField(),
  password: z.string().min(1, { error: () => m.auth_form_password_required() }),
});

export type SignInValues = z.infer<typeof signInSchema>;

/*===== Sign Up =====*/
// Only the name is free text: the email and password are sent exactly as typed. The server normalizes the name again
// and checks its length (`src/lib/auth.server.ts`).
export const signUpSchema = z.object({
  name: persianText()
    .min(1, { error: () => m.auth_form_name_required() })
    .max(NAME_MAX_LENGTH, { error: () => m.auth_form_name_too_long({ max: NAME_MAX_LENGTH }) }),
  email: emailField(),
  password: newPasswordField(),
});

export type SignUpValues = z.infer<typeof signUpSchema>;
