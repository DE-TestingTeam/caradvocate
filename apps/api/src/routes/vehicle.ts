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
import { toKnownIssue, toKnownIssueFromReports, toRecall, toVehicle } from '../mappers.js';
import { validateBody } from '../middleware/validate.js';
import { userIdOf } from '../middleware/currentUser.js';
import { fetchVehicleImage, fetchVehicleModel } from '../services/carImages.js';
import { getOwnerReports } from '../services/complaintSync.js';
import { loadMaintenanceItems, toMaintenanceItem } from '../services/maintenanceDue.js';
import { ensureMaintenanceSchedule } from '../services/maintenanceScheduleSync.js';
import { ensureMarketValue } from '../services/marketValueSync.js';
import { modelMatches, type ModelKey } from '../services/modelFeed.js';
import { getModelRecalls } from '../services/recallSync.js';
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
  let vehicle = await requireOwnVehicle(req);
  if (await ensureMarketValue(req.db, vehicle)) {
    vehicle = await requireOwnVehicle(req);
  }
  const points = await loadValuePoints(req.db, vehicle.id);

  res.json(toVehicle(vehicle, points));
});

vehicleRouter.patch('/', validateBody(updateVehicleSchema), async (req, res) => {
  const vehicle = await requireOwnVehicle(req);

  let [updated] = await req.db
    .update(vehicles)
    // A mileage in the body is the owner telling us the odometer as of now -- from Account, or
    // from My Car's confirmation prompt -- so it is the one reading whose date really is today.
    // Stamped only when mileage is actually present: this is a PATCH, and a request that only
    // changes the zip must not refresh the odometer's timestamp and silence the prompt.
    //
    // Unlike the ratchet in services/odometer.ts this accepts a LOWER figure. It has to: an
    // owner correcting a mistyped 1,210,000 back to 121,000 has nowhere else to do it, and that
    // is the documented escape hatch for the ratchet's one sharp edge.
    .set(req.body.mileage == null ? req.body : { ...req.body, mileageUpdatedAt: new Date() })
    .where(eq(vehicles.id, vehicle.id))
    .returning();

  if (await ensureMarketValue(req.db, updated)) {
    updated = await requireOwnVehicle(req);
  }
  const points = await loadValuePoints(req.db, updated.id);

  res.json(toVehicle(updated, points));
});

/**
 * Adds the caller's vehicle during onboarding. Valuation columns are left null -- nothing
 * has priced this car yet -- and maintenance and recalls start empty.
 */
vehicleRouter.post('/', validateBody(newVehicleSchema), async (req, res) => {
  const userId = userIdOf(req);

  const existing = await req.db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(eq(vehicles.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    // Single-vehicle today. Fail loudly rather than create a car the app cannot reach.
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
      // The owner is reading their own odometer as they type this, so today is the truth. The
      // column defaults to null and null means stale, which would put a confirmation prompt on
      // My Car the moment onboarding finished.
      mileageUpdatedAt: new Date(),
      zip: req.body.zip ?? null,
    })
    .returning();

  res.status(201).json(toVehicle(created, []));
});

/**
 * Decodes a VIN into year/make/model so onboarding can prefill. A VIN that cannot be
 * decoded is a 404, which the client treats as "use the manual form".
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
 * Upkeep jobs with their due status computed -- never stored. See services/maintenanceDue.ts.
 *
 * The schedule sync runs first so a car gets the manufacturer's own intervals on the first
 * visit rather than showing generic ones until something else happens to fetch them. At most
 * one vendor call per car, ever; see services/maintenanceScheduleSync.ts.
 */
vehicleRouter.get('/maintenance', async (req, res) => {
  const vehicle = await requireOwnVehicle(req);
  await ensureMaintenanceSchedule(req.db, vehicle);
  res.json(await loadMaintenanceItems(req.db, vehicle));
});

vehicleRouter.post('/maintenance', validateBody(newMaintenanceItemSchema), async (req, res) => {
  const vehicle = await requireOwnVehicle(req);

  // Appended: `position` is the owner's ordering, and the response sorts by urgency anyway.
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

  // Explicit nulls so clearing an interval is possible: Drizzle drops `undefined`, and
  // the old value would silently survive.
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
 * Narrows a path id to an item on the caller's own car. The id comes from the client, so
 * the vehicle filter is what stops one account editing another's schedule.
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
 * Open safety recalls for the caller's model, mirrored from NHTSA. Keyed by
 * year/make/model, so the first request for a model pays for the upstream fetch and the
 * rest of the week is a local query (services/recallSync.ts). `checked` lets the UI tell
 * an all-clear apart from never having reached NHTSA.
 */
vehicleRouter.get('/recalls', async (req, res) => {
  const vehicle = await requireOwnVehicle(req);
  const [{ recalls, status }, owned] = await Promise.all([
    getModelRecalls(req.db, modelKeyOf(vehicle)),
    req.db.select().from(vehicleRecallStatus).where(eq(vehicleRecallStatus.vehicleId, vehicle.id)),
  ]);

  const repairedBy = new Map(owned.map((row) => [row.campaignNumber, row.repaired]));
  const merged = recalls.map((row) => toRecall(row, repairedBy.get(row.campaignNumber)));

  // Anything the owner confirmed as done drops to the bottom. Still listed -- they may
  // have been mistaken -- but not competing with outstanding work for attention.
  merged.sort((a, b) => Number(a.repaired === true) - Number(b.repaired === true));

  res.json({ recalls: merged, status } satisfies RecallReport);
});

/**
 * Records what the owner says about one recall on their car. The campaign has to apply to
 * this model, so a mistyped or invented number is a 404 rather than a stored row.
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
 * Validates the campaign in the path and confirms it is one of this model's. Without the
 * second half, an owner could record a status against any campaign in NHTSA's catalogue.
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
 * The signed URLs of a studio photo and an interactive 3D model of the caller's model.
 * Separate from `GET /api/vehicle` because both expire, and bundling them would put a
 * decaying value inside the one response the whole app caches -- and a slow CarImages
 * then delays a picture, not the car.
 *
 * Fetched together (one round trip) since both are the same decoration with the same
 * lookup; each still has its own cache and quota cost inside carImages.ts.
 *
 * Always 200: an absent `imageUrl` or `modelUrl` means "placeholder", not an error.
 */
vehicleRouter.get('/image', async (req, res) => {
  const vehicle = await requireOwnVehicle(req);
  const lookup = modelKeyOf(vehicle);

  const [image, model] = await Promise.all([fetchVehicleImage(lookup), fetchVehicleModel(lookup)]);

  const response: VehicleImage = { ...image, ...model };
  res.json(response);
});

/** Beyond this the list stops informing and starts overwhelming. */
const MAX_REPORTED_ISSUES = 8;

/**
 * Known issues, keyed by year/make/model -- no user filter, since the answer is the same
 * for every owner of the same car. Curated entries come first because they are written
 * for a reader; aggregated NHTSA complaints follow, capped. `checked` reports whether the
 * complaint feed was ever reached.
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
