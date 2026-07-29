import { and, asc, desc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { completeAssessmentSchema, newAssessmentSchema } from '@caradvocate/shared';
import {
  assessmentLaborTasks,
  assessmentParts,
  assessments,
  benchmarkLaborTasks,
  benchmarkParts,
  repairBenchmarks,
  repairs,
  serviceRecords,
} from '../db/schema.js';
import { HttpError } from '../lib/httpError.js';
import { toAssessment } from '../mappers.js';
import { userIdOf } from '../middleware/currentUser.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { evaluateQuote } from '../services/quoteEvaluation.js';
import type { Database } from '../db/index.js';
import { requireOwnVehicle, stringParam } from './helpers.js';

export const assessmentsRouter = Router();

const idParamSchema = z.object({ id: z.string().uuid('Not a valid assessment id') });

/** Loads an assessment with its snapshot children, scoped to the requesting user. */
async function loadOwnAssessment(db: Database, id: string, userId: string) {
  const [row] = await db
    .select()
    .from(assessments)
    // The userId predicate is what makes another tenant's id a 404 rather than a leak.
    .where(and(eq(assessments.id, id), eq(assessments.userId, userId)))
    .limit(1);

  if (!row) throw HttpError.notFound('Assessment not found');

  const parts = await db
    .select()
    .from(assessmentParts)
    .where(eq(assessmentParts.assessmentId, row.id))
    .orderBy(asc(assessmentParts.position));

  const tasks = await db
    .select()
    .from(assessmentLaborTasks)
    .where(eq(assessmentLaborTasks.assessmentId, row.id))
    .orderBy(asc(assessmentLaborTasks.position));

  return { row, parts, tasks };
}

assessmentsRouter.get('/', async (req, res) => {
  const userId = userIdOf(req);

  const rows = await req.db
    .select()
    .from(assessments)
    .where(eq(assessments.userId, userId))
    .orderBy(desc(assessments.createdAt));

  // Children are fetched per row for clarity. With a realistic number of
  // assessments per user this is fine; batch it if that assumption changes.
  const result = [];
  for (const row of rows) {
    const parts = await req.db
      .select()
      .from(assessmentParts)
      .where(eq(assessmentParts.assessmentId, row.id))
      .orderBy(asc(assessmentParts.position));
    const tasks = await req.db
      .select()
      .from(assessmentLaborTasks)
      .where(eq(assessmentLaborTasks.assessmentId, row.id))
      .orderBy(asc(assessmentLaborTasks.position));
    result.push(toAssessment(row, parts, tasks));
  }

  res.json(result);
});

assessmentsRouter.get('/:id', validateParams(idParamSchema), async (req, res) => {
  const { row, parts, tasks } = await loadOwnAssessment(req.db, stringParam(req, 'id'), userIdOf(req));
  res.json(toAssessment(row, parts, tasks));
});

/**
 * Creates an assessment by SNAPSHOTTING the current benchmark.
 *
 * Nothing here is joined live from repairBenchmarks afterwards: reference pricing
 * gets refreshed, and an assessment the user saved must keep showing the numbers
 * they were actually shown.
 */
assessmentsRouter.post('/', validateBody(newAssessmentSchema), async (req, res) => {
  const userId = userIdOf(req);
  const vehicle = await requireOwnVehicle(req);

  const [benchmarkRow] = await req.db
    .select({ repair: repairs, benchmark: repairBenchmarks })
    .from(repairs)
    .innerJoin(repairBenchmarks, eq(repairBenchmarks.repairId, repairs.id))
    .where(eq(repairs.id, req.body.repairId))
    .limit(1);

  if (!benchmarkRow) {
    throw HttpError.notFound('No benchmark pricing available for that repair');
  }

  const { repair, benchmark } = benchmarkRow;

  const sourceParts = await req.db
    .select()
    .from(benchmarkParts)
    .where(eq(benchmarkParts.benchmarkId, benchmark.id))
    .orderBy(asc(benchmarkParts.position));

  const sourceTasks = await req.db
    .select()
    .from(benchmarkLaborTasks)
    .where(eq(benchmarkLaborTasks.benchmarkId, benchmark.id))
    .orderBy(asc(benchmarkLaborTasks.position));

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
