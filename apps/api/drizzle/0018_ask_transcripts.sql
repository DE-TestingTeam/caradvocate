CREATE TABLE IF NOT EXISTS "ask_transcript_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transcript_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ask_transcripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer" text,
	"outcome" text NOT NULL,
	"urgency_level" "severity",
	"urgency_text" text,
	"cta_label" text,
	"history_messages" integer NOT NULL,
	"model" text,
	"latency_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"cache_read_tokens" integer,
	"cache_write_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ask_transcript_sources" ADD CONSTRAINT "ask_transcript_sources_transcript_id_ask_transcripts_id_fk" FOREIGN KEY ("transcript_id") REFERENCES "public"."ask_transcripts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ask_transcripts" ADD CONSTRAINT "ask_transcripts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ask_transcripts" ADD CONSTRAINT "ask_transcripts_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ask_transcript_sources_transcript_idx" ON "ask_transcript_sources" USING btree ("transcript_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ask_transcripts_created_idx" ON "ask_transcripts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ask_transcripts_outcome_idx" ON "ask_transcripts" USING btree ("outcome","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ask_transcripts_user_idx" ON "ask_transcripts" USING btree ("user_id","created_at");--> statement-breakpoint
-- Deny-by-default for PostgREST, the same as every other table. Required per new table:
-- sql/rls-lockdown.sql closes the stock `anon`/`authenticated` grants and revokes the default
-- privileges that would hand them back on a newly created table, but Postgres has no default
-- for RLS itself, so it has to be switched on here. Transcripts are the last table that should
-- ever be readable with a public key. `postgres` (the API's role) has BYPASSRLS, so this
-- changes no query the app runs. drizzle-kit does not track RLS, so these lines cause no drift.
ALTER TABLE "ask_transcripts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ask_transcript_sources" ENABLE ROW LEVEL SECURITY;
