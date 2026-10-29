import { baseLocale, getLocale, type Locale } from "#/paraglide/runtime";

/*===== Localized Text =====*/
// Content that editors write in each language (a category's name, a page's title). It isn't a Paraglide message:
// messages are compiled into the build, and this text is stored in the database so it can be edited without a deploy.
// The base locale is required; the others are filled in when someone translates them.

/** Stored as `jsonb`: `{ fa: "اخبار", en: "News" }`. */
export type LocalizedText = { [K in typeof baseLocale]: string } & Partial<Record<Locale, string>>;

/**
 * The text in the current locale, or the base locale's when it hasn't been translated. Called while serving a
 * request, so `getLocale()` is that request's locale.
 */
export function localize(text: LocalizedText): string {
  return text[getLocale()] || text[baseLocale];
}

/** `localize` for an optional field: `null` stays `null`. */
export function localizeOptional(text: LocalizedText | null): string | null {
  return text ? localize(text) : null;
}
