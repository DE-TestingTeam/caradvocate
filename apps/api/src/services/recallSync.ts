/**
 * Keeps the local mirror of NHTSA recalls fresh. Syncs per year/make/model, so every owner of
 * that car reads the same rows, a page load is a local query, and My Car still works when
 * NHTSA does not. Freshness is coarse: campaigns are issued over weeks, not minutes.
 */
import { and, notInArray, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { modelRecalls } from '../db/schema.js';
import { fetchRecalls, type FetchedRecall, type RecallLookup } from './recalls.js';
import { dueForCheck, modelMatches, normaliseKey, readSyncState, recordCheck } from './modelFeed.js';

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
): Promise<{ recalls: RecallRow[]; synced: boolean }> {
  const sync = await readSyncState(db, FEED, lookup);

  // Tracked rather than re-read: this runs on every My Car load, and the sync already knows.
  let reached = sync?.succeededAt != null;
  if (dueForCheck(FEED, sync, now)) {
    reached = (await syncModelRecalls(db, lookup, now)) || reached;
  }

  const recalls = await db.select().from(modelRecalls).where(modelMatches(modelRecalls, lookup));
  recalls.sort(bySeverityThenAge);

  return { recalls, synced: reached };
}

/**
 * Fetches and stores one model's recalls, returning whether NHTSA was reached. A failed fetch
 * records the attempt and leaves existing rows untouched -- deleting on failure would let an
 * NHTSA blip clear a genuine safety warning off someone's screen.
 */
async function syncModelRecalls(db: Database, lookup: RecallLookup, now: Date): Promise<boolean> {
  const fetched = await fetchRecalls(lookup);

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
 * Highest urgency first, then the oldest campaign. Nothing here expires, so a never-remedied
 * 2011 defect is more overdue than one issued last year, not less interesting -- sorting
 * newest-first would push the longest-neglected item to the bottom.
 */
function bySeverityThenAge(a: RecallRow, b: RecallRow): number {
  const urgency = (row: RecallRow) => (row.parkIt ? 2 : row.parkOutside ? 1 : 0);
  const byUrgency = urgency(b) - urgency(a);
  if (byUrgency !== 0) return byUrgency;
  // Undated campaigns sort last rather than masquerading as the oldest.
  return (a.reportedOn ?? '9999').localeCompare(b.reportedOn ?? '9999');
}
