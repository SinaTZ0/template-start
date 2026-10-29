// The current design, as a study's option 0: one screenshot per section × device × language × theme.
// Copy into .tmp-claude/<topic>-study/, set the constants, then from the repo root (dev server running):
//   node .tmp-claude/<topic>-study/shoot-base.mjs
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

/*===== Settings =====*/
const STUDY = ".tmp-claude/TOPIC-study";
const ORIGIN = "http://localhost:3000";
const PATH = "/"; // the Persian path; English is the same path under /en
// Output name → the section to shoot. The viewer reads base/<name>-<device>-<lang>-<theme>.jpg.
const SECTIONS = { main: "main section:first-of-type" };
// A normal user agent: some sites (an old site the page mirrors, say) answer HeadlessChrome with an error.
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/*===== Shoot =====*/
mkdirSync(`${STUDY}/base`, { recursive: true });
const browser = await chromium.launch();
for (const device of ["desk", "phone"]) for (const lang of ["fa", "en"]) for (const scheme of ["light", "dark"]) {
  const viewport = device === "desk" ? { width: 1440, height: 1000 } : { width: 390, height: 844 };
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, deviceScaleFactor: device === "desk" ? 1 : 2, userAgent: UA });
  const page = await ctx.newPage();
  await page.goto(ORIGIN + (lang === "en" ? `/en${PATH === "/" ? "" : PATH}` : PATH), { waitUntil: "load", timeout: 120000 });
  // The sticky header would cover the top of each section.
  await page.addStyleTag({ content: "header{display:none!important}" });
  for (const [name, selector] of Object.entries(SECTIONS)) {
    const section = page.locator(selector);
    await section.scrollIntoViewIfNeeded();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);
    // boundingBox() is relative to the viewport; a fullPage clip needs page coordinates.
    const scrollY = await page.evaluate(() => scrollY);
    const box = await section.boundingBox();
    await page.screenshot({
      path: `${STUDY}/base/${name}-${device}-${lang}-${scheme}.jpg`,
      type: "jpeg",
      quality: 85,
      fullPage: true,
      clip: { x: 0, y: box.y + scrollY, width: viewport.width, height: box.height },
    });
  }
  await ctx.close();
}
await browser.close();
