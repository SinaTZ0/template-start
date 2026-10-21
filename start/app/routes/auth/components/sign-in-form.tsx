import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "~/components/primitive/button/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "~/components/primitive/field/field";
import { Input } from "~/components/primitive/input/input";
import { Spinner } from "~/components/primitive/spinner/spinner";
import { FormAlert } from "~/components/shared/form-alert/form-alert";
import { authClient } from "~/lib/auth-client";
import { describeAuthError } from "~/routes/auth/auth-errors";
import { signInSchema, type SignInValues } from "~/routes/auth/schema";

/*===== Sign In Form =====*/
export function SignInForm({ onSuccess }: { onSuccess: () => void }) {
  const [formError, setFormError] = useState<string>();
  const form = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    const { error } = await authClient.signIn.email(values);
    if (error) return setFormError(describeAuthError(error));
    onSuccess();
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <FormAlert message={formError} />

        <Field data-invalid={!!errors.email || undefined}>
          <FieldLabel htmlFor="sign-in-email">ایمیل</FieldLabel>
          <Input
            id="sign-in-email"
            type="email"
            dir="ltr"
            autoComplete="email"
            aria-invalid={!!errors.email}
            {...form.register("email")}
          />
          <FieldError errors={[errors.email]} />
        </Field>

        <Field data-invalid={!!errors.password || undefined}>
          <FieldLabel htmlFor="sign-in-password">رمز عبور</FieldLabel>
          <Input
            id="sign-in-password"
            type="password"
            dir="ltr"
            autoComplete="current-password"
            aria-invalid={!!errors.password}
            {...form.register("password")}
          />
          <FieldError errors={[errors.password]} />
        </Field>

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Spinner data-icon="inline-start" />}
          ورود
        </Button>
      </FieldGroup>
    </form>
  );
}
