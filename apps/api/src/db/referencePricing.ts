/**
 * Writes the repair catalog and the snapshot model's pricing. The figures are real vendor
 * pricing for ONE car (a 2019 Civic) and are stored against that model only -- nothing
 * falls back to them. See services/repairPricingSync.ts.
 *
 * Shared by two callers that must not diverge: `db:seed`, which rebuilds a demo database
 * from nothing, and `db:pricing`, which refreshes these figures on a database holding real
 * accounts. Separate from the seed because `seed()` truncates `users` and refuses to run
 * against a database somebody has signed up to, which left no way to get corrected pricing
 * onto the live databases.
 *
 * Everything here is therefore an upsert keyed on natural identity -- a repair by slug, a
 * benchmark by (repair, model) -- so nothing referenced by an assessment is deleted and a
 * second run leaves the same result as the first.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from './index.js';
import * as t from './schema.js';
import { referenceBenchmarks, unpricedRepairs } from './fixtures.js';
import { normaliseKey, type ModelKey } from '../services/modelFeed.js';

/** What a run changed, so the script can report it rather than claim success blindly. */
export interface PricingWriteReport {
  repairsInserted: number;
  benchmarksWritten: number;
  benchmarksRemoved: number;
}

/**
 * Writes the catalog and the reference model's benchmarks. Returns every catalog repair's
 * id by slug, which the seed needs for the demo assessments it builds afterwards.
 */
export async function writeReferencePricing(
  db: Database,
  snapshotModel: ModelKey,
  now: Date = new Date(),
): Promise<{ repairIdBySlug: Map<string, string>; report: PricingWriteReport }> {
  const snapshotKey = normaliseKey(snapshotModel);
  const report: PricingWriteReport = {
    repairsInserted: 0,
    benchmarksWritten: 0,
    benchmarksRemoved: 0,
  };

  const repairIdBySlug = new Map<string, string>();

  // The catalog: priced repairs first, in picker order, then the unpriced ones.
  const catalog = [
    ...referenceBenchmarks.map((row) => ({ slug: row.slug, name: row.name })),
    ...unpricedRepairs,
  ];

  for (const [position, row] of catalog.entries()) {
    // Upserted on slug so an existing repair keeps its id: assessments reference it, and a
    // delete-and-reinsert would null those out through the FK's ON DELETE.
    const [repair] = await db
      .insert(t.repairs)
      .values({ slug: row.slug, name: row.name, position })
      .onConflictDoUpdate({
        target: t.repairs.slug,
        set: { name: row.name, position },
      })
      .returning({ id: t.repairs.id, inserted: t.repairs.id });

    if (!repairIdBySlug.has(row.slug)) report.repairsInserted += 1;
    repairIdBySlug.set(row.slug, repair.id);
  }

  for (const seedRow of referenceBenchmarks) {
    const repairId = repairIdBySlug.get(seedRow.slug);
    if (!repairId) continue;

    const [benchmark] = await db
      .insert(t.repairBenchmarks)
      .values({
        repairId,
        ...snapshotKey,
        partsTotal: seedRow.partsTotal,
        partsLow: seedRow.partsLow,
        partsHigh: seedRow.partsHigh,
        // Null, deliberately. The vendor publishes no book times; see fixtures.ts.
        laborRatePerHour: null,
        laborEstHours: null,
        laborTotal: seedRow.laborTotal,
        fairTotalLow: seedRow.fairTotalLow,
        fairTotalHigh: seedRow.fairTotalHigh,
        recommendationHeadline: seedRow.recommendation.headline,
        recommendationBadge: seedRow.recommendation.badge,
        recommendationBody: seedRow.recommendation.body,
        source: sourceLabel(seedRow.sourceTitle, snapshotKey, seedRow.channels),
      })
      .onConflictDoUpdate({
        target: [
          t.repairBenchmarks.repairId,
          t.repairBenchmarks.year,
          t.repairBenchmarks.make,
          t.repairBenchmarks.model,
        ],
        set: {
          partsTotal: seedRow.partsTotal,
          partsLow: seedRow.partsLow,
          partsHigh: seedRow.partsHigh,
          laborRatePerHour: null,
          laborEstHours: null,
          laborTotal: seedRow.laborTotal,
          fairTotalLow: seedRow.fairTotalLow,
          fairTotalHigh: seedRow.fairTotalHigh,
          // Overwritten here, unlike in the live sync: these rows carry figures a migration
          // backfilled as placeholders, so stale copy beside corrected numbers would drift.
          recommendationHeadline: seedRow.recommendation.headline,
          recommendationBadge: seedRow.recommendation.badge,
          recommendationBody: seedRow.recommendation.body,
          source: sourceLabel(seedRow.sourceTitle, snapshotKey, seedRow.channels),
        },
      })
      .returning({ id: t.repairBenchmarks.id });

    report.benchmarksWritten += 1;

    // Children have no identity beyond their position, so they are replaced whole.
    await db.delete(t.benchmarkParts).where(eq(t.benchmarkParts.benchmarkId, benchmark.id));
    await db.delete(t.benchmarkLaborTasks).where(eq(t.benchmarkLaborTasks.benchmarkId, benchmark.id));

    // One aggregate row, and none at all when the vendor prices the job as pure labor.
    if (seedRow.partsTotal > 0) {
      await db.insert(t.benchmarkParts).values({
        benchmarkId: benchmark.id,
        name: 'All parts for this repair',
        avgPrice: seedRow.partsTotal,
        position: 0,
      });
    }

    await db.insert(t.benchmarkLaborTasks).values({
      benchmarkId: benchmark.id,
      name: 'Shop labor for this repair',
      hours: null,
      position: 0,
    });
  }

  /*
   * Drops reference benchmarks for repairs that must not be priced -- the one destructive
   * step, and the point of the exercise on an already-migrated database. Migration 0013
   * backfills every pre-existing placeholder row as this model, including the repair the
   * vendor does not price, so left alone `timing-belt-inspection` keeps an invented
   * $200-$380 range and stays in the picker.
   */
  const unpricedIds = unpricedRepairs
    .map((row) => repairIdBySlug.get(row.slug))
    .filter((id): id is string => id !== undefined);

  if (unpricedIds.length > 0) {
    const removed = await db
      .delete(t.repairBenchmarks)
      .where(
        and(
          inArray(t.repairBenchmarks.repairId, unpricedIds),
          eq(t.repairBenchmarks.year, snapshotKey.year),
          eq(t.repairBenchmarks.make, snapshotKey.make),
          eq(t.repairBenchmarks.model, snapshotKey.model),
        ),
      )
      .returning({ id: t.repairBenchmarks.id });

    report.benchmarksRemoved = removed.length;
  }

  // Recorded as a successful check, so a freshly-written database does not spend a metered
  // vendor call re-fetching the model it was just given.
  await db
    .insert(t.modelFeedSyncs)
    .values({ feed: 'repair_pricing', ...snapshotKey, checkedAt: now, succeededAt: now })
    .onConflictDoUpdate({
      target: [
        t.modelFeedSyncs.feed,
        t.modelFeedSyncs.year,
        t.modelFeedSyncs.make,
        t.modelFeedSyncs.model,
      ],
      set: { checkedAt: now, succeededAt: now },
    });

  return { repairIdBySlug, report };
}

function sourceLabel(title: string, key: ModelKey, channels: string[]): string {
  return `Vehicle Databases "${title}" for ${key.year} ${key.make} ${key.model} (${channels.join(' + ')})`;
}
