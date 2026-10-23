/*===== Types =====*/
// Structural subset of Standard Schema issues, so both Zod errors and oRPC `ValidationError`s fit.
type PathSegment = PropertyKey | { readonly key: PropertyKey };

type SchemaIssueLike = {
  readonly message: string;
  readonly path?: ReadonlyArray<PathSegment> | undefined;
};

/*===== Conversion =====*/
/**
 * Groups schema issues into general messages and per-field messages keyed by dotted path
 * (`address.city`). Only the first message for each field is kept, which matches how forms show
 * one error per field.
 */
export function issuesToErrorData(issues: ReadonlyArray<SchemaIssueLike>): {
  errors: string[];
  fields: Record<string, string>;
} {
  const errors: string[] = [];
  const fields: Record<string, string> = {};

  for (const issue of issues) {
    const path = (issue.path ?? [])
      .map((segment) => String(typeof segment === "object" ? segment.key : segment))
      .join(".");

    if (!path) errors.push(issue.message);
    else fields[path] ??= issue.message;
  }

  return { errors, fields };
}
