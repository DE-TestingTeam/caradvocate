/**
 * The manufacturer's service schedule for one car, from Vehicle Databases' repair-estimates
 * feed. This is what replaces the hand-typed round numbers the seed used to write -- "oil
 * every 5,000 miles" was a reasonable guess, and a 2011 Pathfinder is actually on 7,500.
 *
 * WHY THIS ENDPOINT AND NOT `/vehicle-maintenance/v4`: the dedicated maintenance feed answers
 * "no records for this vehicle" for older cars (a 2011 Pathfinder included), while
 * repair-estimates carries the same schedule as a side effect of costing it. One call, and
 * the vehicle it describes is identified by VIN rather than model, so the trim is right too.
 *
 * WHAT IS DELIBERATELY IGNORED: every dollar figure in the response. Those are priced against
 * an assumed $55/hour, roughly half a real shop rate, so they must not reach the fair-price
 * verdict -- see the header of repairPricing.ts. Only mileages and task names are read here.
 *
 * FETCHED ONCE PER CAR, NEVER REFRESHED. A factory schedule is fixed for the life of the
 * model; there is nothing to go stale. `scheduleIsLoaded` is the whole of the freshness
 * policy, and it costs one metered call per vehicle ever.
 */
import { readData, requestVehicleDatabases } from './vehicleDatabases.js';

/**
 * VDB's task name -> our maintenance item label.
 *
 * Hand-written rather than derived from the vendor's strings, matching `REPAIR_TITLES` in
 * repairPricing.ts and for the same reason: the labels have to line up with rows the seed
 * already wrote, or a sync inserts "Change - Engine oil" beside the existing "Oil & filter"
 * and the owner sees the same job twice. Two VDB tasks map onto one label here -- engine oil
 * and its filter are one job to an owner and one row in our table.
 *
 * `Inspect - ...` tasks are all absent on purpose. VDB lists twelve of them for this car
 * (cruise control, exhaust, fuel lines, differential fluid). They are things a mechanic looks
 * at during a service, not jobs an owner schedules or logs, and adding twelve rows nobody can
 * act on would bury the five that matter.
 */
const SCHEDULE_LABELS: Readonly<Record<string, string>> = {
  'Change - Engine oil': 'Oil & filter',
  'Replace - Oil filter': 'Oil & filter',
  'Rotate - Wheels & tires': 'Tyre rotation',
  'Replace - Cabin air filter': 'Cabin air filter',
  'Replace - Air filter': 'Engine air filter',
  'Flush/replace - Coolant': 'Coolant flush',
  'Replace - Spark plugs': 'Spark plugs',
};

/** One upkeep job and how often this car's maker wants it done. */
export interface ScheduledJob {
  label: string;
  intervalMiles: number;
}

export type MaintenanceScheduleResult =
  | { outcome: 'ok'; jobs: ScheduledJob[] }
  | { outcome: 'no_record' }
  | { outcome: 'unavailable' };

/**
 * Measured at 3.7-4.1 seconds for a 28KB response, so the shared eight-second ceiling sat one
 * slow moment away from recording a working vendor as an outage -- which is exactly what it did
 * on the first real attempt. Generous because this runs once per car in its lifetime: there is
 * no throughput to protect, and a wrong answer here costs an owner a week of stale intervals.
 */
const SCHEDULE_TIMEOUT_MS = 20_000;

/** The schedule for one VIN. Never throws; see vehicleDatabases.ts for the outcomes. */
export async function fetchMaintenanceSchedule(vin: string): Promise<MaintenanceScheduleResult> {
  const result = await requestVehicleDatabases(
    `/repair-estimates/${encodeURIComponent(vin)}`,
    SCHEDULE_TIMEOUT_MS,
  );
  if (result.outcome !== 'ok') return result;

  const jobs = parseMaintenanceSchedule(result.body);
  // An unreadable success envelope is an unexpected shape, not a car with no schedule.
  if (jobs === undefined) return { outcome: 'unavailable' };

  return { outcome: 'ok', jobs };
}

/**
 * Exported for testing. VDB returns
 * `{ data: { data: [ { mileage, items: [ { parts: [{type}], labor: [{type}] } ] } ] } }`
 * -- one entry per service interval, each listing the tasks due at that mileage.
 *
 * `undefined` means the body was not the shape we expect. An empty array means it was, and
 * held none of the tasks we track.
 */
export function parseMaintenanceSchedule(body: unknown): ScheduledJob[] | undefined {
  const data = readData(body);
  if (!data) return undefined;

  const intervals = data.data;
  if (!Array.isArray(intervals)) return undefined;

  // Every mileage each label appears at, so the interval can be read off the spacing.
  const mileagesByLabel = new Map<string, Set<number>>();

  for (const interval of intervals) {
    if (!interval || typeof interval !== 'object' || Array.isArray(interval)) continue;
    const record = interval as Record<string, unknown>;

    const mileage = readMileage(record.mileage);
    if (mileage === undefined) continue;

    for (const label of labelsAt(record.items)) {
      const seen = mileagesByLabel.get(label) ?? new Set<number>();
      seen.add(mileage);
      mileagesByLabel.set(label, seen);
    }
  }

  const jobs: ScheduledJob[] = [];
  for (const [label, mileages] of mileagesByLabel) {
    const intervalMiles = intervalFrom(mileages);
    if (intervalMiles !== undefined) jobs.push({ label, intervalMiles });
  }

  // Shortest interval first: the jobs that come round most often are the ones an owner is
  // most often due for, and this becomes the `position` the list is ordered by.
  jobs.sort((a, b) => a.intervalMiles - b.intervalMiles || a.label.localeCompare(b.label));

  return jobs;
}

/** Our labels for every task listed at one interval, across both parts and labor lines. */
function labelsAt(rawItems: unknown): Set<string> {
  const labels = new Set<string>();
  if (!Array.isArray(rawItems)) return labels;

  for (const item of rawItems) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;

    // Both lists are read: a part-only line (oil) and a labor-only line (tyre rotation) are
    // both real jobs, and a job with both would otherwise be counted from one list only.
    for (const key of ['parts', 'labor'] as const) {
      const lines = record[key];
      if (!Array.isArray(lines)) continue;

      for (const line of lines) {
        if (!line || typeof line !== 'object' || Array.isArray(line)) continue;
        const type = (line as Record<string, unknown>).type;
        if (typeof type !== 'string') continue;

        const label = SCHEDULE_LABELS[type.trim()];
        if (label !== undefined) labels.add(label);
      }
    }
  }

  return labels;
}

/**
 * The recurrence read off the mileages a job appears at. The SMALLEST gap, not the average: a
 * job that also falls inside a larger service is listed at both, and averaging those spacings
 * would report the job as due less often than it is.
 *
 * THIS IS THE RECURRENCE, NOT THE FIRST DUE POINT, and for some jobs those differ. Nissan wants
 * the Pathfinder's coolant done at 60,000 and then every 30,000, so this returns 30,000 and
 * says nothing about the 60,000. That is fine for how the figure is used and would not be if it
 * changed: `maintenanceDue` measures from the owner's last logged service, and answers
 * `unknown` when nothing has been logged, so the first-ever due point is never computed from
 * this number. Anything that starts predicting a first service from a zero baseline needs the
 * earliest mileage kept as well.
 *
 * A job listed once -- spark plugs, at 105,000 -- is taken to recur at that mileage. A guess,
 * but the safe one: it brings the job round rather than never.
 */
function intervalFrom(mileages: Set<number>): number | undefined {
  const sorted = [...mileages].sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  if (sorted.length === 1) return sorted[0];

  let smallest = Infinity;
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > 0 && gap < smallest) smallest = gap;
  }

  return Number.isFinite(smallest) ? smallest : sorted[0];
}

/** Mileage as a positive whole number. VDB sends it as a string ("7500"). */
function readMileage(raw: unknown): number | undefined {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value);
}
