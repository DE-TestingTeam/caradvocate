import { and, asc, eq, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Router } from 'express';
import {
  campaignNumberSchema,
  newMaintenanceItemSchema,
  newVehicleSchema,
  recallStatusSchema,
  updateMaintenanceItemSchema,
  updateVehicleSchema,
  vinSchema,
  type KnownIssueReport,
  type RecallReport,
  type SafetyRatingReport,
  type VehicleImage,
} from '@caradvocate/shared';
import type { Database } from '../db/index.js';
import {
  maintenanceItems,
  modelKnownIssues,
  modelRecalls,
  serviceRecords,
  vehicleRecallStatus,
  vehicleValuePoints,
  vehicles,
} from '../db/schema.js';
import { toKnownIssue, toKnownIssueFromReports, toRecall, toSafetyRating, toVehicle } from '../mappers.js';
import { validateBody } from '../middleware/validate.js';
import { userIdOf } from '../middleware/currentUser.js';
import { fetchVehicleImage } from '../services/carImages.js';
import { getOwnerReports } from '../services/complaintSync.js';
import { loadMaintenanceItems, toMaintenanceItem } from '../services/maintenanceDue.js';
import { modelMatches, type ModelKey } from '../services/modelFeed.js';
import { getModelRecalls } from '../services/recallSync.js';
import { getModelSafetyRatings } from '../services/safetyRatingSync.js';
import { decodeVin } from '../services/vinDecode.js';
import { HttpError } from '../lib/httpError.js';
import { requireOwnVehicle, stringParam } from './helpers.js';

export const vehicleRouter = Router();

/** The year/make/model a global feed is keyed on. */
function modelKeyOf(vehicle: ModelKey): ModelKey {
  return { year: vehicle.year, make: vehicle.make, model: vehicle.model };
}

/** The valuation trend points, in the order the chart plots them. */
function loadValuePoints(db: Database, vehicleId: string) {
  return db
    .select()
    .from(vehicleValuePoints)
    .where(eq(vehicleValuePoints.vehicleId, vehicleId))
    .orderBy(asc(vehicleValuePoints.position));
}

vehicleRouter.get('/', async (req, res) => {
  const vehicle = await requireOwnVehicle(req);
  const points = await loadValuePoints(req.db, vehicle.id);

  res.json(toVehicle(vehicle, points));
});

vehicleRouter.patch('/', validateBody(updateVehicleSchema), async (req, res) => {
  const vehicle = await requireOwnVehicle(req);

  const [updated] = await req.db
    .update(vehicles)
    .set(req.body)
    // Re-asserting the id here means a future multi-vehicle version cannot
    // accidentally update by id alone.
    .where(eq(vehicles.id, vehicle.id))
    .returning();

  const points = await loadValuePoints(req.db, updated.id);

  res.json(toVehicle(updated, points));
});

/**
 * Adds the caller's vehicle during onboarding.
 *
 * Valuation columns are deliberately left null: nothing has priced this car yet.
 * Maintenance and recalls are likewise empty until a recall feed is connected --
 * an empty list is honest, invented items are not.
 */
vehicleRouter.post('/', validateBody(newVehicleSchema), async (req, res) => {
  const userId = userIdOf(req);

  const existing = await req.db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(eq(vehicles.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    // The product is single-vehicle today. Fail loudly rather than silently
    // creating a second car the rest of the app cannot reach.
    throw HttpError.conflict('This account already has a vehicle');
  }

  const [created] = await req.db
    .insert(vehicles)
    .values({
      userId,
      year: req.body.year,
      make: req.body.make,
      model: req.body.model,
      trim: req.body.trim ?? null,
      // Left null when skipped. The owner can add it later from Account.
      vin: req.body.vin ?? null,
      mileage: req.body.mileage,
    })
    .returning();

  res.status(201).json(toVehicle(created, []));
});

/**
 * Decodes a VIN into year/make/model so onboarding can prefill.
 *
 * Mounted under /vehicle because it is only ever used while adding one. Returns
 * 404 when the VIN cannot be decoded, which the client treats as "use the manual
 * form" rather than as an error worth showing.
 */
vehicleRouter.get('/decode/:vin', async (req, res) => {
  const parsed = vinSchema.safeParse(stringParam(req, 'vin'));
  if (!parsed.success) {
    throw new HttpError('validation_failed', 'That does not look like a VIN', [
      { path: 'vin', message: parsed.error.issues[0]?.message ?? 'Invalid VIN' },
    ]);
  }

  res.json(await decodeVin(parsed.data));
});

/**
 * Upkeep jobs with their due status worked out.
 *
 * The status is computed, never stored -- see services/maintenanceDue.ts. That needs
 * two things beyond the job itself: today's odometer, and the last service logged
 * against each job, which is one grouped query rather than one per item.
 */
vehicleRouter.get('/maintenance', async (req, res) => {
  const vehicle = await requireOwnVehicle(req);
  res.json(await loadMaintenanceItems(req.db, vehicle));
});

vehicleRouter.post('/maintenance', validateBody(newMaintenanceItemSchema), async (req, res) => {
  const vehicle = await requireOwnVehicle(req);

  // Appended rather than inserted: `position` is the owner's own ordering, and the
  // response is sorted by urgency anyway.
  const [{ next } = { next: 0 }] = await req.db
    .select({ next: sql<number>`coalesce(max(${maintenanceItems.position}), -1) + 1` })
    .from(maintenanceItems)
    .where(eq(maintenanceItems.vehicleId, vehicle.id));

  const [row] = await req.db
    .insert(maintenanceItems)
    .values({
      vehicleId: vehicle.id,
      label: req.body.label,
      intervalMiles: req.body.intervalMiles ?? null,
      intervalMonths: req.body.intervalMonths ?? null,
      position: Number(next),
    })
    .returning();

  const context = { currentMileage: vehicle.mileage, today: new Date() };
  res.status(201).json(toMaintenanceItem(row, undefined, context));
});

vehicleRouter.patch('/maintenance/:id', validateBody(updateMaintenanceItemSchema), async (req, res) => {
  const vehicle = await requireOwnVehicle(req);
  const id = await requireOwnMaintenanceItem(req, vehicle.id);

  // Explicit nulls so clearing an interval is possible; `undefined` would be
  // dropped by Drizzle and the old value would silently survive.
  const patch: Record<string, unknown> = {};
  if (req.body.label !== undefined) patch.label = req.body.label;
  if ('intervalMiles' in req.body) patch.intervalMiles = req.body.intervalMiles ?? null;
  if ('intervalMonths' in req.body) patch.intervalMonths = req.body.intervalMonths ?? null;

  const [row] = await req.db
    .update(maintenanceItems)
    .set(patch)
    .where(eq(maintenanceItems.id, id))
    .returning();

  const [last] = await req.db
    .select({ date: max(serviceRecords.serviceDate), mileage: max(serviceRecords.mileageAtService) })
    .from(serviceRecords)
    .where(eq(serviceRecords.maintenanceItemId, id));

  const context = { currentMileage: vehicle.mileage, today: new Date() };
  res.json(toMaintenanceItem(row, last?.date ? { date: last.date, mileage: last.mileage } : undefined, context));
});

vehicleRouter.delete('/maintenance/:id', async (req, res) => {
  const vehicle = await requireOwnVehicle(req);
  const id = await requireOwnMaintenanceItem(req, vehicle.id);

  // Service records referencing it survive with a null link: the work still happened.
  await req.db.delete(maintenanceItems).where(eq(maintenanceItems.id, id));
  res.status(204).end();
});

/**
 * Narrows a path id to an item on the caller's own car.
 *
 * The id comes from the client, so the vehicle filter is what stops one account
 * editing another's schedule -- the same reasoning as requireOwnVehicle.
 */
async function requireOwnMaintenanceItem(
  req: Parameters<typeof requireOwnVehicle>[0],
  vehicleId: string,
): Promise<string> {
  const id = stringParam(req, 'id');
  if (!z.string().uuid().safeParse(id).success) {
    throw HttpError.notFound('No such maintenance item');
  }

  const [row] = await req.db
    .select({ id: maintenanceItems.id })
    .from(maintenanceItems)
    .where(and(eq(maintenanceItems.id, id), eq(maintenanceItems.vehicleId, vehicleId)))
    .limit(1);

  if (!row) throw HttpError.notFound('No such maintenance item');
  return row.id;
}

/**
 * Open safety recalls for the caller's model, mirrored from NHTSA.
 *
 * Like known issues this is global reference data keyed by year/make/model. The
 * first request for a model pays for the upstream fetch; after that it is a local
 * query for a week (see services/recallSync.ts).
 *
 * `checked` is returned alongside the list so the UI can tell an all-clear apart
 * from never having reached NHTSA, rather than presenting the second as the first.
 */
vehicleRouter.get('/recalls', async (req, res) => {
  const vehicle = await requireOwnVehicle(req);
  const [{ recalls, synced }, owned] = await Promise.all([
    getModelRecalls(req.db, modelKeyOf(vehicle)),
    req.db.select().from(vehicleRecallStatus).where(eq(vehicleRecallStatus.vehicleId, vehicle.id)),
  ]);

  const repairedBy = new Map(owned.map((row) => [row.campaignNumber, row.repaired]));
  const merged = recalls.map((row) => toRecall(row, repairedBy.get(row.campaignNumber)));

  // Anything the owner has confirmed as done drops to the bottom. It stays listed
  // -- the record matters, and they may have been mistaken -- but it should not
  // compete with outstanding work for attention.
  merged.sort((a, b) => Number(a.repaired === true) - Number(b.repaired === true));

  res.json({ recalls: merged, checked: synced } satisfies RecallReport);
});

/**
 * Records what the owner says about one recall on their car.
 *
 * The campaign has to actually apply to this vehicle's model, so a mistyped or
 * invented number is a 404 rather than a stored row about a car this is not.
 */
vehicleRouter.put('/recalls/:campaign', validateBody(recallStatusSchema), async (req, res) => {
  const vehicle = await requireOwnVehicle(req);
  const campaignNumber = await requireCampaignForVehicle(req, vehicle);

  await req.db
    .insert(vehicleRecallStatus)
    .values({ vehicleId: vehicle.id, campaignNumber, repaired: req.body.repaired })
    .onConflictDoUpdate({
      target: [vehicleRecallStatus.vehicleId, vehicleRecallStatus.campaignNumber],
      set: { repaired: req.body.repaired, notedAt: new Date() },
    });

  res.status(204).end();
});

/** Clears the owner's answer, returning the recall to an honest "unknown". */
vehicleRouter.delete('/recalls/:campaign', async (req, res) => {
  const vehicle = await requireOwnVehicle(req);
  const campaignNumber = await requireCampaignForVehicle(req, vehicle);

  await req.db
    .delete(vehicleRecallStatus)
    .where(
      and(eq(vehicleRecallStatus.vehicleId, vehicle.id), eq(vehicleRecallStatus.campaignNumber, campaignNumber)),
    );

  res.status(204).end();
});

/**
 * Validates the campaign in the path and confirms it is one of this model's.
 *
 * Without the second half an owner could record a status against any campaign in
 * NHTSA's catalogue, and the recalls list would carry answers to questions this car
 * was never asked.
 */
async function requireCampaignForVehicle(
  req: Parameters<typeof requireOwnVehicle>[0],
  vehicle: ModelKey,
): Promise<string> {
  const parsed = campaignNumberSchema.safeParse(stringParam(req, 'campaign'));
  if (!parsed.success) {
    throw new HttpError('validation_failed', 'That does not look like an NHTSA campaign number', [
      { path: 'campaign', message: parsed.error.issues[0]?.message ?? 'Invalid campaign number' },
    ]);
  }

  const [match] = await req.db
    .select({ id: modelRecalls.id })
    .from(modelRecalls)
    .where(and(modelMatches(modelRecalls, vehicle), eq(modelRecalls.campaignNumber, parsed.data)))
    .limit(1);

  if (!match) throw HttpError.notFound('That recall does not apply to this vehicle');
  return parsed.data;
}

/**
 * NHTSA crash-test ratings for the caller's model, mirrored locally.
 *
 * One row per tested variant, worst-rated first -- NHTSA tests body styles and
 * drivetrains separately and this endpoint does not average them, because a 4x2 and a
 * 4x4 can differ by a star and the mean describes neither.
 *
 * `checked` carries the same weight as on the recalls endpoint: an untested car and
 * an unreachable NHTSA both yield an empty list, and only one is a fact about the car.
 */
vehicleRouter.get('/safety', async (req, res) => {
  const vehicle = await requireOwnVehicle(req);
  const { variants, synced } = await getModelSafetyRatings(req.db, modelKeyOf(vehicle));

  res.json({ variants: variants.map(toSafetyRating), checked: synced } satisfies SafetyRatingReport);
});

/**
 * The signed URL of a studio photo of the caller's model.
 *
 * Deliberately not part of `GET /api/vehicle`: it expires, so bundling it into the
 * vehicle record would put a decaying value inside the one response the whole app
 * caches and reuses. A separate endpoint also means a slow or broken CarImages
 * delays a picture rather than the car.
 *
 * Always 200, even with nothing to show -- an absent `imageUrl` is the normal way
 * this says "placeholder", not an error. See the VehicleImage contract.
 */
vehicleRouter.get('/image', async (req, res) => {
  const vehicle = await requireOwnVehicle(req);

  const image: VehicleImage = await fetchVehicleImage(modelKeyOf(vehicle));

  res.json(image);
});

/** Beyond this the list stops informing and starts overwhelming. */
const MAX_REPORTED_ISSUES = 8;

/**
 * Known issues are global reference data keyed by year/make/model -- there is
 * deliberately no user filter, because the answer is the same for every owner of
 * the same car.
 *
 * Two sources, in order. Curated entries come first because they are written for a
 * reader; aggregated NHTSA complaints follow, capped, because the raw feed runs to
 * hundreds of reports across dozens of components and a page-long list informs
 * nobody. `checked` reports whether the complaint feed was ever reached.
 */
vehicleRouter.get('/known-issues', async (req, res) => {
  const vehicle = await requireOwnVehicle(req);

  const [curated, reported] = await Promise.all([
    req.db
      .select()
      .from(modelKnownIssues)
      .where(
        and(
          eq(modelKnownIssues.year, vehicle.year),
          eq(modelKnownIssues.make, vehicle.make),
          eq(modelKnownIssues.model, vehicle.model),
        ),
      )
      .orderBy(asc(modelKnownIssues.position)),
    getOwnerReports(req.db, modelKeyOf(vehicle)),
  ]);

  res.json({
    issues: [
      ...curated.map(toKnownIssue),
      ...reported.reports.slice(0, MAX_REPORTED_ISSUES).map(toKnownIssueFromReports),
    ],
    checked: reported.synced,
  } satisfies KnownIssueReport);
});
