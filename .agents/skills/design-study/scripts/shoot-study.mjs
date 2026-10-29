// Screenshots of a study page's frame, one per option, to check every option before handing the study over.
// From the repo root:
//   node .tmp-claude/<topic>-study/shoot-study.mjs <options> [device] [lang] [theme]
// <options> is digits ("1234") or a comma list ("9,10,11"); device desk|phone, lang fa|en, theme light|dark.
// Writes shots/o<n>-<device>-<lang>-<theme>.png next to this script.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
// Must match KEY in index.html.
const KEY = "TOPIC-study";
const [opts = "1234", device = "desk", lang = "fa", theme = "light"] = process.argv.slice(2);

mkdirSync(join(DIR, "shots"), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.goto(pathToFileURL(join(DIR, "index.html")).href);
for (const opt of opts.includes(",") ? opts.split(",") : [...opts]) {
  await page.evaluate(([key, s]) => localStorage.setItem(key, JSON.stringify(s)), [KEY, { opt: Number(opt), section: "all", device, lang, theme }]);
  await page.reload();
  await page.waitForTimeout(600);
  await page.locator("#frame").screenshot({ path: join(DIR, "shots", `o${opt}-${device}-${lang}-${theme}.png`) });
}
if (errors.length) console.error("page errors:", errors);
await browser.close();
