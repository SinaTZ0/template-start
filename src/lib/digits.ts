/*===== Digit Normalization =====*/
// Persian keyboards type Persian (۰–۹) or Arabic-Indic (٠–٩) digits. Number inputs must accept
// both, so normalize to ASCII before parsing.
const PERSIAN_ZERO = 0x06f0;
const ARABIC_ZERO = 0x0660;

/** Replaces Persian and Arabic-Indic digits with ASCII digits; other characters are untouched. */
export function toLatinDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (digit) => {
    const code = digit.charCodeAt(0);
    const zero = code >= PERSIAN_ZERO ? PERSIAN_ZERO : ARABIC_ZERO;
    return String(code - zero);
  });
}

// Showing numbers is the locale's job: `formatNumber` in `src/lib/locale.ts`, or a message's `number` declaration.
