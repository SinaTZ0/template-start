import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "~/components/primitive/button/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "~/components/primitive/field/field";
import { Input } from "~/components/primitive/input/input";
import { Spinner } from "~/components/primitive/spinner/spinner";
import { FormAlert } from "~/components/shared/form-alert/form-alert";
import { authClient } from "~/lib/auth-client";
import { ALTCHA_HEADER } from "~/lib/auth-constants";
import { describeAuthError } from "~/routes/auth/auth-errors";
import { useCaptcha } from "~/routes/auth/hooks/use-captcha";
import { signUpSchema, type SignUpValues } from "~/routes/auth/schema";

/*===== Sign Up Form =====*/
/** Creates an account and signs in. A proof-of-work captcha is solved in the background while submitting. */
export function SignUpForm({ onSuccess }: { onSuccess: () => void }) {
  const [formError, setFormError] = useState<string>();
  const { widgetRef, solve } = useCaptcha();
  const form = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: "", email: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);

    /*------ Captcha ------*/
    const payload = await solve().catch(() => null);
    if (!payload) return setFormError("بررسی امنیتی انجام نشد. صفحه را دوباره بارگذاری کنید.");

    /*------ Account ------*/
    const { error } = await authClient.signUp.email(values, { headers: { [ALTCHA_HEADER]: payload } });
    if (error) return setFormError(describeAuthError(error));
    onSuccess();
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <FormAlert message={formError} />

        <Field data-invalid={!!errors.name || undefined}>
          <FieldLabel htmlFor="sign-up-name">نام</FieldLabel>
          <Input id="sign-up-name" autoComplete="name" aria-invalid={!!errors.name} {...form.register("name")} />
          <FieldError errors={[errors.name]} />
        </Field>

        <Field data-invalid={!!errors.email || undefined}>
          <FieldLabel htmlFor="sign-up-email">ایمیل</FieldLabel>
          <Input
            id="sign-up-email"
            type="email"
            dir="ltr"
            autoComplete="email"
            aria-invalid={!!errors.email}
            {...form.register("email")}
          />
          <FieldError errors={[errors.email]} />
        </Field>

        <Field data-invalid={!!errors.password || undefined}>
          <FieldLabel htmlFor="sign-up-password">رمز عبور</FieldLabel>
          <Input
            id="sign-up-password"
            type="password"
            dir="ltr"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            {...form.register("password")}
          />
          <FieldDescription>حداقل ۸ نویسه.</FieldDescription>
          <FieldError errors={[errors.password]} />
        </Field>

        {/* Invisible: it only solves the challenge; `suppressHydrationWarning` because it upgrades after hydration. */}
        <altcha-widget ref={widgetRef} display="invisible" suppressHydrationWarning />

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Spinner data-icon="inline-start" />}
          ساخت حساب
        </Button>
      </FieldGroup>
    </form>
  );
}
