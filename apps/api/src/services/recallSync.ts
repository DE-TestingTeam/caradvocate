/**
 * Keeps the local mirror of NHTSA recalls fresh.
 *
 * Recalls belong to a model, so this syncs per year/make/model and every owner of
 * that car reads the same rows. The mirror exists so a page load is a local query
 * rather than an upstream request, and so My Car still works when NHTSA does not.
 *
 * Freshness is deliberately coarse: campaigns are issued over weeks, not minutes.
 */
import { and, eq, notInArray, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { modelRecallSyncs, modelRecalls } from '../db/schema.js';
import { fetchRecalls, type FetchedRecall, type RecallLookup } from './recalls.js';

/** A successful check is trusted for a week. */
const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
/** A failed one is retried sooner, but not on every request. */
const RETRY_AFTER_MS = 15 * 60 * 1000;

type RecallRow = typeof modelRecalls.$inferSelect;

/**
 * Test seam, mirroring setJwksForTesting in auth/verifyToken.ts. The suite must not
 * depend on NHTSA being reachable, and the sync logic worth testing -- upsert,
 * removal of retired campaigns, failure handling -- is all downstream of the fetch.
 */
type RecallFetcher = (lookup: RecallLookup) => Promise<FetchedRecall[] | undefined>;

let fetcher: RecallFetcher = fetchRecalls;

export function setRecallFetcherForTesting(next: RecallFetcher | undefined): void {
  fetcher = next ?? fetchRecalls;
}

/**
 * Recalls for one model, syncing first if the mirror is stale.
 *
 * Returns `synced: false` only when NHTSA has never been reached successfully for
 * this model, which is what lets the UI distinguish "no recalls" from "we do not
 * know yet" instead of reporting an all-clear it cannot support.
 */
export async function getModelRecalls(
  db: Database,
  lookup: RecallLookup,
  now: Date = new Date(),
): Promise<{ recalls: RecallRow[]; synced: boolean }> {
  const [sync] = await db
    .select()
    .from(modelRecallSyncs)
    .where(modelMatches(modelRecallSyncs, lookup))
    .limit(1);

  // Tracked rather than re-read afterwards: this runs on every My Car load, and
  // the sync already knows whether it reached NHTSA.
  let reached = sync?.succeededAt != null;
  if (dueForCheck(sync, now)) {
    reached = (await syncModelRecalls(db, lookup, now)) || reached;
  }

  const recalls = await db.select().from(modelRecalls).where(modelMatches(modelRecalls, lookup));
  // Most severe first, then longest-outstanding: a "stop driving" campaign must
  // never sit below a routine one, and an old unremedied defect must not sink.
  recalls.sort(bySeverityThenAge);

  return { recalls, synced: reached };
}

type SyncRow = { checkedAt: Date; succeededAt: Date | null };

/**
 * Never checked, the last success has aged out, or a previous failure's cooldown
 * has elapsed. The cooldown is checked in every case so a persistent NHTSA outage
 * costs one attempt per window rather than one per request.
 */
function dueForCheck(sync: SyncRow | undefined, now: Date): boolean {
  if (!sync) return true;
  if (now.getTime() - sync.checkedAt.getTime() <= RETRY_AFTER_MS) return false;
  if (!sync.succeededAt) return true;
  return now.getTime() - sync.succeededAt.getTime() > FRESH_MS;
}

/**
 * Fetches and stores one model's recalls.
 *
 * A failed fetch records the attempt and leaves existing rows untouched: stale
 * recall data is far better than none, and deleting on failure would mean an
 * NHTSA blip silently clears a genuine safety warning off someone's screen.
 *
 * Returns whether NHTSA was actually reached.
 */
async function syncModelRecalls(db: Database, lookup: RecallLookup, now: Date): Promise<boolean> {
  const fetched = await fetcher(lookup);

  if (fetched === undefined) {
    await recordCheck(db, lookup, now, false);
    return false;
  }

  await db.transaction(async (tx) => {
    const keep = fetched.map((recall) => recall.campaignNumber);

    // Campaigns NHTSA no longer lists for this model are dropped, so a corrected
    // or superseded recall does not linger forever.
    await tx
      .delete(modelRecalls)
      .where(
        keep.length > 0
          ? and(modelMatches(modelRecalls, lookup), notInArray(modelRecalls.campaignNumber, keep))
          : modelMatches(modelRecalls, lookup),
      );

    if (fetched.length > 0) {
      await tx
        .insert(modelRecalls)
        .values(fetched.map((recall) => toRow(lookup, recall)))
        // Re-syncing updates in place: NHTSA revises summaries and remedies as a
        // campaign progresses, and the campaign number is the stable identity.
        .onConflictDoUpdate({
          target: [modelRecalls.year, modelRecalls.make, modelRecalls.model, modelRecalls.campaignNumber],
          set: {
            component: sql`excluded.component`,
            summary: sql`excluded.summary`,
            consequence: sql`excluded.consequence`,
            remedy: sql`excluded.remedy`,
            parkIt: sql`excluded.park_it`,
            parkOutside: sql`excluded.park_outside`,
            reportedOn: sql`excluded.reported_on`,
          },
        });
    }

    await recordCheck(tx, lookup, now, true);
  });

  return true;
}

/** Accepts a transaction as readily as the pool, since it runs in both. */
type Executor = Pick<Database, 'insert'>;

async function recordCheck(db: Executor, lookup: RecallLookup, now: Date, succeeded: boolean): Promise<void> {
  await db
    .insert(modelRecallSyncs)
    .values({ ...normalise(lookup), checkedAt: now, succeededAt: succeeded ? now : null })
    .onConflictDoUpdate({
      target: [modelRecallSyncs.year, modelRecallSyncs.make, modelRecallSyncs.model],
      // A failure advances only the attempt clock, leaving the earlier success --
      // and therefore the recalls it produced -- standing.
      set: succeeded ? { checkedAt: now, succeededAt: now } : { checkedAt: now },
    });
}

function toRow(lookup: RecallLookup, recall: FetchedRecall) {
  return {
    ...normalise(lookup),
    campaignNumber: recall.campaignNumber,
    component: recall.component,
    summary: recall.summary,
    consequence: recall.consequence,
    remedy: recall.remedy,
    parkIt: recall.parkIt,
    parkOutside: recall.parkOutside,
    reportedOn: recall.reportedOn ?? null,
  };
}

/**
 * Make and model are stored uppercase.
 *
 * NHTSA is case-insensitive on input but echoes uppercase, and a vehicle's own
 * make/model come from either a VIN decode ("HONDA") or a typed form ("Honda").
 * Normalising on the way in keeps one row per model instead of one per spelling.
 */
function normalise(lookup: RecallLookup): RecallLookup {
  return {
    year: lookup.year,
    make: lookup.make.trim().toUpperCase(),
    model: lookup.model.trim().toUpperCase(),
  };
}

function modelMatches(table: typeof modelRecalls | typeof modelRecallSyncs, lookup: RecallLookup) {
  const key = normalise(lookup);
  return and(eq(table.year, key.year), eq(table.make, key.make), eq(table.model, key.model));
}

/**
 * Highest urgency first; within the same urgency, the oldest campaign first.
 *
 * Age is not a reason to bury a recall. Nothing here expires -- a 2011 defect that
 * was never remedied has been outstanding for over a decade, which makes it more
 * overdue than one issued last year, not less interesting. Sorting newest-first
 * would push exactly the longest-neglected item to the bottom of the list.
 */
function bySeverityThenAge(a: RecallRow, b: RecallRow): number {
  const urgency = (row: RecallRow) => (row.parkIt ? 2 : row.parkOutside ? 1 : 0);
  const byUrgency = urgency(b) - urgency(a);
  if (byUrgency !== 0) return byUrgency;
  // Undated campaigns sort last rather than masquerading as the oldest.
  return (a.reportedOn ?? '9999').localeCompare(b.reportedOn ?? '9999');
}
