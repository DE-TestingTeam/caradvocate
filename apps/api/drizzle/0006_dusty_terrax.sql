CREATE TABLE IF NOT EXISTS "vehicle_recall_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"campaign_number" text NOT NULL,
	"repaired" boolean NOT NULL,
	"noted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle_recall_status" ADD CONSTRAINT "vehicle_recall_status_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vehicle_recall_status_unique" ON "vehicle_recall_status" USING btree ("vehicle_id","campaign_number");