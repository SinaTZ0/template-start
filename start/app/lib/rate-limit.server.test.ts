import { describe, expect, it } from "vitest";

import { checkRateLimit, createMemoryStore } from "~/lib/rate-limit.server";

/*===== Rate Limit =====*/
// The limiter is a security boundary for sign-in and uploads: it must stop a client at the limit, tell it when to retry,
// and keep each client's count to itself.

const policy = { name: "test", limit: 2, windowMs: 60_000 };

describe("checkRateLimit", () => {
  it("rejects a client over the limit until its window ends", () => {
    const store = createMemoryStore();
    const hit = (now: number) => checkRateLimit({ policy, client: "1.2.3.4", store, now });

    expect(hit(0)).toEqual({ allowed: true });
    expect(hit(1_000)).toEqual({ allowed: true });
    expect(hit(30_000)).toEqual({ allowed: false, retryAfterSeconds: 30 });
    expect(hit(60_000)).toEqual({ allowed: true });
  });

  it("counts each client separately", () => {
    const store = createMemoryStore();
    for (let i = 0; i < 3; i++) checkRateLimit({ policy, client: "1.2.3.4", store, now: 0 });

    expect(checkRateLimit({ policy, client: "5.6.7.8", store, now: 0 })).toEqual({ allowed: true });
  });
});
