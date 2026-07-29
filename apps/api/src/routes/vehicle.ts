import { and, asc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { newVehicleSchema, updateVehicleSchema, vinSchema } from '@caradvocate/shared';
import { maintenanceItems, modelKnownIssues, vehicleValuePoints, vehicles } from '../db/schema.js';
import { toKnownIssue, toMaintenanceItem, toVehicle } from '../mappers.js';
import { validateBody } from '../middleware/validate.js';
import { userIdOf } from '../middleware/currentUser.js';
import { decodeVin } from '../services/vinDecode.js';
import { HttpError } from '../lib/httpError.js';
import { requireOwnVehicle, stringParam } from './helpers.js';

export const vehicleRouter = Router();

vehicleRouter.get('/', async (req, res) => {
  const vehicle = await requireOwnVehicle(req);
  const points = await req.db
    .select()
    .from(vehicleValuePoints)
    .where(eq(vehicleValuePoints.vehicleId, vehicle.id))
    .orderBy(asc(vehicleValuePoints.position));

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

  const points = await req.db
    .select()
    .from(vehicleValuePoints)
    .where(eq(vehicleValuePoints.vehicleId, updated.id))
    .orderBy(asc(vehicleValuePoints.position));

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

  const existing = await req.db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.userId, userId)).limit(1);
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

vehicleRouter.get('/maintenance', async (req, res) => {
  const vehicle = await requireOwnVehicle(req);
  const rows = await req.db
    .select()
    .from(maintenanceItems)
    .where(eq(maintenanceItems.vehicleId, vehicle.id))
    .orderBy(asc(maintenanceItems.position));

  res.json(rows.map(toMaintenanceItem));
});

/**
 * Known issues are global reference data keyed by year/make/model -- there is
 * deliberately no user filter, because the answer is the same for every owner of
 * the same car.
 */
vehicleRouter.get('/known-issues', async (req, res) => {
  const vehicle = await requireOwnVehicle(req);
  const rows = await req.db
    .select()
    .from(modelKnownIssues)
    .where(
      and(
        eq(modelKnownIssues.year, vehicle.year),
        eq(modelKnownIssues.make, vehicle.make),
        eq(modelKnownIssues.model, vehicle.model),
      ),
    )
    .orderBy(asc(modelKnownIssues.position));

  res.json(rows.map(toKnownIssue));
});
