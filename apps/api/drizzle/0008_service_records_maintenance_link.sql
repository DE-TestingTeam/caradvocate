ALTER TABLE "service_records" ADD COLUMN "mileage_at_service" integer;--> statement-breakpoint
ALTER TABLE "service_records" ADD COLUMN "maintenance_item_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_records" ADD CONSTRAINT "service_records_maintenance_item_id_maintenance_items_id_fk" FOREIGN KEY ("maintenance_item_id") REFERENCES "public"."maintenance_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "maintenance_items" DROP COLUMN IF EXISTS "status";--> statement-breakpoint
DROP TYPE "public"."maintenance_status";