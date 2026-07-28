/**
 * Domain contract for CarAdvocate.
 *
 * These types are the contract the Express + Postgres backend will implement.
 * Keep them in sync with the API once it exists.
 */

export type Severity = 'low' | 'medium' | 'high';

export type MaintenanceStatus = 'open_recall' | 'overdue' | 'upcoming';

export type QuoteVerdict = 'fair' | 'overpriced';

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
  /** Ordered oldest -> newest, used by both the sparkline and the 6-month chart. */
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
  /** ISO date string. */
  date: string;
  cost: number;
  source: 'manual' | 'repair_cost_checker';
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
  /** ISO date string. */
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
  status: 'Included' | 'Active';
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

export interface NewAssessmentInput {
  repairName: string;
  /** Undefined when the user chose "No, not yet". */
  quoteAmount?: number;
  quoteFileName?: string;
}

export interface NewServiceRecordInput {
  description: string;
  date: string;
  cost: number;
}
