import { describe, expect, it } from "vitest";

import { parseOtlpHeaders } from "#/server/config.server";

/*===== OTLP Headers =====*/
// The export's credentials travel in this variable: a value read wrong is an export the backend refuses, silently.

describe("parseOtlpHeaders", () => {
  it("reads a credential written as it is and one that is percent-encoded", () => {
    // Base64 padding is `=`, the same character that separates a name from its value.
    expect(parseOtlpHeaders("Authorization=Basic dXNlcjpwYXNzd29yZA==")).toEqual({
      Authorization: "Basic dXNlcjpwYXNzd29yZA==",
    });
    expect(parseOtlpHeaders("Authorization=Basic%20dXNlcjpwYXNzd29yZA%3D%3D, stream-name = app ")).toEqual({
      Authorization: "Basic dXNlcjpwYXNzd29yZA==",
      "stream-name": "app",
    });
    expect(parseOtlpHeaders("")).toEqual({});
  });
});
