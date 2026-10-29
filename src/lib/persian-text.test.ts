import { describe, expect, it } from "vitest";

import { matchesSearch, normalizePersianText, searchWords } from "#/lib/persian-text";

/*===== Persian Text =====*/
// Text that looks the same must be stored the same, or searches and comparisons miss it. What carries meaning (a ZWNJ
// inside a word, Latin digits) must survive.

describe("normalizePersianText", () => {
  it("turns Arabic yeh and kaf into Persian", () => {
    expect(normalizePersianText("علي كتاب")).toBe("علی کتاب");
  });

  it("removes direction marks", () => {
    expect(normalizePersianText("‏سلام‎")).toBe("سلام");
  });

  it("keeps a ZWNJ inside a word and Latin digits", () => {
    expect(normalizePersianText("می‌خواهم 3 تا")).toBe("می‌خواهم 3 تا");
  });

  it("leaves clean text unchanged", () => {
    const text = "یادداشت‌های من برای ۱۴۰۳";

    expect(normalizePersianText(text)).toBe(text);
  });
});

describe("matchesSearch", () => {
  it("matches what the user sees, whatever was typed underneath", () => {
    const texts = ["انتخاب‌واحد ترم ۱۴۰۳"];

    expect(matchesSearch(searchWords("انتخاب واحد"), texts)).toBe(true);
    expect(matchesSearch(searchWords("انتخاب واحد 1403"), texts)).toBe(true);
    expect(matchesSearch(searchWords("انتخاب مهمان"), texts)).toBe(false);
  });
});
