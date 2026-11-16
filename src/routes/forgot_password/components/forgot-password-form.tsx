import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "#/components/primitive/button/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "#/components/primitive/field/field";
import { Input } from "#/components/primitive/input/input";
import { Spinner } from "#/components/primitive/spinner/spinner";
import { FormAlert } from "#/components/shared/form-alert/form-alert";
import { authClient } from "#/lib/auth-client";
import { describeAuthError } from "#/lib/auth-errors";
import { m } from "#/paraglide/messages";
import { forgotPasswordSchema, type ForgotPasswordValues } from "#/routes/forgot_password/schema";

/*===== Forgot Password Form =====*/
/**
 * Asks for a password reset link. The answer is the same whether the address has an account or not, so `onSent` runs
 * for both and the page never says which; only an address with an account gets the email.
 */
export function ForgotPasswordForm({ onSent }: { onSent: (email: string) => void }) {
  const [formError, setFormError] = useState<string>();
  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    // The page the link lands on is the server's choice (`withLandingPage` in `src/lib/auth.server.ts`).
    const { error } = await authClient.requestPasswordReset({ email: values.email });
    if (error) return setFormError(describeAuthError(error));
    onSent(values.email);
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <FormAlert message={formError} />

        <Field data-invalid={!!errors.email || undefined}>
          <FieldLabel htmlFor="forgot-password-email">{m.auth_email_label()}</FieldLabel>
          <Input
            id="forgot-password-email"
            type="email"
            dir="ltr"
            autoComplete="email"
            aria-invalid={!!errors.email}
            {...form.register("email")}
          />
          <FieldError errors={[errors.email]} />
        </Field>

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Spinner data-icon="inline-start" />}
          {m.forgot_submit()}
        </Button>
      </FieldGroup>
    </form>
  );
}
