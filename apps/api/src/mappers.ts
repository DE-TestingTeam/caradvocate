/**
 * Row -> wire mapping. Postgres gives snake_case columns and `numeric`/`date` as strings;
 * the contract in @caradvocate/shared wants camelCase and real numbers. Translating here
 * keeps routes thin and database shapes out of components.
 */
import type {
  Account,
  Assessment,
  KnownIssue,
  MileageAtFailure,
  Recall,
  RepairCatalogItem,
  ServiceRecord,
  Vehicle,
} from '@caradvocate/shared';
import type * as t from './db/schema.js';
import { featuresFor } from './services/featureCatalog.js';

type Row<T> = T extends { $inferSelect: infer R } ? R : never;

export function toVehicle(
  row: Row<typeof t.vehicles>,
  valuePoints: Row<typeof t.vehicleValuePoints>[],
): Vehicle {
  return {
    id: row.id,
    year: row.year,
    make: row.make,
    model: row.model,
    trim: row.trim ?? undefined,
    vin: row.vin ?? undefined,
    mileage: row.mileage,
    zip: row.zip ?? undefined,
    estMarketValue: row.estMarketValue ?? undefined,
    tradeInLow: row.tradeInLow ?? undefined,
    tradeInHigh: row.tradeInHigh ?? undefined,
    valueTrend: [...valuePoints]
      .sort((a, b) => a.position - b.position)
      .map((point) => ({ month: point.monthLabel, value: point.value })),
  };
}

export function toKnownIssue(row: Row<typeof t.modelKnownIssues>): KnownIssue {
  return { id: row.id, label: row.label, severity: row.severity, source: 'curated' };
}

/** A complaint group needs this many reports before it reads as a pattern. */
const PATTERN_THRESHOLD = 5;

/**
 * Aggregated owner complaints, presented as a known issue. Severity comes from what NHTSA
 * recorded: a group where someone crashed, caught fire or was hurt is high, a
 * repeatedly-reported one is medium, a handful of reports is low. Unlike recalls, `low` is
 * meaningful here -- two complaints is noise, not a fault.
 */
export function toKnownIssueFromReports(row: Row<typeof t.modelOwnerReports>): KnownIssue {
  const harmed =
    row.crashCount > 0 || row.fireCount > 0 || row.injuryCount > 0 || row.deathCount > 0;

  return {
    id: row.id,
    label: row.component,
    severity: harmed ? 'high' : row.reportCount >= PATTERN_THRESHOLD ? 'medium' : 'low',
    source: 'owner_reports',
    reportCount: row.reportCount,
    crashCount: row.crashCount,
    fireCount: row.fireCount,
    injuryCount: row.injuryCount,
    deathCount: row.deathCount,
    latestIncidentOn: row.latestIncidentOn ?? undefined,
    mileage: toMileageAtFailure(row),
  };
}

/**
 * Present only when the ingest has run for this model and found enough odometer
 * readings. All four columns are written together, so one null means no mileage.
 */
function toMileageAtFailure(row: Row<typeof t.modelOwnerReports>): MileageAtFailure | undefined {
  const { mileageSampleCount, mileageLowMi, mileageMedianMi, mileageHighMi } = row;
  if (
    mileageSampleCount == null ||
    mileageLowMi == null ||
    mileageMedianMi == null ||
    mileageHighMi == null
  ) {
    return undefined;
  }
  return {
    lowMi: mileageLowMi,
    medianMi: mileageMedianMi,
    highMi: mileageHighMi,
    sampleCount: mileageSampleCount,
  };
}

/**
 * Severity comes from NHTSA's own "stop driving" and "park outside" advisories. Every other
 * recall is a safety defect too, so none map to `low`.
 */
export function toRecall(row: Row<typeof t.modelRecalls>, repaired?: boolean): Recall {
  return {
    ...(repaired === undefined ? {} : { repaired }),
    id: row.id,
    campaignNumber: row.campaignNumber,
    component: row.component,
    summary: row.summary,
    consequence: row.consequence,
    remedy: row.remedy,
    severity: row.parkIt || row.parkOutside ? 'high' : 'medium',
    parkIt: row.parkIt,
    parkOutside: row.parkOutside,
    reportedOn: row.reportedOn ?? undefined,
  };
}

export function toServiceRecord(row: Row<typeof t.serviceRecords>): ServiceRecord {
  return {
    id: row.id,
    description: row.description,
    date: row.serviceDate,
    cost: row.cost,
    source: row.source,
    mileageAtService: row.mileageAtService ?? undefined,
    maintenanceItemId: row.maintenanceItemId ?? undefined,
  };
}

/**
 * `priced` is not a column -- it is whether this repair has a benchmark for the caller's
 * own model, which the route resolves once for the whole catalog.
 */
export function toRepairCatalogItem(
  row: Row<typeof t.repairs>,
  priced: boolean,
): RepairCatalogItem {
  return { id: row.id, name: row.name, priced };
}

export function toAssessment(
  row: Row<typeof t.assessments>,
  parts: Row<typeof t.assessmentParts>[],
  laborTasks: Row<typeof t.assessmentLaborTasks>[],
): Assessment {
  const assessment: Assessment = {
    id: row.id,
    repairName: row.repairName,
    vehicleId: row.vehicleId,
    mileageAtAssessment: row.mileageAtAssessment,
    createdAt: row.createdAt.toISOString().slice(0, 10),
    recommendation: {
      headline: row.recommendationHeadline,
      badge: row.recommendationBadge,
      body: row.recommendationBody,
    },
    parts: {
      items: [...parts]
        .sort((a, b) => a.position - b.position)
        .map((part) => ({ name: part.name, avgPrice: part.avgPrice })),
      total: row.partsTotal,
      low: row.partsLow,
      high: row.partsHigh,
    },
    labor: {
      // Dropped rather than zeroed when the source published no book times: "0 h at $0/hr"
      // beside a real total reads as broken. See services/repairPricing.ts.
      ...(row.laborRatePerHour === null ? {} : { ratePerHour: row.laborRatePerHour }),
      ...(row.laborEstHours === null ? {} : { estHours: Number(row.laborEstHours) }),
      tasks: [...laborTasks]
        .sort((a, b) => a.position - b.position)
        .map((task) => ({
          name: task.name,
          ...(task.hours === null ? {} : { hours: Number(task.hours) }),
        })),
      total: row.laborTotal,
    },
    fairTotalLow: row.fairTotalLow,
    fairTotalHigh: row.fairTotalHigh,
    benchmarkSource: row.benchmarkSource,
  };

  // The five quote columns are written together, so testing one is enough.
  if (row.quoteAmount !== null && row.quoteVerdict !== null) {
    assessment.quote = {
      amount: row.quoteAmount,
      parts: row.quoteParts ?? 0,
      labor: row.quoteLabor ?? 0,
      verdict: row.quoteVerdict,
      explanation: row.quoteExplanation ?? '',
    };
  }

  if (row.completedAt !== null) {
    assessment.completedAt = row.completedAt;
    assessment.completedCost = row.completedCost ?? undefined;
  }

  return assessment;
}

export function toAccount(row: Row<typeof t.users>): Account {
  return {
    name: row.name,
    email: row.email,
    phone: row.phone,
    // The UI renders "Member since 2024"; only the year is meaningful.
    memberSince: row.memberSince.slice(0, 4),
    plan: row.plan,
    pricingModel: row.pricingModel ?? undefined,
    features: featuresFor(row.plan),
  };
}
