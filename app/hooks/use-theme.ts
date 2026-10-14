import { useSyncExternalStore } from "react";

import { getTheme, setTheme, subscribeToTheme, type Theme } from "~/lib/theme";

/*===== Use Theme =====*/
/**
 * The applied theme and a setter that saves the user's choice.
 *
 * `theme` is `null` during server rendering and hydration: the server can't know it, so UI that
 * depends on it should use the `dark:` variant instead.
 */
export function useTheme(): { theme: Theme | null; setTheme: (theme: Theme) => void } {
  const theme = useSyncExternalStore(subscribeToTheme, getTheme, () => null);
  return { theme, setTheme };
}
