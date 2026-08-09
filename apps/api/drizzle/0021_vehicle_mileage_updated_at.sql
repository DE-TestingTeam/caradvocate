-- Records WHEN the odometer reading in `vehicles.mileage` was taken, so the app can tell a
-- reading typed this week from one typed two years ago.
--
-- It could not before, and three things read `mileage` as though it were current: the
-- maintenance due calculation (which is the one that matters -- a stale figure says a job is
-- fine when it is overdue), the price sent to MarketCheck, and My Car's masthead. Half of that
-- was closed by services/odometer.ts, which raises the mileage from logged service records. A
-- car that is not serviced is not read, though, so the other half is asking the owner directly
-- -- and "should we ask?" needs a date to answer. This is that date.
--
-- Nullable, because a NOT NULL column cannot be added to a populated table without a default,
-- and every candidate default is a lie: `now()` would claim every existing car was read today,
-- which is exactly the false freshness this column exists to expose. So it goes on nullable and
-- is backfilled below. Application code treats null as "unknown, therefore stale" regardless.
ALTER TABLE "vehicles" ADD COLUMN "mileage_updated_at" timestamp with time zone;--> statement-breakpoint

-- The honest backfill: rows written before this column existed got their mileage at onboarding
-- and, for most owners, never again -- so `created_at` is when that reading was taken.
--
-- It is a lower bound, not a certainty. Some of these owners edited their mileage in Account
-- afterwards, and that edit is invisible to us now. Erring old is deliberate: the cost of
-- treating a fresh reading as stale is one dismissible prompt, and the cost of treating a stale
-- reading as fresh is telling someone their brakes are fine when they are overdue.
UPDATE "vehicles" SET "mileage_updated_at" = "created_at" WHERE "mileage_updated_at" IS NULL;
