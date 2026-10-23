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
