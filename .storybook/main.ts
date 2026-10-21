import type { StorybookConfig } from "@storybook/react-vite";
import type { PluginOption } from "vite";

/*===== Storybook Config =====*/
const config: StorybookConfig = {
  stories: ["../app/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-a11y"],
  framework: "@storybook/react-vite",
  /*------ Vite ------*/
  // Storybook reuses vite.config.ts, but the TanStack Start and Nitro plugins expect to own the app entry and server
  // build, so strip them and keep everything else (Tailwind, paths).
  viteFinal: (viteConfig) => ({
    ...viteConfig,
    plugins: (viteConfig.plugins ?? []).flat(Infinity as 1).filter((plugin: PluginOption) => {
      const name = plugin && typeof plugin === "object" && "name" in plugin ? plugin.name : "";
      return !/^(tanstack|nitro)/i.test(name);
    }),
  }),
};

export default config;
