/*===== Theme =====*/
// The theme lives on <html> (`.dark` class + `color-scheme`). With no saved choice it follows the
// system setting, live. Once the user picks one with the toggle, that choice wins from then on.
// Browser-only except `THEME_INIT_SCRIPT`, which __root.tsx inlines into the server-rendered <head>.

export type Theme = "light" | "dark";

const STORAGE_KEY = "app-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";
// Notifies other components in this tab; the `storage` event only fires in other tabs.
const CHANGE_EVENT = "app:theme-change";

/*===== First Paint =====*/
/**
 * Runs before the page paints, so neither theme flashes. The server can't know the system
 * preference, so this has to happen in the browser. Mirrors `resolveTheme` and `applyTheme`.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});var d=s==="dark"||(s!=="light"&&matchMedia(${JSON.stringify(DARK_QUERY)}).matches);var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light"}catch(e){}})()`;

/*===== Helpers =====*/
function readSavedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    // Storage can be blocked (privacy modes); fall back to the system theme.
    return null;
  }
}

function resolveTheme(): Theme {
  return readSavedTheme() ?? (matchMedia(DARK_QUERY).matches ? "dark" : "light");
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  // Native controls, scrollbars, and autofill follow `color-scheme`.
  root.style.colorScheme = theme;
}

/*===== Store =====*/
/** The theme currently applied to the document. */
export function getTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** Applies and saves the user's choice; from now on it overrides the system setting. */
export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Not saved, but still applied for this page view.
  }
  applyTheme(theme);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Subscribes to theme changes: the toggle, a system change (only while no choice is saved), and
 * a choice made in another tab. Shaped for `useSyncExternalStore`.
 */
export function subscribeToTheme(onChange: () => void): () => void {
  const media = matchMedia(DARK_QUERY);

  const handleSystemChange = () => {
    if (readSavedTheme()) return;
    applyTheme(resolveTheme());
    onChange();
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    applyTheme(resolveTheme());
    onChange();
  };

  media.addEventListener("change", handleSystemChange);
  window.addEventListener("storage", handleStorage);
  window.addEventListener(CHANGE_EVENT, onChange);

  return () => {
    media.removeEventListener("change", handleSystemChange);
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}
