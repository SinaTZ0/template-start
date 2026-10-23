import type { Decorator, Preview } from "@storybook/react-vite";

import { DirectionProvider } from "#/components/primitive/direction/direction";
import { TooltipProvider } from "#/components/primitive/tooltip/tooltip";

import "../src/styles.css";

/*===== Document =====*/
// Mirror __root.tsx so stories render RTL, in Persian, with the app font.
document.documentElement.lang = "fa";
document.documentElement.dir = "rtl";

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

// Base UI reads direction from context, not the `dir` attribute (see __root.tsx).
const withProviders: Decorator = (Story) => (
  <DirectionProvider direction="rtl">
    <TooltipProvider>
      <Story />
    </TooltipProvider>
  </DirectionProvider>
);

/*===== Preview =====*/
const preview: Preview = {
  decorators: [withTheme, withProviders],
  globalTypes: {
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
    theme: "light",
  },
  parameters: {
    layout: "padded",
    controls: { expanded: true },
  },
};

export default preview;
