-- Repair pricing becomes per-model, and labor time becomes optional.
--
-- HAND-EDITED after generation. drizzle-kit emitted the four new repair_benchmarks
-- columns as bare `ADD COLUMN ... NOT NULL`, which fails outright on any database
-- that already holds benchmark rows -- which is every deployed one. They are added
-- with a backfill default and the default is then dropped, so the column stays
-- NOT NULL without a value ever being invented for a new row.
--
-- The backfill claims the existing rows as 2019 HONDA CIVIC because that is what they
-- effectively were: hand-written placeholders shaped around the demo Civic. `source`
-- records that they are placeholders, so a stale row is distinguishable from a
-- vendor-priced one until the next sync or reseed replaces it.

DROP INDEX IF EXISTS "repair_benchmarks_repair_unique";--> statement-breakpoint
ALTER TABLE "assessment_labor_tasks" ALTER COLUMN "hours" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "assessments" ALTER COLUMN "labor_rate_per_hour" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "assessments" ALTER COLUMN "labor_est_hours" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "benchmark_labor_tasks" ALTER COLUMN "hours" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "repair_benchmarks" ALTER COLUMN "labor_rate_per_hour" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "repair_benchmarks" ALTER COLUMN "labor_est_hours" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "benchmark_source" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "repair_benchmarks" ADD COLUMN "year" integer NOT NULL DEFAULT 2019;--> statement-breakpoint
ALTER TABLE "repair_benchmarks" ADD COLUMN "make" text NOT NULL DEFAULT 'HONDA';--> statement-breakpoint
ALTER TABLE "repair_benchmarks" ADD COLUMN "model" text NOT NULL DEFAULT 'CIVIC';--> statement-breakpoint
ALTER TABLE "repair_benchmarks" ADD COLUMN "source" text NOT NULL DEFAULT 'Hand-written placeholder (superseded)';--> statement-breakpoint
ALTER TABLE "repair_benchmarks" ALTER COLUMN "year" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "repair_benchmarks" ALTER COLUMN "make" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "repair_benchmarks" ALTER COLUMN "model" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "repair_benchmarks" ALTER COLUMN "source" DROP DEFAULT;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "repair_benchmarks_repair_model_unique" ON "repair_benchmarks" USING btree ("repair_id","year","make","model");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repair_benchmarks_model_idx" ON "repair_benchmarks" USING btree ("year","make","model");
