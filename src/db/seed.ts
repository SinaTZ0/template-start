import { eq } from "drizzle-orm";

import { db } from "#/db/client.server";
import { user } from "#/db/schema";
import { auth } from "#/lib/auth.server";

/*===== Seed =====*/
// Creates the first admin from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD. Idempotent: an existing account with that email
// is only promoted, never changed otherwise. Run with `pnpm db:seed` after `pnpm db:migrate`.

const email = process.env.SEED_ADMIN_EMAIL?.toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD;

if (!email || !password) {
  throw new Error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD to seed the admin.");
}

/*------ Account ------*/
// Through the internal adapter rather than `auth.api.signUpEmail`, which would require a solved captcha.
const context = await auth.$context;
const existing = await context.internalAdapter.findUserByEmail(email);

if (!existing) {
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
}

/*------ Role ------*/
await db.update(user).set({ role: "admin" }).where(eq(user.email, email));

console.info(existing ? `Promoted ${email} to admin.` : `Created admin ${email}.`);
await db.$client.end();
