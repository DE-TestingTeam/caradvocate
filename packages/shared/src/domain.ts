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
  /**
   * Absent until a data source (Kelley Blue Book or equivalent) has priced the
   * vehicle. A car the user just added has none, and inventing a number would
   * undermine the one thing this product is for.
   */
  estMarketValue?: number;
  tradeInLow?: number;
  tradeInHigh?: number;
  /** Ordered oldest -> newest. Empty until valuation history exists. */
  valueTrend: { month: string; value: number }[];
}

/**
 * The signed URL of a studio photo of the owner's model, shown on My Car.
 *
 * `{}` is a routine response. An absent `imageUrl` covers "not configured", "no match"
 * and "unreachable" alike -- the photo is decoration, and the UI falls back to a static
 * placeholder. The URL expires, so it is fetched on mount rather than stored.
 */
export interface VehicleImage {
  /** Studio photo of this generation, 3:2. */
  imageUrl?: string;
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
 * Recalls plus whether the upstream check has ever succeeded. Without `checked`, an
 * empty list could mean this car is clear or that NHTSA has never been reachable.
 */
export interface RecallReport {
  recalls: Recall[];
  checked: boolean;
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
  quote?: AssessmentQuote;
  completedAt?: string;
  completedCost?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  urgency?: { level: Severity; text: string };
  cta?: { label: string; action: 'start_assessment' };
}

export interface AccountFeature {
  name: string;
  status: FeatureStatus;
}

/** `paid` means they tapped through the paywall, not that they were charged. */
export type Plan = 'free' | 'paid';

export interface Account {
  name: string;
  email: string;
  phone: string;
  memberSince: string;
  plan: Plan;
  features: AccountFeature[];
}

// What the paywall shows, and whether this owner is past it.
export interface PaywallStatus {
  /** True once the owner has tapped unlock. Paid features are open to them. */
  unlocked: boolean;
  /** Whole cents, so the client formats and never arithmetics on a float. */
  priceCents: number;
  /** ISO 4217. Only USD in v1, but the client should not assume a `$`. */
  currency: string;
  /** Per the spec, v1 tests a subscription only -- never per-incident pricing. */
  interval: 'month' | 'year';
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
