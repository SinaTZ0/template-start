/*===== User Constants =====*/
// Browser-safe values shared by auth, the seed and the route guards. Stored as plain text (see `app/db/schema.ts`), so
// adding a role is a code change, not a migration.

/** Everyone who signs up is a `user`; `admin` is only ever set on the server (the seed, or an admin screen). */
export const USER_ROLES = ["user", "admin"] as const;

export type UserRole = (typeof USER_ROLES)[number];

/** Blocked users can't use the API, and their sessions are revoked when a guarded page sees them. */
export const USER_STATUSES = ["active", "blocked"] as const;

export type UserStatus = (typeof USER_STATUSES)[number];
