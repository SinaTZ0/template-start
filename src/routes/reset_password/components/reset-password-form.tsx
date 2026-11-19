import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "#/components/primitive/button/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "#/components/primitive/field/field";
import { Input } from "#/components/primitive/input/input";
import { Spinner } from "#/components/primitive/spinner/spinner";
import { FormAlert } from "#/components/shared/form-alert/form-alert";
import { authClient } from "#/lib/auth-client";
import { describeAuthError } from "#/lib/auth-errors";
import { PASSWORD_MIN_LENGTH } from "#/lib/auth-form-fields";
import { orpc } from "#/orpc/client";
import { m } from "#/paraglide/messages";
import { resetPasswordSchema, type ResetPasswordValues } from "#/routes/reset_password/schema";

/*===== Reset Password Form =====*/
/**
 * Sets a new password with the token from the email's link. `onInvalid` runs when the server no longer accepts the
 * token (used, expired, or edited), which the form can't fix: the page offers a new link instead.
 */
export function ResetPasswordForm({
  token,
  onDone,
  onInvalid,
}: {
  token: string;
  onDone: () => void;
  onInvalid: () => void;
}) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string>();
  const form = useForm<ResetPasswordValues>({
    resolver: standardSchemaResolver(resetPasswordSchema),
    defaultValues: { password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    const { error } = await authClient.resetPassword({ newPassword: values.password, token });
    if (error?.code === "INVALID_TOKEN") return onInvalid();
    if (error) return setFormError(describeAuthError(error));
    // A reset signs the account out everywhere (`revokeSessionsOnPasswordReset`), this browser included.
    await queryClient.invalidateQueries({ queryKey: orpc.session.viewer.key() });
    onDone();
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <FormAlert message={formError} />

        <Field data-invalid={!!errors.password || undefined}>
          <FieldLabel htmlFor="reset-password-password">{m.reset_password_label()}</FieldLabel>
          <Input
            id="reset-password-password"
            type="password"
            dir="ltr"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            {...form.register("password")}
          />
          <FieldDescription>{m.auth_password_hint({ min: PASSWORD_MIN_LENGTH })}</FieldDescription>
          <FieldError errors={[errors.password]} />
        </Field>

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Spinner data-icon="inline-start" />}
          {m.reset_submit()}
        </Button>
      </FieldGroup>
    </form>
  );
}
