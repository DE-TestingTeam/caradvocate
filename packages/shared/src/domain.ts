/**
 * The CarAdvocate domain contract.
 *
 * This is the single definition of every shape that crosses the wire. The API
 * validates against it and the web app consumes it, so the two cannot drift.
 * Nothing in here is allowed to import from apps/.
 */

export type Severity = 'low' | 'medium' | 'high';

export type MaintenanceStatus = 'open_recall' | 'overdue' | 'upcoming';

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
  vin: string;
  mileage: number;
  estMarketValue: number;
  tradeInLow: number;
  tradeInHigh: number;
  /** Ordered oldest -> newest. Drives both the sparkline and the 6-month chart. */
  valueTrend: { month: string; value: number }[];
}

export interface MaintenanceItem {
  id: string;
  label: string;
  status: MaintenanceStatus;
}

export interface KnownIssue {
  id: string;
  label: string;
  severity: Severity;
}

export interface ServiceRecord {
  id: string;
  description: string;
  /** ISO calendar date, no time component. */
  date: string;
  cost: number;
  source: ServiceRecordSource;
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
