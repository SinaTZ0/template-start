/*===== Email Theme =====*/
// Email clients don't read CSS variables or `oklch()`, and many strip `<style>`, so an email's colours are hex values
// written into each element's `style`. These are the light theme's tokens (`src/styles.css` → `:root`) converted to
// sRGB: keep them in step when the theme changes. Emails have no dark variant of their own: clients that darken mail
// do it themselves. Inline styles and hex are the rule here, not the app's classes and tokens, so the lint rules against
// them are off for `src/mail/templates/` (`.oxlintrc.json`).
export const mailTheme = {
  background: "#ffffff",
  page: "#f5f3f5",
  foreground: "#0c090c",
  mutedForeground: "#79697b",
  border: "#e7e4e7",
  primary: "#007595",
  primaryForeground: "#ecfeff",
  radius: "10px",
} as const;

/**
 * Fonts in the order clients should try them. Gmail and most webmail ignore web fonts, so Vazirmatn shows only where
 * it's installed or the client loads it (Apple Mail); Tahoma and the system fonts that follow all carry Persian.
 */
export const mailFontFamily = "Vazirmatn, Tahoma, 'Segoe UI', Arial, sans-serif";
