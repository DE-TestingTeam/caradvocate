import { and, asc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { updateVehicleSchema } from '@caradvocate/shared';
import { maintenanceItems, modelKnownIssues, vehicleValuePoints, vehicles } from '../db/schema.js';
import { toKnownIssue, toMaintenanceItem, toVehicle } from '../mappers.js';
import { validateBody } from '../middleware/validate.js';
import { requireOwnVehicle } from './helpers.js';

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
