import { expect, test } from "@playwright/test";

import { E2E_EMAIL_DOMAIN } from "./accounts";

/*===== Notes =====*/
// The one flow that crosses everything the template wires together: the captcha and sign-up, the session, a guarded
// page, a form that creates and edits, a delete, and sign-out. In Persian, the language every project keeps.
test("a new account creates, edits and deletes a note, then signs out", async ({ page }) => {
  const title = `یادداشت ${Date.now()}`;
  const editedTitle = `${title} ویرایش‌شده`;
  const notes = page.getByRole("region", { name: "یادداشت‌های شما" });

  /*------ Sign Up ------*/
  await page.goto("/auth");
  await page.getByRole("tab", { name: "ثبت‌نام" }).click();
  // Both tabs have an email and a password field; only the open one is a `tabpanel`.
  const signUp = page.getByRole("tabpanel");
  await signUp.getByLabel("نام").fill("آزمون");
  await signUp.getByLabel("ایمیل").fill(`e2e-${Date.now()}-${test.info().workerIndex}@${E2E_EMAIL_DOMAIN}`);
  await signUp.getByLabel("رمز عبور").fill("a-long-test-password");
  // The real captcha runs: the browser solves the proof of work before the account is created.
  await signUp.getByRole("button", { name: "ساخت حساب" }).click();
  await expect(page).toHaveURL(/\/notes$/, { timeout: 30_000 });

  /*------ Create ------*/
  await page.getByLabel("عنوان").fill(title);
  await page.getByLabel("متن").fill("متن یادداشت");
  await page.getByRole("button", { name: "افزودن یادداشت" }).click();
  await expect(notes.getByRole("link", { name: `باز کردن «${title}»` })).toBeVisible();
  // The form is ready for the next note.
  await expect(page.getByLabel("عنوان")).toHaveValue("");

  /*------ Edit ------*/
  await notes.getByRole("link", { name: `باز کردن «${title}»` }).click();
  await expect(page).toHaveURL(/\/notes\/[\w-]+$/);
  await expect(page.getByLabel("عنوان")).toHaveValue(title);
  await page.getByLabel("عنوان").fill(editedTitle);
  await page.getByRole("button", { name: "ذخیرهٔ تغییرها" }).click();
  await expect(page).toHaveURL(/\/notes$/);
  await expect(notes.getByRole("link", { name: `باز کردن «${editedTitle}»` })).toBeVisible();

  /*------ Delete ------*/
  await notes.getByRole("button", { name: `حذف «${editedTitle}»` }).click();
  await expect(notes.getByText("هنوز یادداشتی ندارید")).toBeVisible();

  /*------ Sign Out ------*/
  await page.getByRole("button", { name: "حساب کاربری" }).click();
  await page.getByRole("menuitem", { name: "خروج" }).click();
  await expect(page.getByRole("link", { name: "ورود" })).toBeVisible();
  // The session is gone, not only the header's idea of it: the guarded page sends the visitor to sign in.
  await page.goto("/notes");
  await expect(page).toHaveURL(/\/auth\?redirectTo=/);
});
