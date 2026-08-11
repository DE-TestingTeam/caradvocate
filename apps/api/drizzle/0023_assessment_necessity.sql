-- The necessity verdict, which the assessment could state but never worked out.
--
-- Migration 0022 collected the missing input -- why the repair came up. This stores what is made
-- of it: a band, the facts behind it, and why it fell short when it did. Until now the three
-- recommendation columns on this table carried a fixed string copied off the benchmark ("Priced
-- for your car", badge ASSESSED) that was identical on every repair for every car, which is a
-- statement about pricing wearing the clothes of a judgement.
--
-- SNAPSHOTTED, like every figure on this row, rather than recomputed on read the way maintenance
-- status is. The inputs move underneath: the owner logs the service afterwards, the complaint
-- mileage ingest runs, a factory schedule finally arrives. A verdict that quietly changed under
-- an owner who had already taken it to a shop is worse than no verdict at all.
--
-- `necessity_signals` is jsonb rather than a child table because the rows are read and written
-- whole and never queried into, and a table would invite a join that recomputes exactly what this
-- column exists to freeze. It holds `[{"stance": "...", "detail": "..."}]` -- the sentences the
-- prose was written from, so the body can never quote evidence the row does not hold.
--
-- NULLABLE WITH NO BACKFILL. Null means never judged, which is NOT `not_enough`: one is us not
-- looking, the other is us looking and finding nothing to go on. The four assessments predating
-- this were never asked why they came up (see 0022) and so cannot be judged now -- a backfill
-- would have to invent the one input the whole check turns on.
ALTER TABLE "assessments" ADD COLUMN "necessity_band" text;--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "necessity_shortfall" text;--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "necessity_signals" jsonb;
