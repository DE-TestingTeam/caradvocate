ALTER TYPE "public"."feature_status" ADD VALUE 'Locked';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "paywall_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"price_cents" integer NOT NULL,
	"interval" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "plan" SET DEFAULT 'free';--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "paywall_intents" ADD CONSTRAINT "paywall_intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "paywall_intents_user_idx" ON "paywall_intents" USING btree ("user_id","created_at");