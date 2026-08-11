/**
 * The necessity check -- whether a proposed repair holds up against what we know about this car.
 *
 * THE CLAIM IS NOT "IS THIS NECESSARY?". That is a diagnosis, and this app cannot make one: it
 * has never seen the car, and Ask CA is explicitly forbidden from trying (services/askClaude.ts).
 * What it can do is set the repair a shop proposed beside the owner's own reason for asking, this
 * model's failure record and this car's schedule and history, and say whether those agree. Hence
 * three bands, and the third is the honest majority case rather than a fallback:
 *
 *   holds_up          -- something we hold independently backs it up
 *   worth_questioning -- something we hold sits against it, and the owner should ask about that
 *   not_enough        -- we cannot say, and must not imply otherwise
 *
 * THE BAND IS COMPUTED HERE AND NEVER BY THE MODEL. Claude writes the prose from the signals this
 * returns and from nothing else -- the same split that makes Ask CA's "Based on" line trustworthy
 * (services/vehicleContext.ts). A model that can choose the band can be talked into choosing a
 * different one, and this band is what the paid tier sells.
 *
 * THE OWNER'S REPORT IS THE QUESTION, NOT THE EVIDENCE. "I hear grinding" is why we are looking;
 * it cannot also be the corroboration, or every symptom an owner reported would confirm whatever
 * the shop proposed for it -- which is the exact failure this feature exists to catch. So the
 * owner-side facts are carried as `neutral` signals: the prose may state them, they never move
 * the band. Only what we hold independently of the owner and the shop does that.
 *
 * PURE, and takes rows rather than a database, like services/maintenanceDue.ts. The band rules
 * are the part worth being able to read in one sitting and re-run over invented cases without a
 * Postgres; `scripts/checkNecessity.mts` does exactly that. `loadNecessityFinding` at the foot is
 * the one exception, and it only gathers the four inputs.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type {
  AssessmentContext,
  MaintenanceStatus,
  NecessityBand,
  NecessityShortfall,
  NecessityStance,
} from '@caradvocate/shared';
import type { Database } from '../db/index.js';
import { modelOwnerReports, serviceRecords } from '../db/schema.js';
import { loadMaintenanceItems } from './maintenanceDue.js';
import { modelMatches, type ModelKey } from './modelFeed.js';

/** What kind of evidence can bear on a repair at all. See REPAIR_EVIDENCE. */
type RepairKind = 'wear' | 'failure';

interface RepairEvidence {
  kind: RepairKind;
  /** NHTSA's canonical component label, for failure jobs we can match to one. */
  component?: string;
  /** Our maintenance item label, for wear jobs the factory schedule lists. */
  scheduleLabel?: string;
}

/**
 * What each catalogue repair can be checked against. Hand-written, matching `REPAIR_TITLES` in
 * repairPricing.ts and `SCHEDULE_LABELS` in maintenanceSchedule.ts, and for their reason: both
 * vocabularies belong to someone else and neither is derivable from our slug.
 *
 * `kind` decides which evidence applies at all, and getting it wrong is the mistake this map
 * exists to prevent. NHTSA complaints are reports of things BREAKING. "This model has 24 engine
 * complaints" says nothing about whether your spark plugs are due, so a wear job must never draw
 * on them -- it would corroborate every scheduled service on every model owners complain about.
 * Wear jobs are checked against the factory schedule; failure jobs against the failure record.
 *
 * `component` is NHTSA's own label as `canonicalComponent` reduces it (services/complaints.ts),
 * read off the live feed rather than guessed: a 2019 Civic files under STEERING, FUEL SYSTEM,
 * ELECTRICAL SYSTEM, SERVICE BRAKES, ENGINE and POWER TRAIN; a 2011 Pathfinder adds SUSPENSION.
 *
 * THREE JOBS ARE DELIBERATELY LEFT UNMAPPED, and they should stay that way:
 *
 * - Both AC jobs. NHTSA has no air-conditioning component; those complaints land in EQUIPMENT and
 *   UNKNOWN OR OTHER, the bucket complaints.ts drops as telling an owner nothing. Mapping AC to
 *   the nearest plausible label would manufacture corroboration out of an unrelated pile.
 * - Wheel alignment. The obvious label is STEERING, which on a 2019 Civic is 80 reports about
 *   electric power steering -- nothing to do with alignment. Alignment is diagnosed from tyre
 *   wear, which we do not hold.
 *
 * A repair absent from this map is not an error: it reaches `not_enough`, which is correct.
 */
const REPAIR_EVIDENCE: Readonly<Record<string, RepairEvidence>> = {
  'brake-pad-replacement': { kind: 'failure', component: 'SERVICE BRAKES' },
  'battery-replacement': { kind: 'failure', component: 'ELECTRICAL SYSTEM' },
  'alternator-replacement': { kind: 'failure', component: 'ELECTRICAL SYSTEM' },
  // See the header: no NHTSA component covers these three.
  'ac-compressor-replacement': { kind: 'failure' },
  'ac-recharge': { kind: 'failure' },
  'wheel-alignment': { kind: 'failure' },
  'oil-change-filter': { kind: 'wear', scheduleLabel: 'Oil & filter' },
  'tire-rotation': { kind: 'wear', scheduleLabel: 'Tyre rotation' },
  'coolant-flush': { kind: 'wear', scheduleLabel: 'Coolant flush' },
  'spark-plug-replacement': { kind: 'wear', scheduleLabel: 'Spark plugs' },
  // Wear jobs SCHEDULE_LABELS does not carry, so no factory interval ever lands against them.
  'transmission-flush': { kind: 'wear' },
  'timing-belt-inspection': { kind: 'wear' },
};

/**
 * Below this many odometer readings a complaint group's mileage range is not published, matching
 * MIN_SAMPLES in scripts/ingestComplaintMileage.mts -- the two must agree, or this reasons over
 * percentiles the ingest already judged too thin to compute. Live, 28 of 81 groups clear it.
 */
const MIN_MILEAGE_SAMPLES = 4;

/**
 * How much of an interval has to be left for a repeat to read as early. A quarter is deliberately
 * lenient: an oil change at 4,000 of a 5,000-mile interval is somebody being careful, not a shop
 * selling twice, and the band must not accuse them of it.
 */
const REPEAT_INTERVAL_FRACTION = 0.25;

/**
 * The window for a FAILURE job, which has no interval by nature -- a second alternator inside
 * either of these is a comeback. Never applied to a wear job; see `repeatWindow`.
 */
const REPEAT_MILES = 12_000;
const REPEAT_DAYS = 365;

export type NecessitySignalId =
  | 'owner_reported_symptom'
  | 'shop_initiated'
  | 'routine_visit'
  | 'never_asked'
  | 'failure_pattern_at_mileage'
  | 'failure_pattern_beyond_mileage'
  | 'failure_pattern_no_mileage'
  | 'due_on_factory_schedule'
  | 'not_due_on_factory_schedule'
  | 'done_recently'
  | 'done_before';

/**
 * The shared `NecessitySignal` plus which rule produced it. The id is stored but not sent: it is
 * for reading the table later -- which signals actually fire, on how many cars -- and an owner
 * has no use for `failure_pattern_at_mileage` when the sentence beside it says the same thing.
 */
export interface NecessitySignal {
  id: NecessitySignalId;
  stance: NecessityStance;
  /**
   * One finished sentence stating the fact and naming where it came from. The prose step is given
   * these and nothing else, so anything a reader would need to judge the claim has to be in here.
   */
  detail: string;
}

/** One component's owner-report group for this model, as `model_owner_reports` holds it. */
export interface ComponentFailureRecord {
  component: string;
  reportCount: number;
  /** Null until scripts/ingestComplaintMileage.mts has run for this model. */
  mileageSampleCount: number | null;
  /** 25th and 75th percentiles, not the extremes. Null together with the sample count. */
  mileageLowMi: number | null;
  mileageMedianMi: number | null;
  mileageHighMi: number | null;
}

/** The upkeep job this repair satisfies, already resolved by services/maintenanceDue.ts. */
export interface ScheduledJobStatus {
  label: string;
  status: MaintenanceStatus;
  intervalMiles?: number;
  milesRemaining?: number;
  dueAtMileage?: number;
}

/** A service the owner logged. ISO yyyy-mm-dd, mileage null where they did not know it. */
export interface PastService {
  date: string;
  mileage: number | null;
}

export interface NecessityInput {
  /** Null for an assessment whose catalogue row was retired. No slug, no evidence map. */
  repairSlug: string | null;
  repairName: string;
  mileageAtAssessment: number;
  /**
   * Undefined means NEVER ASKED -- the four assessments predating migration 0022 -- which is not
   * the same as the owner having nothing to report, and is the one input whose absence settles
   * the band on its own.
   */
  context?: AssessmentContext;
  /** The owner-report group for this repair's component, when there is one. */
  failureRecord?: ComponentFailureRecord;
  scheduledJob?: ScheduledJobStatus;
  /**
   * True only when this car's intervals are the MANUFACTURER'S. The caller decides, because only
   * it can see `vehicles.maintenance_schedule_checked_at`, and the seed writes intervals too
   * (services/maintenanceScheduleSync.ts). False degrades every schedule signal to silence: a
   * generic 5,000-mile oil interval must never produce "your maker says this is overdue", and an
   * empty or invented interval list is not evidence that nothing is due.
   */
  scheduleIsFactory: boolean;
  /**
   * The owner's most recent service logged under exactly this repair's name. Exact name, because
   * the completion writeback stores `repairName` verbatim (routes/assessments.ts) -- matching on
   * a description any looser guesses, and schema.ts warns off guessing for the same reason.
   */
  lastSameRepair?: PastService;
  /** Injected so the calculation is testable without freezing the clock, as in maintenanceDue.ts. */
  today: Date;
}

export interface NecessityFinding {
  band: NecessityBand;
  /** Owner-side first, then failure record, schedule, history. Stable, so the prose reads in order. */
  signals: NecessitySignal[];
  /** Which checks could run at all, so the prose can say what was missing rather than stay quiet. */
  checked: { failureRecord: boolean; factorySchedule: boolean };
  /** Set only on `not_enough`. */
  shortfall?: NecessityShortfall;
}

/**
 * The band, and the signals behind it.
 *
 * Three rules, in this order, and the order is the whole design:
 *
 * 1. No recorded reason -- `not_enough`, whatever else we hold. Without knowing why the repair
 *    came up we are pricing a name, which is what the app already did and what this replaces.
 * 2. Anything questioning it wins over anything supporting it. Brake pads that match the model's
 *    failure mileage AND were fitted 2,000 miles ago is not a confirmation, it is a comeback, and
 *    the owner needs to raise it either way.
 * 3. Otherwise it takes one independent supporting signal to reach `holds_up`. Silence is
 *    `not_enough`, never `holds_up`.
 */
export function assessNecessity(input: NecessityInput): NecessityFinding {
  const evidence = input.repairSlug ? REPAIR_EVIDENCE[input.repairSlug] : undefined;

  const checked = {
    failureRecord: evidence?.kind === 'failure' && input.failureRecord !== undefined,
    factorySchedule: input.scheduleIsFactory && input.scheduledJob !== undefined,
  };

  // Rule 1. Deliberately before any evidence is gathered: there is no combination of data that
  // answers "should this have been proposed?" when nothing recorded what prompted it.
  if (!input.context) {
    return {
      band: 'not_enough',
      signals: [
        {
          id: 'never_asked',
          stance: 'neutral',
          detail: `This assessment was created before we started asking why a repair came up, so we do not know what prompted ${input.repairName}.`,
        },
      ],
      checked,
      shortfall: 'never_asked',
    };
  }

  const reportedSymptom =
    input.context.promptedBy === 'symptom' || input.context.promptedBy === 'warning_light';

  const signals: NecessitySignal[] = [
    ownerReasonSignal(input.context),
    ...failureRecordSignals(input, evidence),
    ...scheduleSignals(input, reportedSymptom),
    ...historySignals(input, evidence),
  ];

  // Rule 2.
  if (signals.some((signal) => signal.stance === 'questions')) {
    return { band: 'worth_questioning', signals, checked };
  }

  // Rule 3.
  if (signals.some((signal) => signal.stance === 'supports')) {
    return { band: 'holds_up', signals, checked };
  }

  return {
    band: 'not_enough',
    signals,
    checked,
    shortfall:
      checked.failureRecord || checked.factorySchedule
        ? 'nothing_spoke_either_way'
        : 'nothing_to_check_against',
  };
}

/**
 * What the owner told us, as a sentence. Always `neutral` -- see the header. It is here because
 * the prose has to lead with why the repair came up, not because it weighs anything.
 */
function ownerReasonSignal(context: AssessmentContext): NecessitySignal {
  const notes = context.notes?.trim();
  const said = notes ? ` You described it as: "${notes}".` : '';

  switch (context.promptedBy) {
    case 'symptom':
      return {
        id: 'owner_reported_symptom',
        stance: 'neutral',
        detail: `You brought the car in about something you noticed${durationClause(context)}.${said}`,
      };
    case 'warning_light':
      return {
        id: 'owner_reported_symptom',
        stance: 'neutral',
        detail: `You brought the car in for a warning light${durationClause(context)}.${said}`,
      };
    case 'shop_suggested':
      return {
        id: 'shop_initiated',
        stance: 'neutral',
        detail: `You reported no symptom -- the shop raised this repair.${said}`,
      };
    case 'routine_service':
      return {
        id: 'routine_visit',
        stance: 'neutral',
        detail: `Your car was in for routine upkeep, not for a problem.${said}`,
      };
    case 'other':
      return {
        id: 'shop_initiated',
        stance: 'neutral',
        detail: `You gave another reason for this repair coming up.${said}`,
      };
  }
}

/** Only meaningful alongside a symptom or a warning light, per the shared type. */
function durationClause(context: AssessmentContext): string {
  switch (context.duration) {
    case 'days':
      return ', going on for days';
    case 'weeks':
      return ', going on for weeks';
    case 'months':
      return ', going on for months';
    default:
      return '';
  }
}

/**
 * What this model's owners report about the same system, and whether this car is at the mileage
 * they report it at.
 *
 * THE COUNT ALONE IS NOT CORROBORATION and is returned `neutral`. Every popular model has
 * complaints about every major system -- a 2019 Civic has 25 on service brakes -- so "others have
 * reported brakes" would confirm a brake job on any car of any age at any mileage. What makes it
 * about THIS car is the mileage those failures cluster at, which is why only the mileage match
 * supports the band, and why it needs the sample count the ingest publishes.
 */
function failureRecordSignals(
  input: NecessityInput,
  evidence: RepairEvidence | undefined,
): NecessitySignal[] {
  // Wear jobs never draw on the failure record. See REPAIR_EVIDENCE.
  if (evidence?.kind !== 'failure') return [];

  const record = input.failureRecord;
  if (!record || record.reportCount === 0) return [];

  const system = record.component.toLowerCase();
  const reports = `NHTSA holds ${count(record.reportCount, 'owner report')} about ${system} on this model`;

  const samples = record.mileageSampleCount ?? 0;
  if (
    samples < MIN_MILEAGE_SAMPLES ||
    record.mileageLowMi == null ||
    record.mileageMedianMi == null ||
    record.mileageHighMi == null
  ) {
    return [
      {
        id: 'failure_pattern_no_mileage',
        stance: 'neutral',
        detail: `${reports}, but too few of them gave an odometer reading to say when it tends to happen.`,
      },
    ];
  }

  const range = `${record.mileageLowMi.toLocaleString('en-US')} and ${miles(record.mileageHighMi)}`;
  const cluster = `${reports}; the ${count(samples, 'report')} that gave an odometer cluster between ${range}, with a median of ${miles(record.mileageMedianMi)}`;
  const here = `Your car is at ${miles(input.mileageAtAssessment)}`;

  // INSIDE THE RANGE IS THE ONLY THING THAT CORROBORATES, and the sentence has to say which side
  // of it this car is on. An earlier draft supported anything at or above the low percentile and
  // then described every one of them as "within the range" -- on a real 2019 Civic at 68,400
  // miles, against brake reports clustering between 5,199 and 14,500, that was a false statement
  // wearing the words of the evidence it was supposed to be citing.
  if (
    input.mileageAtAssessment >= record.mileageLowMi &&
    input.mileageAtAssessment <= record.mileageHighMi
  ) {
    return [
      {
        id: 'failure_pattern_at_mileage',
        stance: 'supports',
        detail: `${cluster}. ${here}, within the range where owners report it.`,
      },
    ];
  }

  // Earlier than the pattern. Parts do fail early, and a quarter of the reports sit below this
  // line by construction, so it is not a contradiction -- it informs the prose and nothing more.
  if (input.mileageAtAssessment < record.mileageLowMi) {
    return [
      {
        id: 'failure_pattern_beyond_mileage',
        stance: 'neutral',
        detail: `${cluster}. ${here}, earlier than most of those reports.`,
      },
    ];
  }

  // Well past the reports. NOT corroboration and not a contradiction either: a cluster at 5,000
  // to 14,000 miles on a five-year-old car describes an early-life defect, and a car at 68,400
  // is simply not the car those owners were describing. Saying so is more use than silence.
  return [
    {
      id: 'failure_pattern_beyond_mileage',
      stance: 'neutral',
      detail: `${cluster}. ${here}, well past the point those reports describe, so they do not say much about a car this far along.`,
    },
  ];
}

/**
 * What the manufacturer's schedule says, and only ever the manufacturer's -- see
 * `scheduleIsFactory`.
 *
 * "NOT DUE" ONLY QUESTIONS A REPAIR THE OWNER REPORTED NO SYMPTOM FOR. Coolant proposed at 8,000
 * of a 30,000-mile interval to someone who came in for an oil change is the case this whole
 * feature is for. The same interval means nothing against someone who arrived with the
 * temperature gauge climbing: things break between services, and telling them their maker says
 * they are fine would be the app talking an owner out of a real fault.
 */
function scheduleSignals(input: NecessityInput, reportedSymptom: boolean): NecessitySignal[] {
  if (!input.scheduleIsFactory) return [];

  const job = input.scheduledJob;
  // `unknown` means no interval or nothing ever logged against it -- no baseline, so no signal.
  if (!job || job.status === 'unknown') return [];

  const named = `Your car's factory schedule lists ${job.label}`;

  if (job.status === 'overdue' || job.status === 'due_soon') {
    const when =
      job.status === 'overdue'
        ? job.milesRemaining != null && job.milesRemaining < 0
          ? `and it is overdue by ${miles(Math.abs(job.milesRemaining))}`
          : 'and it is overdue'
        : 'and it is due now';
    return [
      {
        id: 'due_on_factory_schedule',
        stance: 'supports',
        detail: `${named} ${when}.`,
      },
    ];
  }

  const distance =
    job.milesRemaining != null
      ? ` -- ${miles(job.milesRemaining)} from now`
      : job.dueAtMileage != null
        ? ` -- not until ${miles(job.dueAtMileage)}`
        : '';

  if (reportedSymptom) {
    return [
      {
        id: 'not_due_on_factory_schedule',
        stance: 'neutral',
        detail: `${named} and it is not due yet${distance}, though a reported symptom is a reason to look regardless.`,
      },
    ];
  }

  return [
    {
      id: 'not_due_on_factory_schedule',
      stance: 'questions',
      detail: `${named} and it is not due yet${distance}, and you reported no symptom.`,
    },
  ];
}

/**
 * The owner's own record of having had this exact job done.
 *
 * A REPEAT QUESTIONS THE REPAIR EVEN WITH A SYMPTOM, unlike "not due" above. Pads fitted 2,000
 * miles ago and grinding now is either a comeback or the wrong diagnosis, and both are things to
 * raise with the shop before paying for the same job twice.
 */
function historySignals(
  input: NecessityInput,
  evidence: RepairEvidence | undefined,
): NecessitySignal[] {
  const last = input.lastSameRepair;
  if (!last) return [];

  const milesSince = last.mileage != null ? input.mileageAtAssessment - last.mileage : undefined;
  const when =
    milesSince == null
      ? `on ${last.date}`
      : milesSince === 0
        ? `at this same odometer reading, on ${last.date}`
        : `${miles(milesSince)} ago, at ${miles(last.mileage as number)} on ${last.date}`;

  const window = repeatWindow(input, evidence);

  // Mileage decides where there is one; the date is the fallback for a receipt logged without an
  // odometer reading, which the service form allows.
  const repeat =
    window === undefined
      ? false
      : milesSince != null
        ? milesSince < window
        : daysBetween(last.date, input.today) < REPEAT_DAYS;

  if (repeat) {
    return [
      {
        id: 'done_recently',
        stance: 'questions',
        detail: `You logged this same repair ${when}, which is a short interval to be doing it again.`,
      },
    ];
  }

  return [
    {
      id: 'done_before',
      stance: 'neutral',
      detail: `You last logged this repair ${when}.`,
    },
  ];
}

/**
 * How soon a repeat of this job is soon enough to raise -- or `undefined` where we cannot say,
 * which is silence rather than a guess.
 *
 * THE UNDEFINED CASE IS THE IMPORTANT ONE. A wear job with no factory interval has no baseline:
 * the flat fallback below flagged a real 2019 Civic oil change logged 4,500 miles earlier as
 * "a short interval to be doing it again", which is an ordinary oil change and an accusation the
 * app had no grounds for. Telling an owner their shop is selling twice, wrongly, is the worst
 * thing this feature can do -- worse than saying nothing -- so with no interval it says nothing.
 *
 * The flat window survives only for failure jobs, where it is not an interval at all: a second
 * alternator or a second set of pads inside 12,000 miles is a comeback whatever the schedule
 * says, because nothing about that job is supposed to recur.
 */
function repeatWindow(
  input: NecessityInput,
  evidence: RepairEvidence | undefined,
): number | undefined {
  const interval = input.scheduledJob?.intervalMiles;
  if (interval != null) return Math.round(interval * REPEAT_INTERVAL_FRACTION);
  return evidence?.kind === 'failure' ? REPEAT_MILES : undefined;
}

/** Whole days from an ISO date to `today`. Negative would mean a future service; treated as 0. */
function daysBetween(iso: string, today: Date): number {
  const [year, month, day] = iso.split('-').map(Number);
  const then = Date.UTC(year, month - 1, day);
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.max(0, Math.round((now - then) / 86_400_000));
}

function miles(value: number): string {
  return `${value.toLocaleString('en-US')} miles`;
}

function count(value: number, noun: string): string {
  return `${value.toLocaleString('en-US')} ${noun}${value === 1 ? '' : 's'}`;
}

/* ----------------------------------------------------------- the one loader */

/** The car a verdict is about. `maintenanceScheduleCheckedAt` decides whose schedule speaks. */
export interface NecessityVehicle extends ModelKey {
  id: string;
  mileage: number;
  maintenanceScheduleCheckedAt: Date | null;
}

export interface NecessityTarget {
  vehicle: NecessityVehicle;
  /** Null for a repair whose catalogue row was retired, which degrades rather than throws. */
  repairSlug: string | null;
  repairName: string;
  mileageAtAssessment: number;
  context?: AssessmentContext;
}

/**
 * Gathers the four inputs and works out the band. The only part of this file that touches a
 * database, for the reason `loadMaintenanceItems` is the only such part of maintenanceDue.ts:
 * the rules above are worth being able to read and re-run without one.
 *
 * NOTHING HERE REACHES A VENDOR. This runs inside the assessment-creation request, which has
 * already spent one metered call on pricing; every source below is our own mirror, so a spent
 * quota or a slow afternoon at NHTSA costs the owner a thinner verdict, never a failed
 * assessment. Which is also why a missing failure record is silence rather than an error --
 * `not_enough` is a real answer and the honest one when the mirror is empty.
 */
export async function loadNecessityFinding(
  db: Database,
  target: NecessityTarget,
  today: Date = new Date(),
): Promise<NecessityFinding> {
  const { vehicle, repairSlug, repairName } = target;
  const evidence = repairSlug ? REPAIR_EVIDENCE[repairSlug] : undefined;

  // Only the manufacturer's own intervals may speak; the seed writes intervals too, and this
  // column is the only thing that tells them apart (services/maintenanceScheduleSync.ts).
  const scheduleIsFactory = vehicle.maintenanceScheduleCheckedAt !== null;

  const wantsFailureRecord = evidence?.kind === 'failure' && evidence.component !== undefined;
  const wantsSchedule = scheduleIsFactory && evidence?.scheduleLabel !== undefined;

  // One round, not a chain: this sits on the owner's create request. Queries whose answer could
  // not be used are not issued at all -- a wear job never reads the failure record.
  const [failureRows, scheduledItems, historyRows] = await Promise.all([
    wantsFailureRecord
      ? db
          .select()
          .from(modelOwnerReports)
          .where(
            and(
              modelMatches(modelOwnerReports, vehicle),
              eq(modelOwnerReports.component, evidence!.component!),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
    wantsSchedule ? loadMaintenanceItems(db, vehicle) : Promise.resolve([]),
    db
      .select()
      .from(serviceRecords)
      .where(
        and(
          eq(serviceRecords.vehicleId, vehicle.id),
          // The completion writeback stores `repairName` verbatim (routes/assessments.ts), so
          // this is the same string rather than a guess at one. Lowercased only so a manually
          // typed row with different capitalisation is still the same job -- schema.ts warns
          // against inferring a match from a description, and this does not infer anything.
          eq(sql`lower(${serviceRecords.description})`, repairName.trim().toLowerCase()),
        ),
      )
      .orderBy(desc(serviceRecords.serviceDate))
      .limit(1),
  ]);

  const failureRow = failureRows[0];
  const scheduled = evidence?.scheduleLabel
    ? scheduledItems.find((item) => item.label === evidence.scheduleLabel)
    : undefined;
  const lastService = historyRows[0];

  return assessNecessity({
    repairSlug,
    repairName,
    mileageAtAssessment: target.mileageAtAssessment,
    ...(target.context ? { context: target.context } : {}),
    ...(failureRow
      ? {
          failureRecord: {
            component: failureRow.component,
            reportCount: failureRow.reportCount,
            mileageSampleCount: failureRow.mileageSampleCount,
            mileageLowMi: failureRow.mileageLowMi,
            mileageMedianMi: failureRow.mileageMedianMi,
            mileageHighMi: failureRow.mileageHighMi,
          },
        }
      : {}),
    ...(scheduled
      ? {
          scheduledJob: {
            label: scheduled.label,
            status: scheduled.status,
            ...(scheduled.intervalMiles != null ? { intervalMiles: scheduled.intervalMiles } : {}),
            ...(scheduled.milesRemaining != null
              ? { milesRemaining: scheduled.milesRemaining }
              : {}),
            ...(scheduled.dueAtMileage != null ? { dueAtMileage: scheduled.dueAtMileage } : {}),
          },
        }
      : {}),
    scheduleIsFactory,
    ...(lastService
      ? { lastSameRepair: { date: lastService.serviceDate, mileage: lastService.mileageAtService } }
      : {}),
    today,
  });
}
