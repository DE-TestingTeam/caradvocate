/**
 * Shared machinery for upstream feeds keyed by year/make/model.
 *
 * Recalls and owner complaints are both properties of a *model* rather than an
 * owner, both come from NHTSA, and both are mirrored locally so a page load is a
 * local query. The freshness policy, the case normalising and the record of what
 * has been checked are identical, so they live here once rather than being copied
 * per feed. A third feed (investigations, safety ratings) should need only a
 * fetcher and a table.
 */
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { modelFeedSyncs } from '../db/schema.js';

/** A successful check is trusted for a week. Campaigns and complaints accrue over weeks, not minutes. */
const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
/** A failed one is retried sooner, but not on every request. */
const RETRY_AFTER_MS = 15 * 60 * 1000;

/** Which upstream feed a sync record belongs to. */
export type FeedName = 'recalls' | 'complaints';

export interface ModelKey {
  year: number;
  make: string;
  model: string;
}

/** Accepts a transaction as readily as the pool, since it runs in both. */
type Executor = Pick<Database, 'insert'>;

/**
 * Make and model are stored uppercase.
 *
 * NHTSA is case-insensitive on input but echoes uppercase, and a vehicle's own
 * make/model come from either a VIN decode ("HONDA") or a typed form ("Honda").
 * Normalising on the way in keeps one row per model instead of one per spelling.
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
 * Never checked, the last success has aged out, or a previous failure's cooldown
 * has elapsed. The cooldown is checked in every case so a persistent upstream
 * outage costs one attempt per window rather than one per request.
 */
export function dueForCheck(sync: SyncState | undefined, now: Date): boolean {
  if (!sync) return true;
  if (now.getTime() - sync.checkedAt.getTime() <= RETRY_AFTER_MS) return false;
  if (!sync.succeededAt) return true;
  return now.getTime() - sync.succeededAt.getTime() > FRESH_MS;
}

/**
 * Records an attempt.
 *
 * A failure advances only the attempt clock, leaving any earlier success -- and
 * therefore the mirrored rows it produced -- standing. Stale upstream data beats
 * none, and a blip must never retract something we already earned.
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
