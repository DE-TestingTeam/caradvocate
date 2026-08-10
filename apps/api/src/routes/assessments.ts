import { and, asc, desc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { completeAssessmentSchema, newAssessmentSchema, type Assessment } from '@caradvocate/shared';
import {
  assessmentLaborTasks,
  assessmentParts,
  assessments,
  benchmarkLaborTasks,
  benchmarkParts,
  repairs,
  serviceRecords,
} from '../db/schema.js';
import { HttpError } from '../lib/httpError.js';
import { toAssessment } from '../mappers.js';
import { userIdOf } from '../middleware/currentUser.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { evaluateQuote } from '../services/quoteEvaluation.js';
import { ensureRepairPricing, findBenchmark } from '../services/repairPricingSync.js';
import type { ModelKey } from '../services/modelFeed.js';
import type { Database } from '../db/index.js';
import { requireOwnVehicle, stringParam } from './helpers.js';

export const assessmentsRouter = Router();

/**
 * The prompts a duration actually says something about. "Grinding for three weeks" is a fact
 * about the car; "routine service for three weeks" is noise, and stored it would later read as a
 * reported symptom to anything summarising the row.
 */
const SYMPTOM_IS_MEANINGFUL = new Set<string>(['symptom', 'warning_light']);

const idParamSchema = z.object({ id: z.string().uuid('Not a valid assessment id') });

/** The snapshotted parts and labour of one assessment, in the order the benchmark listed them. */
async function loadSnapshotChildren(db: Database, assessmentId: string) {
  const [parts, tasks] = await Promise.all([
    db
      .select()
      .from(assessmentParts)
      .where(eq(assessmentParts.assessmentId, assessmentId))
      .orderBy(asc(assessmentParts.position)),
    db
      .select()
      .from(assessmentLaborTasks)
      .where(eq(assessmentLaborTasks.assessmentId, assessmentId))
      .orderBy(asc(assessmentLaborTasks.position)),
  ]);

  return { parts, tasks };
}

/** Loads an assessment with its snapshot children, scoped to the requesting user. */
async function loadOwnAssessment(db: Database, id: string, userId: string) {
  const [row] = await db
    .select()
    .from(assessments)
    // The userId predicate is what makes another tenant's id a 404 rather than a leak.
    .where(and(eq(assessments.id, id), eq(assessments.userId, userId)))
    .limit(1);

  if (!row) throw HttpError.notFound('Assessment not found');

  const { parts, tasks } = await loadSnapshotChildren(db, row.id);
  return { row, parts, tasks };
}

assessmentsRouter.get('/', async (req, res) => {
  const userId = userIdOf(req);

  const rows = await req.db
    .select()
    .from(assessments)
    .where(eq(assessments.userId, userId))
    .orderBy(desc(assessments.createdAt));

  // Children per row for clarity. Fine at a realistic number of assessments per user;
  // batch it if that assumption changes.
  const result: Assessment[] = [];
  for (const row of rows) {
    const { parts, tasks } = await loadSnapshotChildren(req.db, row.id);
    result.push(toAssessment(row, parts, tasks));
  }

  res.json(result);
});

assessmentsRouter.get('/:id', validateParams(idParamSchema), async (req, res) => {
  const id = stringParam(req, 'id');
  const { row, parts, tasks } = await loadOwnAssessment(req.db, id, userIdOf(req));
  res.json(toAssessment(row, parts, tasks));
});

/**
 * The pricing for one repair on the caller's OWN model, with its line items. No pricing
 * for this car is a 404, never a substitution with another vehicle's figures -- an
 * assessment is a comparison against the car in the driveway. See
 * services/repairPricingSync.ts.
 */
async function loadBenchmark(db: Database, repairId: string, model: ModelKey) {
  const [repair] = await db.select().from(repairs).where(eq(repairs.id, repairId)).limit(1);
  if (!repair) throw HttpError.notFound('No pricing available for that repair');

  // One metered call per model per week at most; see services/repairPricingSync.ts.
  await ensureRepairPricing(db, model);

  const benchmark = await findBenchmark(db, repairId, model);
  if (!benchmark) {
    // Names the car: the reason is specific to it, and the client shows this verbatim.
    throw HttpError.notFound(
      `We do not have pricing for a ${model.year} ${model.make} ${model.model} for that repair yet.`,
    );
  }

  const [sourceParts, sourceTasks] = await Promise.all([
    db
      .select()
      .from(benchmarkParts)
      .where(eq(benchmarkParts.benchmarkId, benchmark.id))
      .orderBy(asc(benchmarkParts.position)),
    db
      .select()
      .from(benchmarkLaborTasks)
      .where(eq(benchmarkLaborTasks.benchmarkId, benchmark.id))
      .orderBy(asc(benchmarkLaborTasks.position)),
  ]);

  return { repair, benchmark, sourceParts, sourceTasks };
}

/**
 * Creates an assessment by SNAPSHOTTING the current benchmark. Nothing is joined live from
 * repairBenchmarks afterwards: reference pricing gets refreshed, and a saved assessment
 * must keep showing the numbers the user was shown.
 */
assessmentsRouter.post('/', validateBody(newAssessmentSchema), async (req, res) => {
  const userId = userIdOf(req);
  const vehicle = await requireOwnVehicle(req);

  const { repair, benchmark, sourceParts, sourceTasks } = await loadBenchmark(
    req.db,
    req.body.repairId,
    { year: vehicle.year, make: vehicle.make, model: vehicle.model },
  );

  const quote =
    typeof req.body.quoteAmount === 'number'
      ? evaluateQuote(req.body.quoteAmount, {
          partsTotal: benchmark.partsTotal,
          laborTotal: benchmark.laborTotal,
          fairTotalLow: benchmark.fairTotalLow,
          fairTotalHigh: benchmark.fairTotalHigh,
        })
      : undefined;

  const created = await req.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(assessments)
      .values({
        userId,
        vehicleId: vehicle.id,
        repairId: repair.id,
        repairName: repair.name,
        mileageAtAssessment: vehicle.mileage,
        // Why the owner is asking. Stored but not yet reasoned over -- the necessity check is
        // still unbuilt (STATUS.md gap 1) -- and collected now because a judgement cannot be
        // made retroactively about assessments that never recorded their own reason.
        promptedBy: req.body.promptedBy,
        symptomNotes: req.body.symptomNotes ?? null,
        // Dropped unless it means something: a duration attached to "routine service" is an
        // answer to a question that was not asked, and would read later as a reported symptom.
        symptomDuration: SYMPTOM_IS_MEANINGFUL.has(req.body.promptedBy)
          ? (req.body.symptomDuration ?? null)
          : null,
        recommendationHeadline: benchmark.recommendationHeadline,
        recommendationBadge: benchmark.recommendationBadge,
        recommendationBody: benchmark.recommendationBody,
        partsTotal: benchmark.partsTotal,
        partsLow: benchmark.partsLow,
        partsHigh: benchmark.partsHigh,
        laborRatePerHour: benchmark.laborRatePerHour,
        laborEstHours: benchmark.laborEstHours,
        laborTotal: benchmark.laborTotal,
        fairTotalLow: benchmark.fairTotalLow,
        fairTotalHigh: benchmark.fairTotalHigh,
        // Snapshotted with the figures: which car's pricing this verdict rests on is part
        // of the answer, not metadata about it.
        benchmarkSource: benchmark.source,
        quoteAmount: quote?.amount ?? null,
        quoteParts: quote?.parts ?? null,
        quoteLabor: quote?.labor ?? null,
        quoteVerdict: quote?.verdict ?? null,
        quoteExplanation: quote?.explanation ?? null,
        quoteFileName: req.body.quoteFileName ?? null,
      })
      .returning();

    if (sourceParts.length > 0) {
      await tx.insert(assessmentParts).values(
        sourceParts.map((part, position) => ({
          assessmentId: row.id,
          name: part.name,
          avgPrice: part.avgPrice,
          position,
        })),
      );
    }

    if (sourceTasks.length > 0) {
      await tx.insert(assessmentLaborTasks).values(
        sourceTasks.map((task, position) => ({
          assessmentId: row.id,
          name: task.name,
          hours: task.hours,
          position,
        })),
      );
    }

    return row;
  });

  const { row, parts, tasks } = await loadOwnAssessment(req.db, created.id, userId);
  res.status(201).json(toAssessment(row, parts, tasks));
});

/**
 * Marks a repair complete and mirrors it into service history, which is what the
 * Repair Completed dialog promises the user. Both writes share a transaction so
 * history can never disagree with the assessment.
 */
assessmentsRouter.post(
  '/:id/complete',
  validateParams(idParamSchema),
  validateBody(completeAssessmentSchema),
  async (req, res) => {
    const userId = userIdOf(req);
    const { row } = await loadOwnAssessment(req.db, stringParam(req, 'id'), userId);

    if (row.completedAt) {
      throw HttpError.conflict('This repair is already marked complete');
    }

    const completedAt = new Date().toISOString().slice(0, 10);

    await req.db.transaction(async (tx) => {
      await tx
        .update(assessments)
        .set({ completedAt, completedCost: req.body.cost })
        .where(and(eq(assessments.id, row.id), eq(assessments.userId, userId)));

      await tx.insert(serviceRecords).values({
        userId,
        vehicleId: row.vehicleId,
        description: row.repairName,
        serviceDate: completedAt,
        cost: req.body.cost,
        source: 'repair_cost_checker',
      });
    });

    const fresh = await loadOwnAssessment(req.db, row.id, userId);
    res.json(toAssessment(fresh.row, fresh.parts, fresh.tasks));
  },
);
