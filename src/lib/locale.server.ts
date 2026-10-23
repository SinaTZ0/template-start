import { LOCALE_HEADER } from "#/lib/locale";
import { defineCustomServerStrategy, isLocale } from "#/paraglide/runtime";

/*===== Locale Header Strategy =====*/
/**
 * Registers `custom-locale-header`, the strategy `paraglide.config.ts` uses for `/rpc/*`: the locale the browser's API
 * client names in `x-locale`. A missing or unknown value passes to the next strategy (the base locale). Called once, by
 * the server entry, before any request is handled.
 */
export function defineLocaleHeaderStrategy() {
  defineCustomServerStrategy("custom-locale-header", {
    getLocale: (request) => {
      const value = request?.headers.get(LOCALE_HEADER);
      return value && isLocale(value) ? value : undefined;
    },
  });
}
