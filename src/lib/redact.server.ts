// Adapted from @nestjs/observe (src/utils/sensitive-keys.ts, log-redactor.ts, redact-url-query.ts),
// https://github.com/nestjs/observe, MIT License.

/*===== Redaction =====*/
// Strips secrets out of log lines and error reports before they leave the process: once written to stdout or sent to
// the error viewer they are stored for weeks, so scrubbing later would be too late. The rules are high-precision
// rather than exhaustive: a redactor that mangles ordinary values (or Persian text) gets switched off, and then it
// protects nothing. It is a safety net for secrets that leak by accident, not a guarantee: a credential logged in a
// shape nothing here matches still goes out.

export const REDACTED = "[REDACTED]";

/*===== Sensitive Keys =====*/
/** Masked only as the whole key: too short or generic to match inside a longer name (`auth` would take `author`). */
const EXACT_KEYS = new Set(["pwd", "auth"]);

/**
 * What a credential's name ends in. Real code calls it `resetToken`, `client_secret` or `x-api-key`, not `token`. A
 * suffix rather than a substring keeps it precise: the keys that merely mention one (`maxTokens`, `tokenCount`,
 * `secretary`) don't end in the noun.
 */
const SENSITIVE_SUFFIXES = [
  "password",
  "passwd",
  "secret",
  "token",
  "credential",
  "credentials",
  "signature",
  "jwt",
  "cookie",
  "apikey",
  "privatekey",
  "accesskey",
  "secretkey",
  "sessionid",
  "authorization",
];

/**
 * Words that mark a key wherever they sit in it, for names that put the noun first: `passwordConfirm`,
 * `secret_value`. `token` is deliberately absent: `tokenCount` and `tokenLimit` are ordinary numbers.
 */
const SENSITIVE_WORDS = new Set(["password", "passwd", "secret", "credential", "credentials"]);

/** Case-insensitive, ignoring `-` and `_`: `api_key`, `apiKey` and `API-KEY` are one key. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, "");
}

function wordsOf(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/);
}

/** Whether a field or parameter name names a credential, so its value is masked whatever it holds. */
export function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  // `password2`, `token_1`: a numbered credential is still one.
  const stem = normalized.replace(/\d+$/, "");
  return (
    EXACT_KEYS.has(normalized) ||
    SENSITIVE_SUFFIXES.some((suffix) => stem.endsWith(suffix)) ||
    wordsOf(key).some((word) => SENSITIVE_WORDS.has(word))
  );
}

/*===== Free Text =====*/
/**
 * Key names recognised inside free text, as `key=value` or `"key": "value"`. Unanchored on the left, so a compound
 * name (`resetToken=`, `client_secret=`) matches on its ending, as `isSensitiveKey` does.
 */
const TEXT_KEYS = [
  "password",
  "passwd",
  "pwd",
  "secret",
  "token",
  "access[_-]?token",
  "refresh[_-]?token",
  "id[_-]?token",
  "api[_-]?key",
  "authorization",
  "auth",
  "credentials?",
  "private[_-]?key",
  "access[_-]?key",
  "secret[_-]?key",
  "session[_-]?id",
  "set-cookie",
  "cookie",
].join("|");

const TEXT_VALUE = String.raw`(?:"[^"]*"|'[^']*'|(?:Bearer|Basic|Token)\s+\S+|[^\s,;&}"']+)`;

/** A rule's replacement keeps the part that says what was removed (the key, the scheme) and masks only the value. */
const TEXT_RULES: { pattern: RegExp; replace: (...groups: string[]) => string }[] = [
  // PEM blocks first: they span lines and would otherwise be partly eaten by the narrower rules below.
  {
    pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g,
    replace: () => REDACTED,
  },
  // Authorization schemes: `Bearer eyJ…`, `Basic dXNlcjpwYXNz`. Before the key=value rule, whose value stops at
  // whitespace: on `Authorization: Basic dXNlcjpwYXNz` it would mask only the word "Basic" and leave the credential.
  {
    pattern: /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    replace: (scheme) => `${scheme} ${REDACTED}`,
  },
  // key=value and "key": "value", keeping the key: `password=[REDACTED]` still says what was there. The value matches
  // a scheme-prefixed credential before the bare form, so an already-masked `Authorization: Bearer [REDACTED]`
  // collapses to one `[REDACTED]` instead of stacking two.
  {
    pattern: new RegExp(`((?:${TEXT_KEYS})["']?\\s*[:=]\\s*)${TEXT_VALUE}`, "gi"),
    replace: (prefix) => `${prefix}${REDACTED}`,
  },
  // Bare JWTs. "Not after a token character" rather than `\b`: a hyphen is a word boundary but also a token
  // character, so under `\b` every `eyJ` in a run like `eyJ-eyJ-eyJ-…` would start a match that rescans the rest of
  // the run. That is quadratic, on text a caller can fill.
  {
    pattern: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g,
    replace: () => REDACTED,
  },
  // AWS access key IDs, distinctive enough to match on sight. The secret key has no shape and is left to key=value.
  {
    pattern: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ABIA|ACCA)[0-9A-Z]{16}\b/g,
    replace: () => REDACTED,
  },
];

/*------ Card Numbers ------*/
// A bare 13–19 digit run matches plenty of innocent things (order IDs, timestamps run together), so candidates are
// Luhn-checked before anything is masked. `\d` is ASCII only, so a card number typed in Persian digits isn't caught:
// accepted, since such a number reaches a log only through free text.
const CARD_CANDIDATE = /\b\d(?:[ -]?\d){12,18}\b/g;

function isLuhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = digits.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Masks credentials in free text (an error message, a stack, a log field's value). Ordinary text comes back as is. */
export function redactText(text: string): string {
  let output = text;
  for (const { pattern, replace } of TEXT_RULES) {
    // `replace` passes the match, its groups, then the offset and the whole string.
    output = output.replace(pattern, (...args: unknown[]) =>
      replace(...args.slice(1, -2).map((group) => (typeof group === "string" ? group : ""))),
    );
  }
  return output.replace(CARD_CANDIDATE, (match) => {
    const digits = match.replace(/[ -]/g, "");
    return digits.length >= 13 && isLuhnValid(digits) ? REDACTED : match;
  });
}

/*===== Fields =====*/
// Log fields can nest arbitrarily deep, and this runs on every log line.
const MAX_DEPTH = 8;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Redacts a log line's fields: a sensitive key's value becomes `[REDACTED]` whatever its shape (an object under
 * `credentials` is exactly what must not be walked into and partly kept), and every string is passed through
 * `redactText`. Only plain objects and arrays are walked; anything else (an `Error`, a `Date`) is returned as is.
 * The input is never changed.
 */
export function redactFields<T>(value: T, depth = 0): T {
  if (depth > MAX_DEPTH) return REDACTED as T;
  if (typeof value === "string") return redactText(value) as T;
  if (Array.isArray(value)) return value.map((item: unknown) => redactFields(item, depth + 1)) as T;
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, isSensitiveKey(key) ? REDACTED : redactFields(item, depth + 1)]),
  ) as T;
}

/*===== URLs =====*/
/**
 * Query keys masked on top of `isSensitiveKey`: sensitive in a URL and ordinary elsewhere. `?code=` is an OAuth code
 * and `?key=` an API key, but a log field called `code` is an error code.
 */
const URL_ONLY_KEYS = new Set(["code", "state", "sig", "key"]);

/**
 * Masks the values of sensitive query parameters in a URL, keeping the keys: knowing a request carried a `token` is
 * useful, knowing which token is not. Only keys are inspected; a URL with nothing to hide comes back exactly as it was.
 */
export function redactUrl(url: string): string {
  const separator = url.indexOf("?");
  if (separator === -1) return url;

  const path = url.slice(0, separator);
  const rest = url.slice(separator + 1);
  const hashAt = rest.indexOf("#");
  const query = hashAt === -1 ? rest : rest.slice(0, hashAt);
  const fragment = hashAt === -1 ? "" : rest.slice(hashAt);

  // Parsed rather than pattern-replaced: the parser knows that a value may contain an escaped `&`. The keys are
  // copied first, since `set` changes the object being iterated.
  const params = new URLSearchParams(query);
  let redacted = false;
  // oxlint-disable-next-line unicorn/no-useless-spread
  for (const key of [...params.keys()]) {
    if (URL_ONLY_KEYS.has(normalizeKey(key)) || isSensitiveKey(key)) {
      params.set(key, REDACTED);
      redacted = true;
    }
  }
  return redacted ? `${path}?${params.toString()}${fragment}` : url;
}
