CREATE TABLE IF NOT EXISTS "model_recall_syncs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"succeeded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_recalls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"campaign_number" text NOT NULL,
	"component" text NOT NULL,
	"summary" text NOT NULL,
	"consequence" text NOT NULL,
	"remedy" text NOT NULL,
	"park_it" boolean DEFAULT false NOT NULL,
	"park_outside" boolean DEFAULT false NOT NULL,
	"reported_on" date
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "model_recall_syncs_model_unique" ON "model_recall_syncs" USING btree ("year","make","model");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_recalls_model_idx" ON "model_recalls" USING btree ("year","make","model");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "model_recalls_campaign_unique" ON "model_recalls" USING btree ("year","make","model","campaign_number");