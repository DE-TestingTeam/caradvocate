-- A local mirror of NHTSA's entire recall catalog, loaded from their bulk flat files by
-- scripts/importNhtsaRecalls.mts and read by services/recallMirror.ts when api.nhtsa.gov
-- cannot be reached. Additive only: `model_recalls` is untouched and stays the per-model
-- working set the app reads.
--
-- Two tables rather than one because a campaign covers many models and its prose runs to
-- paragraphs. Denormalised the catalog is 268MB, the same text repeated for every model it
-- names; split this way 169,240 model rows share 26,482 campaigns and it is 28MB.
--
-- No `id` column on either: NHTSA's campaign number is already the identifier, and
-- year/make/model/campaign is already unique. Both tables are wholly derived from the files,
-- nothing references them, and the importer replaces them outright on each run.
CREATE TABLE IF NOT EXISTS "nhtsa_recall_campaigns" (
	"campaign_number" text PRIMARY KEY NOT NULL,
	"summary" text NOT NULL,
	"consequence" text NOT NULL,
	"remedy" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nhtsa_recall_models" (
	"year" integer NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"campaign_number" text NOT NULL,
	"component" text NOT NULL,
	"park_it" boolean DEFAULT false NOT NULL,
	"park_outside" boolean DEFAULT false NOT NULL,
	"reported_on" date
);
--> statement-breakpoint
-- The lookup the fallback makes: one model, in one index scan.
CREATE INDEX IF NOT EXISTS "nhtsa_recall_models_model_idx" ON "nhtsa_recall_models" USING btree ("year","make","model");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "nhtsa_recall_models_campaign_unique" ON "nhtsa_recall_models" USING btree ("year","make","model","campaign_number");--> statement-breakpoint
-- Deny-by-default for PostgREST, the same as every other table and for the same reason as
-- 0018. sql/rls-lockdown.sql closes the stock `anon`/`authenticated` grants and revokes the
-- default privileges that would hand them back on a newly created table, but Postgres has no
-- default for RLS itself, so it has to be switched on per table here. Nothing in these two is
-- private -- it is published federal data -- but a table with RLS off is an open door
-- regardless of what is behind it, and leaving one open makes the next one easier to miss.
-- `postgres` (the API's role) has BYPASSRLS, so this changes no query the app runs.
-- drizzle-kit does not track RLS, so these lines cause no drift on the next db:generate.
ALTER TABLE "nhtsa_recall_campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nhtsa_recall_models" ENABLE ROW LEVEL SECURITY;
