import { createRouterClient } from "@orpc/server";
import { ManagedRuntime } from "effect";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { router } from "#/orpc/router";
import { Auth } from "#/server/auth.server";
import type { AuthSession } from "#/server/better-auth.server";
import { makeAppLayer } from "#/server/runtime.server";

/*===== Access =====*/
// Who gets past the boundary, called the way a loader calls the API (`createRouterClient`). Only the session is
// faked, by an app layer built with `Auth.layerTest`; the one call let through reads a user who has no notes.
//
// Plain vitest and a runtime of its own, unlike the tests of services (`note/integration.test.ts`): the boundary is a
// promise API that takes the runtime it runs on (`context.runtime`).

let session: AuthSession | null = null;

function signedInAs(user: { role: string; status: string }) {
  session = {
    user: { id: "test-user", name: "Test user", email: "test-user@example.test", ...user },
  } as unknown as AuthSession;
}

const runtime = ManagedRuntime.make(makeAppLayer({ auth: Auth.layerTest(() => session) }));
const client = createRouterClient(router, { context: { headers: new Headers(), runtime } });

beforeEach(() => {
  session = null;
});

afterAll(() => runtime.dispose());

describe("public procedures", () => {
  it("serve a visitor", async () => {
    await expect(client.session.viewer()).resolves.toBeNull();
  });

  // Read through `SessionService`, which keeps the `Auth` its layer was built with: it sees the faked session only
  // when the app layer itself was built with the test `Auth`.
  it("show the signed-in person as the viewer", async () => {
    signedInAs({ role: "user", status: "active" });
    await expect(client.session.viewer()).resolves.toMatchObject({ id: "test-user", role: "user" });
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
