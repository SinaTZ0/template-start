import type { Decorator, Preview } from "@storybook/react-vite";

import { DirectionProvider } from "#/components/primitive/direction/direction";
import { TooltipProvider } from "#/components/primitive/tooltip/tooltip";
import { baseLocale, getTextDirection, isLocale, type Locale, locales, overwriteGetLocale } from "#/paraglide/runtime";

import "../src/styles.css";

/*===== Decorators =====*/
type Theme = "light" | "dark" | "both";

/**
 * Applies the toolbar theme. "light" and "dark" toggle `.dark` on <html> so portals
 * (select popups, dialogs) follow too. "both" renders the story twice, side by side,
 * because toggling hides contrast issues that only show when comparing the themes.
 * Portals in "both" mode render in the light theme.
 */
const withTheme: Decorator = (Story, context) => {
  const theme = (context.globals.theme ?? "light") as Theme;
  document.documentElement.classList.toggle("dark", theme === "dark");

  if (theme !== "both") return <Story />;

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-2">
      <div className="bg-background p-6 text-foreground">
        <Story />
      </div>
      <div className="dark bg-background p-6 text-foreground">
        <Story />
      </div>
    </div>
  );
};

/**
 * Applies the toolbar locale the way `__root.tsx` does: `lang` and `dir` on <html>, and Base UI's direction context,
 * which it reads instead of the `dir` attribute. Messages read the locale through `getLocale()`, which a story has no
 * URL for, so it is overwritten with the toolbar's choice.
 */
const withLocale: Decorator = (Story, context) => {
  const chosen = String(context.globals.locale ?? baseLocale);
  const locale: Locale = isLocale(chosen) ? chosen : baseLocale;
  const direction = getTextDirection(locale);
  overwriteGetLocale(() => locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = direction;

  return (
    <DirectionProvider direction={direction}>
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    </DirectionProvider>
  );
};

/*===== Preview =====*/
const preview: Preview = {
  decorators: [withTheme, withLocale],
  globalTypes: {
    locale: {
      description: "Language and direction",
      toolbar: {
        title: "Locale",
        icon: "globe",
        items: locales.map((locale) => ({ value: locale, title: `${locale} (${getTextDirection(locale)})` })),
        dynamicTitle: true,
      },
    },
    theme: {
      description: "Color theme",
      toolbar: {
        title: "Theme",
        icon: "mirror",
        items: [
          { value: "light", title: "Light", icon: "sun" },
          { value: "dark", title: "Dark", icon: "moon" },
          { value: "both", title: "Side by side", icon: "sidebaralt" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    locale: baseLocale,
    theme: "light",
  },
  parameters: {
    layout: "padded",
    controls: { expanded: true },
  },
};

export default preview;
