import { Schema } from "effect";

import { NAME_MAX_LENGTH } from "#/lib/auth-constants";
import { EmailField, NewPasswordField } from "#/lib/auth-form-fields";
import { PersianText, standardSchema } from "#/lib/schema";
import { m } from "#/paraglide/messages";

/*===== Sign In =====*/
// Written for the form's messages. The server (Better-Auth) is the final authority.
const SignInFields = Schema.Struct({
  email: EmailField,
  password: Schema.String.check(Schema.isMinLength(1, { text: () => m.auth_form_password_required() })),
});

export const signInSchema = standardSchema(SignInFields);

export type SignInValues = typeof SignInFields.Type;

/*===== Sign Up =====*/
// Only the name is free text: the email and password are sent exactly as typed. The server normalizes the name again
// and checks its length (`#/server/better-auth.server`).
const SignUpFields = Schema.Struct({
  name: PersianText.check(
    Schema.isMinLength(1, { text: () => m.auth_form_name_required() }),
    Schema.isMaxLength(NAME_MAX_LENGTH, { text: () => m.auth_form_name_too_long({ max: NAME_MAX_LENGTH }) }),
  ),
  email: EmailField,
  password: NewPasswordField,
});

export const signUpSchema = standardSchema(SignUpFields);

export type SignUpValues = typeof SignUpFields.Type;
