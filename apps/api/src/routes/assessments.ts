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

/**
 * The snapshotted parts and labour of one assessment, in display order.
 *
 * `position` is what preserves the order the benchmark listed them in; without it
 * the line items would come back in whatever order Postgres chose.
 */
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

  // Children are fetched per row for clarity. With a realistic number of
  // assessments per user this is fine; batch it if that assumption changes.
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
 * The reference pricing for one repair, with its line items.
 *
 * A repair with no benchmark row is a 404: the whole point of an assessment is the
 * comparison, and there is nothing to compare against.
 */
async function loadBenchmark(db: Database, repairId: string) {
  const [row] = await db
    .select({ repair: repairs, benchmark: repairBenchmarks })
    .from(repairs)
    .innerJoin(repairBenchmarks, eq(repairBenchmarks.repairId, repairs.id))
    .where(eq(repairs.id, repairId))
    .limit(1);

  if (!row) {
    throw HttpError.notFound('No benchmark pricing available for that repair');
  }

  const [sourceParts, sourceTasks] = await Promise.all([
    db
      .select()
      .from(benchmarkParts)
      .where(eq(benchmarkParts.benchmarkId, row.benchmark.id))
      .orderBy(asc(benchmarkParts.position)),
    db
      .select()
      .from(benchmarkLaborTasks)
      .where(eq(benchmarkLaborTasks.benchmarkId, row.benchmark.id))
      .orderBy(asc(benchmarkLaborTasks.position)),
  ]);

  return { repair: row.repair, benchmark: row.benchmark, sourceParts, sourceTasks };
}

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

  const { repair, benchmark, sourceParts, sourceTasks } = await loadBenchmark(
    req.db,
    req.body.repairId,
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
