import type { Plugin } from "vite";

/*===== Trace Layers =====*/
// `src/orpc/<feature>/service.ts` or `repository.ts`, with either path separator.
const LAYER_FILE = /[\\/]src[\\/]orpc[\\/]([^\\/]+)[\\/](service|repository)\.ts$/;
const ASYNC_EXPORT = /^export async function (\w+)/gm;

/**
 * Times every exported async function of a feature's service and repository as a `service` or `repository` span
 * (`src/lib/trace.server.ts`), named `<feature>.<function>`, e.g. `note.listNotes`. Feature code stays plain.
 *
 * Exported function declarations are mutable bindings, so the code appended to the module reassigns each one to its
 * traced wrapper: importers and calls inside the module both go through it. Only `async` functions are wrapped. A
 * plain function may return a Drizzle query builder, which runs its query every time it is awaited, so timing it from
 * outside would run the query twice.
 *
 * The code is appended, never inserted, so line numbers (and source maps) stay as they were. The appended `import` is
 * hoisted like any other.
 */
export function traceLayers(): Plugin {
  return {
    name: "trace-layers",
    transform(code, id) {
      // Server-side modules only: the trace lives in `.server` code, which the client bundle can't import.
      if (this.environment.config.consumer !== "server") return;
      const match = LAYER_FILE.exec(id.split("?")[0] ?? id);
      if (!match) return;

      const [, feature, kind] = match;
      const names = [...code.matchAll(ASYNC_EXPORT)].map(([, name]) => name);
      if (names.length === 0) return;

      const wraps = names.map(
        (name) => `${name} = __traced({ kind: "${kind}", name: "${feature}.${name}", fn: ${name} });`,
      );
      return {
        code: [code, `import { traced as __traced } from "#/lib/trace.server";`, ...wraps].join("\n"),
        // The original code is untouched, so the incoming source map still holds.
        map: null,
      };
    },
  };
}
