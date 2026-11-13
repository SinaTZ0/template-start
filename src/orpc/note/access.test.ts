import { createRouterClient } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "#/lib/auth.server";
import { router } from "#/orpc/router";

/*===== Note Access =====*/
// Who gets past the middleware, called the way a loader calls the API (`createRouterClient`). Only the session is
// faked: every call here is turned away before it reaches the database.

const session = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("#/lib/auth.server", () => ({
  getRequestSession: () => Promise.resolve(session.current),
}));

function signedInAs(user: { role: string; status: string }) {
  session.current = { user: { id: "test-user", ...user } } as unknown as AuthSession;
}

const client = createRouterClient(router, { context: { headers: new Headers() } });

beforeEach(() => {
  session.current = null;
});

describe("note access", () => {
  it("turns away a visitor who isn't signed in", async () => {
    await expect(client.note.list({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("turns away a blocked account that still holds a session", async () => {
    signedInAs({ role: "user", status: "blocked" });
    await expect(client.note.list({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("keeps the admin's numbers from other roles", async () => {
    signedInAs({ role: "user", status: "active" });
    await expect(client.note.stats()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
