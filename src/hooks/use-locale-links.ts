import { useLocation } from "@tanstack/react-router";

import { LOCALE_NAMES } from "#/lib/locale";
import { getLocale, localizeHref, type Locale, locales } from "#/paraglide/runtime";

/*===== Locale Links =====*/
export type LocaleLink = { locale: Locale; name: string; href: string };

/**
 * The current page, search params included, in every locale but the current one: what the language switcher links to.
 * Empty when the app has one locale.
 */
export function useLocaleLinks(): LocaleLink[] {
  // The router's own location, without the locale prefix (`rewrite` in `src/router.tsx`).
  const href = useLocation({ select: (location) => location.href });
  const current = getLocale();

  return locales
    .filter((locale) => locale !== current)
    .map((locale) => ({ locale, name: LOCALE_NAMES[locale], href: localizeHref(href, { locale }) }));
}
