/**
 * Keeps the local mirror of repair pricing fresh. Same shape as recallSync.ts, on the same
 * machinery in modelFeed.ts. Two things differ, both because these feeds are metered
 * rather than free:
 *
 * ONE CALL PER MODEL, PER FEED. Both vendors bill per call, and each returns its whole
 * catalog for a vehicle in one response, so a sync prices everything at once and the
 * weekly window means one call per model per week rather than one per repair per page
 * load. Do not make either of these per-repair.
 *
 * FAILURE MUST NOT UNPRICE A CAR. `no_record` is cached as an answer; `unavailable`
 * (quota, bad key, timeout) records only the attempt, leaving prior rows standing.
 * Backwards, a spent quota shows no repairs for a week.
 *
 * TWO FEEDS, ONE ROW. Vehicle Databases supplies the money (services/repairPricing.ts)
 * and Open Labor Project the hours (services/laborTimes.ts), because neither publishes
 * both. Money is load-bearing and hours are decoration: a sync with no pricing writes
 * nothing, while a sync with pricing and no hours writes the benchmark with
 * `laborEstHours` null, which is what every row looked like before the second feed
 * existed. An hours outage therefore retains the hours already stored rather than
 * blanking them -- see `retainedHours`.
 */
import { and, eq, notInArray, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { benchmarkLaborTasks, benchmarkParts, repairBenchmarks, repairs } from '../db/schema.js';
import { fetchRepairPricing, type FetchedRepairBenchmark } from './repairPricing.js';
import { describeLaborSource, fetchLaborTimes, type LaborTimesResult } from './laborTimes.js';
import {
  dueForCheck,
  modelMatches,
  normaliseKey,
  readSyncState,
  recordCheck,
  type ModelKey,
} from './modelFeed.js';

const FEED = 'repair_pricing' as const;

/**
 * The model the captured pricing snapshot in db/fixtures.ts describes.
 *
 * THIS IS NOT A FALLBACK. DO NOT MAKE IT ONE. Its only job is telling the seed which
 * year/make/model those captured rows belong to. An earlier version used it to stand in
 * whenever the vendor could not price the owner's car, with the substitution noted in
 * `source`; provenance in the database does not undo a wrong number on the screen. A
 * 2011 Pathfinder judged against Civic brake pricing is a false answer, and it fails in
 * the direction that costs money -- Civic parts are cheaper, so a fair Pathfinder quote
 * reads as overpriced. Showing nothing is correct. See `pricedRepairIds`, `findBenchmark`.
 */
export const SNAPSHOT_MODEL: ModelKey = { year: 2019, make: 'HONDA', model: 'CIVIC' };

/**
 * Makes sure this model's pricing is as fresh as the policy requires. Returns whether
 * VDB has ever answered for this model -- the same `synced` signal the other feeds carry.
 */
export async function ensureRepairPricing(
  db: Database,
  lookup: ModelKey,
  now: Date = new Date(),
): Promise<boolean> {
  const sync = await readSyncState(db, FEED, lookup);

  let reached = sync?.succeededAt != null;
  if (dueForCheck(FEED, sync, now)) {
    reached = (await syncRepairPricing(db, lookup, now)) || reached;
  }

  return reached;
}

/**
 * Fetches and stores one model's pricing. Returns whether VDB was reached -- `no_record`
 * counts, because it is an answer about the vehicle.
 */
async function syncRepairPricing(db: Database, lookup: ModelKey, now: Date): Promise<boolean> {
  const result = await fetchRepairPricing(lookup);

  if (result.outcome === 'unavailable') {
    // Attempt clock only. Existing rows survive; see the header.
    await recordCheck(db, FEED, lookup, now, false);
    return false;
  }

  const benchmarks = result.outcome === 'ok' ? result.benchmarks : [];

  // Slugs are what VDB pricing is keyed on; repair ids are what the tables are. A slug
  // with no catalog row is skipped -- its benchmark would be unreachable from the picker.
  const repairIdBySlug = await loadRepairIds(db);

  const rows = benchmarks
    .map((benchmark) => {
      const repairId = repairIdBySlug.get(benchmark.slug);
      return repairId === undefined ? undefined : { repairId, benchmark };
    })
    .filter((row): row is { repairId: string; benchmark: FetchedRepairBenchmark } => row !== undefined);

  // Only worth an hours call when there is a priced row to hang the hours on. Skipping
  // saves a slot against an allowance of ten a day.
  const labor = rows.length > 0 ? await fetchLaborTimes(lookup) : ({ outcome: 'no_record' } as const);
  // Read once, and only when it can be needed: the prior hours are what an hours outage
  // falls back to, so they are not fetched when the vendor answered.
  const retained =
    labor.outcome === 'unavailable' ? await retainedHours(db, lookup) : new Map<string, string>();

  await db.transaction(async (tx) => {
    const keep = rows.map((row) => row.repairId);

    // Repairs VDB no longer prices lose their benchmark, so a retired price does not sit
    // next to current ones. Scoped to this model -- another car's rows are not ours.
    await tx
      .delete(repairBenchmarks)
      .where(
        keep.length > 0
          ? and(
              modelMatches(repairBenchmarks, lookup),
              notInArray(repairBenchmarks.repairId, keep),
            )
          : modelMatches(repairBenchmarks, lookup),
      );

    for (const { repairId, benchmark } of rows) {
      await upsertBenchmark(tx, lookup, repairId, benchmark, resolveLabor(labor, retained, repairId, benchmark.slug));
    }

    await recordCheck(tx, FEED, lookup, now, true);
  });

  return true;
}

/**
 * One repair's labor time as it will be stored: a `numeric(4,2)` string or null, plus the
 * provenance fragment that goes on `source`.
 */
interface ResolvedLabor {
  hours: string | null;
  note: string | undefined;
}

/**
 * Which hours to store for one repair.
 *
 * On an hours outage the figure already in the table is kept rather than blanked, so a
 * spent daily allowance does not strip book times off a car that had them. The provenance
 * says so, because a retained figure was priced against an older sync of the same vendor
 * and should not read as freshly confirmed.
 */
function resolveLabor(
  labor: LaborTimesResult,
  retained: Map<string, string>,
  repairId: string,
  slug: string,
): ResolvedLabor {
  if (labor.outcome === 'unavailable') {
    const hours = retained.get(repairId);
    return hours === undefined
      ? { hours: null, note: undefined }
      : { hours, note: `labor ${Number(hours)} h from Open Labor Project (retained, vendor unreachable)` };
  }

  const time = labor.outcome === 'ok' ? labor.times.get(slug) : undefined;
  // A vendor that answered without this job is an answer: no hours for this repair.
  if (!time) return { hours: null, note: undefined };

  return { hours: time.hours.toFixed(2), note: describeLaborSource(time) };
}

/**
 * The hours already stored for this model, keyed by repair. Only read on an hours outage;
 * see `resolveLabor`.
 */
async function retainedHours(db: Database, lookup: ModelKey): Promise<Map<string, string>> {
  const rows = await db
    .select({ repairId: repairBenchmarks.repairId, hours: repairBenchmarks.laborEstHours })
    .from(repairBenchmarks)
    .where(modelMatches(repairBenchmarks, lookup));

  return new Map(
    rows
      .filter((row): row is { repairId: string; hours: string } => row.hours !== null)
      .map((row) => [row.repairId, row.hours]),
  );
}

/**
 * Writes one benchmark and replaces its line items. The parent is upserted so its id
 * survives a re-sync; the children are deleted and rewritten, having no identity of their
 * own beyond their position.
 */
async function upsertBenchmark(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  lookup: ModelKey,
  repairId: string,
  benchmark: FetchedRepairBenchmark,
  labor: ResolvedLabor,
): Promise<void> {
  const source = describeSource(lookup, benchmark, labor);

  const [row] = await tx
    .insert(repairBenchmarks)
    .values({
      ...normaliseKey(lookup),
      repairId,
      partsTotal: benchmark.partsTotal,
      partsLow: benchmark.partsLow,
      partsHigh: benchmark.partsHigh,
      // Null, deliberately, even now that hours exist: neither vendor publishes a shop
      // rate, and VDB's labor dollars over these hours is not one. See laborTimes.ts.
      laborRatePerHour: null,
      laborEstHours: labor.hours,
      laborTotal: benchmark.laborTotal,
      fairTotalLow: benchmark.fairTotalLow,
      fairTotalHigh: benchmark.fairTotalHigh,
      ...recommendationFor(benchmark),
      source,
    })
    .onConflictDoUpdate({
      target: [
        repairBenchmarks.repairId,
        repairBenchmarks.year,
        repairBenchmarks.make,
        repairBenchmarks.model,
      ],
      set: {
        partsTotal: sql`excluded.parts_total`,
        partsLow: sql`excluded.parts_low`,
        partsHigh: sql`excluded.parts_high`,
        laborRatePerHour: sql`excluded.labor_rate_per_hour`,
        laborEstHours: sql`excluded.labor_est_hours`,
        laborTotal: sql`excluded.labor_total`,
        fairTotalLow: sql`excluded.fair_total_low`,
        fairTotalHigh: sql`excluded.fair_total_high`,
        source: sql`excluded.source`,
        // Recommendation copy is authored, not sourced, so a re-sync must not
        // overwrite an edited headline with a regenerated one.
      },
    })
    .returning({ id: repairBenchmarks.id });

  await tx.delete(benchmarkParts).where(eq(benchmarkParts.benchmarkId, row.id));
  await tx.delete(benchmarkLaborTasks).where(eq(benchmarkLaborTasks.benchmarkId, row.id));

  // A zero parts total is real -- VDB prices a tire rotation as pure labor -- but a
  // "$0 parts" line item is noise, so it is omitted rather than stored.
  if (benchmark.partsTotal > 0) {
    await tx.insert(benchmarkParts).values({
      benchmarkId: row.id,
      name: 'All parts for this repair',
      avgPrice: benchmark.partsTotal,
      position: 0,
    });
  }

  await tx.insert(benchmarkLaborTasks).values({
    benchmarkId: row.id,
    name: 'Shop labor for this repair',
    // The same figure as the parent's, not a second opinion: one aggregate labor line
    // means the task's duration and the benchmark's are the same number by definition.
    hours: labor.hours,
    position: 0,
  });
}

/** Every catalog slug's id, so a sync is one query rather than one per repair. */
async function loadRepairIds(db: Database): Promise<Map<string, string>> {
  const rows = await db.select({ id: repairs.id, slug: repairs.slug }).from(repairs);
  return new Map(rows.map((row) => [row.slug, row.id]));
}

/**
 * Human-readable provenance, stored on the row. See the schema comment. Names both feeds
 * when both contributed, so a row on screen can be traced to whichever vendor supplied
 * each half of it.
 */
function describeSource(
  lookup: ModelKey,
  benchmark: FetchedRepairBenchmark,
  labor: ResolvedLabor,
): string {
  const key = normaliseKey(lookup);
  const channels = benchmark.channels.length > 0 ? benchmark.channels.join(' + ') : 'no channel';
  const money = `Vehicle Databases "${benchmark.sourceTitle}" for ${key.year} ${key.make} ${key.model} (${channels})`;

  return labor.note === undefined ? money : `${money}; ${labor.note}`;
}

/**
 * Recommendation copy for a freshly-priced repair. Insert only -- the upsert above leaves
 * an existing row's copy alone. Deliberately mileage-free: the authored wireframe copy
 * names a specific odometer reading, and a synced row has no owner to speak about.
 *
 * NO LONGER REACHES AN OWNER. Until 10 August 2026 an assessment copied these three columns
 * onto itself, which is how every repair on every car came to carry one fixed sentence where a
 * judgement should have been. Assessments now write their own from services/necessityProse.ts,
 * and nothing reads the benchmark's copy. Kept because the columns are `not null` and dropping
 * them is its own migration -- but do not wire anything back to them.
 */
function recommendationFor(benchmark: FetchedRepairBenchmark) {
  return {
    recommendationHeadline: 'Priced for your car',
    recommendationBadge: 'ASSESSED',
    recommendationBody: `Typical cost for this repair, from real parts and labor pricing for your year, make and model. Compare a shop's quote against the range rather than the average -- ${benchmark.channels.includes('independent') ? 'independent shops sit at the low end and dealers at the high end' : 'these are dealer figures, so an independent shop may come in lower'}.`,
  };
}

/**
 * One repair's benchmark for one model. `undefined` when this car has no pricing, and
 * there is deliberately no fallback to another vehicle -- see SNAPSHOT_MODEL above. The
 * caller must decline rather than answer about a different car.
 */
export async function findBenchmark(
  db: Database,
  repairId: string,
  lookup: ModelKey,
): Promise<typeof repairBenchmarks.$inferSelect | undefined> {
  const [row] = await db
    .select()
    .from(repairBenchmarks)
    .where(and(eq(repairBenchmarks.repairId, repairId), modelMatches(repairBenchmarks, lookup)))
    .limit(1);

  return row;
}

/**
 * The catalog repairs priced for THIS model, and nothing else. An empty set is a
 * legitimate answer, and the picker must then explain rather than show another car's.
 */
export async function pricedRepairIds(db: Database, lookup: ModelKey): Promise<Set<string>> {
  const rows = await db
    .select({ repairId: repairBenchmarks.repairId })
    .from(repairBenchmarks)
    .where(modelMatches(repairBenchmarks, lookup));

  return new Set(rows.map((row) => row.repairId));
}
