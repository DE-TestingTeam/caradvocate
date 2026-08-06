/**
 * Refreshes the repair catalog and the reference model's pricing. `npm run db:pricing`.
 *
 * The safe counterpart to `db:seed`: it upserts reference data and touches nothing a user
 * owns, so it is the way to correct pricing on a database with real accounts. Repeatable.
 *
 * It does NOT fetch from the vendor -- the figures come from the captured snapshot in
 * fixtures.ts. Live pricing for an owner's own model arrives through
 * services/repairPricingSync.ts on request.
 */
import { closeDb, describeTarget, getDb } from './index.js';
import { writeReferencePricing } from './referencePricing.js';
import { SNAPSHOT_MODEL } from '../services/repairPricingSync.js';

console.log(`Writing reference repair pricing to ${describeTarget()}`);

try {
  const { report } = await writeReferencePricing(getDb(), SNAPSHOT_MODEL);
  console.log(
    `Catalog: ${report.repairsInserted} repairs. ` +
      `Benchmarks: ${report.benchmarksWritten} written, ${report.benchmarksRemoved} removed as unpriced.`,
  );
  console.log('No user, vehicle or assessment row was touched.');
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  await closeDb();
  process.exit(1);
}

await closeDb();
