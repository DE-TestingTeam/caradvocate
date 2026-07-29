import { asc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { repairBenchmarks, repairs } from '../db/schema.js';
import { toRepairCatalogItem } from '../mappers.js';

export const repairsRouter = Router();

/**
 * The repair catalog. Global reference data, so no user filter.
 *
 * Inner-joined against benchmarks on purpose: a repair with no benchmark cannot
 * produce an assessment, so offering it in the picker would be a dead end.
 */
repairsRouter.get('/', async (req, res) => {
  const rows = await req.db
    .select({ repair: repairs })
    .from(repairs)
    .innerJoin(repairBenchmarks, eq(repairBenchmarks.repairId, repairs.id))
    .orderBy(asc(repairs.position));

  res.json(rows.map((row) => toRepairCatalogItem(row.repair)));
});
