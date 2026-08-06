/**
 * Puts the manufacturer's service intervals onto one car's maintenance list, replacing the
 * generic figures the seed writes. See services/maintenanceSchedule.ts for the feed.
 *
 * WHEN IT RUNS: once per car, and never again. A factory schedule does not change, so the
 * question is not "is this stale?" but "has this car been asked about yet?" --
 * `vehicles.maintenance_schedule_checked_at` answers it. A car that has been asked costs
 * nothing to serve; one that has not costs a single metered call, ever.
 *
 * That marker is a column and not a look at `maintenance_items` for a reason worth keeping: the
 * seed writes intervals too, so a car with rows is not necessarily a car with the
 * manufacturer's rows. Inferring it from the data skipped every seeded vehicle for good.
 *
 * A TIMEOUT IS NOT AN ANSWER. Only a conclusive outcome sets the marker -- intervals returned,
 * or the vendor stating it has none for this car. An unreachable vendor is left unmarked and
 * retried, held off meanwhile by a short cooldown, because the first real attempt was lost to a
 * four-second response against an eight-second ceiling and a week of stale intervals is a steep
 * price for one slow moment.
 *
 * NOTHING IS EVER DELETED. `service_records.maintenance_item_id` points at these rows, so a
 * delete-and-rewrite would cut an owner's logged history loose. Known labels are updated in
 * place, unknown ones are appended, and anything the vendor does not mention -- an item the
 * owner added, or "Brake fluid flush", which VDB lists for no interval on this car -- is left
 * exactly as it was.
 *
 * WHY THE FAILURE COOLDOWN IS KEYED BY MODEL: whether a schedule exists at all is a fact about
 * the model, not the car, so one 2011 Pathfinder finding nothing spares every other one the
 * same wasted call. A success is deliberately NOT consulted for gating -- two owners of the
 * same model both need their own rows written, and blocking the second on the first's success
 * would leave their list on the generic numbers forever.
 */
import { asc, eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { maintenanceItems, vehicles } from '../db/schema.js';
import { fetchMaintenanceSchedule, type ScheduledJob } from './maintenanceSchedule.js';
import { readSyncState, recordCheck, type ModelKey } from './modelFeed.js';

const FEED = 'maintenance_schedule' as const;

/**
 * How long an UNREACHABLE vendor is left alone. Only transient failures land here now -- a car
 * the vendor has no schedule for is marked on the car itself and never asked about again -- so
 * this is a short backoff rather than a verdict's shelf life. An hour keeps a bad afternoon
 * from costing a call per page load without stranding a car for a week.
 */
const UNAVAILABLE_RETRY_MS = 60 * 60 * 1000;

/** The car this runs for. VIN identifies it to the vendor; the model keys the cooldown. */
export interface ScheduleTarget extends ModelKey {
  id: string;
  vin: string | null;
  /** Null means this car has never had a conclusive answer. See the header. */
  maintenanceScheduleCheckedAt: Date | null;
}

/**
 * Makes sure this car's maintenance intervals are the manufacturer's. Returns whether any row
 * was written, so a caller can re-read. Never throws -- a vendor that will not answer leaves
 * the existing list standing, which is the seed's generic figures rather than nothing.
 */
export async function ensureMaintenanceSchedule(
  db: Database,
  vehicle: ScheduleTarget,
  now: Date = new Date(),
): Promise<boolean> {
  // No VIN, nothing to ask about: the feed is VIN-keyed.
  if (!vehicle.vin) return false;
  // Already answered for this car, either way. The one call it gets has been spent.
  if (vehicle.maintenanceScheduleCheckedAt) return false;

  const sync = await readSyncState(db, FEED, vehicle);
  if (sync && !sync.succeededAt && now.getTime() - sync.checkedAt.getTime() < UNAVAILABLE_RETRY_MS) {
    return false;
  }

  const result = await fetchMaintenanceSchedule(vehicle.vin);

  if (result.outcome === 'unavailable') {
    // Not an answer. The car stays unmarked so it is asked again; only the cooldown advances.
    await recordCheck(db, FEED, vehicle, now, false);
    return false;
  }

  const jobs = result.outcome === 'ok' ? result.jobs : [];
  if (jobs.length > 0) await writeSchedule(db, vehicle.id, jobs);

  // Conclusive either way -- rows written, or this car genuinely has no published schedule.
  // Marked so neither outcome is paid for twice.
  await markChecked(db, vehicle.id, now);
  await recordCheck(db, FEED, vehicle, now, true);

  return jobs.length > 0;
}

/** Records that this car's one schedule lookup has happened. */
async function markChecked(db: Database, vehicleId: string, now: Date): Promise<void> {
  await db
    .update(vehicles)
    .set({ maintenanceScheduleCheckedAt: now })
    .where(eq(vehicles.id, vehicleId));
}

/**
 * Updates the intervals of jobs this car already lists and appends the ones it does not.
 *
 * Matched on a case-folded label because the two sides are authored separately -- the seed's
 * "Oil & filter" and a mapping's "Oil & filter" must not become two rows. `position` and
 * `intervalMonths` on an existing row are left alone: the first is the owner's ordering, and
 * the second is a time limit ("or 12 months") that this feed publishes no equivalent of, so
 * overwriting it with null would quietly drop a rule that still applies.
 */
async function writeSchedule(db: Database, vehicleId: string, jobs: ScheduledJob[]): Promise<void> {
  const existing = await db
    .select({
      id: maintenanceItems.id,
      label: maintenanceItems.label,
      position: maintenanceItems.position,
    })
    .from(maintenanceItems)
    .where(eq(maintenanceItems.vehicleId, vehicleId))
    .orderBy(asc(maintenanceItems.position));

  const byLabel = new Map(existing.map((row) => [row.label.trim().toLowerCase(), row]));
  let nextPosition = existing.reduce((max, row) => Math.max(max, row.position), -1) + 1;

  await db.transaction(async (tx) => {
    for (const job of jobs) {
      const match = byLabel.get(job.label.trim().toLowerCase());

      if (match) {
        await tx
          .update(maintenanceItems)
          .set({ intervalMiles: job.intervalMiles })
          .where(eq(maintenanceItems.id, match.id));
        continue;
      }

      await tx.insert(maintenanceItems).values({
        vehicleId,
        label: job.label,
        intervalMiles: job.intervalMiles,
        // Null, not a guess: the vendor publishes mileages only, and inventing a month figure
        // would make a job read as overdue on a car that is simply driven very little.
        intervalMonths: null,
        position: nextPosition,
      });
      nextPosition += 1;
    }
  });
}
