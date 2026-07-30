/**
 * Everything known about one owner's car, as text for the model to reason over.
 *
 * This is what separates a grounded answer from a plausible one. Asked "my brakes
 * feel spongy", a model with no context can only recite general advice; a model
 * holding this block can say that six owners of this exact model reported brake
 * problems around 26,000 miles, that one involved a crash, and that the owner's own
 * brake service was 8,000 miles ago.
 *
 * Two deliberate choices:
 *
 *   - **Text, not JSON.** Cheaper in tokens and the model reads it just as well.
 *   - **Provenance travels with every fact.** Each section says where it came from
 *     and what it cannot support, because the model has to be able to tell the owner
 *     the difference between an NHTSA recall and an unverified complaint. Stripping
 *     the provenance to save tokens would remove exactly what stops it overclaiming.
 */
import { desc, eq } from 'drizzle-orm';
import type { MaintenanceItem } from '@caradvocate/shared';
import type { Database } from '../db/index.js';
import {
  modelOwnerReportQuotes,
  modelOwnerReports,
  serviceRecords,
  vehicleRecallStatus,
  vehicles,
} from '../db/schema.js';
import { getOwnerReports } from './complaintSync.js';
import { loadMaintenanceItems } from './maintenanceDue.js';
import { modelMatches, type ModelKey } from './modelFeed.js';
import { getModelRecalls } from './recallSync.js';
import { getModelSafetyRatings } from './safetyRatingSync.js';

type Vehicle = typeof vehicles.$inferSelect;

/**
 * How many owner accounts to include per component. Enough to be useful, not a wall.
 *
 * Fewer than complaints.ts stores per component: everything here competes for the
 * model's attention against the recalls and the upkeep schedule.
 */
const QUOTES_IN_PROMPT = 2;

/**
 * How many complaint components to describe, most-reported first.
 *
 * Matches MAX_REPORTED_ISSUES on the known-issues endpoint deliberately: the model
 * should be reasoning over the same list the owner is looking at.
 */
const COMPONENTS_IN_PROMPT = 8;

/** Recent history only -- an owner's full service record can run to dozens of rows. */
const HISTORY_LIMIT = 8;

export async function buildVehicleContext(db: Database, vehicle: Vehicle): Promise<string> {
  const model: ModelKey = { year: vehicle.year, make: vehicle.make, model: vehicle.model };

  const [recalls, reports, safety, jobs, history] = await Promise.all([
    getModelRecalls(db, model),
    getOwnerReports(db, model),
    getModelSafetyRatings(db, model),
    loadMaintenanceItems(db, vehicle),
    db
      .select()
      .from(serviceRecords)
      .where(eq(serviceRecords.vehicleId, vehicle.id))
      .orderBy(desc(serviceRecords.serviceDate))
      .limit(HISTORY_LIMIT),
  ]);

  const ownerStatus = await db
    .select()
    .from(vehicleRecallStatus)
    .where(eq(vehicleRecallStatus.vehicleId, vehicle.id));
  const repairedBy = new Map(ownerStatus.map((row) => [row.campaignNumber, row.repaired]));

  const quotes = reports.reports.length ? await loadQuotes(db, model) : new Map<string, string[]>();

  const sections = [
    `THE CAR
${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ''}
Odometer: ${vehicle.mileage.toLocaleString('en-US')} miles${vehicle.mileage <= 1 ? ' (looks like a placeholder -- treat the odometer as unknown)' : ''}
VIN on file: ${vehicle.vin ? 'yes' : 'no'}`,

    recallSection(recalls, repairedBy),
    knownIssuesSection(reports, quotes),
    safetySection(safety),
    maintenanceSection(jobs),
    historySection(history),
  ];

  return sections.join('\n\n');
}

function recallSection(
  recalls: Awaited<ReturnType<typeof getModelRecalls>>,
  repairedBy: Map<string, boolean>,
): string {
  if (!recalls.synced) {
    return 'SAFETY RECALLS\nNHTSA could not be reached, so recalls are unknown for this car. This is NOT an all-clear -- say so if it comes up.';
  }
  if (recalls.recalls.length === 0) {
    return 'SAFETY RECALLS\nNone issued for this year/make/model. This one you can state plainly.';
  }

  const lines = recalls.recalls.map((recall) => {
    const repaired = repairedBy.get(recall.campaignNumber);
    const status =
      repaired === true
        ? 'the owner says this was already repaired'
        : repaired === false
          ? 'the owner says this is still outstanding'
          : 'the owner has not said whether this was repaired';
    const urgency = recall.parkIt
      ? ' [NHTSA SAYS STOP DRIVING]'
      : recall.parkOutside
        ? ' [NHTSA SAYS PARK OUTSIDE]'
        : '';
    return `- ${recall.campaignNumber} ${recall.component}${urgency}: ${recall.consequence} Remedy: ${recall.remedy} (${status})`;
  });

  return `SAFETY RECALLS -- official NHTSA campaigns for this year/make/model. Repairs are free at a dealer.
NHTSA reports these per model and cannot say whether THIS car was repaired; only the owner's own answer settles that.
${lines.join('\n')}`;
}

function knownIssuesSection(
  reports: Awaited<ReturnType<typeof getOwnerReports>>,
  quotes: Map<string, string[]>,
): string {
  if (!reports.synced) {
    return 'WHAT OWNERS REPORT\nNHTSA complaint data could not be loaded. Do not treat that as "no known problems".';
  }
  if (reports.reports.length === 0) {
    return 'WHAT OWNERS REPORT\nNo complaints filed with NHTSA for this year/make/model.';
  }

  const lines = reports.reports.slice(0, COMPONENTS_IN_PROMPT).map((row) => {
    const harms = [
      row.deathCount ? `${row.deathCount} death` : '',
      row.injuryCount ? `${row.injuryCount} injured` : '',
      row.crashCount ? `${row.crashCount} crash` : '',
      row.fireCount ? `${row.fireCount} fire` : '',
    ]
      .filter(Boolean)
      .join(', ');

    const mileage =
      row.mileageLowMi != null && row.mileageHighMi != null
        ? ` Reported between ${row.mileageLowMi.toLocaleString('en-US')} and ${row.mileageHighMi.toLocaleString('en-US')} miles (from ${row.mileageSampleCount} of them).`
        : '';

    const said = quotes.get(row.component)?.map((q) => `    "${q}"`).join('\n');

    return `- ${row.component}: ${row.reportCount} reports${harms ? ` (${harms})` : ''}.${mileage}${said ? `\n${said}` : ''}`;
  });

  return `WHAT OWNERS REPORT -- complaints filed with NHTSA about this year/make/model.
These are unverified first-hand accounts, NOT confirmed faults, and not proof this car will develop the same problem. Say so when you use them.
${lines.join('\n')}`;
}

/**
 * Crash-test results, which answer a question the other sections cannot.
 *
 * Recalls and complaints are both about things going *wrong* with a specific car.
 * This is the only section describing how the model performs when the worst happens,
 * and it is what lets the model answer "is this a safe car for my daughter" with a
 * figure instead of a platitude.
 *
 * Untested is stated as untested. Most pre-2011 vehicles carry "Not Rated" on every
 * field, and a model that treated a missing star rating as a bad one would tell an
 * owner their car failed a test nobody ran.
 */
function safetySection(safety: Awaited<ReturnType<typeof getModelSafetyRatings>>): string {
  if (!safety.synced) {
    return 'CRASH TEST RATINGS\nNHTSA could not be reached, so crash-test results are unknown. Not a sign the car did badly.';
  }
  if (safety.variants.length === 0) {
    return 'CRASH TEST RATINGS\nNHTSA has not crash-tested this year/make/model. That means untested, NOT unsafe -- say it that way if it comes up.';
  }

  const lines = safety.variants.map((row) => {
    const stars = [
      row.overallRating ? `${row.overallRating}/5 overall` : 'no overall rating',
      row.frontCrashRating ? `${row.frontCrashRating}/5 front` : '',
      row.sideCrashRating ? `${row.sideCrashRating}/5 side` : '',
      row.rolloverRating ? `${row.rolloverRating}/5 rollover` : '',
    ]
      .filter(Boolean)
      .join(', ');

    const rollover = row.rolloverPossibility
      ? ` Rollover chance in a single-vehicle crash: ${(Number(row.rolloverPossibility) * 100).toFixed(1)}%.`
      : '';

    // Fitment is worth carrying because it is actionable in a way stars are not: an
    // owner whose trim lists automatic braking as optional can check whether theirs
    // has it, and one whose model never offered it knows not to look.
    const assists = [
      describeAssist('automatic emergency braking / forward collision warning', row.forwardCollisionWarning),
      describeAssist('lane departure warning', row.laneDepartureWarning),
      describeAssist('electronic stability control', row.electronicStabilityControl),
    ]
      .filter(Boolean)
      .join('; ');

    return `- ${row.description}: ${stars}.${rollover}${assists ? `\n    Driver aids: ${assists}.` : ''}`;
  });

  return `CRASH TEST RATINGS -- NHTSA's own 5-star crash tests for this year/make/model. Stars are out of 5; more is better.
NHTSA tests each body style and drivetrain separately, so several versions of one model can score differently. These are results for the MODEL, not an inspection of this car.
Driver-aid fitment is what NHTSA recorded for the tested version; the owner's own trim may differ, so tell them to check rather than asserting their car has it.
${lines.join('\n')}`;
}

function describeAssist(label: string, fitment: string | null): string {
  if (fitment === 'standard') return `${label} was standard`;
  if (fitment === 'optional') return `${label} was optional`;
  if (fitment === 'no') return `${label} was not offered`;
  return '';
}

function maintenanceSection(jobs: MaintenanceItem[]): string {
  if (jobs.length === 0) {
    return 'UPKEEP SCHEDULE\nThe owner has not set up any upkeep jobs, so nothing is being tracked. Do not invent service intervals for this model -- the manufacturer schedule is licensed data this app does not have.';
  }

  const lines = jobs.map((job) => {
    const interval = [
      job.intervalMiles ? `every ${job.intervalMiles.toLocaleString('en-US')} mi` : '',
      job.intervalMonths ? `every ${job.intervalMonths} months` : '',
    ]
      .filter(Boolean)
      .join(' or ');
    const last = job.lastServicedMileage
      ? `last done at ${job.lastServicedMileage.toLocaleString('en-US')} mi`
      : job.lastServicedOn
        ? `last done ${job.lastServicedOn}`
        : 'never logged';
    const due = job.dueAtMileage ? `, due at ${job.dueAtMileage.toLocaleString('en-US')} mi` : '';
    return `- ${job.label} [${job.status}]: ${interval || 'no interval set'}, ${last}${due}`;
  });

  return `UPKEEP SCHEDULE -- intervals the OWNER set, not the manufacturer's schedule. Status is computed from the interval, the last logged service and the odometer.
${lines.join('\n')}`;
}

function historySection(history: (typeof serviceRecords.$inferSelect)[]): string {
  if (history.length === 0) {
    return 'SERVICE HISTORY\nNothing logged. That means no work has been recorded here, not that no work was done.';
  }

  const lines = history.map(
    (row) =>
      `- ${row.serviceDate}: ${row.description}, $${row.cost}${row.mileageAtService ? ` at ${row.mileageAtService.toLocaleString('en-US')} mi` : ' (no odometer recorded)'}`,
  );

  return `SERVICE HISTORY -- what the owner logged in this app. Incomplete by nature; work done before they started using it is absent.
${lines.join('\n')}`;
}

/** A couple of owner accounts per component, for colour the counts cannot give. */
async function loadQuotes(db: Database, model: ModelKey) {
  const rows = await db
    .select({
      component: modelOwnerReports.component,
      text: modelOwnerReportQuotes.text,
      position: modelOwnerReportQuotes.position,
    })
    .from(modelOwnerReports)
    .innerJoin(modelOwnerReportQuotes, eq(modelOwnerReportQuotes.reportId, modelOwnerReports.id))
    .where(modelMatches(modelOwnerReports, model));

  const byComponent = new Map<string, string[]>();
  for (const row of [...rows].sort((a, b) => a.position - b.position)) {
    const list = byComponent.get(row.component) ?? [];
    if (list.length < QUOTES_IN_PROMPT) list.push(row.text);
    byComponent.set(row.component, list);
  }
  return byComponent;
}
