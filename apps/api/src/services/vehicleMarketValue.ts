/**
 * Vehicle Databases' market-value endpoint -- the second valuation source, and the one that
 * answers for cars MarketCheck cannot.
 *
 * WHY A SECOND ONE AT ALL. MarketCheck prices from real market listings, so a VIN absent from
 * their data answers 400 "Failed to decode VIN" and the car has no value, ever. This endpoint
 * decodes the VIN's pattern instead, so it answers for those cars -- measured on a 2018 CTS and a
 * 2004 Passat that MarketCheck refuses outright. It also carries the two things the base
 * MarketCheck tier never has: a TRADE-IN figure, which is the question an owner actually asks,
 * and condition bands rather than one number.
 *
 * THE TWO VENDORS DISAGREE, AND THAT IS NOT A BUG IN EITHER. On a 2012 Camaro, MarketCheck
 * decoded a 1SS and this decoded a 1LT -- a V8 and a V6, roughly $16k against $9k, and each
 * figure is right for the car its vendor thinks it is. Both were reading a VIN whose middle
 * digits were invented, which is what a test fleet is made of. Real VINs encode engine and body
 * unambiguously and the disagreement should disappear; `npm run probe:valuation` is how to check
 * that once real cars arrive, rather than assuming it.
 *
 * ONE CALL PER CAR PER MONTH, through the shared client -- so it is covered by the vendor-wide
 * circuit breaker in services/vehicleDatabases.ts and cannot contribute to a retry storm.
 */
import { readData, requestVehicleDatabases } from './vehicleDatabases.js';
import { stateForZip } from '../lib/zipState.js';

/**
 * The condition an unseen car is assumed to be in.
 *
 * "Clean" and not "Outstanding", which is a car with no flaws at all and would put the highest
 * number on the screen -- flattering, and wrong for almost every car in use. Not "Average"
 * either: that is a judgement about wear this app has no way to make. Clean is the honest
 * middle, and the band is stated on the card so the assumption is visible rather than implied.
 */
const CONDITION = 'Clean';

/**
 * Generous, like the maintenance-schedule call and for the same reason: measured at 1.7-2.3
 * seconds against the shared eight-second ceiling, which leaves little room on a slow afternoon.
 */
const TIMEOUT_MS = 15000;

/** One vehicle's valuation, in whole dollars. */
export interface VehicleValuation {
  /** Private-party value at `CONDITION` -- what an owner would get selling it themselves. */
  privateParty: number;
  /** Dealer retail at `CONDITION` -- what a lot would ask for it. */
  dealerRetail: number;
  /** Trade-in across every condition band, worst to best. The range, not a point. */
  tradeInLow: number;
  tradeInHigh: number;
  /** The trim this was priced as, so a wrong decode is visible rather than silent. */
  trim?: string;
}

export type VehicleValuationResult =
  | { outcome: 'ok'; valuation: VehicleValuation }
  | { outcome: 'no_record' }
  | { outcome: 'unavailable' };

export interface ValuationLookup {
  vin: string;
  mileage: number;
  /** As stored. Converted to a state, or dropped -- see lib/zipState.ts. */
  zip: string | null;
}

/**
 * One car's valuation. Never throws; three outcomes, matching every other client here.
 *
 * MILEAGE IS SENT AND MATTERS. The same CTS returns an $18,027 trade-in at 20,000 miles and
 * $10,946 at 100,000, so omitting it would price every car as though its odometer were unknown --
 * which the endpoint answers by pricing it as a national average of all mileages.
 */
export async function fetchVehicleValuation(
  lookup: ValuationLookup,
): Promise<VehicleValuationResult> {
  const params = new URLSearchParams({ mileage: String(lookup.mileage) });

  // Omitted rather than guessed when the ZIP is unrecognised. A missing state prices nationally,
  // which is honest; a wrong one prices the wrong half of the country and looks fine doing it.
  const state = stateForZip(lookup.zip);
  if (state) params.set('state', state);

  const result = await requestVehicleDatabases(
    `/market-value/v2/${encodeURIComponent(lookup.vin)}?${params}`,
    TIMEOUT_MS,
  );

  if (result.outcome !== 'ok') return result;

  const valuation = parseValuation(result.body);
  // A success envelope we cannot read is not a fact about the car: the vendor answered, we simply
  // could not use it, so it retries rather than being cached as "this car has no value".
  return valuation ? { outcome: 'ok', valuation } : { outcome: 'unavailable' };
}

/**
 * Exported for the probe script, which reads real responses without a database.
 *
 * The shape is deep and the money arrives as display strings: `data.market_value
 * .market_value_data[0]["market value"]` is an array of `{ Condition, "Trade-In",
 * "Private Party", "Dealer Retail" }`, each value formatted like "$11,529". Every level is
 * checked rather than asserted -- a vendor that changes its shape should degrade to "no value
 * yet", not throw inside a page load.
 */
export function parseValuation(body: unknown): VehicleValuation | undefined {
  const data = readData(body);
  if (!data) return undefined;

  const groups = (data.market_value as { market_value_data?: unknown } | undefined)
    ?.market_value_data;
  if (!Array.isArray(groups) || groups.length === 0) return undefined;

  const first = groups[0] as Record<string, unknown>;
  const bands = first['market value'];
  if (!Array.isArray(bands) || bands.length === 0) return undefined;

  const rows = bands.filter(
    (band): band is Record<string, unknown> => Boolean(band) && typeof band === 'object',
  );

  const chosen = rows.find((row) => row.Condition === CONDITION);
  if (!chosen) return undefined;

  const privateParty = money(chosen['Private Party']);
  const dealerRetail = money(chosen['Dealer Retail']);
  if (privateParty === undefined || dealerRetail === undefined) return undefined;

  // The trade-in RANGE spans every band, not just the chosen one: the spread between a rough car
  // and an outstanding one is the honest answer to "what would I get", and the app has no way to
  // know which end an owner's car sits at.
  const tradeIns = rows
    .map((row) => money(row['Trade-In']))
    .filter((value): value is number => value !== undefined);
  if (tradeIns.length === 0) return undefined;

  const trim = typeof first.trim === 'string' && first.trim.trim() ? first.trim.trim() : undefined;

  return {
    privateParty,
    dealerRetail,
    tradeInLow: Math.min(...tradeIns),
    tradeInHigh: Math.max(...tradeIns),
    ...(trim ? { trim } : {}),
  };
}

/** "$11,529" -> 11529. Undefined for anything that is not a positive figure. */
function money(raw: unknown): number | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : undefined;
  if (typeof raw !== 'string') return undefined;

  const digits = raw.replace(/[^0-9.]/g, '');
  if (!digits) return undefined;

  const value = Number(digits);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
}
