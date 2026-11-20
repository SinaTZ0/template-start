import { readFile, readdir } from "node:fs/promises";
import { join, sep } from "node:path";

/*===== Effect Rules =====*/
// Checks the rules of the server's Effect code that the type checker can't (docs/backend/architecture.md). Each rule
// names what to write instead. Run by `pnpm lint`.

const SOURCE_DIR = "src";

/** Generated code, which no rule applies to. */
const GENERATED = /^src\/(paraglide\/|routeTree\.gen\.ts$)/;

/*------ Feature Files ------*/
// The files whose code is all Effect: business rules, queries and background work.
const FEATURE_RULES = [
  {
    pattern: /\basync\b|\bawait\b/,
    message:
      "no async/await: write an Effect.fn and yield* (wrap a promise API once in a service, with Effect.promise).",
  },
  {
    pattern: /\bthrow\b|\btry\s*\{/,
    message: "no throw/try: fail with a Schema.TaggedError (`return yield* new X()`), or end in Effect.orDie.",
  },
  {
    pattern: /\bEffect\.run[A-Z]\w*|\bRuntime\.run|\.run(Promise|Sync|Fork)(Exit)?\(/,
    message: "no running Effects here: compose with yield*. Only boundaries run them (#/orpc/effect.server).",
  },
  {
    pattern: /#\/paraglide\/messages/,
    message: "no user-facing text here: fail with a tagged error; the procedure writes the message.",
  },
];

/*------ Everywhere ------*/
const SOURCE_RULES = [
  {
    pattern: /yield\*\s*\(\s*yield\*/,
    message: "ask for the service on its own line (`const notes = yield* NoteService;`), then call it.",
  },
];

/*------ Routes ------*/
const ROUTE_RULES = [
  {
    pattern: /\bappRuntime\b/,
    message: "run the Effect with runInRequest (#/server/runtime.server), so it joins the request's trace.",
  },
];

/** Which files each set of rules applies to, by their path from the repository root. */
const RULE_SETS = [
  { files: /^src\/orpc\/[^/]+\/(service|repository|jobs\.server)\.ts$/, rules: FEATURE_RULES },
  { files: /\.tsx?$/, rules: SOURCE_RULES },
  { files: /^src\/routes\//, rules: ROUTE_RULES },
];

/** Every TypeScript file under `src/`, generated code aside. */
async function sourceFiles(dir = SOURCE_DIR) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name).split(sep).join("/");
    if (GENERATED.test(path)) continue;
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (/\.tsx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

/** The code of a line without its comment, so a rule named in a comment isn't a match. */
function code(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return "";
  return line.replace(/\/\/.*$/, "");
}

/*===== Run =====*/
let problems = 0;
for (const file of await sourceFiles()) {
  const rules = RULE_SETS.filter((set) => set.files.test(file)).flatMap((set) => set.rules);
  const lines = (await readFile(file, "utf8")).split("\n");
  lines.forEach((line, index) => {
    for (const { pattern, message } of rules) {
      if (pattern.test(code(line))) {
        console.error(`${file}:${index + 1}: ${message}`);
        problems += 1;
      }
    }
  });
}

if (problems > 0) {
  console.error(`\nlint-effect: ${problems} problem(s).`);
  process.exit(1);
}
console.log("lint-effect: Effect code OK");
