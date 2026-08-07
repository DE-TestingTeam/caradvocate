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
 * A TIMEOUT IS NOT AN ANSWER. Only a successful price sets the marker; an unreachable
 * vendor is left unmarked so the next visit tries again, rather than a bad afternoon
 * freezing a car's value for a month.
 *
 * THE TREND IS BUILT GOING FORWARD, NEVER BACKFILLED. MarketCheck has no history for a car
 * that has never been listed for sale -- only for VINs that turn up in its own dealer
 * listing data -- so there is no "what was this worth six months ago" to fetch. Every
 * successful check appends (or, within the same calendar month, updates) one point, capped
 * at MAX_POINTS so the "last 6 mo" label stays true.
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
 * Makes sure this car's value is no more than a month stale. Returns whether a new price was
 * written, so a caller can re-read. Never throws -- a vendor that will not answer leaves the
 * existing value standing, which is better than nothing for a page about a car's worth.
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
