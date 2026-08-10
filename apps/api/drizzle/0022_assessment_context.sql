-- Records WHY the owner is asking about a repair, which the assessment never captured.
--
-- The Repair Cost Checker stored which repair and what it cost, and nothing about what prompted
-- it. That is why the necessity check does not exist: "is this repair needed?" has no answer from
-- a repair name and a price. A shop proposing brake pads to someone who reported grinding and a
-- shop proposing them to someone who came in for an oil change are different questions, and the
-- app could not tell them apart.
--
-- `prompted_by` is a short fixed list (see AssessmentPrompt in the shared package) because it is
-- the field that gets reasoned over; `symptom_notes` is where the owner's own words go.
-- `symptom_duration` is deliberately coarse -- an owner rarely knows when something started, and
-- offering day-level precision invites a guess that later reads as a fact.
--
-- Text rather than enum types, matching model_feed_syncs.feed and ask_transcripts.outcome: a
-- newly distinguished reason should not need a migration.
--
-- NULLABLE WITH NO BACKFILL, and the API requires `prompted_by` for new rows. Null means "never
-- asked", which is not "nothing to report" and has to stay tellable apart -- the four assessments
-- that predate this cannot be given an answer nobody ever gave. Any default would invent one.
ALTER TABLE "assessments" ADD COLUMN "prompted_by" text;--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "symptom_notes" text;--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "symptom_duration" text;
