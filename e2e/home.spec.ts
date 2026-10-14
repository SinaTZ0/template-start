import { expect, test } from "@playwright/test";

test("the home page renders and links to sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "ورود" }).click();
  await expect(page).toHaveURL(/\/auth$/);
});
