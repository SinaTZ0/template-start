import { expect, test } from "@playwright/test";

import { newTestEmail, signUpAndConfirm } from "./accounts";
import { linkFromEmail } from "./mailbox";

/*===== Password Reset =====*/
// A forgotten password is replaced through the emailed link, which signs the account out everywhere, and the new
// password is the one that works afterwards. Needs Mailpit as well as the database (`pnpm services`).
test("a forgotten password is replaced through the emailed link", async ({ page, context }) => {
  const email = newTestEmail(test.info().workerIndex);
  await signUpAndConfirm({ page, email, password: "the-old-password" });

  /*------ Ask for a Link ------*/
  await context.clearCookies();
  await page.goto("/auth");
  await page.getByRole("link", { name: "رمز عبور را فراموش کرده‌اید؟" }).click();
  // The link opens the page before its scripts have started, and a field filled by then is emptied when the form
  // starts. Nothing on the page says when that is, so the address is typed again until the form takes it.
  await expect(async () => {
    await page.getByLabel("ایمیل").fill(email);
    await page.getByRole("button", { name: "فرستادن پیوند" }).click();
    await expect(page.getByRole("status").getByText(email)).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });

  /*------ Choose a New Password ------*/
  await page.goto(await linkFromEmail({ to: email, subject: "انتخاب رمز عبور تازه" }));
  await expect(page).toHaveURL(/\/reset-password\?token=/);
  await page.getByLabel("رمز عبور تازه").fill("the-new-password");
  await page.getByRole("button", { name: "ذخیرهٔ رمز تازه" }).click();
  await expect(page.getByText("رمز عبور شما تغییر کرد")).toBeVisible();

  /*------ Sign In with It ------*/
  await page.getByRole("link", { name: "رفتن به صفحهٔ ورود" }).click();
  const signIn = page.getByRole("tabpanel");
  await signIn.getByLabel("ایمیل").fill(email);
  await signIn.getByLabel("رمز عبور").fill("the-old-password");
  await signIn.getByRole("button", { name: "ورود" }).click();
  await expect(page.getByText("ایمیل یا رمز عبور درست نیست.")).toBeVisible();
  await signIn.getByLabel("رمز عبور").fill("the-new-password");
  await signIn.getByRole("button", { name: "ورود" }).click();
  await expect(page).toHaveURL(/\/notes$/);
});
