import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createReportThrottle } from "~/lib/report-throttle.server";

/*===== Report Throttle =====*/
// Repeats are throttled so they can't use up the error viewer's per-address budget, but none may vanish unnoticed:
// the next report sent says how many were left out.

describe("createReportThrottle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("skips repeats inside the window and counts them on the next report", () => {
    const take = createReportThrottle({ limit: 1 });

    expect(take("GET /notes")).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(take("GET /notes")).toBeUndefined();
    expect(take("GET /notes")).toBeUndefined();

    vi.advanceTimersByTime(50_000);
    expect(take("GET /notes")).toBe(2);
    expect(take("GET /notes")).toBeUndefined();
  });

  it("never throttles one key by another", () => {
    const take = createReportThrottle({ limit: 1 });
    take("GET /notes");

    expect(take("GET /notes/:id")).toBe(0);
  });
});
