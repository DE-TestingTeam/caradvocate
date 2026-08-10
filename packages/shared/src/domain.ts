/**
 * The CarAdvocate domain contract: the single definition of every shape that crosses
 * the wire. The API validates against it and the web app consumes it, so the two
 * cannot drift. Nothing in here may import from apps/.
 */

export type Severity = 'low' | 'medium' | 'high';

/**
 * Whether an upkeep job is due. Computed from the interval, the last service and
 * today's odometer -- not stored, because nothing would keep a stored value true.
 *
 * `unknown` is a first-class answer and the default: with no interval set or no service
 * ever logged, there is nothing to say, and `ok` would be an unsupportable all-clear.
 */
export type MaintenanceStatus = 'overdue' | 'due_soon' | 'ok' | 'unknown';

/**
 * The wireframes only ever show FAIR and OVERPRICED. A below-benchmark quote is
 * reported as fair; to flag suspiciously low quotes, add the member here first.
 */
export type QuoteVerdict = 'fair' | 'overpriced';

export type ServiceRecordSource = 'manual' | 'repair_cost_checker';

/** `Locked` is a paid feature the owner has not unlocked yet. */
export type FeatureStatus = 'Included' | 'Active' | 'Locked';

export interface Vehicle {
  id: string;
  year: number;
  make: string;
  model: string;
  trim?: string;
  /** Absent when the owner skipped it during onboarding. */
  vin?: string;
  mileage: number;
  /** Absent when the owner skipped it. Needed to localize a market value estimate. */
  zip?: string;
  /**
   * Absent until a data source (Kelley Blue Book or equivalent) has priced the
   * vehicle. A car the user just added has none, and inventing a number would
   * undermine the one thing this product is for.
   */
  estMarketValue?: number;
  tradeInLow?: number;
  tradeInHigh?: number;
  /**
   * True when the valuation source has given a conclusive "cannot price this one" --
   * observed for a vehicle old enough to fall outside its data (a 1993 truck, for one).
   * Only meaningful while `estMarketValue` is absent: it tells the UI not to imply a price
   * is still coming. Absent/false covers both "never asked" (no VIN or zip yet) and "asked,
   * vendor unreachable, will retry."
   */
  valuationUnavailable?: boolean;
  /**
   * ISO date-time the reading in `mileage` was TAKEN, or absent when it is not known.
   *
   * Absent is not the same as recent -- see `mileageIsStale`, which treats it as stale. Rows
   * predating migration 0021 are backfilled from the car's creation date, so in practice this
   * is only absent for a row written by something that forgot to stamp it.
   */
  mileageUpdatedAt?: string;
  /** Ordered oldest -> newest. Empty until valuation history exists. */
  valueTrend: { month: string; value: number }[];
}

/**
 * How long a reading stays trustworthy before the app asks the owner to confirm it.
 *
 * Ninety days is chosen against what goes wrong, not for roundness. A typical car covers
 * roughly a thousand miles a month, so three months is about 3,000 miles of drift -- already
 * most of the way through a 5,000-mile oil interval, which is the point at which "you are fine"
 * stops being true. Shorter would nag owners who have not driven anywhere; much longer and the
 * maintenance calculation is answering with a number nobody has checked since spring.
 */
export const MILEAGE_STALE_AFTER_DAYS = 90;

/** Average miles a car covers in a month, used only to prefill a prompt the owner corrects. */
const MILES_PER_MONTH = 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether the odometer on file is old enough to be worth re-asking.
 *
 * Shared rather than implemented on each side, because the browser decides whether to SHOW the
 * prompt and the API decides what to tell it, and two copies of this rule would eventually
 * disagree about whether a car needs asking.
 *
 * An unknown date counts as stale. The alternative -- treating "we have no idea when this was
 * read" as fresh -- is the exact failure this whole column exists to end.
 */
export function mileageIsStale(vehicle: Pick<Vehicle, 'mileageUpdatedAt'>, now = new Date()): boolean {
  if (!vehicle.mileageUpdatedAt) return true;

  const takenAt = new Date(vehicle.mileageUpdatedAt).getTime();
  // An unparseable date is a bug somewhere upstream, but guessing "fresh" would hide it.
  if (Number.isNaN(takenAt)) return true;

  return now.getTime() - takenAt > MILEAGE_STALE_AFTER_DAYS * DAY_MS;
}

/** Whole days since the reading was taken. Null when the date is unknown or unparseable. */
export function daysSinceMileageReading(
  vehicle: Pick<Vehicle, 'mileageUpdatedAt'>,
  now = new Date(),
): number | null {
  if (!vehicle.mileageUpdatedAt) return null;

  const takenAt = new Date(vehicle.mileageUpdatedAt).getTime();
  if (Number.isNaN(takenAt)) return null;

  return Math.max(0, Math.floor((now.getTime() - takenAt) / DAY_MS));
}

/**
 * A guess at what the odometer probably reads now, for PREFILLING the confirmation prompt.
 *
 * THIS IS NEVER STORED WITHOUT THE OWNER CONFIRMING IT, and that restriction is the entire
 * design. Writing an estimate straight into `vehicles.mileage` would swap one invented number
 * for another and, worse, would stamp `mileageUpdatedAt` -- turning a guess into something the
 * app then treats as a real reading and stops asking about. The estimate exists so the owner
 * has something to correct instead of a blank box; the number that gets saved is whatever they
 * agree to.
 *
 * Rounded to the nearest hundred, deliberately. A precise-looking 63,847 invites acceptance
 * without thought; 63,800 reads as the approximation it is.
 */
export function estimateCurrentMileage(
  vehicle: Pick<Vehicle, 'mileage' | 'mileageUpdatedAt'>,
  now = new Date(),
): number {
  const days = daysSinceMileageReading(vehicle, now);
  if (days == null) return vehicle.mileage;

  const driven = Math.round((days / 30) * MILES_PER_MONTH);
  return Math.round((vehicle.mileage + driven) / 100) * 100;
}

/**
 * The signed URLs of a studio photo and an interactive 3D model of the owner's model,
 * shown on My Car.
 *
 * `{}` is a routine response. An absent `imageUrl` or `modelUrl` covers "not configured",
 * "no match" and "unreachable" alike -- both are decoration, and the UI falls back to a
 * static placeholder. Both URLs expire, so they are fetched on mount rather than stored.
 */
export interface VehicleImage {
  /** Studio photo of this generation, 3:2. */
  imageUrl?: string;
  /** Interactive 3D model (GLB) of this generation, for a <model-viewer>. */
  modelUrl?: string;
}

/**
 * What a VIN lookup yields during onboarding. Every field but the VIN is optional: the
 * decoder reports only what it could determine, and the form falls back to manual entry.
 */
export interface DecodedVin {
  vin: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
}

export interface MaintenanceItem {
  id: string;
  label: string;
  status: MaintenanceStatus;
  /** How often it is due. Owner-supplied; either, both or neither. */
  intervalMiles?: number;
  intervalMonths?: number;
  /** The most recent service logged against this job, if any. */
  lastServicedOn?: string;
  lastServicedMileage?: number;
  /** Present only with an interval *and* a last service to measure from. */
  dueAtMileage?: number;
  dueOn?: string;
  /**
   * Miles left before it is due; negative when overdue. Supplied so the UI does not
   * repeat the subtraction and risk disagreeing with the status.
   */
  milesRemaining?: number;
  /** Why the status is `unknown`, so the UI can say what is missing. */
  unknownReason?: 'no_interval' | 'never_serviced';
}

/**
 * One NHTSA safety recall for the owner's model. `severity` is derived from NHTSA's own
 * advisories rather than judged here.
 */
export interface Recall {
  id: string;
  /** NHTSA's campaign number, e.g. "20V314000". Quote it when calling a dealer. */
  campaignNumber: string;
  component: string;
  summary: string;
  consequence: string;
  remedy: string;
  severity: Severity;
  /** NHTSA says stop driving this vehicle. */
  parkIt: boolean;
  /** NHTSA says park away from buildings -- typically a fire risk. */
  parkOutside: boolean;
  /** ISO yyyy-mm-dd. Absent when NHTSA reported no usable date. */
  reportedOn?: string;
  /**
   * What the owner says about their own car: `true` repaired, `false` outstanding,
   * absent when nobody has said. NHTSA's feed is per-model and cannot answer this, so
   * absent means unknown, not "not done".
   */
  repaired?: boolean;
}

/**
 * How the recall check ended. Three states, not two, because an empty list has three
 * different meanings and only one of them is reassuring:
 *
 *   `ok`               NHTSA answered about this model. An empty list is a real all-clear.
 *   `model_not_listed` NHTSA answered, but files no recalls under this model name. Says
 *                      nothing about the car. NHTSA returns HTTP 400 for these -- e.g. a
 *                      2014 "F-350", which it files by cab as "F-350 SUPERCAB" and friends,
 *                      or a "GMT-400", which is a platform code no manufacturer sells.
 *   `unreachable`      No answer at all. Says nothing about the car either, but for a
 *                      reason that may fix itself.
 *
 * The last two both mean "unknown", and both were previously reported as `unreachable`,
 * which told owners a database was down when it had in fact replied in under a second.
 */
export type RecallCheckStatus = 'ok' | 'model_not_listed' | 'unreachable';

/**
 * Recalls plus how the check ended. Without `status`, an empty list could mean this car is
 * clear, or that nobody has managed to ask about it.
 */
export interface RecallReport {
  recalls: Recall[];
  status: RecallCheckStatus;
}

/**
 * Where a known issue came from, which decides how much weight it carries. `curated`
 * entries are written by us; `owner_reports` are aggregated NHTSA complaints -- real
 * but unverified accounts. The UI must say which is which.
 */
export type KnownIssueSource = 'curated' | 'owner_reports';

export interface KnownIssue {
  id: string;
  label: string;
  severity: Severity;
  source: KnownIssueSource;
  /** How many owners reported this system. `owner_reports` only. */
  reportCount?: number;
  /** Reports that mentioned a crash or fire, and any casualties NHTSA recorded. */
  crashCount?: number;
  fireCount?: number;
  injuryCount?: number;
  deathCount?: number;
  /** ISO yyyy-mm-dd of the most recent reported incident. */
  latestIncidentOn?: string;
  /**
   * When this system tends to fail, from odometer readings on the complaints. Absent
   * until the bulk ingest has run, and withheld when too few complaints reported
   * mileage to say anything.
   */
  mileage?: MileageAtFailure;
}

/**
 * The mileage range a component gets reported at. `lowMi`/`highMi` are the 25th and
 * 75th percentiles, not the extremes, so one complaint at 600 miles does not stretch
 * the range past usefulness.
 *
 * `sampleCount` is smaller than the group's `reportCount` -- only about two thirds of
 * complaints include an odometer reading -- and is carried so a range built from four
 * readings does not look like one built from forty.
 */
export interface MileageAtFailure {
  lowMi: number;
  medianMi: number;
  highMi: number;
  sampleCount: number;
}

/** Known issues plus whether the complaint feed has been reached. See RecallReport. */
export interface KnownIssueReport {
  issues: KnownIssue[];
  checked: boolean;
}

export interface ServiceRecord {
  id: string;
  description: string;
  /** ISO calendar date, no time component. */
  date: string;
  cost: number;
  source: ServiceRecordSource;
  /** Odometer when the work was done. Absent on older records and when unknown. */
  mileageAtService?: number;
  /** The upkeep job this counts as, when the owner said it counts as one. */
  maintenanceItemId?: string;
}

/**
 * The whole repair catalog, with each entry saying whether it can be priced for the
 * caller's own car. The list is NOT filtered to priced repairs: "what repair do you
 * need?" is a question about the car in the driveway, and an owner needing brakes should
 * see brakes on the list whether or not we can quote them.
 *
 * `checked` says whether the pricing vendor has ever answered for this model, because
 * nothing priced cannot otherwise distinguish "no pricing for this car" from "never
 * reached the vendor", and only the first is a fact about the vehicle.
 *
 * Pricing from a DIFFERENT car is never substituted -- `priced: false` is where that
 * refusal surfaces. See apps/api/src/services/repairPricingSync.ts.
 */
export interface RepairCatalogReport {
  repairs: RepairCatalogItem[];
  checked: boolean;
}

export interface PartBenchmark {
  name: string;
  avgPrice: number;
}

export interface LaborTask {
  name: string;
  /**
   * Absent when the source published a cost but not a duration, the normal case:
   * Vehicle Databases gives labor as money only. The UI omits the figure rather than
   * deriving one -- see apps/api/src/services/repairPricing.ts.
   */
  hours?: number;
}

export interface AssessmentQuote {
  amount: number;
  parts: number;
  labor: number;
  verdict: QuoteVerdict;
  explanation: string;
}

/**
 * Why the owner is asking about this repair.
 *
 * The necessity check cannot exist without this. "Is this repair needed?" has no answer from a
 * repair name and a price alone -- a shop proposing brake pads to someone who reported grinding
 * and a shop proposing them to someone who came in for an oil change are completely different
 * questions, and until now the app recorded neither.
 *
 * Kept to a short fixed list rather than free text because it is the field that gets reasoned
 * over. `symptomNotes` is where the words go.
 */
export type AssessmentPrompt =
  | 'symptom'
  | 'warning_light'
  | 'routine_service'
  | 'shop_suggested'
  | 'other';

/**
 * How long it has been going on. Coarse on purpose: an owner rarely knows the date something
 * started, and offering "3 days" precision invites a guess that reads as a fact.
 */
export type SymptomDuration = 'days' | 'weeks' | 'months' | 'unsure';

export const ASSESSMENT_PROMPTS: readonly AssessmentPrompt[] = [
  'symptom',
  'warning_light',
  'routine_service',
  'shop_suggested',
  'other',
];

export const SYMPTOM_DURATIONS: readonly SymptomDuration[] = ['days', 'weeks', 'months', 'unsure'];

/** What the owner told us about why this repair came up. Absent on assessments predating it. */
export interface AssessmentContext {
  promptedBy: AssessmentPrompt;
  /** What they are noticing, or what the shop said. Absent when they had nothing to add. */
  notes?: string;
  /** Only meaningful alongside a symptom or a warning light. */
  duration?: SymptomDuration;
}

export interface Assessment {
  id: string;
  repairName: string;
  vehicleId: string;
  mileageAtAssessment: number;
  createdAt: string;
  recommendation: { headline: string; badge: string; body: string };
  parts: { items: PartBenchmark[]; total: number; low: number; high: number };
  /**
   * `estHours` is present wherever the hours vendor knows the job; `ratePerHour` is always
   * absent, because no vendor we use publishes a shop rate and it must not be derived from
   * the others (see apps/api/src/services/laborTimes.ts). They are therefore NOT absent
   * together, and a consumer that tests for both gets neither. `total` is always real.
   */
  labor: { ratePerHour?: number; estHours?: number; tasks: LaborTask[]; total: number };
  fairTotalLow: number;
  fairTotalHigh: number;
  /**
   * Which model's pricing produced these figures and where it came from, e.g.
   * `Vehicle Databases "Brakes - Replace Pads" for 2019 HONDA CIVIC (independent +
   * dealer)`. On the wire because the benchmark is not always the owner's own car: a
   * reference model stands in when the vendor cannot price theirs.
   */
  benchmarkSource: string;
  /**
   * Why the owner asked. Absent on the four assessments created before this was collected --
   * "not asked", which is different from "nothing to report" and must stay tellable apart.
   *
   * Read back rather than write-only on purpose: `quote_file_name` is a dead column in this same
   * table for exactly the reason that it is written and never surfaced, and a field nothing can
   * see is a field nobody notices has stopped being filled in.
   */
  context?: AssessmentContext;
  quote?: AssessmentQuote;
  completedAt?: string;
  completedCost?: number;
}

/**
 * Which kinds of fact an answer drew on. A closed set, because the whole point is that the
 * assistant cannot name a source the app did not give it -- see ChatSource.
 */
export type ChatSourceKind = 'vehicle' | 'recalls' | 'owner_reports' | 'upkeep' | 'service_history';

/**
 * One line of the "Based on" summary under an answer.
 *
 * The model picks the `kind`s it leaned on; the API writes the `label` from the facts it
 * actually assembled, and drops any kind that was not in that block. So the label can state a
 * real count ("125 owner reports for this model") without the model ever having authored a
 * number -- the same split as the CTA label, for the same reason.
 */
export interface ChatSource {
  kind: ChatSourceKind;
  label: string;
}

/**
 * What the Repair Cost Checker should open with when the owner taps through from a chat answer.
 *
 * A head start, never a decision: everything here lands as the form's initial state and stays
 * editable. `repairId` is resolved by the API against the owner's own catalogue -- the assistant
 * names a repair, it does not choose an id -- so a value that arrives here is one the picker can
 * actually show. `quoteAmount` is only ever a figure the owner themselves stated; nothing here
 * is the assistant's estimate of what anything costs.
 */
export interface ChatCtaPrefill {
  repairId: string;
  /** The catalogue's own wording, so the button and the picker cannot disagree. */
  repairName: string;
  /** Whole dollars, echoed back from what the owner said they were quoted. */
  quoteAmount?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  urgency?: { level: Severity; text: string };
  cta?: { label: string; action: 'start_assessment'; prefill?: ChatCtaPrefill };
  /** Omitted when the answer drew on nothing -- a greeting has no sources. */
  sources?: ChatSource[];
}

export interface AccountFeature {
  name: string;
  status: FeatureStatus;
}

/** `paid` means they tapped through the paywall, not that they were charged. */
export type Plan = 'free' | 'paid';

/**
 * Which of the two paywall offers an owner chose. Both open the same paid features (see
 * services/featureCatalog.ts on the API) -- they differ only in price shape, and which one
 * people prefer is itself what the prototype is testing.
 */
export type PricingModel = 'all_you_can_eat' | 'per_incident';

export interface Account {
  name: string;
  email: string;
  phone: string;
  memberSince: string;
  plan: Plan;
  /** Which offer this account is on. Undefined while free. */
  pricingModel?: PricingModel;
  features: AccountFeature[];
}

/** One of the paywall's two side-by-side offers. */
export interface PricingOffer {
  model: PricingModel;
  /** Whole cents, so the client formats and never arithmetics on a float. */
  priceCents: number;
  /** ISO 4217. Only USD in v1, but the client should not assume a `$`. */
  currency: string;
  interval: 'month' | 'year';
  /**
   * Only set on the per-incident offer: what a parts-benchmark lookup costs on top of the
   * subscription. Disclosed, not metered -- see services/paywall.ts on the API.
   */
  perIncidentFeeCents?: number;
}

// What the paywall shows, and whether this owner is past it.
export interface PaywallStatus {
  /** True once the owner has tapped unlock. Paid features are open to them. */
  unlocked: boolean;
  /** Which offer they picked. Undefined while unlocked === false. */
  pricingModel?: PricingModel;
  /** Both offers, side by side, for the owner to choose between. */
  offers: PricingOffer[];
  /** What unlocking opens up, in the order the paywall lists them. */
  includes: string[];
}

export interface RepairCatalogItem {
  id: string;
  name: string;
  /**
   * Whether we hold pricing for this repair on THIS car. Informational: the picker lets
   * any repair be chosen regardless, because what the car needs is the owner's to say.
   * False means POST /api/assessments will refuse it with a 404, and the client shows
   * that on the following page rather than gating the choice.
   */
  priced: boolean;
}
