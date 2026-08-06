-- Drops the NHTSA crash-test mirror. Nothing read it: the fetcher, sync and endpoint
-- were removed earlier and the table definition outlived them, so this is the deliberate
-- second half of that removal rather than a new decision.
--
-- The rows are a mirror of a free public NHTSA feed keyed by year/make/model. No user
-- data is here and nothing references it, so CASCADE has nothing to follow. Re-fetching
-- is the recovery path if crash ratings ever come back.
DROP TABLE "model_safety_ratings" CASCADE;
