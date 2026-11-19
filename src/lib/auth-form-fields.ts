import { Schema } from "effect";

import { m } from "#/paraglide/messages";

/*===== Auth Form Fields =====*/
// The fields more than one auth form asks for: sign-in, sign-up, forgot password and reset password. Written for the
// forms' messages; the server (Better-Auth) is the final authority.

/** Better-Auth's default password limits, which it checks on sign-up and on a reset. */
export const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

// The shape of an address a mailbox accepts: a local part without leading, trailing or doubled dots, then a domain with
// a dot and a top-level part of two letters or more.
const EMAIL = /^(?!\.)(?!.*\.\.)[A-Za-z0-9_'+\-.]*[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

/** An email address, sent exactly as typed. */
export const EmailField = Schema.String.check(Schema.isPattern(EMAIL, { text: () => m.auth_form_email_invalid() }));

/** A password being chosen, on sign-up or a reset. Never normalized: it's sent exactly as typed. */
export const NewPasswordField = Schema.String.check(
  Schema.isMinLength(PASSWORD_MIN_LENGTH, { text: () => m.auth_form_password_too_short({ min: PASSWORD_MIN_LENGTH }) }),
  Schema.isMaxLength(PASSWORD_MAX_LENGTH, { text: () => m.auth_form_password_too_long({ max: PASSWORD_MAX_LENGTH }) }),
);
