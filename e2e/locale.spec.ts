import { expect, test } from "@playwright/test";

test("an English page is left-to-right, keeps its prefix, and switches back to Persian", async ({ page }) => {
  await page.goto("/en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");

  // Links are declared without a locale; the router keeps the visitor's. The notes page is guarded, so it redirects.
  await page.getByRole("link", { name: "Notes", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/auth\?redirectTo=/);

  await page.getByRole("link", { name: "فارسی" }).click();
  await expect(page).toHaveURL(/\/auth\?redirectTo=/);
  await expect(page).not.toHaveURL(/\/en\//);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});
