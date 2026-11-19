import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/*===== Effect Layer Rules =====*/
// Checks the rules of a feature's Effect files that the type checker can't (docs/backend/architecture.md). Each
// rule names what to write instead. Run by `pnpm lint`.

const FEATURES_DIR = "src/orpc";

/** The files whose code is all Effect: business rules, queries and background work. */
const EFFECT_FILES = /^(service|repository|jobs\.server)\.ts$/;

const RULES = [
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

/** Every `service.ts`, `repository.ts` and `jobs.server.ts` under the features. */
async function effectFiles() {
  const files = [];
  for (const feature of await readdir(FEATURES_DIR, { withFileTypes: true })) {
    if (!feature.isDirectory()) continue;
    for (const name of await readdir(join(FEATURES_DIR, feature.name))) {
      if (EFFECT_FILES.test(name)) files.push(join(FEATURES_DIR, feature.name, name));
    }
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
for (const file of await effectFiles()) {
  const lines = (await readFile(file, "utf8")).split("\n");
  lines.forEach((line, index) => {
    for (const { pattern, message } of RULES) {
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
console.log("lint-effect: feature services, repositories and jobs OK");
