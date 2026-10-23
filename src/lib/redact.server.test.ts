import { describe, expect, it } from "vitest";

import { REDACTED, redactFields, redactText } from "#/lib/redact.server";

/*===== Redaction =====*/
// Secrets must not reach stdout or the error viewer, and ordinary values (Persian text above all) must come through
// untouched, or the logs stop being useful.

describe("redactFields", () => {
  it("masks credential keys and keeps their look-alikes", () => {
    const fields = { resetToken: "a1b2", client_secret: "s", passwordConfirm: "p", maxTokens: 4000, author: "Sara" };

    expect(redactFields(fields)).toEqual({
      resetToken: REDACTED,
      client_secret: REDACTED,
      passwordConfirm: REDACTED,
      maxTokens: 4000,
      author: "Sara",
    });
  });
});

describe("redactText", () => {
  it("masks a Bearer token and a JWT in a message", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJl";

    expect(redactText("upstream refused Bearer abcdef123456")).toBe(`upstream refused Bearer ${REDACTED}`);
    expect(redactText(`invalid session ${jwt}`)).toBe(`invalid session ${REDACTED}`);
  });

  it("masks a Luhn-valid card number and keeps an order ID", () => {
    expect(redactText("card 4111 1111 1111 1111 declined")).toBe(`card ${REDACTED} declined`);
    expect(redactText("order 1234567890123 failed")).toBe("order 1234567890123 failed");
  });

  it("keeps Persian text unchanged", () => {
    const text = "یادداشت «خرید» برای کاربر ۱۲۳۴ پیدا نشد";

    expect(redactText(text)).toBe(text);
  });
});
