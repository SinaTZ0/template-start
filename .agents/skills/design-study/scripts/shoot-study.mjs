// Screenshots of a study route, one per option, language, theme and width, to check every option before handing it over.
// Copy into .tmp-claude/<topic>-study/ and run from the repo root with the dev server up:
//   node .tmp-claude/<topic>-study/shoot-study.mjs <topic> <options> [langs] [themes] [widths]
// <topic> is the URL's (`hero-carousel`); <options> a comma list ("0,1,2,3,3b"); langs fa,en; themes light,dark;
// widths in px, 1440,390 by default, so the phone is never skipped.
// STUDY_BASE is the dev server (http://localhost:5173 by default). A study behind sign-in needs STUDY_EMAIL and
// STUDY_PASSWORD; a public one needs neither.
// Writes shots/o<option>-<lang>-<theme>-<width>.png next to this script, with the bar's notes hidden, and prints any page
// errors.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.STUDY_BASE ?? "http://localhost:5173";
const [topic, opts = "0,1,2,3,4", langs = "fa", themes = "light", widths = "1440,390"] = process.argv.slice(2);
const list = (value) => value.split(",").filter(Boolean);

mkdirSync(join(DIR, "shots"), { recursive: true });
const browser = await chromium.launch();
const errors = [];
for (const theme of list(themes)) {
  for (const width of list(widths).map(Number)) {
    const phone = width < 768;
    const context = await browser.newContext({
      viewport: { width, height: phone ? 844 : 900 },
      deviceScaleFactor: phone ? 2 : 1,
      colorScheme: theme,
      // Some sites that photos are hotlinked from answer `HeadlessChrome` with an error.
      userAgent: `Mozilla/5.0 (${phone ? "Linux; Android 14" : "Windows NT 10.0; Win64; x64"}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 ${phone ? "Mobile " : ""}Safari/537.36`,
    });
    if (process.env.STUDY_EMAIL) {
      // One sign-in per context: the auth endpoints are rate limited.
      await context.request.post(`${BASE}/api/auth/sign-in/email`, {
        data: { email: process.env.STUDY_EMAIL, password: process.env.STUDY_PASSWORD },
        headers: { origin: BASE },
      });
    }
    await context.addInitScript((value) => localStorage.setItem("app-theme", value), theme);
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => message.type() === "error" && errors.push(message.text().slice(0, 200)));
    for (const lang of list(langs)) {
      for (const opt of list(opts)) {
        await page.goto(`${BASE}${lang === "en" ? "/en" : ""}/design-study/${topic}?opt=${opt}`, { waitUntil: "load" });
        await page.waitForSelector("[data-study-bar]", { timeout: 40000 });
        await page.addStyleTag({
          content:
            "[data-testid=tanstack_devtools], .tsqd-parent-container, .tsqd-open-btn-container, [data-study-notes] { display: none !important }",
        });
        await page.waitForTimeout(1800);
        await page.screenshot({ path: join(DIR, "shots", `o${opt}-${lang}-${theme}-${width}.png`) });
      }
    }
    await context.close();
  }
}
if (errors.length) console.error("page errors:", [...new Set(errors)]);
await browser.close();
