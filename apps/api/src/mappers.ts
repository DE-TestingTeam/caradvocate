/**
 * Row -> wire mapping.
 *
 * Postgres gives us snake_case columns, `numeric` as strings and `date` as
 * strings; the client contract in @caradvocate/shared wants camelCase and real
 * numbers. All of that translation happens here so routes stay thin and no
 * component ever sees a database shape.
 */
import type {
  Account,
  AssistFitment,
  Assessment,
  KnownIssue,
  MileageAtFailure,
  Recall,
  RepairCatalogItem,
  SafetyRating,
  ServiceRecord,
  Vehicle,
} from '@caradvocate/shared';
import type * as t from './db/schema.js';

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
 * Aggregated owner complaints, presented as a known issue.
 *
 * Severity is derived from what NHTSA actually recorded rather than from a
 * judgement of our own: a group where someone crashed, caught fire or was hurt is
 * high, a repeatedly-reported one is medium, and a handful of reports is low. Unlike
 * recalls, `low` is meaningful here -- two complaints about a model is noise, not a
 * fault, and dressing it up as one would mislead.
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
 * Severity comes from NHTSA's advisories, not from a judgement made here. Both
 * "stop driving" and "park outside" are escalations it publishes explicitly; every
 * other recall is a safety defect too, so none of them map to `low`.
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

/**
 * One NCAP-tested variant.
 *
 * Every rating is dropped rather than zeroed when NHTSA never ran the test, because
 * the wire contract uses absence to mean "untested" and a zero would render as a
 * zero-star car. `rolloverPossibility` arrives from `numeric` as a string.
 *
 * The fitment columns are plain `text` in the database -- adding a value should not
 * need a migration -- so an unrecognised one is dropped here rather than passed
 * through as a string the client's union does not admit.
 */
export function toSafetyRating(row: Row<typeof t.modelSafetyRatings>): SafetyRating {
  return {
    id: row.id,
    description: row.description,
    overall: row.overallRating ?? undefined,
    frontCrash: row.frontCrashRating ?? undefined,
    sideCrash: row.sideCrashRating ?? undefined,
    rollover: row.rolloverRating ?? undefined,
    rolloverPossibility: readPossibility(row.rolloverPossibility),
    forwardCollisionWarning: fitment(row.forwardCollisionWarning),
    laneDepartureWarning: fitment(row.laneDepartureWarning),
    electronicStabilityControl: fitment(row.electronicStabilityControl),
  };
}

/** `numeric` round-trips as a string; anything unparseable is no reading at all. */
function readPossibility(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Narrows a stored fitment string to the contract's union.
 *
 * The column is plain `text` so adding a value needs no migration, which means an
 * unrecognised one is possible; it is dropped rather than passed through as a string
 * the client's union does not admit.
 */
function fitment(value: string | null): AssistFitment | undefined {
  return value === 'standard' || value === 'optional' || value === 'no' ? value : undefined;
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

export function toRepairCatalogItem(row: Row<typeof t.repairs>): RepairCatalogItem {
  return { id: row.id, name: row.name };
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
      ratePerHour: row.laborRatePerHour,
      estHours: Number(row.laborEstHours),
      tasks: [...laborTasks]
        .sort((a, b) => a.position - b.position)
        .map((task) => ({ name: task.name, hours: Number(task.hours) })),
      total: row.laborTotal,
    },
    fairTotalLow: row.fairTotalLow,
    fairTotalHigh: row.fairTotalHigh,
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

export function toAccount(
  row: Row<typeof t.users>,
  features: Row<typeof t.userFeatures>[],
): Account {
  return {
    name: row.name,
    email: row.email,
    phone: row.phone,
    // The UI renders "Member since 2024"; only the year is meaningful.
    memberSince: row.memberSince.slice(0, 4),
    plan: 'paid',
    features: [...features]
      .sort((a, b) => a.position - b.position)
      .map((feature) => ({ name: feature.name, status: feature.status })),
  };
}
