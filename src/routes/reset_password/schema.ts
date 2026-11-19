import { Schema } from "effect";

import { NewPasswordField } from "#/lib/auth-form-fields";
import { optionalSearchParam, searchSchema, standardSchema } from "#/lib/schema";

/*===== Search =====*/
// What Better-Auth's link check sends the browser here with (`/api/auth/reset-password/<token>`): the token when the
// link is good, `error=INVALID_TOKEN` when it isn't. Either can be missing or edited by hand.
export const resetPasswordSearchSchema = searchSchema(
  Schema.Struct({
    token: optionalSearchParam(Schema.String.check(Schema.isMinLength(1))),
    error: optionalSearchParam(Schema.String),
  }),
);

/*===== Form =====*/
const ResetPasswordFields = Schema.Struct({ password: NewPasswordField });

export const resetPasswordSchema = standardSchema(ResetPasswordFields);

export type ResetPasswordValues = typeof ResetPasswordFields.Type;
