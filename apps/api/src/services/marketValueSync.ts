/**
 * Keeps one car's market value current, and grows the trend chart one point at a time. See
 * services/marketCheck.ts for the vendor call.
 *
 * WHEN IT RUNS: not once ever, unlike the maintenance schedule -- a price goes stale and
 * mileage climbs, so this is due again once a month. `vehicles.market_value_checked_at`
 * answers "was this car priced within the last REFRESH_MS", not "has it ever been priced".
 *
 * TWO CALLERS, AND THE SECOND ONE IS WHY THE CHART IS A TIME SERIES AT ALL. The vehicle routes
 * call this on read, which only ever produced "one point per month in which the owner happened to
 * visit" -- an owner away for three months left three gaps, and a chart with gaps in it is not
 * measuring time. scripts/refreshMarketValues.mts now sweeps every due car nightly, so the points
 * land a month apart whether anybody signs in or not. The route call stays: it is what prices a
 * car the moment it is added, rather than leaving it blank until the next sweep.
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
import { and, asc, eq, gt, isNotNull, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { vehicleValuePoints, vehicles } from '../db/schema.js';
import { fetchMarketValue } from './marketCheck.js';
import { fetchVehicleValuation } from './vehicleMarketValue.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How recently another car must have priced for a decode failure to count as conclusive. Two
 * refresh cycles: every priceable car is asked monthly, so a working key leaves a trail inside
 * one cycle and this allows a whole spare one before it stops trusting the evidence.
 */
const DECODE_EVIDENCE_MS = 60 * DAY_MS;

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
 * Whether this car is worth asking MarketCheck about right now: it has the VIN and zip the call
 * requires, and its last price is either absent or over a month old.
 *
 * Exported so the nightly sweep (scripts/refreshMarketValues.mts) can count and report what it
 * would do without a second copy of the rule. `ensureMarketValue` re-checks it rather than
 * trusting the caller, so a stale queue cannot turn into a duplicate vendor call.
 */
export function marketValueDue(vehicle: ValuationTarget, now: Date = new Date()): boolean {
  if (!vehicle.vin || !vehicle.zip) return false;
  if (!vehicle.marketValueCheckedAt) return true;
  return now.getTime() - vehicle.marketValueCheckedAt.getTime() >= REFRESH_MS;
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
  if (!marketValueDue(vehicle, now)) return false;

  // Narrowing for TypeScript's benefit; `marketValueDue` has already established both.
  if (!vehicle.vin || !vehicle.zip) return false;

  /*
   * VEHICLE DATABASES FIRST, MARKETCHECK SECOND, and the order is the whole of the change.
   *
   * MarketCheck prices from real listings, so a VIN it does not hold is refused permanently -- a
   * 2018 CTS and a 2004 Passat on this database have never had a value and never would. Vehicle
   * Databases decodes the VIN pattern instead, so it answers for those cars, and it carries a
   * trade-in range the base MarketCheck tier does not publish at all.
   *
   * MarketCheck is not dropped: it is the fallback, so a car Vehicle Databases has nothing for
   * still gets priced. Only one vendor is called for a car that succeeds, so the monthly cost per
   * car is unchanged.
   */
  const valuation = await fetchVehicleValuation({
    vin: vehicle.vin,
    mileage: vehicle.mileage,
    zip: vehicle.zip,
  });

  if (valuation.outcome === 'ok') {
    return recordValue(db, vehicle.id, now, {
      price: valuation.valuation.privateParty,
      tradeInLow: valuation.valuation.tradeInLow,
      tradeInHigh: valuation.valuation.tradeInHigh,
      source: 'vehicle_databases',
    });
  }

  const result = await fetchMarketValue({ vin: vehicle.vin, miles: vehicle.mileage, zip: vehicle.zip });

  /*
   * The fallback could not be reached, so nothing is settled and the car is asked again next
   * time. Deliberately NOT conclusive even when Vehicle Databases said `no_record` above: a
   * verdict of "this car cannot be valued" needs both sources to have actually answered, and one
   * of them did not. Marking it here would freeze a car for a month over an outage.
   */
  if (result.outcome === 'unavailable') return false;

  /*
   * NEITHER FALLBACK VERDICT COUNTS WHILE THE PRIMARY IS UNREACHABLE.
   *
   * Caught on a real run: Vehicle Databases hit its call quota mid-sweep and answered
   * `unavailable`, MarketCheck then failed to decode the same VIN, and the car was marked
   * permanently unvaluable on the strength of one vendor while the other had not been asked. The
   * comment two branches up already says one vendor's silence is not a verdict; it just was not
   * being applied to the conclusive paths.
   */
  if (valuation.outcome === 'unavailable') return false;

  // A decode failure is conclusive only if the key is demonstrably decoding other cars. See
  // `decodeIsWorking`; the client hands this up undecided on purpose.
  if (result.outcome === 'decode_failed') {
    if (!(await decodeIsWorking(db, vehicle.id, now))) {
      console.warn(
        'MarketCheck could not decode a VIN, and no other car has priced recently either. ' +
          'Treating it as transient. If every car is failing, the key has probably lost its ' +
          'decode entitlement -- check /v2/decode/car/{vin}/specs.',
      );
      return false;
    }
    return markUnvaluable(db, vehicle.id, now);
  }

  if (result.outcome === 'no_record') {
    // Conclusive: MarketCheck cannot price this VIN at all.
    return markUnvaluable(db, vehicle.id, now);
  }

  return recordValue(db, vehicle.id, now, { price: result.price, source: 'marketcheck' });
}

/**
 * Stores a price, stamps the check, and appends the month's trend point.
 *
 * Shared by both vendors so a value means the same thing whoever produced it -- and so the trend
 * chart cannot end up with one source's points beside another's rules.
 */
async function recordValue(
  db: Database,
  vehicleId: string,
  now: Date,
  figures: { price: number; tradeInLow?: number; tradeInHigh?: number; source: string },
): Promise<boolean> {
  await db.transaction(async (tx) => {
    await tx
      .update(vehicles)
      // `valuationUnavailable` is cleared, not just left alone: a car refused once can appear in
      // the vendor's data later, and a stale refusal would hide a price we now hold.
      .set({
        estMarketValue: figures.price,
        marketValueCheckedAt: now,
        valuationUnavailable: false,
        valuationSource: figures.source,
        // Only written by a vendor that publishes them, and left untouched by one that does not
        // -- overwriting a real range with nulls because this month's price came from the other
        // source would lose data for no reason.
        ...(figures.tradeInLow != null ? { tradeInLow: figures.tradeInLow } : {}),
        ...(figures.tradeInHigh != null ? { tradeInHigh: figures.tradeInHigh } : {}),
      })
      .where(eq(vehicles.id, vehicleId));

    // Adds one point to the trend, oldest-first by `position`. A second check within the
    // same calendar month updates that month's point in place rather than adding a
    // duplicate; past that, the oldest point is dropped once there are MAX_POINTS, and the
    // rest shift down so position stays a dense 0..n-1 the chart can sort on.
    const existing = await tx
      .select({ id: vehicleValuePoints.id, monthLabel: vehicleValuePoints.monthLabel })
      .from(vehicleValuePoints)
      .where(eq(vehicleValuePoints.vehicleId, vehicleId))
      .orderBy(asc(vehicleValuePoints.position));

    const monthLabel = monthLabelOf(now);
    const last = existing[existing.length - 1];

    if (last && last.monthLabel === monthLabel) {
      await tx.update(vehicleValuePoints).set({ value: figures.price }).where(eq(vehicleValuePoints.id, last.id));
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
      .values({ vehicleId, monthLabel, value: figures.price, position: rest.length });
  });

  return true;
}

/** en-US three-letter form, matching the seed's own points ("Feb", "Mar", ...). */
/**
 * Records the vendor's conclusive "no" and stops asking.
 *
 * `marketValueCheckedAt` is what stops the retry -- `marketValueDue` reads it -- and
 * `valuationUnavailable` is what lets the card say WHY. Both, or the card goes quiet about a
 * decision that was actually made.
 */
async function markUnvaluable(db: Database, vehicleId: string, now: Date): Promise<boolean> {
  await db
    .update(vehicles)
    .set({ marketValueCheckedAt: now, valuationUnavailable: true })
    .where(eq(vehicles.id, vehicleId));
  return true;
}

/**
 * Whether the vendor is decoding OTHER cars, which is the whole difference between "this car is
 * not in their data" and "our key cannot decode anything".
 *
 * MEASURED, NOT ASSUMED, and this is the guard that makes the conclusive branch safe. A key that
 * loses its decode entitlement fails identically on every vehicle; marking each one permanently
 * unpriceable as it came round would quietly blank the whole fleet, and nothing would ever
 * re-check them. So a refusal only sticks while some other car has priced recently. On the day a
 * key breaks, this answers false for every car and every failure stays retryable.
 *
 * Excludes the car being asked about: its own stale price says nothing about today's key.
 */
async function decodeIsWorking(db: Database, exceptVehicleId: string, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - DECODE_EVIDENCE_MS);

  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(vehicles)
    .where(
      and(
        isNotNull(vehicles.estMarketValue),
        gt(vehicles.marketValueCheckedAt, since),
        sql`${vehicles.id} <> ${exceptVehicleId}`,
      ),
    );

  return Number(row?.count ?? 0) > 0;
}

function monthLabelOf(date: Date): string {
  return date.toLocaleString('en-US', { month: 'short' });
}
