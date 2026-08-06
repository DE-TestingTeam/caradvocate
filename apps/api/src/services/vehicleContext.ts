/**
 * Everything known about one owner's car, as text for the model to reason over -- what
 * separates a grounded answer from a plausible one.
 *
 * Text rather than JSON: cheaper in tokens and the model reads it just as well. Provenance
 * travels with every fact, because the model has to be able to tell the owner an NHTSA
 * recall from an unverified complaint; stripping it to save tokens would remove exactly
 * what stops it overclaiming.
 */
import { asc, desc, eq } from 'drizzle-orm';
import type { ChatSource, MaintenanceItem } from '@caradvocate/shared';
import type { Database } from '../db/index.js';
import {
  modelOwnerReportQuotes,
  modelOwnerReports,
  repairs,
  serviceRecords,
  vehicleRecallStatus,
  vehicles,
} from '../db/schema.js';
import { getOwnerReports } from './complaintSync.js';
import { loadMaintenanceItems } from './maintenanceDue.js';
import { modelMatches, type ModelKey } from './modelFeed.js';
import { getModelRecalls } from './recallSync.js';
import { pricedRepairIds } from './repairPricingSync.js';

type Vehicle = typeof vehicles.$inferSelect;

/**
 * How many owner accounts per component. Fewer than complaints.ts stores, since everything
 * here competes for the model's attention against the recalls and the upkeep schedule.
 */
const QUOTES_IN_PROMPT = 2;

/**
 * How many complaint components to describe, most-reported first. Matches
 * MAX_REPORTED_ISSUES on the known-issues endpoint, so the model reasons over the same list
 * the owner is looking at.
 */
const COMPONENTS_IN_PROMPT = 8;

/** Recent history only -- an owner's full service record can run to dozens of rows. */
const HISTORY_LIMIT = 8;

/**
 * The facts block, plus what is actually in it.
 *
 * `sources` is the authoritative list of what the answer *could* have drawn on, labelled with
 * real counts. Ask CA picks from it; it cannot add to it. Built here rather than in askClaude
 * because this is the only place that knows what the block ended up containing.
 */
export interface VehicleContext {
  text: string;
  sources: ChatSource[];
  /**
   * The repair catalogue as this owner would see it. Carried so a CTA can be resolved: the
   * assistant names a repair, and parseReply matches that name against this list to get an id.
   * It never receives an id and so cannot invent one.
   */
  repairs: CatalogueEntry[];
}

export interface CatalogueEntry {
  id: string;
  name: string;
  /** Whether we hold pricing for this repair on THIS car. Never substituted from another. */
  priced: boolean;
}

export async function buildVehicleContext(db: Database, vehicle: Vehicle): Promise<VehicleContext> {
  const model: ModelKey = { year: vehicle.year, make: vehicle.make, model: vehicle.model };

  // All six in one round of queries. This runs on every Ask CA message, so a chain of awaits
  // here is latency the owner waits through before the model has even been called. Quotes are
  // fetched unconditionally rather than after checking whether there are any complaints: the
  // query is cheap, and gating it on an earlier result is what made it sequential.
  const [recalls, reports, jobs, history, ownerStatus, quotes, catalogue, priced] = await Promise.all([
    getModelRecalls(db, model),
    getOwnerReports(db, model),
    loadMaintenanceItems(db, vehicle),
    db
      .select()
      .from(serviceRecords)
      .where(eq(serviceRecords.vehicleId, vehicle.id))
      .orderBy(desc(serviceRecords.serviceDate))
      .limit(HISTORY_LIMIT),
    db.select().from(vehicleRecallStatus).where(eq(vehicleRecallStatus.vehicleId, vehicle.id)),
    loadQuotes(db, model),
    db.select().from(repairs).orderBy(asc(repairs.position)),
    // Read, not synced. GET /api/repairs calls ensureRepairPricing and may reach the vendor;
    // doing that here would put a third-party request on the path of every chat message. An
    // owner who has not opened the checker yet simply sees nothing marked as priced.
    pricedRepairIds(db, model),
  ]);

  const repairedBy = new Map(ownerStatus.map((row) => [row.campaignNumber, row.repaired]));

  const sections = [
    `THE CAR
${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ''}
Odometer: ${vehicle.mileage.toLocaleString('en-US')} miles${vehicle.mileage <= 1 ? ' (looks like a placeholder -- treat the odometer as unknown)' : ''}
VIN on file: ${vehicle.vin ? 'yes' : 'no'}`,

    recallSection(recalls, repairedBy),
    knownIssuesSection(reports, quotes),
    maintenanceSection(jobs),
    historySection(history),
    repairSection(catalogue, priced),
  ];

  return {
    text: sections.join('\n\n'),
    sources: describeSources(vehicle, recalls, reports, jobs, history.length),
    repairs: catalogue.map((row) => ({ id: row.id, name: row.name, priced: priced.has(row.id) })),
  };
}

/**
 * The repairs the Repair Cost Checker offers, so a cost question can be handed over with the
 * right one already chosen rather than dropping the owner on an empty form.
 *
 * Names only, no figures: the checker holds the pricing and this block deliberately does not,
 * which is what keeps "I cannot quote you a number" true. The priced flag is here so the
 * assistant can be honest about coverage without promising an outcome.
 */
function repairSection(catalogue: (typeof repairs.$inferSelect)[], priced: Set<string>): string {
  if (catalogue.length === 0) return 'REPAIRS THE COST CHECKER COVERS\nNone configured.';

  const lines = catalogue.map(
    (row) => `- ${row.name}${priced.has(row.id) ? '' : ' (no pricing held for this car yet)'}`,
  );

  return `REPAIRS THE COST CHECKER COVERS -- the jobs the owner can run a quote against. No prices here; the checker holds those and you do not.
${lines.join('\n')}`;
}

/**
 * What the block actually ended up holding, in a fixed order so the row under an answer does
 * not reshuffle between turns.
 *
 * A section that could not be loaded is deliberately absent rather than listed as unknown: this
 * summarises what an answer stood on, and "NHTSA could not be reached" is not something an
 * answer stood on. The facts block still says so in words, which is where it belongs.
 */
function describeSources(
  vehicle: Vehicle,
  recalls: Awaited<ReturnType<typeof getModelRecalls>>,
  reports: Awaited<ReturnType<typeof getOwnerReports>>,
  jobs: MaintenanceItem[],
  historyCount: number,
): ChatSource[] {
  const sources: ChatSource[] = [
    { kind: 'vehicle', label: `Your ${vehicle.year} ${vehicle.make} ${vehicle.model}` },
  ];

  if (recalls.synced && recalls.recalls.length > 0) {
    sources.push({
      kind: 'recalls',
      label: `${plural(recalls.recalls.length, 'NHTSA recall')} for this model`,
    });
  }

  if (reports.synced && reports.reports.length > 0) {
    // Summed over the components the block actually described, not every component on file,
    // so the number the owner reads matches what the answer could have used.
    const shown = reports.reports.slice(0, COMPONENTS_IN_PROMPT);
    const total = shown.reduce((sum, row) => sum + row.reportCount, 0);
    sources.push({
      kind: 'owner_reports',
      label: `${total.toLocaleString('en-US')} owner reports for this model`,
    });
  }

  if (jobs.length > 0) {
    sources.push({ kind: 'upkeep', label: `Your upkeep schedule (${jobs.length} jobs)` });
  }

  if (historyCount > 0) {
    sources.push({
      kind: 'service_history',
      label: `Your last ${plural(historyCount, 'logged service')}`,
    });
  }

  return sources;
}

function plural(count: number, noun: string): string {
  return `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`;
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
