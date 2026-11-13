// Checks the message files (`messages/<locale>.json`) for what Paraglide compiles without complaint but the site can't
// afford: a key missing from a locale (Paraglide quietly shows the base locale's text), an empty message, and a
// placeholder a translation uses that the Persian doesn't have (the caller passes what the Persian needs; a translation
// may leave a value out where its grammar does without it). Run by `pnpm lint`. See docs/frontend/i18n.md.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const settings = JSON.parse(readFileSync(join(root, "project.inlang/settings.json"), "utf8"));
const { baseLocale, locales } = settings;
const problems = [];

/*===== Files =====*/
const files = {};
for (const locale of locales) {
  const path = `messages/${locale}.json`;
  try {
    const { $schema: _schema, ...messages } = JSON.parse(readFileSync(join(root, path), "utf8"));
    files[locale] = messages;
  } catch (error) {
    problems.push(`${path}: ${error.message}`);
  }
}

/*===== Messages =====*/
/** The `{name}` placeholders a message uses, whether it is a plain string or a variant list. */
function placeholders(value) {
  const text = JSON.stringify(value);
  return [...text.matchAll(/(?<!\\)\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((match) => match[1]);
}

if (problems.length === 0) {
  for (const locale of locales) {
    for (const [key, value] of Object.entries(files[locale])) {
      const where = `messages/${locale}.json: ${key}`;
      if (typeof value === "string" && value.trim() === "") problems.push(`${where}: empty`);
      for (const other of locales) {
        if (other !== locale && !(key in files[other])) problems.push(`${where}: missing in ${other}.json`);
      }
      if (locale !== baseLocale && key in files[baseLocale]) {
        const base = new Set(placeholders(files[baseLocale][key]));
        const extra = [...new Set(placeholders(value))].filter((name) => !base.has(name));
        if (extra.length > 0) problems.push(`${where}: {${extra.join("}, {")}} is not in the ${baseLocale} message`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`i18n-check: ${problems.length} problem(s)\n${problems.map((line) => `  ${line}`).join("\n")}`);
  process.exit(1);
}
console.log("i18n-check: messages OK");
