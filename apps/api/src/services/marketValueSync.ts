/**
 * Keeps one car's market value current, and grows the trend chart one point at a time. See
 * services/marketCheck.ts for the vendor call.
 *
 * WHEN IT RUNS: not once ever, unlike the maintenance schedule -- a price goes stale and
 * mileage climbs, so this is due again once a month. `vehicles.market_value_checked_at`
 * answers "was this car priced within the last REFRESH_MS", not "has it ever been priced".
 *
 * NO VIN OR NO ZIP, NOTHING TO ASK ABOUT. MarketCheck's base tier requires both per call
 * (VIN identifies the car, zip localizes the estimate), and onboarding lets an owner skip
 * either. A car missing one is left exactly as it was -- not an error, just unpriced.
 *
 * A TIMEOUT IS NOT AN ANSWER, BUT "CANNOT DECODE THIS VIN" IS. The marker is set on either a
 * price or MarketCheck's own conclusive no (`no_record` -- a VIN too old for their model,
 * mostly), so a car it will never be able to price is not asked about on every page load.
 * An unreachable vendor sets nothing, so the next visit tries again rather than a bad
 * afternoon freezing a car's value for a month.
 *
 * THE TREND IS BUILT GOING FORWARD, NEVER BACKFILLED. The predict endpoint prices a VIN as of
 * today and takes no as-of date, so there is no "what was this worth six months ago" to ask
 * for.
 *
 * MarketCheck does have a history API -- GET /v2/history/car/{vin}, listings since 2015 -- and
 * it is the obvious thing to reach for here, so: it is the wrong data, not missing data. It
 * returns LISTING records (what a dealer was asking while the car sat on a lot), not
 * valuations. Two problems with charting it. It is empty for the ordinary case, a car its
 * owner has driven for years and never listed; and where it is not empty, an asking price and
 * a predicted private-party value are different quantities, so joining them into one line
 * would draw a trend that never happened.
 *
 * Every successful check appends (or, within the same calendar month, updates) one point,
 * capped at MAX_POINTS so the "last 6 mo" label stays true. A new car therefore shows one
 * point and no line; ValueTrendPlaceholder in the web app is what fills that gap on screen.
 */
import { asc, eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { vehicleValuePoints, vehicles } from '../db/schema.js';
import { fetchMarketValue } from './marketCheck.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a priced car is left alone before the next monthly refresh. */
const REFRESH_MS = 30 * DAY_MS;

/** Matches the "last 6 mo" label on the trend chart; see ValueTrendChart. */
const MAX_POINTS = 6;

export interface ValuationTarget {
  id: string;
  vin: string | null;
  zip: string | null;
  mileage: number;
  /** Null means this car has never been priced. See the header. */
  marketValueCheckedAt: Date | null;
}

/**
 * Makes sure this car's value is no more than a month stale. Returns whether the row changed
 * -- a new price, or a conclusive "cannot price this one" -- so a caller can re-read. Never
 * throws -- a vendor that will not answer leaves the existing value standing, which is
 * better than nothing for a page about a car's worth.
 */
export async function ensureMarketValue(
  db: Database,
  vehicle: ValuationTarget,
  now: Date = new Date(),
): Promise<boolean> {
  if (!vehicle.vin || !vehicle.zip) return false;

  if (
    vehicle.marketValueCheckedAt &&
    now.getTime() - vehicle.marketValueCheckedAt.getTime() < REFRESH_MS
  ) {
    return false;
  }

  const result = await fetchMarketValue({ vin: vehicle.vin, miles: vehicle.mileage, zip: vehicle.zip });
  if (result.outcome === 'unavailable') return false;

  if (result.outcome === 'no_record') {
    // Conclusive: MarketCheck cannot price this VIN at all. Marked so the card can say so
    // instead of implying a price is still coming -- see `valuationUnavailable` in mappers.ts.
    await db.update(vehicles).set({ marketValueCheckedAt: now }).where(eq(vehicles.id, vehicle.id));
    return true;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(vehicles)
      .set({ estMarketValue: result.price, marketValueCheckedAt: now })
      .where(eq(vehicles.id, vehicle.id));

    // Adds one point to the trend, oldest-first by `position`. A second check within the
    // same calendar month updates that month's point in place rather than adding a
    // duplicate; past that, the oldest point is dropped once there are MAX_POINTS, and the
    // rest shift down so position stays a dense 0..n-1 the chart can sort on.
    const existing = await tx
      .select({ id: vehicleValuePoints.id, monthLabel: vehicleValuePoints.monthLabel })
      .from(vehicleValuePoints)
      .where(eq(vehicleValuePoints.vehicleId, vehicle.id))
      .orderBy(asc(vehicleValuePoints.position));

    const monthLabel = monthLabelOf(now);
    const last = existing[existing.length - 1];

    if (last && last.monthLabel === monthLabel) {
      await tx.update(vehicleValuePoints).set({ value: result.price }).where(eq(vehicleValuePoints.id, last.id));
      return;
    }

    let rest = existing;
    if (existing.length >= MAX_POINTS) {
      const [oldest, ...kept] = existing;
      await tx.delete(vehicleValuePoints).where(eq(vehicleValuePoints.id, oldest.id));
      for (const [position, row] of kept.entries()) {
        await tx.update(vehicleValuePoints).set({ position }).where(eq(vehicleValuePoints.id, row.id));
      }
      rest = kept;
    }

    await tx
      .insert(vehicleValuePoints)
      .values({ vehicleId: vehicle.id, monthLabel, value: result.price, position: rest.length });
  });

  return true;
}

/** en-US three-letter form, matching the seed's own points ("Feb", "Mar", ...). */
function monthLabelOf(date: Date): string {
  return date.toLocaleString('en-US', { month: 'short' });
}
