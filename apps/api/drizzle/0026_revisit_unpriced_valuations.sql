-- Re-opens every "cannot be valued" verdict, because a second valuation source now exists.
--
-- Migration 0025 added Vehicle Databases alongside MarketCheck. Every unpriced car on file was
-- judged when MarketCheck was the only source, and those verdicts are sticky by design:
-- `market_value_checked_at` is what stops the app asking again for a month, and
-- `valuation_unavailable` is what makes the card say the answer is final. Both were correct about
-- a world with one vendor and are wrong about this one.
--
-- The 2011 Pathfinder is the proof. MarketCheck cannot decode its VIN, so it carried no value and
-- was not being re-asked; Vehicle Databases prices it at $4,286 private-party without difficulty.
-- A 2018 Cadillac CTS is in the same state. Without this, both stay blank for thirty days and
-- then get asked again only by accident of timing.
--
-- ONLY CARS WITH NO PRICE. A car that already has a value has nothing to re-open -- clearing its
-- marker would spend a metered call re-answering a question we can already answer, on every car,
-- for nothing. The trade-in range those cars are missing arrives on their next monthly refresh.
--
-- This is a one-off correction, not a rule. The rule lives in services/marketValueSync.ts: a
-- refusal only sticks when the sources that could have answered actually did.
UPDATE "vehicles"
SET "market_value_checked_at" = NULL,
    "valuation_unavailable" = false
WHERE "est_market_value" IS NULL;
