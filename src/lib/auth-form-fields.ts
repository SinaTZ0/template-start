import { z } from "zod";

import { m } from "#/paraglide/messages";

/*===== Auth Form Fields =====*/
// The fields more than one auth form asks for: sign-in, sign-up, forgot password and reset password. Written for the
// forms' messages; the server (Better-Auth) is the final authority.

/** Better-Auth's default password limits, which it checks on sign-up and on a reset. */
export const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

/** An email address, sent exactly as typed. */
export const emailField = () => z.email({ error: () => m.auth_form_email_invalid() });

/** A password being chosen, on sign-up or a reset. Never normalized: it's sent exactly as typed. */
export const newPasswordField = () =>
  z
    .string()
    .min(PASSWORD_MIN_LENGTH, { error: () => m.auth_form_password_too_short({ min: PASSWORD_MIN_LENGTH }) })
    .max(PASSWORD_MAX_LENGTH, { error: () => m.auth_form_password_too_long({ max: PASSWORD_MAX_LENGTH }) });
