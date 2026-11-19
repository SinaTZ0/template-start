import { eq } from "drizzle-orm";
import { Effect } from "effect";

import { user } from "#/db/schema";
import { Auth } from "#/server/auth.server";
import { Db } from "#/server/db.server";
import { AppLayer } from "#/server/runtime.server";

/*===== Seed =====*/
// Creates the first admin from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD. Idempotent: an existing account with that email
// is only promoted, never changed otherwise. Run with `pnpm db:seed` after `pnpm db:migrate`.

const email = process.env.SEED_ADMIN_EMAIL?.toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD;

if (!email || !password) {
  throw new Error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD to seed the admin.");
}

const seedAdmin = Effect.gen(function* () {
  /*------ Account ------*/
  // Through the internal adapter rather than `signUpEmail`, which would require a solved captcha.
  const { betterAuth } = yield* Auth;
  const existing = yield* Effect.promise(async () => {
    const context = await betterAuth.$context;
    const found = await context.internalAdapter.findUserByEmail(email);
    if (found) return found;
    const created = await context.internalAdapter.createUser(
      { email, name: "Admin", emailVerified: true },
      { method: "admin" },
    );
    await context.internalAdapter.linkAccount({
      userId: created.id,
      providerId: "credential",
      accountId: created.id,
      password: await context.password.hash(password),
    });
    return null;
  });

  /*------ Role ------*/
  const { q } = yield* Db;
  yield* q.update(user).set({ role: "admin" }).where(eq(user.email, email));
  console.info(existing ? `Promoted ${email} to admin.` : `Created admin ${email}.`);
});

// The pools are closed when the program ends.
await Effect.runPromise(seedAdmin.pipe(Effect.provide(AppLayer)));
