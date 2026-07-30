/**
 * Keeps the local mirror of NHTSA crash-test ratings fresh.
 *
 * The third feed through the machinery in modelFeed.ts, and the one that shows the
 * abstraction was the right call: a fetcher and a table, no new freshness policy.
 *
 * Ratings are even more static than recalls -- a model's crash test happens once and
 * the result never changes -- so the shared week-long freshness window is, if
 * anything, conservative here. What does change is the set of variants NHTSA has got
 * around to testing, which is why this re-syncs at all.
 */
import { and, notInArray, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { modelSafetyRatings } from '../db/schema.js';
import {
  fetchSafetyRatings,
  type FetchedSafetyRating,
  type SafetyRatingLookup,
} from './safetyRatings.js';
import { dueForCheck, modelMatches, normaliseKey, readSyncState, recordCheck } from './modelFeed.js';

const FEED = 'safety_ratings' as const;

type SafetyRatingRow = typeof modelSafetyRatings.$inferSelect;

/** Test seam, mirroring setRecallFetcherForTesting. */
type SafetyRatingFetcher = (
  lookup: SafetyRatingLookup,
) => Promise<FetchedSafetyRating[] | undefined>;

let fetcher: SafetyRatingFetcher = fetchSafetyRatings;

export function setSafetyRatingFetcherForTesting(next: SafetyRatingFetcher | undefined): void {
  fetcher = next ?? fetchSafetyRatings;
}

/**
 * Crash-test ratings for one model, syncing first if the mirror is stale.
 *
 * `synced: false` means NHTSA has never been reached for this model. Distinguishing
 * that from "NHTSA has tested nothing matching this car" matters more here than
 * anywhere else in the app: an owner shown a blank safety panel will read it as
 * reassurance unless the UI says which of the two it is.
 */
export async function getModelSafetyRatings(
  db: Database,
  lookup: SafetyRatingLookup,
  now: Date = new Date(),
): Promise<{ variants: SafetyRatingRow[]; synced: boolean }> {
  const sync = await readSyncState(db, FEED, lookup);

  let reached = sync?.succeededAt != null;
  if (dueForCheck(sync, now)) {
    reached = (await syncModelSafetyRatings(db, lookup, now)) || reached;
  }

  const variants = await db
    .select()
    .from(modelSafetyRatings)
    .where(modelMatches(modelSafetyRatings, lookup));
  variants.sort(byRatingThenName);

  return { variants, synced: reached };
}

/**
 * Fetches and stores one model's ratings.
 *
 * A failed fetch records the attempt and leaves existing rows untouched, for the same
 * reason as recalls: stale data beats none, and a blip must not blank a safety panel.
 *
 * Returns whether NHTSA was actually reached.
 */
async function syncModelSafetyRatings(
  db: Database,
  lookup: SafetyRatingLookup,
  now: Date,
): Promise<boolean> {
  const fetched = await fetcher(lookup);

  if (fetched === undefined) {
    await recordCheck(db, FEED, lookup, now, false);
    return false;
  }

  await db.transaction(async (tx) => {
    const keep = fetched.map((variant) => variant.ncapVehicleId);

    // Variants NHTSA no longer lists are dropped, so a retired or re-keyed test does
    // not linger next to the current one.
    await tx
      .delete(modelSafetyRatings)
      .where(
        keep.length > 0
          ? and(
              modelMatches(modelSafetyRatings, lookup),
              notInArray(modelSafetyRatings.ncapVehicleId, keep),
            )
          : modelMatches(modelSafetyRatings, lookup),
      );

    if (fetched.length > 0) {
      await tx
        .insert(modelSafetyRatings)
        .values(fetched.map((variant) => toRow(lookup, variant)))
        // NHTSA does revise ratings when it re-tests a variant, and the VehicleId is
        // the stable identity, so re-syncing updates in place.
        .onConflictDoUpdate({
          target: [
            modelSafetyRatings.year,
            modelSafetyRatings.make,
            modelSafetyRatings.model,
            modelSafetyRatings.ncapVehicleId,
          ],
          set: {
            description: sql`excluded.description`,
            overallRating: sql`excluded.overall_rating`,
            frontCrashRating: sql`excluded.front_crash_rating`,
            sideCrashRating: sql`excluded.side_crash_rating`,
            rolloverRating: sql`excluded.rollover_rating`,
            rolloverPossibility: sql`excluded.rollover_possibility`,
            forwardCollisionWarning: sql`excluded.forward_collision_warning`,
            laneDepartureWarning: sql`excluded.lane_departure_warning`,
            electronicStabilityControl: sql`excluded.electronic_stability_control`,
          },
        });
    }

    await recordCheck(tx, FEED, lookup, now, true);
  });

  return true;
}

function toRow(lookup: SafetyRatingLookup, variant: FetchedSafetyRating) {
  return {
    ...normaliseKey(lookup),
    ncapVehicleId: variant.ncapVehicleId,
    description: variant.description,
    overallRating: variant.overallRating ?? null,
    frontCrashRating: variant.frontCrashRating ?? null,
    sideCrashRating: variant.sideCrashRating ?? null,
    rolloverRating: variant.rolloverRating ?? null,
    // numeric() round-trips as a string in Drizzle; store it as one.
    rolloverPossibility: variant.rolloverPossibility?.toFixed(3) ?? null,
    forwardCollisionWarning: variant.forwardCollisionWarning ?? null,
    laneDepartureWarning: variant.laneDepartureWarning ?? null,
    electronicStabilityControl: variant.electronicStabilityControl ?? null,
  };
}

/**
 * Worst rating first, then by name.
 *
 * The same reasoning as sorting recalls by severity: if one cab configuration of a
 * truck scored three stars and another scored five, the three-star result is the one
 * the owner needs to see, and it must not sit below the reassuring one. Untested
 * variants sort last rather than as the worst -- no rating is not a bad rating.
 */
function byRatingThenName(a: SafetyRatingRow, b: SafetyRatingRow): number {
  const rank = (row: SafetyRatingRow) => row.overallRating ?? Number.POSITIVE_INFINITY;
  return rank(a) - rank(b) || a.description.localeCompare(b.description);
}
