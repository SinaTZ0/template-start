import { expect, type Page } from "@playwright/test";

import { linkFromEmail } from "./mailbox";

/*===== Test Accounts =====*/
// Accounts the browser tests sign up use this domain, so `global-teardown.ts` can tell them from real ones.
export const E2E_EMAIL_DOMAIN = "e2e.example.com";

/** A new address at the tests' domain, unique to this run and worker. */
export function newTestEmail(workerIndex: number): string {
  return `e2e-${Date.now()}-${workerIndex}@${E2E_EMAIL_DOMAIN}`;
}

/**
 * Signs up a new account in Persian and opens the confirmation link from its email, which confirms the address and
 * signs in. Ends on the confirmation page, signed in.
 */
export async function signUpAndConfirm({ page, email, password }: { page: Page; email: string; password: string }) {
  await page.goto("/auth");
  await page.getByRole("tab", { name: "ثبت‌نام" }).click();
  // Both tabs have an email and a password field; only the open one is a `tabpanel`.
  const signUp = page.getByRole("tabpanel");
  await signUp.getByLabel("نام").fill("آزمون");
  await signUp.getByLabel("ایمیل").fill(email);
  await signUp.getByLabel("رمز عبور").fill(password);
  // The real captcha runs: the browser solves the proof of work before the account is created.
  await signUp.getByRole("button", { name: "ساخت حساب" }).click();
  // Sign-up doesn't sign in: it sends the confirmation link.
  await expect(page.getByRole("status").getByText(email)).toBeVisible({ timeout: 30_000 });

  await page.goto(await linkFromEmail({ to: email, subject: "ایمیل خود را تأیید کنید" }));
  await expect(page).toHaveURL(/\/verify-email$/);
  await expect(page.getByText("ایمیل شما تأیید شد")).toBeVisible();
}
