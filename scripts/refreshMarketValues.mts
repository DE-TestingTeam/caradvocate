/**
 * Re-prices every car whose market value has gone stale, and appends this month's point to its
 * trend chart.
 *
 *   npm run refresh:values                 # ask MarketCheck about every due car
 *   npm run refresh:values -- --dry-run    # report which cars are due, call nothing
 *   npm run refresh:values -- --limit 25   # cap the vendor calls this run
 *
 * WHY: `ensureMarketValue` was only ever reached from GET/PATCH /api/vehicle, so a car was
 * re-priced when its owner happened to open the app. That is fine for the value on the card, which
 * is read at exactly that moment -- but the trend chart is supposed to be six readings a month
 * apart, and what it actually held was one point per month in which somebody signed in. An owner
 * away for the summer came back to a chart missing the summer.
 *
 * A nightly run fixes that without changing the cadence: `marketValueDue` still says no until a
 * car's last price is over a month old, so each car is asked about once a month, on whatever night
 * it falls due. The sweep is cheap on the nights when nothing is due -- one query, no vendor calls.
 *
 * THE WORK ALL LIVES IN THE SERVICE, NOT HERE. This script picks the rows and reports; every rule
 * about when to ask, what an answer means and what to write is in services/marketValueSync.ts,
 * shared with the routes. A second implementation of the monthly rule in a cron script is exactly
 * how the chart would start disagreeing with the card.
 */
import { asc } from 'drizzle-orm';
import { closeDb, getDb, describeTarget } from '../apps/api/src/db/index.js';
import { vehicles } from '../apps/api/src/db/schema.js';
import { env } from '../apps/api/src/env.js';
import { ensureMarketValue, marketValueDue } from '../apps/api/src/services/marketValueSync.js';

/**
 * Pause between vendor calls. MarketCheck's plan carries a finite monthly allowance and this is
 * the one place that could spend a chunk of it in a burst, so the sweep goes at a deliberate
 * walking pace rather than as fast as the pool allows. Nothing is waiting on it -- it runs at
 * 09:30 UTC with no user attached.
 */
const PAUSE_MS = 500;

/**
 * Vendor calls allowed in one run, unless `--limit` says otherwise.
 *
 * A backstop, not a target. On a normal night the due set is a small fraction of the fleet, so
 * this never binds; it exists for the first run after this ships, when every car with a VIN and a
 * zip is due at once and an unbounded sweep would spend the month's allowance in one go. Cars over
 * the limit are simply due again tomorrow, so a capped run is a slower start rather than a gap.
 */
const DEFAULT_LIMIT = 250;

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const limit = readLimit();

  const db = getDb();
  console.log(`Database: ${describeTarget()}`);

  if (!env.MARKET_CHECK_API_KEY && !dryRun) {
    // Every call would answer `unavailable` and write nothing, so the run would report a fleet of
    // failures and look like a vendor outage. Naming the real cause is worth an early exit.
    throw new Error(
      'MARKET_CHECK_API_KEY is not set, so no car can be priced. Set it, or pass --dry-run to see ' +
        'which cars are due.',
    );
  }

  // Oldest first, so a run that hits the limit works through the most stale cars rather than
  // whatever order Postgres felt like. Nulls -- never priced -- sort first on `asc` in Postgres
  // only with NULLS FIRST, which is not the default; they are picked out separately below.
  const fleet = await db
    .select({
      id: vehicles.id,
      vin: vehicles.vin,
      zip: vehicles.zip,
      mileage: vehicles.mileage,
      marketValueCheckedAt: vehicles.marketValueCheckedAt,
    })
    .from(vehicles)
    .orderBy(asc(vehicles.marketValueCheckedAt));

  const now = new Date();
  const due = fleet.filter((vehicle) => marketValueDue(vehicle, now));
  // Never-priced cars first: those are the ones showing an empty card right now.
  due.sort((a, b) => rank(a.marketValueCheckedAt) - rank(b.marketValueCheckedAt));

  const skipped = fleet.length - due.length;
  console.log(
    `${fleet.length} vehicle(s) on file. ${due.length} due for a price, ${skipped} not ` +
      `(priced within the last month, or missing the VIN or zip the call needs).`,
  );

  if (due.length === 0) {
    await closeDb();
    return;
  }

  if (dryRun) {
    for (const vehicle of due) {
      const last = vehicle.marketValueCheckedAt?.toISOString().slice(0, 10) ?? 'never';
      console.log(`  would price ${vehicle.id} (last: ${last}, ${vehicle.mileage} mi)`);
    }
    console.log('Dry run: nothing was called and nothing was written.');
    await closeDb();
    return;
  }

  const queue = due.slice(0, limit);
  if (queue.length < due.length) {
    // Loud, because a silent cap reads as "the whole fleet is done" in the run log.
    console.log(
      `Capping this run at ${limit} of ${due.length} due. The remaining ${due.length - queue.length} ` +
        `stay due and are picked up by the next run.`,
    );
  }

  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const [index, vehicle] of queue.entries()) {
    if (index > 0) await sleep(PAUSE_MS);

    try {
      // Returns false for a vendor that would not answer, which is a retry rather than a result --
      // the car keeps the value it had and falls due again tomorrow.
      if (await ensureMarketValue(db, vehicle, new Date())) updated += 1;
      else unchanged += 1;
    } catch (cause) {
      // `ensureMarketValue` swallows vendor trouble itself, so anything landing here is the
      // database. One bad row must not abandon the rest of the fleet.
      failed += 1;
      console.warn(`  ${vehicle.id}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  console.log(`Done. ${updated} re-priced, ${unchanged} left as they were, ${failed} errored.`);
  await closeDb();

  // A sweep where every single car errored is a broken deploy, not a quiet night, and CI should
  // go red for it. Partial failure is not: one unreachable row among many is ordinary.
  if (failed > 0 && failed === queue.length) {
    throw new Error(`Every one of the ${failed} vehicle(s) attempted failed. See the warnings above.`);
  }
}

/** Sorts never-priced cars ahead of merely stale ones. */
function rank(checkedAt: Date | null): number {
  return checkedAt ? checkedAt.getTime() : 0;
}

function readLimit(): number {
  const flag = process.argv.indexOf('--limit');
  if (flag === -1) return DEFAULT_LIMIT;

  const parsed = Number(process.argv[flag + 1]);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('--limit needs a positive whole number, e.g. --limit 25');
  }
  return parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await main();
