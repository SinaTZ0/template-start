import { and, asc, eq, inArray } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";

import { note, user } from "#/db/schema";
import { AppConfig } from "#/server/config.server";
import { Db, PgLive } from "#/server/db.server";

/*===== Seed Notes =====*/
// Loads a set of sample notes, so a new server (or a fresh local database) has something on /notes. It's the note
// feature's seed, the worked example of a seed the deploy tool runs (`deploy/deploy.sh seed notes`, docs/deployment.md
// → First Deploy, Seed): replace it with the project's own once the note feature is deleted.
//
//   pnpm db:seed:notes                      the first admin's notes (`pnpm db:seed`, or `deploy/deploy.sh admin`)
//   pnpm db:seed:notes --owner a@b.c        someone else's
//   pnpm db:seed:notes --replace            load them again
//
// Notes are private to their owner, so they go to an account that can sign in and see them. An owner who already has
// the sample notes is skipped, which makes a second run safe. `--replace` deletes only the sample notes (found by their
// titles) before loading them again; the owner's own notes stay.

/*------ Sample Notes ------*/
// Fixed text rather than random, so a second load gives the same notes. Persian first, a few in English.
const SAMPLE_NOTES: { title: string; body: string }[] = [
  { title: "به یادداشت‌ها خوش آمدید", body: "این یادداشت‌ها نمونه‌اند و با `seed notes` ساخته شده‌اند." },
  { title: "خرید هفته", body: "نان، پنیر، سبزی خوردن، چای" },
  { title: "ایده‌های پروژه", body: "یک صفحهٔ تازه برای گزارش‌ها\nجست‌وجو در یادداشت‌ها\nخروجی PDF" },
  { title: "جلسهٔ دوشنبه", body: "ساعت ۱۰ صبح، اتاق جلسات. بررسی برنامهٔ ماه آینده." },
  { title: "کتاب‌هایی که باید خواند", body: "بوف کور، کلیدر، سمفونی مردگان" },
  { title: "شمارهٔ پشتیبانی", body: "داخلی ۲۴۱۰، از ۸ تا ۱۶" },
  { title: "Release checklist", body: "Run the migrations, check /healthz, read the error viewer." },
  { title: "Reading list", body: "The Pragmatic Programmer\nDesigning Data-Intensive Applications" },
  { title: "Trip to Isfahan", body: "Naqsh-e Jahan Square, Si-o-se-pol, Chehel Sotoun." },
  { title: "یادداشت بدون متن", body: "" },
];

const SAMPLE_TITLES = SAMPLE_NOTES.map((sample) => sample.title);

/*------ Owner ------*/
class NoOwner extends Schema.TaggedError<NoOwner>()("NoOwner", { message: Schema.String }) {}

/** The account given by `--owner`, or the first admin. */
const findOwner = Effect.fn("SeedNotes.findOwner")(function* (email: string | undefined) {
  const { q } = yield* Db;
  const [owner] = email
    ? yield* q.select({ id: user.id, email: user.email }).from(user).where(eq(user.email, email.toLowerCase()))
    : yield* q
        .select({ id: user.id, email: user.email })
        .from(user)
        .where(eq(user.role, "admin"))
        .orderBy(asc(user.createdAt))
        .limit(1);
  if (owner) return owner;
  return yield* new NoOwner({
    message: email
      ? `No account has the email ${email}. Sign up with it first.`
      : "There's no admin to give the notes to. Make one first (`pnpm db:seed`, or `deploy/deploy.sh admin <email>` " +
        "on a server), or pass --owner <email>.",
  });
});

/*===== Run =====*/
const args = process.argv.slice(2);
const replace = args.includes("--replace");
const ownerIndex = args.indexOf("--owner");

const seedNotes = Effect.gen(function* () {
  const { q, transaction } = yield* Db;
  const owner = yield* findOwner(ownerIndex === -1 ? undefined : args[ownerIndex + 1]);

  const samples = and(eq(note.ownerId, owner.id), inArray(note.title, SAMPLE_TITLES));
  const [existing] = yield* q.select({ id: note.id }).from(note).where(samples).limit(1);

  if (existing && !replace) {
    console.info(`Skipped ${owner.email}: the sample notes are there. Pass --replace to load them again.`);
    return;
  }
  // One transaction, so a stopped run leaves the notes as they were rather than half of them.
  yield* transaction(
    Effect.gen(function* () {
      if (existing) yield* q.delete(note).where(samples);
      // A minute apart, the first the newest: the list shows the newest first, so it reads in this order.
      const now = Date.now();
      yield* q.insert(note).values(
        SAMPLE_NOTES.map((sample, index) => ({
          ownerId: owner.id,
          title: sample.title,
          body: sample.body,
          createdAt: new Date(now - index * 60_000),
        })),
      );
    }),
  );
  console.info(`Seeded ${SAMPLE_NOTES.length} sample notes for ${owner.email}.`);
});

// The pool is closed when the program ends, whether it succeeded or not.
await Effect.runPromise(
  seedNotes.pipe(
    Effect.provide(Db.layer.pipe(Layer.provideMerge(PgLive), Layer.provide(AppConfig.layer))),
    Effect.catchTag("NoOwner", (error) =>
      Effect.sync(() => {
        console.error(error.message);
        process.exitCode = 1;
      }),
    ),
  ),
);
