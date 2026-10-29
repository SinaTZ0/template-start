import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "#/db/client.server";
import { note, user } from "#/db/schema";

/*===== Seed Notes =====*/
// Loads a set of sample notes, so a new server (or a fresh local database) has something on /notes. It's the note
// feature's seed, the worked example of a seed the deploy tool runs (`deploy/deploy.sh seed notes`, docs/deployment.md
// → Seed): replace it with the project's own once the note feature is deleted.
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
/** The account given by `--owner`, or the first admin. Exits with a hint when there's neither. */
async function findOwner(email: string | undefined): Promise<{ id: string; email: string }> {
  const [owner] = email
    ? await db.select({ id: user.id, email: user.email }).from(user).where(eq(user.email, email.toLowerCase()))
    : await db
        .select({ id: user.id, email: user.email })
        .from(user)
        .where(eq(user.role, "admin"))
        .orderBy(asc(user.createdAt))
        .limit(1);
  if (owner) return owner;

  console.error(
    email
      ? `No account has the email ${email}. Sign up with it first.`
      : "There's no admin to give the notes to. Make one first (`pnpm db:seed`, or `deploy/deploy.sh admin <email>` " +
          "on a server), or pass --owner <email>.",
  );
  await db.$client.end();
  process.exit(1);
}

/*===== Run =====*/
const args = process.argv.slice(2);
const replace = args.includes("--replace");
const ownerIndex = args.indexOf("--owner");
const owner = await findOwner(ownerIndex === -1 ? undefined : args[ownerIndex + 1]);

const samples = and(eq(note.ownerId, owner.id), inArray(note.title, SAMPLE_TITLES));
const [existing] = await db.select({ id: note.id }).from(note).where(samples).limit(1);

if (existing && !replace) {
  console.info(`Skipped ${owner.email}: the sample notes are there. Pass --replace to load them again.`);
} else {
  // One transaction, so a stopped run leaves the notes as they were rather than half of them.
  await db.transaction(async (tx) => {
    if (existing) await tx.delete(note).where(samples);
    // A minute apart, the first the newest: the list shows the newest first, so it reads in this order.
    const now = Date.now();
    await tx.insert(note).values(
      SAMPLE_NOTES.map((sample, index) => ({
        ownerId: owner.id,
        title: sample.title,
        body: sample.body,
        createdAt: new Date(now - index * 60_000),
      })),
    );
  });
  console.info(`Seeded ${SAMPLE_NOTES.length} sample notes for ${owner.email}.`);
}

await db.$client.end();
