import { MoonIcon, SunIcon } from "lucide-react";

import { Button } from "#/components/primitive/button/button";
import { useTheme } from "#/hooks/use-theme";

/*===== Theme Toggle =====*/
/**
 * Switches between light and dark and saves the choice. A toggle button ("dark mode", pressed when
 * dark). The icon is chosen with CSS (`dark:`), so it's right on the server-rendered page too.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="حالت تیره"
      aria-pressed={theme === null ? undefined : isDark}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={className}
    >
      <MoonIcon className="dark:hidden" />
      <SunIcon className="hidden dark:block" />
    </Button>
  );
}
