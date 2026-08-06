CREATE TABLE IF NOT EXISTS "model_safety_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"ncap_vehicle_id" integer NOT NULL,
	"description" text NOT NULL,
	"overall_rating" integer,
	"front_crash_rating" integer,
	"side_crash_rating" integer,
	"rollover_rating" integer,
	"rollover_possibility" numeric(4, 3),
	"forward_collision_warning" text,
	"lane_departure_warning" text,
	"electronic_stability_control" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_safety_ratings_model_idx" ON "model_safety_ratings" USING btree ("year","make","model");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "model_safety_ratings_variant_unique" ON "model_safety_ratings" USING btree ("year","make","model","ncap_vehicle_id");