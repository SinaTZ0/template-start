import { getLocale, type Locale } from "#/paraglide/runtime";

/*===== Locales =====*/
// Browser-safe facts about each locale. Adding a language adds a line to each map (docs/frontend/i18n.md).

/** Each language's name for itself, as the switcher shows it. Never translated: a reader looks for their own. */
export const LOCALE_NAMES: Record<Locale, string> = {
  fa: "فارسی",
  en: "English",
};

/** Open Graph's language and region code for each locale's pages. */
export const OG_LOCALE: Record<Locale, string> = {
  fa: "fa_IR",
  en: "en_US",
};

/**
 * The header the browser's API client sends its page's locale in (`src/orpc/client.ts`). `/rpc` paths carry no locale,
 * so the server reads this instead (`src/lib/locale.server.ts`).
 */
export const LOCALE_HEADER = "x-locale";

/*===== Dates =====*/

/** A calendar date stored as ISO (`2026-10-30`) as a `Date` at UTC noon, so it's the same day in every time zone. */
export function isoToDate(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}

/*===== Formatting =====*/
// Formatters are built once per locale and option set: `Intl` constructors are slow, and these run in every render.
const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

/** Formats a number for the current locale: Persian digits and separators in Persian (`۱٬۲۰۰`), `1,200` in English. */
export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
  const locale = getLocale();
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, options);
    numberFormats.set(key, format);
  }
  return format.format(value);
}

/** Formats a date for the current locale: the Jalali calendar with Persian digits in Persian, Gregorian in English. */
export function formatDate(
  value: Date | number,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  const locale = getLocale();
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, options);
    dateFormats.set(key, format);
  }
  return format.format(value);
}

/**
 * Formats a span of dates for the current locale («۲۴ آذر تا ۲۸ آذر» in Persian, "December 15 – 19" in English),
 * leaving out what the two ends share. Day and month by default.
 *
 * The spaces around the dash are always plain spaces: newer locale data (CLDR 48, in Node 24) sets thin spaces there,
 * older data (today's browsers) plain ones, so the server's text didn't match the browser's and React re-rendered it on
 * hydration.
 */
export function formatDateRange({
  start,
  end,
  options = { day: "numeric", month: "long" },
}: {
  start: Date;
  end: Date;
  options?: Intl.DateTimeFormatOptions;
}): string {
  const locale = getLocale();
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, options);
    dateFormats.set(key, format);
  }
  return format.formatRange(start, end).replaceAll("\u2009", " ");
}

/**
 * A date's day, month name and year in the current locale's calendar and digits, for a date tile. `month: "short"`
 * fits a narrow tile ("Sep"); Persian month names have no short form, so they stay whole.
 */
export function formatDateParts(
  value: Date,
  { month = "long" }: { month?: "long" | "short" } = {},
): { day: string; month: string; year: string } {
  const locale = getLocale();
  const key = `${locale}|parts|${month}`;
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { day: "numeric", month, year: "numeric" });
    dateFormats.set(key, format);
  }
  const parts = Object.fromEntries(format.formatToParts(value).map((part) => [part.type, part.value]));
  return { day: parts.day ?? "", month: parts.month ?? "", year: parts.year ?? "" };
}

const relativeFormats = new Map<string, Intl.RelativeTimeFormat>();

/** A whole-day distance in words: «امروز», «فردا», «۳ روز دیگر», «۲ روز پیش» in Persian; "today", "in 3 days" in English. */
export function formatRelativeDays(days: number): string {
  const locale = getLocale();
  let format = relativeFormats.get(locale);
  if (!format) {
    format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    relativeFormats.set(locale, format);
  }
  return format.format(days, "day");
}
