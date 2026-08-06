CREATE TYPE "public"."chat_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."feature_status" AS ENUM('Included', 'Active');--> statement-breakpoint
CREATE TYPE "public"."maintenance_status" AS ENUM('open_recall', 'overdue', 'upcoming');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('free', 'paid');--> statement-breakpoint
CREATE TYPE "public"."quote_verdict" AS ENUM('fair', 'overpriced');--> statement-breakpoint
CREATE TYPE "public"."service_record_source" AS ENUM('manual', 'repair_cost_checker');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assessment_labor_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"name" text NOT NULL,
	"hours" numeric(4, 2) NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assessment_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"name" text NOT NULL,
	"avg_price" integer NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"repair_id" uuid,
	"repair_name" text NOT NULL,
	"mileage_at_assessment" integer NOT NULL,
	"recommendation_headline" text NOT NULL,
	"recommendation_badge" text NOT NULL,
	"recommendation_body" text NOT NULL,
	"parts_total" integer NOT NULL,
	"parts_low" integer NOT NULL,
	"parts_high" integer NOT NULL,
	"labor_rate_per_hour" integer NOT NULL,
	"labor_est_hours" numeric(4, 2) NOT NULL,
	"labor_total" integer NOT NULL,
	"fair_total_low" integer NOT NULL,
	"fair_total_high" integer NOT NULL,
	"quote_amount" integer,
	"quote_parts" integer,
	"quote_labor" integer,
	"quote_verdict" "quote_verdict",
	"quote_explanation" text,
	"quote_file_name" text,
	"completed_at" date,
	"completed_cost" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "benchmark_labor_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"benchmark_id" uuid NOT NULL,
	"name" text NOT NULL,
	"hours" numeric(4, 2) NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "benchmark_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"benchmark_id" uuid NOT NULL,
	"name" text NOT NULL,
	"avg_price" integer NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "chat_role" NOT NULL,
	"text" text NOT NULL,
	"urgency_level" "severity",
	"urgency_text" text,
	"cta_label" text,
	"cta_action" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "maintenance_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"label" text NOT NULL,
	"status" "maintenance_status" NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_known_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"label" text NOT NULL,
	"severity" "severity" NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "repair_benchmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repair_id" uuid NOT NULL,
	"parts_total" integer NOT NULL,
	"parts_low" integer NOT NULL,
	"parts_high" integer NOT NULL,
	"labor_rate_per_hour" integer NOT NULL,
	"labor_est_hours" numeric(4, 2) NOT NULL,
	"labor_total" integer NOT NULL,
	"fair_total_low" integer NOT NULL,
	"fair_total_high" integer NOT NULL,
	"recommendation_headline" text NOT NULL,
	"recommendation_badge" text NOT NULL,
	"recommendation_body" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "repairs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"description" text NOT NULL,
	"service_date" date NOT NULL,
	"cost" integer NOT NULL,
	"source" "service_record_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "feature_status" NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"member_since" date NOT NULL,
	"plan" "plan" DEFAULT 'paid' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle_value_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"month_label" text NOT NULL,
	"value" integer NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"trim" text,
	"vin" text NOT NULL,
	"mileage" integer NOT NULL,
	"est_market_value" integer NOT NULL,
	"trade_in_low" integer NOT NULL,
	"trade_in_high" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assessment_labor_tasks" ADD CONSTRAINT "assessment_labor_tasks_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assessment_parts" ADD CONSTRAINT "assessment_parts_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assessments" ADD CONSTRAINT "assessments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assessments" ADD CONSTRAINT "assessments_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assessments" ADD CONSTRAINT "assessments_repair_id_repairs_id_fk" FOREIGN KEY ("repair_id") REFERENCES "public"."repairs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "benchmark_labor_tasks" ADD CONSTRAINT "benchmark_labor_tasks_benchmark_id_repair_benchmarks_id_fk" FOREIGN KEY ("benchmark_id") REFERENCES "public"."repair_benchmarks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "benchmark_parts" ADD CONSTRAINT "benchmark_parts_benchmark_id_repair_benchmarks_id_fk" FOREIGN KEY ("benchmark_id") REFERENCES "public"."repair_benchmarks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "maintenance_items" ADD CONSTRAINT "maintenance_items_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_benchmarks" ADD CONSTRAINT "repair_benchmarks_repair_id_repairs_id_fk" FOREIGN KEY ("repair_id") REFERENCES "public"."repairs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_records" ADD CONSTRAINT "service_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_records" ADD CONSTRAINT "service_records_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_features" ADD CONSTRAINT "user_features_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle_value_points" ADD CONSTRAINT "vehicle_value_points_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assessment_labor_tasks_assessment_idx" ON "assessment_labor_tasks" USING btree ("assessment_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assessment_parts_assessment_idx" ON "assessment_parts" USING btree ("assessment_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assessments_user_created_idx" ON "assessments" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "benchmark_labor_tasks_benchmark_idx" ON "benchmark_labor_tasks" USING btree ("benchmark_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "benchmark_parts_benchmark_idx" ON "benchmark_parts" USING btree ("benchmark_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_user_created_idx" ON "chat_messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "maintenance_items_vehicle_idx" ON "maintenance_items" USING btree ("vehicle_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_known_issues_model_idx" ON "model_known_issues" USING btree ("year","make","model","position");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "repair_benchmarks_repair_unique" ON "repair_benchmarks" USING btree ("repair_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "repairs_slug_unique" ON "repairs" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_records_user_date_idx" ON "service_records" USING btree ("user_id","service_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_features_user_idx" ON "user_features" USING btree ("user_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicle_value_points_vehicle_idx" ON "vehicle_value_points" USING btree ("vehicle_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicles_user_idx" ON "vehicles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vehicles_user_vin_unique" ON "vehicles" USING btree ("user_id","vin");