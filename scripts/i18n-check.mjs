// Checks the message files (`messages/<locale>.json`) for what Paraglide compiles without complaint but the site can't
// afford: a key missing from a locale (Paraglide quietly shows the base locale's text), an empty message, and a
// placeholder a translation uses that the Persian doesn't have (the caller passes what the Persian needs; a translation
// may leave a value out where its grammar does without it). It also checks that the inlang plugins are committed (see
// Plugins below). Run by `pnpm lint`. See docs/frontend/i18n.md.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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

/*===== Plugins =====*/
// The compiler downloads the plugins in `settings.json` from jsDelivr on every compile and falls back to its copy in
// `project.inlang/cache/plugins/` when that fails. Without either it compiles no messages and still reports success.
// So the copies are committed: the image build must not depend on a CDN the server may not reach. inlang ignores its
// whole folder, hence `git add -f`; a plugin whose version changed gets a new file name, which is what this catches.

/** The cache file name inlang gives a plugin: the 64-bit FNV-1a hash of its URL, in base 36 (`@inlang/sdk`). */
function pluginCacheName(url) {
  let hash = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(url)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n);
  return hash.toString(36);
}

/** Whether git tracks the file. True outside a repository, where there is nothing to ask. */
function isTracked(path) {
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], { cwd: root, stdio: "ignore" });
  } catch {
    return true;
  }
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", path], { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

for (const url of settings.modules ?? []) {
  const path = `project.inlang/cache/plugins/${pluginCacheName(url)}`;
  if (!existsSync(join(root, path))) {
    problems.push(`${path}: missing, the copy of ${url}. Run pnpm i18n:compile online, then git add -f ${path}`);
  } else if (!isTracked(path)) {
    problems.push(`${path}: not committed, the copy of ${url}. Run git add -f ${path}`);
  }
}

if (problems.length > 0) {
  console.error(`i18n-check: ${problems.length} problem(s)\n${problems.map((line) => `  ${line}`).join("\n")}`);
  process.exit(1);
}
console.log("i18n-check: messages OK");
