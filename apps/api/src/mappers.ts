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
  Assessment,
  ChatMessage,
  KnownIssue,
  MaintenanceItem,
  Recall,
  RepairCatalogItem,
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

export function toMaintenanceItem(row: Row<typeof t.maintenanceItems>): MaintenanceItem {
  return { id: row.id, label: row.label, status: row.status };
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
  const harmed = row.crashCount > 0 || row.fireCount > 0 || row.injuryCount > 0 || row.deathCount > 0;

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
  };
}

/**
 * Severity comes from NHTSA's advisories, not from a judgement made here. Both
 * "stop driving" and "park outside" are escalations it publishes explicitly; every
 * other recall is a safety defect too, so none of them map to `low`.
 */
export function toRecall(row: Row<typeof t.modelRecalls>): Recall {
  return {
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

export function toChatMessage(row: Row<typeof t.chatMessages>): ChatMessage {
  const message: ChatMessage = { id: row.id, role: row.role, text: row.text };

  if (row.urgencyLevel && row.urgencyText) {
    message.urgency = { level: row.urgencyLevel, text: row.urgencyText };
  }

  if (row.ctaLabel && row.ctaAction === 'start_assessment') {
    message.cta = { label: row.ctaLabel, action: 'start_assessment' };
  }

  return message;
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
