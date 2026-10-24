import { readFile, readdir } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { __unstable__loadDesignSystem } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";

/*===== Command Options =====*/

const supportedOptions = ["--check", "--json"];
const options = new Set(process.argv.slice(2));
for (const option of options) {
  if (!supportedOptions.includes(option)) {
    console.error(`Unknown option: ${option}. Supported options: ${supportedOptions.join(", ")}.`);
    process.exit(2);
  }
}

/*===== Project Design System =====*/

const sourceDir = "src";
const stylesheet = "src/styles.css";

// The untouched shadcn source is reference only (like `.oxlintrc.json`), and generated code is rewritten on
// every compile, so suggestions there could never be applied.
const ignoredPaths = ["src/components/ui/", "src/paraglide/", "src/routeTree.gen.ts"];

// This internal API also powers IntelliSense's suggestCanonicalClasses diagnostic.
// Keep @tailwindcss/node and @tailwindcss/oxide aligned with the project's Tailwind version.
const designSystem = await __unstable__loadDesignSystem(await readFile(stylesheet, "utf8"), {
  base: resolve(sourceDir),
});
const scanner = new Scanner({});
const files = (await readdir(sourceDir, { recursive: true }))
  .filter((file) => /\.(?:tsx?|jsx?|css)$/.test(file))
  .filter((file) => !file.split(/[\\/]/).some((part) => part.startsWith(".")))
  .map((file) => `${sourceDir}/${file.replaceAll("\\", "/")}`)
  .filter((file) => !ignoredPaths.some((ignored) => file === ignored || file.startsWith(ignored)))
  .toSorted();
const suggestions = [];
const replacements = new Map();

/*===== Source Scan =====*/

for (const file of files) {
  const content = await readFile(file, "utf8");
  const candidates = scanner.getCandidatesWithPositions({ content, extension: extname(file).slice(1) });

  for (const { candidate, position } of candidates) {
    if (!replacements.has(candidate)) {
      // Match IntelliSense's default rootFontSize when converting px and rem values.
      replacements.set(candidate, designSystem.canonicalizeCandidates([candidate], { rem: 16 })[0]);
    }
    const replacement = replacements.get(candidate);
    if (!replacement || replacement === candidate) continue;

    // Oxide reports UTF-16 offsets (checked on 4.3.3), so Persian text and symbols need no byte decoding.
    const prefix = content.slice(0, position);
    suggestions.push({
      file,
      line: prefix.split("\n").length,
      column: prefix.length - prefix.lastIndexOf("\n"),
      candidate,
      replacement,
    });
  }
}

/*===== Report =====*/

if (options.has("--json")) {
  console.log(JSON.stringify(suggestions, null, 2));
} else {
  for (const { file, line, column, candidate, replacement } of suggestions) {
    console.log(`${file}:${line}:${column}  ${candidate} -> ${replacement}`);
  }
  const affectedFiles = new Set(suggestions.map(({ file }) => file)).size;
  console.log(`\n${suggestions.length} Tailwind canonical class suggestions across ${affectedFiles} files.`);
}

// Suggestions are advisory by default; CI can opt into enforcing canonical spellings.
if (options.has("--check") && suggestions.length > 0) process.exitCode = 1;
