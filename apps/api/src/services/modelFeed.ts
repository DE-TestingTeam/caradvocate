/**
 * Shared machinery for upstream feeds keyed by year/make/model. Recalls, owner complaints
 * and repair pricing are all properties of a model rather than an owner, and all are
 * mirrored locally so a page load is a local query. The case normalising, the record of what
 * has been checked and the SHAPE of the freshness policy are identical, so they live here
 * once -- but the freshness window itself is per feed, because one of the three vendors bills
 * per call and the other two do not. See `FRESH_MS`.
 */
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { modelFeedSyncs } from '../db/schema.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Which upstream feed a sync record belongs to. */
export type FeedName = 'recalls' | 'complaints' | 'repair_pricing' | 'maintenance_schedule';

/**
 * How long a successful check is trusted, per feed. This is the only dial that decides how
 * many upstream calls a given number of vehicles costs, so it is set per feed rather than
 * shared: a week is right for the free NHTSA feeds and wasteful for the metered one.
 *
 * `repair_pricing` is metered per call (see services/vehicleDatabases.ts), and parts and
 * labor pricing moves over seasons, not days -- a 2011 Pathfinder's brake job does not cost
 * a different amount this Tuesday than last. Ninety days cuts the spend on that vendor
 * roughly twelvefold for data no staler than the question it answers.
 *
 * Recalls and complaints stay weekly. Both accrue continuously, both are free to ask about,
 * and a recall campaign an owner has not been told about is the thing this app exists to
 * catch -- that is not somewhere to trade freshness for nothing.
 */
const FRESH_MS: Record<FeedName, number> = {
  recalls: 7 * DAY_MS,
  complaints: 7 * DAY_MS,
  repair_pricing: 90 * DAY_MS,
  /**
   * Never, in effect. A factory service schedule is fixed for the life of the model, so a
   * success is good forever and this figure is only here to satisfy the map.
   * `maintenance_schedule` does not go through `dueForCheck` at all -- whether a car needs
   * fetching is answered by whether it already has intervals stored. See
   * services/maintenanceScheduleSync.ts.
   */
  maintenance_schedule: 3650 * DAY_MS,
};

/**
 * How long to wait after a failure before asking again. Escalating rather than flat: a flat
 * cooldown treats a vendor that has been down for a week the same as one that blipped a
 * minute ago, and asks a dead endpoint the same question every quarter of an hour forever.
 *
 * Applies only to the `unavailable` path. A vendor answering "no record for this vehicle"
 * is a success -- it is an answer about the car -- so it is cached for the feed's full
 * freshness window and never reaches this ladder.
 */
const RETRY_LADDER_MS = [15 * 60 * 1000, 60 * 60 * 1000, DAY_MS] as const;

/**
 * A model whose feed has NEVER been reached. There is no first-failure timestamp to escalate
 * from -- `checkedAt` moves with every attempt -- so this is a flat figure rather than a rung
 * on the ladder.
 *
 * The shortest rung, deliberately. The case this covers is a car nobody has successfully
 * priced yet, which includes every newly added vehicle, and the owner is sitting in front of
 * "try again shortly" while it waits. Retrying a genuinely broken key costs nothing that
 * matters: a rejected call is not a billed call, so the only thing a longer wait buys is
 * quieter logs, at the price of making that "shortly" a lie.
 */
const FIRST_CONTACT_RETRY_MS = 15 * 60 * 1000;

export interface ModelKey {
  year: number;
  make: string;
  model: string;
}

/** Accepts a transaction as readily as the pool, since it runs in both. */
type Executor = Pick<Database, 'insert'>;

/**
 * Make and model are stored uppercase. A vehicle's own come from either a VIN decode
 * ("HONDA") or a typed form ("Honda"), so normalising keeps one row per model rather than
 * one per spelling.
 */
export function normaliseKey(key: ModelKey): ModelKey {
  return {
    year: key.year,
    make: key.make.trim().toUpperCase(),
    model: key.model.trim().toUpperCase(),
  };
}

/** Matches one model in any table carrying year/make/model columns. */
export function modelMatches(
  table: { year: unknown; make: unknown; model: unknown },
  key: ModelKey,
) {
  const k = normaliseKey(key);
  const t = table as { year: never; make: never; model: never };
  return and(eq(t.year, k.year), eq(t.make, k.make), eq(t.model, k.model));
}

export interface SyncState {
  checkedAt: Date;
  succeededAt: Date | null;
}

/** The sync record for one feed and model, if it has ever been checked. */
export async function readSyncState(
  db: Database,
  feed: FeedName,
  key: ModelKey,
): Promise<SyncState | undefined> {
  const [row] = await db
    .select({ checkedAt: modelFeedSyncs.checkedAt, succeededAt: modelFeedSyncs.succeededAt })
    .from(modelFeedSyncs)
    .where(and(eq(modelFeedSyncs.feed, feed), modelMatches(modelFeedSyncs, key)))
    .limit(1);

  return row;
}

/**
 * Never checked, the last success has aged out, or a previous failure's cooldown has
 * elapsed. The cooldown is checked in every case so a persistent upstream outage costs one
 * attempt per window rather than one per request.
 */
export function dueForCheck(feed: FeedName, sync: SyncState | undefined, now: Date): boolean {
  if (!sync) return true;
  if (now.getTime() - sync.checkedAt.getTime() <= retryDelayMs(feed, sync, now)) return false;
  if (!sync.succeededAt) return true;
  return now.getTime() - sync.succeededAt.getTime() > FRESH_MS[feed];
}

/**
 * The cooldown this model has earned. Derived from how long the feed has been OVERDUE rather
 * than from a stored attempt count, so no column has to track it.
 *
 * Overdue, not "since the last success": those differ by the whole freshness window, and
 * using the latter would put a ninety-day feed on the top rung the instant its first refresh
 * failed. Measured this way the gap starts at zero when the data goes stale, widens only
 * while the vendor keeps failing, and collapses back to the first rung as soon as one call
 * gets through -- because a success moves `succeededAt` and a failure never does.
 */
function retryDelayMs(feed: FeedName, sync: SyncState, now: Date): number {
  if (!sync.succeededAt) return FIRST_CONTACT_RETRY_MS;

  const overdueForMs =
    now.getTime() - sync.succeededAt.getTime() - FRESH_MS[feed];

  // Not overdue at all: the row is still fresh and this is a cooldown on a call nothing is
  // asking for. The shortest rung, so a genuine blip is not held back by arithmetic.
  if (overdueForMs < 60 * 60 * 1000) return RETRY_LADDER_MS[0];
  if (overdueForMs < DAY_MS) return RETRY_LADDER_MS[1];
  return RETRY_LADDER_MS[2];
}

/**
 * Records an attempt. A failure advances only the attempt clock, leaving any earlier
 * success -- and the mirrored rows it produced -- standing. Stale data beats none.
 */
export async function recordCheck(
  db: Executor,
  feed: FeedName,
  key: ModelKey,
  now: Date,
  succeeded: boolean,
): Promise<void> {
  await db
    .insert(modelFeedSyncs)
    .values({ feed, ...normaliseKey(key), checkedAt: now, succeededAt: succeeded ? now : null })
    .onConflictDoUpdate({
      target: [modelFeedSyncs.feed, modelFeedSyncs.year, modelFeedSyncs.make, modelFeedSyncs.model],
      set: succeeded ? { checkedAt: now, succeededAt: now } : { checkedAt: now },
    });
}
