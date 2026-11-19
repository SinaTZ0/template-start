import { Schema } from "effect";

import { EmailField } from "#/lib/auth-form-fields";
import { standardSchema } from "#/lib/schema";

/*===== Forgot Password =====*/
const ForgotPasswordFields = Schema.Struct({ email: EmailField });

export const forgotPasswordSchema = standardSchema(ForgotPasswordFields);

export type ForgotPasswordValues = typeof ForgotPasswordFields.Type;
