ALTER TABLE "vehicles" ALTER COLUMN "vin" DROP NOT NULL;--> statement-breakpoint
-- Vehicles added before the column was nullable carry a synthetic
-- "UNKNOWN-<random>" VIN, which leaked into the UI through the VIN masker.
-- Absent is now recorded as NULL, so retire the sentinels.
UPDATE "vehicles" SET "vin" = NULL WHERE "vin" LIKE 'UNKNOWN-%';
