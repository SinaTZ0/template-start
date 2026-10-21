import { z } from "zod";

/*===== Persian Text =====*/
// Persian text that looks identical can differ underneath: Arabic yeh and kaf from an Arabic keyboard layout,
// direction marks and tatweel pasted from Word or Telegram, Arabic-Indic digits, NBSP, a BOM. Stored as typed, such
// text never matches a search for what the user sees, and equal-looking values compare unequal. So free text is
// normalized once, when it enters the app. Not `.server`: contracts and form schemas use it too.

const ARABIC_YEH = /[يى]/g; // ي and ى
const ARABIC_KAF = /ك/g; // ك
const ARABIC_INDIC_DIGITS = /[٠-٩]/g; // ٠–٩
// LRM, RLM, ALM, the embeddings and overrides (U+202A–U+202E), the isolates (U+2066–U+2069), the BOM and tatweel.
const INVISIBLES = /[‎‏؜‪-‮⁦-⁩﻿ـ]/g;
const NBSP = / /g;
const REPEATED_ZWNJ = /‌{2,}/g;
// A ZWNJ joins nothing next to a space, or at either end of the text.
const LOOSE_ZWNJ = /‌(?=\s)|(?<=\s)‌|^[\s‌]+|[\s‌]+$/g;

/**
 * Normalizes Persian free text: Arabic yeh/kaf to Persian (ی ک), Arabic-Indic digits to Persian (۰–۹), direction
 * controls, BOM and tatweel removed, NBSP to a space, stray ZWNJs dropped (repeated, next to a space, at the ends),
 * then NFC and trimmed. Latin digits are kept: free text may mix them on purpose.
 *
 * Only for free text (titles, bodies, names, searches). Never for emails, passwords, IDs, tokens, URLs or captcha
 * payloads, which must stay byte-exact. A search must normalize its input with this too, so it matches stored text.
 */
export function normalizePersianText(value: string): string {
  return value
    .normalize("NFC")
    .replace(ARABIC_YEH, "ی")
    .replace(ARABIC_KAF, "ک")
    .replace(ARABIC_INDIC_DIGITS, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0x0660 + 0x06f0))
    .replace(INVISIBLES, "")
    .replace(NBSP, " ")
    .replace(REPEATED_ZWNJ, "‌")
    .replace(LOOSE_ZWNJ, "")
    .trim();
}

/**
 * A string schema for free text that is normalized first (`normalizePersianText`, which also trims). An overwrite
 * rather than a transform: it keeps the schema a string, and the checks chained after it (`.min()`, `.max()`) see the
 * normalized value.
 */
export function persianText() {
  return z.string().overwrite(normalizePersianText);
}
