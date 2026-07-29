import { desc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { newServiceRecordSchema } from '@caradvocate/shared';
import { serviceRecords } from '../db/schema.js';
import { toServiceRecord } from '../mappers.js';
import { userIdOf } from '../middleware/currentUser.js';
import { validateBody } from '../middleware/validate.js';
import { requireOwnVehicle } from './helpers.js';

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

  const [row] = await req.db
    .insert(serviceRecords)
    .values({
      userId,
      vehicleId: vehicle.id,
      description: req.body.description,
      serviceDate: req.body.date,
      cost: req.body.cost,
      source: 'manual',
    })
    .returning();

  res.status(201).json(toServiceRecord(row));
});
