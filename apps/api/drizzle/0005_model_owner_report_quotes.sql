CREATE TABLE IF NOT EXISTS "model_owner_report_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"text" text NOT NULL,
	"incident_on" date,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "model_owner_report_quotes" ADD CONSTRAINT "model_owner_report_quotes_report_id_model_owner_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."model_owner_reports"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_owner_report_quotes_report_idx" ON "model_owner_report_quotes" USING btree ("report_id","position");