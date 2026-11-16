import { expect, test, type Locator } from "@playwright/test";
import sharp from "sharp";

import { newTestEmail, signUpAndConfirm } from "./accounts";

/*===== Notes =====*/
// The one flow that crosses everything the template wires together: the captcha and sign-up, the confirmation email,
// the session, a guarded page, an image upload to the store, a form that creates and edits, a delete, and sign-out. In
// Persian, the language every project keeps. Needs the image store and Mailpit as well as the database
// (`pnpm services`).
test("a new account creates a note with an image, edits and deletes it, then signs out", async ({ page }) => {
  const title = `یادداشت ${Date.now()}`;
  const editedTitle = `${title} ویرایش‌شده`;
  const notes = page.getByRole("region", { name: "یادداشت‌های شما" });

  /*------ Sign Up ------*/
  const email = newTestEmail(test.info().workerIndex);
  await signUpAndConfirm({ page, email, password: "a-long-test-password" });
  await page.getByRole("link", { name: "ادامه" }).click();
  await expect(page).toHaveURL(/\/notes$/);

  /*------ Create ------*/
  await page.getByLabel("عنوان").fill(title);
  await page.getByLabel("متن").fill("متن یادداشت");
  // The picker uploads as soon as a file is chosen; its preview is the processed image, read back from the store.
  const picture = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#3b82f6" } })
    .png()
    .toBuffer();
  await page.getByLabel("عکس (اختیاری)").setInputFiles({ name: "note.png", mimeType: "image/png", buffer: picture });
  await expectLoaded(page.getByRole("img", { name: "پیش‌نمایش عکس" }));
  await page.getByRole("button", { name: "افزودن یادداشت" }).click();
  await expect(notes.getByRole("link", { name: `باز کردن «${title}»` })).toBeVisible();
  // The note kept its image, and the card's variant of it loads.
  await expectLoaded(notes.getByRole("img", { name: title }));
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

/** Passes once the image is on the page and its file arrived: an `<img>` whose request failed is still visible. */
async function expectLoaded(image: Locator) {
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
}
