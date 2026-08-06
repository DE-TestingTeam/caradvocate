CREATE TABLE IF NOT EXISTS "model_feed_syncs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feed" text NOT NULL,
	"year" integer NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"succeeded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_owner_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"component" text NOT NULL,
	"report_count" integer NOT NULL,
	"crash_count" integer DEFAULT 0 NOT NULL,
	"fire_count" integer DEFAULT 0 NOT NULL,
	"injury_count" integer DEFAULT 0 NOT NULL,
	"death_count" integer DEFAULT 0 NOT NULL,
	"latest_incident_on" date
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
CREATE UNIQUE INDEX IF NOT EXISTS "model_feed_syncs_feed_model_unique" ON "model_feed_syncs" USING btree ("feed","year","make","model");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_owner_reports_model_idx" ON "model_owner_reports" USING btree ("year","make","model");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "model_owner_reports_component_unique" ON "model_owner_reports" USING btree ("year","make","model","component");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_recalls_model_idx" ON "model_recalls" USING btree ("year","make","model");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "model_recalls_campaign_unique" ON "model_recalls" USING btree ("year","make","model","campaign_number");