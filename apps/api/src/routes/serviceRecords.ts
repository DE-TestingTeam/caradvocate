import { and, desc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { newServiceRecordSchema, updateServiceRecordSchema } from '@caradvocate/shared';
import { maintenanceItems, serviceRecords } from '../db/schema.js';
import { toServiceRecord } from '../mappers.js';
import { userIdOf } from '../middleware/currentUser.js';
import { validateBody } from '../middleware/validate.js';
import { HttpError } from '../lib/httpError.js';
import { requireOwnVehicle, stringParam } from './helpers.js';

export const serviceRecordsRouter = Router();

serviceRecordsRouter.get('/', async (req, res) => {
  const rows = await req.db
    .select()
    .from(serviceRecords)
    .where(eq(serviceRecords.userId, userIdOf(req)))
    .orderBy(desc(serviceRecords.serviceDate), desc(serviceRecords.createdAt));

  res.json(rows.map(toServiceRecord));
});

serviceRecordsRouter.post('/', validateBody(newServiceRecordSchema), async (req, res) => {
  const userId = userIdOf(req);
  const vehicle = await requireOwnVehicle(req);
  const maintenanceItemId = await resolveMaintenanceItem(req, vehicle.id, req.body.maintenanceItemId);

  const [row] = await req.db
    .insert(serviceRecords)
    .values({
      userId,
      vehicleId: vehicle.id,
      description: req.body.description,
      serviceDate: req.body.date,
      cost: req.body.cost,
      source: 'manual',
      mileageAtService: req.body.mileageAtService ?? null,
      maintenanceItemId,
    })
    .returning();

  res.status(201).json(toServiceRecord(row));
});

/**
 * Corrects a record. These rows feed the maintenance calculation, so a mistyped odometer does
 * not merely look wrong -- it makes the app claim a job is due when it is not.
 */
serviceRecordsRouter.patch('/:id', validateBody(updateServiceRecordSchema), async (req, res) => {
  const vehicle = await requireOwnVehicle(req);
  const existing = await requireOwnRecord(req, vehicle.id);

  const patch: Record<string, unknown> = {};
  if (req.body.description !== undefined) patch.description = req.body.description;
  if (req.body.date !== undefined) patch.serviceDate = req.body.date;
  if (req.body.cost !== undefined) patch.cost = req.body.cost;
  // Explicit null so a wrong reading can be removed, not only replaced: Drizzle drops
  // `undefined` and the bad value would survive.
  if ('mileageAtService' in req.body) patch.mileageAtService = req.body.mileageAtService ?? null;
  if ('maintenanceItemId' in req.body) {
    patch.maintenanceItemId = await resolveMaintenanceItem(req, vehicle.id, req.body.maintenanceItemId);
  }

  const [row] = await req.db
    .update(serviceRecords)
    .set(patch)
    .where(eq(serviceRecords.id, existing.id))
    .returning();

  res.json(toServiceRecord(row));
});

serviceRecordsRouter.delete('/:id', async (req, res) => {
  const vehicle = await requireOwnVehicle(req);
  const existing = await requireOwnRecord(req, vehicle.id);

  await req.db.delete(serviceRecords).where(eq(serviceRecords.id, existing.id));
  res.status(204).end();
});

/**
 * Narrows a path id to a record on the caller's own car. Filtering on the record id *and* the
 * vehicle is what stops one account editing another's history.
 */
async function requireOwnRecord(req: Parameters<typeof requireOwnVehicle>[0], vehicleId: string) {
  const id = stringParam(req, 'id');
  if (!z.string().uuid().safeParse(id).success) {
    throw HttpError.notFound('No such service record');
  }

  const [row] = await req.db
    .select({ id: serviceRecords.id })
    .from(serviceRecords)
    .where(and(eq(serviceRecords.id, id), eq(serviceRecords.vehicleId, vehicleId)))
    .limit(1);

  if (!row) throw HttpError.notFound('No such service record');
  return row;
}

/**
 * Confirms a claimed upkeep job belongs to this car before linking to it. Without the check, a
 * record could point at another account's job and drive its "last done" from a stranger's history.
 */
async function resolveMaintenanceItem(
  req: Parameters<typeof requireOwnVehicle>[0],
  vehicleId: string,
  claimed: string | undefined,
): Promise<string | null> {
  if (!claimed) return null;

  const [row] = await req.db
    .select({ id: maintenanceItems.id })
    .from(maintenanceItems)
    .where(and(eq(maintenanceItems.id, claimed), eq(maintenanceItems.vehicleId, vehicleId)))
    .limit(1);

  if (!row) throw HttpError.notFound('No such maintenance item for this vehicle');
  return row.id;
}
