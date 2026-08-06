import { asc } from 'drizzle-orm';
import { Router } from 'express';
import type { RepairCatalogReport } from '@caradvocate/shared';
import { repairs } from '../db/schema.js';
import { toRepairCatalogItem } from '../mappers.js';
import { ensureRepairPricing, pricedRepairIds } from '../services/repairPricingSync.js';
import { requireOwnVehicle } from './helpers.js';

export const repairsRouter = Router();

/**
 * The whole repair catalog, each entry flagged with whether it can be priced for the
 * caller's OWN car. The catalog is global but pricing is per model, so a repair with no
 * benchmark for this exact car comes back `priced: false` -- never substituted with
 * another vehicle's figures, see services/repairPricingSync.ts.
 *
 * The list is deliberately NOT filtered down to priced repairs. Filtering made an
 * unpriced car look like an app with no repairs in it, which is a worse lie than
 * admitting we cannot price the one the owner wants. The picker offers every row and
 * POST /api/assessments delivers the refusal, so choosing is never blocked.
 *
 * The sync runs first so a car nobody has looked up yet gets its figures on the first visit
 * to the picker rather than the first assessment. At most one call per model per week.
 *
 * `checked` stops "nothing priced" from lying: both "no pricing for your car" and "never
 * reached the vendor" price zero repairs, and only the first is a fact about the vehicle.
 */
repairsRouter.get('/', async (req, res) => {
  const vehicle = await requireOwnVehicle(req);
  const model = { year: vehicle.year, make: vehicle.make, model: vehicle.model };

  const checked = await ensureRepairPricing(req.db, model);
  const priced = await pricedRepairIds(req.db, model);

  const rows = await req.db.select().from(repairs).orderBy(asc(repairs.position));

  res.json({
    repairs: rows.map((row) => toRepairCatalogItem(row, priced.has(row.id))),
    checked,
  } satisfies RepairCatalogReport);
});
