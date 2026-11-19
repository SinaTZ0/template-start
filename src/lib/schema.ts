import { Effect, Schema, SchemaIssue, SchemaTransformation } from "effect";

import { normalizePersianText } from "#/lib/persian-text";
import { issuesToErrorData } from "#/lib/schema-issues";

/*===== Translated Text =====*/
// A check's user-facing message is a function, called when an issue is formatted, so it renders in the locale of the
// request (or page) that formats it: `Schema.isMaxLength(80, { text: () => m.note_error_title_too_long({ max: 80 }) })`.
// Never call a message when a schema is built: modules are evaluated once per server process (docs/frontend/i18n.md).
declare module "effect/Schema" {
  namespace Annotations {
    interface Augment {
      /** The issue's user-facing message, in the current locale. */
      readonly text?: (() => string) | undefined;
    }
  }
}

function textOf(annotations: Schema.Annotations.Annotations | undefined): string | undefined {
  const text = annotations?.text;
  return typeof text === "function" ? String(text()) : undefined;
}

/** A failed check's `text`, else Effect's default (English, for developers: a client sent the wrong shape). */
const checkHook: SchemaIssue.CheckHook = (issue) =>
  textOf(issue.filter.annotations) ?? SchemaIssue.defaultCheckHook(issue);

/** A schema's own `text` (e.g. on a literal), else Effect's default. */
const leafHook: SchemaIssue.LeafHook = (issue) =>
  textOf("annotations" in issue ? issue.annotations : issue.ast.annotations) ?? SchemaIssue.defaultLeafHook(issue);

const formatIssue = SchemaIssue.makeFormatterStandardSchemaV1({ leafHook, checkHook });

/**
 * A schema issue as the API's error data: per-field messages keyed by dotted path, the rest as general messages
 * (`#/orpc/errors`). Call it where the locale is the request's: never inside an Effect's fiber.
 */
export function issueToErrorData(issue: SchemaIssue.Issue): { errors: string[]; fields: Record<string, string> } {
  return issuesToErrorData(formatIssue(issue).issues);
}

/*===== Standard Schema =====*/
/**
 * `schema` as a Standard Schema with this app's messages, for oRPC contracts, form resolvers and `validateSearch`.
 * Reports every issue (so a form shows each field's), and rejects keys the schema doesn't name, the way
 * `z.strictObject` did.
 *
 * Contract schemas check structure only and don't transform: oRPC validates a procedure's output by running it through
 * its schema, so a transforming one would change what the client receives. Normalizing and limits belong to the
 * feature's `validation.ts`.
 */
export function standardSchema<S extends Schema.ConstraintDecoder<unknown>>(schema: S) {
  return Schema.toStandardSchemaV1(schema, {
    leafHook,
    checkHook,
    parseOptions: { errors: "all", onExcessProperty: "error" },
  });
}

/*===== Persian Text =====*/
/**
 * Free text normalized as it is decoded (`normalizePersianText`, which also trims). Checks chained after it
 * (`.check(Schema.isMaxLength(…))`) see the normalized value.
 */
export const PersianText = Schema.String.pipe(
  Schema.decodeTo(
    Schema.String,
    SchemaTransformation.transform({ decode: normalizePersianText, encode: (value: string) => value }),
  ),
);

/*===== Search Params =====*/
// A search param comes from a URL anyone can edit, so a bad value never fails the page: it reads as its fallback, the
// way a missing one does (docs/frontend/search-params.md).

/**
 * A route's search params for `validateSearch`, as a Standard Schema. Unlike `standardSchema`, keys it doesn't name are
 * dropped rather than refused: a URL may carry parameters other code added.
 */
export function searchSchema<S extends Schema.ConstraintDecoder<unknown>>(schema: S) {
  return Schema.toStandardSchemaV1(schema, {
    leafHook,
    checkHook,
    parseOptions: { errors: "all", onExcessProperty: "ignore" },
  });
}

/** A search param with a default: missing or invalid, it reads as `fallback`. */
export function searchParam<S extends Schema.Top & Schema.ConstraintDecoder<unknown>>(
  schema: S,
  fallback: S["Type"] & S["Encoded"],
) {
  return Schema.optionalKey(schema.pipe(Schema.catchDecoding(() => Effect.succeedSome(fallback)))).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(fallback)),
  );
}

/** An optional search param: invalid, it reads as missing. */
export function optionalSearchParam<S extends Schema.Top & Schema.ConstraintDecoder<unknown>>(schema: S) {
  return Schema.optionalKey(schema.pipe(Schema.catchDecoding(() => Effect.succeedNone)));
}
