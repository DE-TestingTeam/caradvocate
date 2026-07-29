/**
 * Whether an upkeep job is due.
 *
 * This is the whole of "scheduled maintenance": subtract the last time a job was
 * done from the interval it recurs on, and compare against today's odometer and
 * today's date. The previous version of this app stored a status instead, which
 * meant nothing kept it true and the seed had to write the answer into the label.
 *
 * Two rules carry most of the weight:
 *
 *   - With no interval, or nothing ever logged against the job, the answer is
 *     `unknown`. Not `ok`. There is no baseline to measure from, and an all-clear we
 *     cannot support is worse than admitting we do not know.
 *   - With both a mileage and a time interval, whichever falls first wins. That is
 *     how manufacturers write schedules ("every 10,000 miles or 12 months") and
 *     taking the later of the two would tell someone they are fine when they are a
 *     year overdue.
 */
import type { MaintenanceItem, MaintenanceStatus } from '@caradvocate/shared';

/** Inside this much of the due point, a job reads as due rather than fine. */
const SOON_MILES = 500;
const SOON_DAYS = 30;

export interface MaintenanceRow {
  id: string;
  label: string;
  intervalMiles: number | null;
  intervalMonths: number | null;
}

/** The most recent service logged against one job. */
export interface LastService {
  /** ISO yyyy-mm-dd. */
  date: string;
  mileage: number | null;
}

export interface DueContext {
  /** Today's odometer, from the vehicle record. */
  currentMileage: number;
  /** Injected so the calculation is testable without freezing the clock. */
  today: Date;
}

export function toMaintenanceItem(
  row: MaintenanceRow,
  last: LastService | undefined,
  context: DueContext,
): MaintenanceItem {
  const base: MaintenanceItem = {
    id: row.id,
    label: row.label,
    status: 'unknown',
    ...(row.intervalMiles != null ? { intervalMiles: row.intervalMiles } : {}),
    ...(row.intervalMonths != null ? { intervalMonths: row.intervalMonths } : {}),
    ...(last ? { lastServicedOn: last.date } : {}),
    ...(last?.mileage != null ? { lastServicedMileage: last.mileage } : {}),
  };

  const hasInterval = row.intervalMiles != null || row.intervalMonths != null;
  if (!hasInterval) return { ...base, unknownReason: 'no_interval' };
  if (!last) return { ...base, unknownReason: 'never_serviced' };

  // Each interval yields a verdict independently; the most urgent one stands, since
  // whichever falls first is what makes the job due.
  const verdicts: MaintenanceStatus[] = [];
  let dueAtMileage: number | undefined;
  let milesRemaining: number | undefined;
  let dueOn: string | undefined;

  if (row.intervalMiles != null && last.mileage != null) {
    dueAtMileage = last.mileage + row.intervalMiles;
    milesRemaining = dueAtMileage - context.currentMileage;
    verdicts.push(milesRemaining < 0 ? 'overdue' : milesRemaining <= SOON_MILES ? 'due_soon' : 'ok');
  }

  if (row.intervalMonths != null) {
    dueOn = addMonths(last.date, row.intervalMonths);
    const daysRemaining = daysBetween(context.today, dueOn);
    verdicts.push(daysRemaining < 0 ? 'overdue' : daysRemaining <= SOON_DAYS ? 'due_soon' : 'ok');
  }

  // A mileage interval with no recorded odometer at the last service leaves nothing
  // to measure -- the interval exists but the baseline does not.
  if (verdicts.length === 0) {
    return { ...base, unknownReason: 'never_serviced' };
  }

  return {
    ...base,
    status: mostUrgent(verdicts),
    ...(dueAtMileage != null ? { dueAtMileage } : {}),
    ...(milesRemaining != null ? { milesRemaining } : {}),
    ...(dueOn ? { dueOn } : {}),
  };
}

/** Sorts the list so anything wanting attention is at the top. */
export function byUrgency(a: MaintenanceItem, b: MaintenanceItem): number {
  const rank: Record<MaintenanceStatus, number> = { overdue: 0, due_soon: 1, unknown: 2, ok: 3 };
  return rank[a.status] - rank[b.status];
}

function mostUrgent(verdicts: MaintenanceStatus[]): MaintenanceStatus {
  if (verdicts.includes('overdue')) return 'overdue';
  if (verdicts.includes('due_soon')) return 'due_soon';
  return 'ok';
}

/**
 * Adds whole months to an ISO date, clamping the day.
 *
 * 31 January plus one month is 28 February, not 3 March -- letting Date roll over
 * would quietly move a due date into the following month.
 */
function addMonths(iso: string, months: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDayOfTargetMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  return target.toISOString().slice(0, 10);
}

/** Whole days from `today` to an ISO date; negative once it has passed. */
function daysBetween(today: Date, iso: string): number {
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const [year, month, day] = iso.split('-').map(Number);
  return Math.round((Date.UTC(year, month - 1, day) - start) / 86_400_000);
}
