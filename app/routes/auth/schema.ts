import { z } from "zod";

import { persianText } from "~/lib/persian-text";

/*===== Sign In =====*/
// Written for the form's messages. The server (Better-Auth) is the final authority.
export const signInSchema = z.object({
  email: z.email("ایمیل معتبر وارد کنید."),
  password: z.string().min(1, "رمز عبور را وارد کنید."),
});

export type SignInValues = z.infer<typeof signInSchema>;

/*===== Sign Up =====*/
// Better-Auth's default minimum password length is 8. Only the name is free text: the email and password are sent
// exactly as typed. The server normalizes the name again (`databaseHooks` in `app/lib/auth.server.ts`).
export const signUpSchema = z.object({
  name: persianText().min(1, "نام خود را وارد کنید.").max(60, "نام حداکثر ۶۰ حرف است."),
  email: z.email("ایمیل معتبر وارد کنید."),
  password: z.string().min(8, "رمز عبور حداقل ۸ نویسه است.").max(128, "رمز عبور حداکثر ۱۲۸ نویسه است."),
});

export type SignUpValues = z.infer<typeof signUpSchema>;
