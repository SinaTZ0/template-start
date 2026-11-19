import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { redirectToParam, sameSitePath } from "#/lib/search-params";
import { searchSchema } from "#/lib/schema";

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

describe("redirectToParam", () => {
  const schema = searchSchema(Schema.Struct({ redirectTo: redirectToParam }));
  const read = (search: Record<string, unknown>) => schema["~standard"].validate(search);

  it("keeps a same-site path and drops one that leaves the site, without failing the page", () => {
    expect(read({ redirectTo: "/notes?before=1" })).toEqual({ value: { redirectTo: "/notes?before=1" } });
    expect(read({ redirectTo: "/.//evil.com" })).toEqual({ value: { redirectTo: undefined } });
    expect(read({ redirectTo: 42 })).toEqual({ value: {} });
    expect(read({})).toEqual({ value: {} });
  });
});
