import { createRouterClient } from "@orpc/server";
import { Layer, ManagedRuntime } from "effect";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { router } from "#/orpc/router";
import { Auth } from "#/server/auth.server";
import type { AuthSession } from "#/server/better-auth.server";
import { AppLayer } from "#/server/runtime.server";

/*===== Access =====*/
// Who gets past the boundary, called the way a loader calls the API (`createRouterClient`). Only the session is
// faked, by a runtime whose `Auth` returns it; the one call let through reads a user who has no notes.

let session: AuthSession | null = null;

function signedInAs(user: { role: string; status: string }) {
  session = { user: { id: "test-user", ...user } } as unknown as AuthSession;
}

const runtime = ManagedRuntime.make(
  Layer.merge(
    AppLayer,
    Auth.layerTest(() => session),
  ),
);
const client = createRouterClient(router, { context: { headers: new Headers(), runtime } });

beforeEach(() => {
  session = null;
});

afterAll(() => runtime.dispose());

describe("public procedures", () => {
  it("serve a visitor", async () => {
    await expect(client.session.viewer()).resolves.toBeNull();
  });
});

describe("note access", () => {
  it("turns away a visitor who isn't signed in", async () => {
    await expect(client.note.list({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("turns away a blocked account that still holds a session", async () => {
    signedInAs({ role: "user", status: "blocked" });
    await expect(client.note.list({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("accepts optional fields set to undefined, the way loaders pass them", async () => {
    signedInAs({ role: "user", status: "active" });
    await expect(client.note.list({ cursor: undefined })).resolves.toMatchObject({ notes: [] });
  });

  it("keeps the admin's numbers from other roles", async () => {
    signedInAs({ role: "user", status: "active" });
    await expect(client.note.stats()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
