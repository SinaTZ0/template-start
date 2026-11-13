import { describe, expect, it } from "vitest";

import { sameSitePath } from "#/lib/search-params";

/*===== Redirect Target =====*/
// `?redirectTo=` comes from a link anyone can craft; after sign-in it must never lead to another site.

describe("sameSitePath", () => {
  it("keeps paths on this site, with their query and hash", () => {
    expect(sameSitePath("/notes")).toBe("/notes");
    expect(sameSitePath("/en/notes?q=a%20b#top")).toBe("/en/notes?q=a%20b#top");
  });

  it("rejects everything a browser would read as another site", () => {
    const hostile = [
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "/.//evil.com",
      "/..//evil.com",
      "/a/..//evil.com",
      "/\t/evil.com",
      "/\n/evil.com",
      "/en//evil.com",
      "notes",
    ];
    expect(hostile.filter((value) => sameSitePath(value) !== undefined)).toEqual([]);
  });
});
