-- Both offers are new; every row that predates them was implicitly the one flat price that
-- used to exist, so existing rows backfill to 'all_you_can_eat' rather than erroring on
-- NOT NULL with no default.
CREATE TYPE "public"."pricing_model" AS ENUM('all_you_can_eat', 'per_incident');--> statement-breakpoint
DROP TABLE "user_features" CASCADE;--> statement-breakpoint
ALTER TABLE "paywall_intents" ADD COLUMN "pricing_model" "pricing_model";--> statement-breakpoint
UPDATE "paywall_intents" SET "pricing_model" = 'all_you_can_eat' WHERE "pricing_model" IS NULL;--> statement-breakpoint
ALTER TABLE "paywall_intents" ALTER COLUMN "pricing_model" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pricing_model" "pricing_model";--> statement-breakpoint
UPDATE "users" SET "pricing_model" = 'all_you_can_eat' WHERE "plan" = 'paid' AND "pricing_model" IS NULL;--> statement-breakpoint
DROP TYPE "public"."feature_status";