/**
 * The CarAdvocate domain contract.
 *
 * This is the single definition of every shape that crosses the wire. The API
 * validates against it and the web app consumes it, so the two cannot drift.
 * Nothing in here is allowed to import from apps/.
 */

export type Severity = 'low' | 'medium' | 'high';

/**
 * Whether an upkeep job is due.
 *
 * Computed from the interval, the last time it was done and today's odometer -- not
 * stored, because nothing would keep a stored value true.
 *
 * `unknown` is a first-class answer and the default: with no interval set, or no
 * service ever logged against the job, there is genuinely nothing to say. Reporting
 * `ok` in that case would be an all-clear we cannot support -- the same mistake as
 * calling an unchecked recall list clean.
 *
 * `open_recall` is gone: recalls have their own section, sourced from NHTSA.
 */
export type MaintenanceStatus = 'overdue' | 'due_soon' | 'ok' | 'unknown';

/**
 * The wireframes only ever show FAIR and OVERPRICED, so those are the only two
 * verdicts. A below-benchmark quote is currently reported as fair -- if the
 * product later wants to flag suspiciously low quotes, add the member here first.
 */
export type QuoteVerdict = 'fair' | 'overpriced';

export type ServiceRecordSource = 'manual' | 'repair_cost_checker';

export type FeatureStatus = 'Included' | 'Active';

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
   * Valuation is absent until a data source (Kelley Blue Book or equivalent) has
   * priced the vehicle. A car the user just added has none, and inventing a
   * number would undermine the one thing this product is for.
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
 * `{}` is a routine response, not an error. An absent `imageUrl` covers all of
 * "CarImages is not configured", "no match for this year/make/model" and "the
 * service could not be reached", because the photo is decoration and none of those
 * deserve an error state on the page whose job is telling an owner about recalls.
 * The UI falls back to a static placeholder.
 *
 * The URL is signed and expiring, so it is fetched when the image mounts rather
 * than stored anywhere. How long it lasts is CarImages' choice and not part of
 * this contract -- treat it as good for this page view only.
 */
export interface VehicleImage {
  /** Studio photo of this generation, 3:2. */
  imageUrl?: string;
}

/**
 * What a VIN lookup yields during onboarding. Every field but the VIN itself is
 * optional: the decoder reports only what it could determine, and the form falls
 * back to manual entry for the rest.
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
  /**
   * When it next falls due. Present only when there is an interval *and* a last
   * service to measure from -- otherwise the app would be inventing a baseline.
   */
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
 * One NHTSA safety recall for the owner's model.
 *
 * `severity` is derived from NHTSA's own advisories rather than judged here:
 * "stop driving" and "park outside" are the two escalations it publishes.
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
   * What the owner says about their own car: `true` repaired, `false` still
   * outstanding, absent when nobody has said. NHTSA cannot answer this -- its feed
   * is per-model -- so an absent value means unknown, not "not done".
   */
  repaired?: boolean;
}

/**
 * Recalls plus whether the upstream check has ever succeeded.
 *
 * Without `checked`, an empty list is ambiguous -- it could mean this car is clear
 * or that NHTSA has never been reachable. Reporting an all-clear we cannot support
 * is the one outcome worth engineering against here.
 */
export interface RecallReport {
  recalls: Recall[];
  checked: boolean;
}

/**
 * Whether NHTSA recorded a driver-assist feature as fitted.
 *
 * `no` means NHTSA recorded the feature as not offered on this variant, which is a
 * finding about the model, not a gap in our data. Absent means NHTSA said nothing --
 * common on older vehicles, where these columns predate the programme.
 */
export type AssistFitment = 'standard' | 'optional' | 'no';

/**
 * One NCAP-tested variant of the owner's model.
 *
 * NHTSA crash-tests body styles and drivetrains separately, so one year/make/model
 * routinely has several of these -- a 2019 Civic has a 2-door and a 4-door, a 2019
 * F-150 has five cab configurations. They are kept apart rather than averaged: a
 * 4x2 and a 4x4 can differ by a star on rollover, and an average would describe a
 * truck nobody drives.
 *
 * Every rating is optional because NHTSA publishes `"Not Rated"` for tests it never
 * ran, and a car nobody crash-tested must not come back as a zero-star car.
 */
export interface SafetyRating {
  id: string;
  /** NHTSA's own label for the tested variant, e.g. "2019 Ford F-150 Super Crew PU/CC 4x4". */
  description: string;
  /** 1-5 stars. Absent where NHTSA reported "Not Rated". */
  overall?: number;
  frontCrash?: number;
  sideCrash?: number;
  rollover?: number;
  /**
   * Modelled chance of rollover in a single-vehicle crash, 0-1. Absent when the
   * rollover test was not run -- NHTSA sends 0.0 for that case, which would read as
   * "cannot roll over" if passed through.
   */
  rolloverPossibility?: number;
  forwardCollisionWarning?: AssistFitment;
  laneDepartureWarning?: AssistFitment;
  electronicStabilityControl?: AssistFitment;
}

/**
 * Crash-test ratings plus whether the upstream check has ever succeeded.
 *
 * Same reasoning as RecallReport: an untested car and an unreachable NHTSA both
 * produce an empty list, and only one of them is a fact about the car.
 */
export interface SafetyRatingReport {
  variants: SafetyRating[];
  checked: boolean;
}

/**
 * Where a known issue came from, which decides how much weight it carries.
 *
 * `curated` entries are written by us. `owner_reports` are aggregated from
 * complaints filed with NHTSA -- real, but unverified accounts from owners rather
 * than findings by anyone. The UI must say which is which; presenting a complaint
 * as an established fault would be the same mistake as inventing a valuation.
 */
export type KnownIssueSource = 'curated' | 'owner_reports';

export interface KnownIssue {
  id: string;
  label: string;
  severity: Severity;
  source: KnownIssueSource;
  /**
   * How many owners reported this system, for `owner_reports` entries. Absent for
   * curated ones, where there is no count to give and a fabricated one would be
   * worse than none.
   */
  reportCount?: number;
  /** Reports that mentioned a crash or fire, and any casualties NHTSA recorded. */
  crashCount?: number;
  fireCount?: number;
  injuryCount?: number;
  deathCount?: number;
  /** ISO yyyy-mm-dd of the most recent reported incident. */
  latestIncidentOn?: string;
  /**
   * When this system tends to fail, from odometer readings on the complaints.
   *
   * Absent until the bulk ingest has run for this model, and withheld when too few
   * complaints reported mileage to say anything -- see MileageAtFailure.
   */
  mileage?: MileageAtFailure;
}

/**
 * The mileage range a component gets reported at.
 *
 * `lowMi` and `highMi` are the 25th and 75th percentiles rather than the extremes,
 * so one complaint at 600 miles does not stretch the range past usefulness.
 *
 * `sampleCount` is carried deliberately and is smaller than the group's
 * `reportCount`: only about two thirds of complaints include an odometer reading. A
 * range built from four readings and one built from forty should not look alike.
 */
export interface MileageAtFailure {
  lowMi: number;
  medianMi: number;
  highMi: number;
  sampleCount: number;
}

/**
 * Known issues plus whether the complaint feed has been reached.
 *
 * Same reasoning as RecallReport: an empty list could mean "nothing reported" or
 * "we have never managed to ask", and only one of those is reassuring.
 */
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

export interface PartBenchmark {
  name: string;
  avgPrice: number;
}

export interface LaborTask {
  name: string;
  hours: number;
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
  labor: { ratePerHour: number; estHours: number; tasks: LaborTask[]; total: number };
  fairTotalLow: number;
  fairTotalHigh: number;
  /** Present only when the user supplied a shop quote. */
  quote?: AssessmentQuote;
  /**
   * Completion is deliberately independent of the verdict badge: the wireframes
   * show an assessment that is both completed and still badged ASSESSED.
   */
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

export interface Account {
  name: string;
  email: string;
  phone: string;
  memberSince: string;
  plan: 'paid';
  features: AccountFeature[];
}

export interface RepairCatalogItem {
  id: string;
  name: string;
}
