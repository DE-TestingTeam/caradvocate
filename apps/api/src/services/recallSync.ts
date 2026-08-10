/**
 * Keeps the local mirror of NHTSA recalls fresh. Syncs per year/make/model, so every owner of
 * that car reads the same rows, a page load is a local query, and My Car still works when
 * NHTSA does not. Freshness is coarse: campaigns are issued over weeks, not minutes.
 */
import { and, notInArray, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { modelRecalls } from '../db/schema.js';
import type { RecallCheckStatus } from '@caradvocate/shared';
import {
  fetchRecalls,
  fetchRecallsForNames,
  type FetchedRecall,
  type RecallFetch,
  type RecallLookup,
} from './recalls.js';
import { listMirroredModelNames, lookupMirroredRecalls } from './recallMirror.js';
import { matchModelNames } from './modelNames.js';
import {
  dueForCheck,
  modelMatches,
  normaliseKey,
  readSyncState,
  recordCheck,
  type SyncState,
} from './modelFeed.js';

const FEED = 'recalls' as const;

type RecallRow = typeof modelRecalls.$inferSelect;

/**
 * Recalls for one model, syncing first if the mirror is stale. `synced: false` means NHTSA has
 * never been reached for this model, which is what lets the UI distinguish "no recalls" from
 * "we do not know yet".
 */
export async function getModelRecalls(
  db: Database,
  lookup: RecallLookup,
  now: Date = new Date(),
): Promise<{ recalls: RecallRow[]; status: RecallCheckStatus }> {
  let sync = await readSyncState(db, FEED, lookup);

  if (dueForCheck(FEED, sync, now)) {
    await syncModelRecalls(db, lookup, now);
    // Re-read rather than tracked: the sync it just wrote carries both whether NHTSA answered
    // and, when it did, whether it recognised the name.
    sync = await readSyncState(db, FEED, lookup);
  }

  const recalls = await db.select().from(modelRecalls).where(modelMatches(modelRecalls, lookup));
  recalls.sort(bySeverityThenRecency);

  return { recalls, status: statusOf(sync) };
}

/**
 * Reads the sync record, which a failure never retracts -- `recordCheck` leaves `succeededAt`
 * standing and moves only the attempt clock. So a model reached last week and unreachable
 * today still reports `ok` and keeps showing the rows it earned, rather than putting a warning
 * banner over a list that is right there. Only a model NHTSA has never answered about at all
 * reports why.
 */
/**
 * Asks NHTSA under the name on the car, and if they do not recognise it, under whatever names
 * the mirror says they file this year and make by.
 *
 * The second step is why the mirror earns its keep beyond being a backup: NHTSA's recall API
 * matches model names exactly, and the name on a car is routinely not one of theirs. A 2014
 * "F-350" -- what a VIN decode gives -- is "F-350 SD" to them, and asking the wrong way is
 * indistinguishable from asking about a car with no recalls. It has 6.
 *
 * A 400 is left standing when nothing resolves. That is the honest answer for a "GMT-400": a
 * platform code no manufacturer sells, which NHTSA has never heard of and no amount of
 * matching should invent a model for.
 */
async function resolveAndFetch(db: Database, lookup: RecallLookup): Promise<RecallFetch> {
  const direct = await fetchRecalls(lookup);
  if (direct.outcome !== 'unknown_model') return direct;

  const vocabulary = await listMirroredModelNames(db, lookup.year, lookup.make);
  const names = matchModelNames(vocabulary, lookup.model);
  // Nothing to try, either because the name is genuinely not NHTSA's or because the mirror has
  // not been imported yet. Both leave the 400 exactly as informative as it already was.
  if (names.length === 0) return direct;

  return fetchRecallsForNames(lookup, names);
}

function statusOf(sync: SyncState | undefined): RecallCheckStatus {
  if (!sync?.succeededAt) return 'unreachable';
  return sync.outcome === 'model_not_listed' ? 'model_not_listed' : 'ok';
}

/**
 * Fetches and stores one model's recalls, returning whether NHTSA was reached. A failed fetch
 * records the attempt and leaves existing rows untouched -- deleting on failure would let an
 * NHTSA blip clear a genuine safety warning off someone's screen.
 *
 * Two sources, asked in order: the live API, then the local mirror of NHTSA's bulk files
 * (services/recallMirror.ts). Both are NHTSA's own data, so an answer from either is a real
 * answer and counts as reached -- the mirror exists precisely so a car that has never been
 * looked up still gets its recalls when the API is unreachable. The API goes first because it
 * normalises model names and is at most a day fresher; see the mirror's header for why a miss
 * there is treated as no answer rather than an all-clear.
 */
async function syncModelRecalls(db: Database, lookup: RecallLookup, now: Date): Promise<boolean> {
  const result = await resolveAndFetch(db, lookup);

  // NHTSA answered and files nothing under any name this car resolves to. A real answer, so
  // it is recorded as one and earns the full freshness window -- but qualified, so it can
  // never reach an owner as "no open recalls".
  if (result.outcome === 'unknown_model') {
    await recordCheck(db, FEED, lookup, now, true, 'model_not_listed');
    return true;
  }

  // The mirror is asked only when the API gave no answer at all.
  const fetched =
    result.outcome === 'ok' ? result.recalls : await lookupMirroredRecalls(db, lookup);

  if (fetched === undefined) {
    await recordCheck(db, FEED, lookup, now, false);
    return false;
  }

  await db.transaction(async (tx) => {
    const keep = fetched.map((recall) => recall.campaignNumber);

    // Campaigns NHTSA no longer lists are dropped, so a superseded recall does not linger.
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
        // Updated in place: NHTSA revises summaries and remedies as a campaign progresses.
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

    await recordCheck(tx, FEED, lookup, now, true);
  });

  return true;
}

function toRow(lookup: RecallLookup, recall: FetchedRecall) {
  return {
    ...normaliseKey(lookup),
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
 * Highest urgency first, then the newest campaign.
 *
 * Urgency still wins, and that part is not a preference: a "stop driving this vehicle" campaign
 * has to be the first thing on the list whenever it was issued, so the date only ever orders
 * recalls of equal urgency.
 *
 * Within a tier it is newest-first. The tradeoff is worth being explicit about, because this
 * used to sort the other way on purpose: nothing here expires, so an unremedied 2011 defect is
 * arguably more overdue than one issued last year, and oldest-first kept the longest-neglected
 * item at the top. Newest-first instead matches how a list of dated notices is normally read --
 * most recent at the top, like a feed -- at the cost of pushing old outstanding work down.
 * Nothing is hidden either way; both orderings show the same rows.
 */
function bySeverityThenRecency(a: RecallRow, b: RecallRow): number {
  const urgency = (row: RecallRow) => (row.parkIt ? 2 : row.parkOutside ? 1 : 0);
  const byUrgency = urgency(b) - urgency(a);
  if (byUrgency !== 0) return byUrgency;
  // Undated campaigns still sort last: '0000' is older than any real date under a descending
  // compare, so they fall to the bottom rather than leading the list as if they were newest.
  return (b.reportedOn ?? '0000').localeCompare(a.reportedOn ?? '0000');
}
