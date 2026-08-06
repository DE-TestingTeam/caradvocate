/**
 * Keeps the local mirror of NHTSA owner complaints fresh. Same shape as recallSync, on the same
 * machinery in modelFeed.ts. The mirror matters more here: the raw feed is 344KB for a popular
 * model, and aggregating it on every page load would be absurd.
 */
import type { Database } from '../db/index.js';
import { modelOwnerReportQuotes, modelOwnerReports } from '../db/schema.js';
import { fetchComponentReports, type ComponentReports, type ComplaintLookup } from './complaints.js';
import { dueForCheck, modelMatches, normaliseKey, readSyncState, recordCheck } from './modelFeed.js';

const FEED = 'complaints' as const;

type ReportRow = typeof modelOwnerReports.$inferSelect;

/**
 * Aggregated owner reports for one model, syncing first if the mirror is stale.
 *
 * `synced: false` means NHTSA has never been reached for this model, so an empty
 * list is "we do not know" rather than "nothing reported".
 */
export async function getOwnerReports(
  db: Database,
  lookup: ComplaintLookup,
  now: Date = new Date(),
): Promise<{ reports: ReportRow[]; synced: boolean }> {
  const sync = await readSyncState(db, FEED, lookup);

  let reached = sync?.succeededAt != null;
  if (dueForCheck(FEED, sync, now)) {
    reached = (await syncOwnerReports(db, lookup, now)) || reached;
  }

  // Does not read the stored accounts: My Car shows counts and links to NHTSA for the prose, so
  // joining them here would be a per-request query nothing renders. Callers that want them (the
  // Ask CA context block) read modelOwnerReportQuotes directly.
  const reports = await db.select().from(modelOwnerReports).where(modelMatches(modelOwnerReports, lookup));

  // Most-reported first. The UI shows a limited number, so this decides which.
  reports.sort((a, b) => b.reportCount - a.reportCount || a.component.localeCompare(b.component));

  return { reports, synced: reached };
}

/**
 * Fetches and stores one model's aggregated complaints, returning whether NHTSA was reached. A
 * failed fetch records the attempt and leaves existing rows untouched.
 */
async function syncOwnerReports(db: Database, lookup: ComplaintLookup, now: Date): Promise<boolean> {
  const fetched = await fetchComponentReports(lookup);

  if (fetched === undefined) {
    await recordCheck(db, FEED, lookup, now, false);
    return false;
  }

  await db.transaction(async (tx) => {
    // Replaced wholesale rather than upserted: every value is derived from the feed, and a
    // clean replace takes the quote rows with it via cascade where an upsert would have to
    // reconcile them. The transaction means the list is never observably empty.
    await tx.delete(modelOwnerReports).where(modelMatches(modelOwnerReports, lookup));

    if (fetched.length > 0) {
      const inserted = await tx
        .insert(modelOwnerReports)
        .values(fetched.map((group) => ({ ...normaliseKey(lookup), ...toRow(group) })))
        .returning({ id: modelOwnerReports.id, component: modelOwnerReports.component });

      const byComponent = new Map(inserted.map((row) => [row.component, row.id]));
      const quotes = fetched.flatMap((group) => {
        const reportId = byComponent.get(group.component);
        if (!reportId) return [];
        return group.quotes.map((quote, position) => ({
          reportId,
          text: quote.text,
          incidentOn: quote.incidentOn ?? null,
          position,
        }));
      });

      if (quotes.length > 0) {
        await tx.insert(modelOwnerReportQuotes).values(quotes);
      }
    }

    await recordCheck(tx, FEED, lookup, now, true);
  });

  return true;
}

function toRow(group: ComponentReports) {
  return {
    component: group.component,
    reportCount: group.reportCount,
    crashCount: group.crashCount,
    fireCount: group.fireCount,
    injuryCount: group.injuryCount,
    deathCount: group.deathCount,
    latestIncidentOn: group.latestIncidentOn ?? null,
  };
}
