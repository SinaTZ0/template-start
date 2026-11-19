-- No change to the database: the column is already timestamp(3). drizzle-kit 1.0 spells the type without the space the
-- 0.x snapshot used ("timestamp (3)"), so it saw a difference; this migration brings the snapshot in line.
ALTER TABLE "note" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) with time zone USING "created_at"::timestamp(3) with time zone;
