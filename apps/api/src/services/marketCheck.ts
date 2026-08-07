/**
 * Client for MarketCheck's price-prediction API -- the estimated market value shown on My
 * Car's valuation card. A timeout, a non-200 or an unexpected body degrades the caller
 * rather than throwing; see services/marketValueSync.ts for how that is handled.
 *
 * Base tier only: `marketcheck_price` and `msrp`. The Premium tier (`.../comparables`) adds
 * percentile stats on real listings, which would be a real source for `tradeInLow/High` --
 * not implemented because it is a separate product tier and the key here is not known to
 * carry it. Upgrading later is additive: a new client function, not a change to this one.
 */
import { env } from '../env.js';

const ENDPOINT = 'https://api.marketcheck.com/v2/predict/car/us/marketcheck_price';

/** A single ML inference call; slower than a lookup but still sub-second in practice. */
const TIMEOUT_MS = 8000;

/**
 * Comparable-listing pool to price against. MarketCheck requires a choice; there is no
 * "both" option on the base tier. Independent lots are the broader, more representative
 * sample of what a given used car actually sells for -- franchise inventory skews toward
 * newer, certified stock that is a worse comparable for an older high-mileage car.
 */
const DEALER_TYPE = 'independent';

export interface MarketValueLookup {
  vin: string;
  miles: number;
  zip: string;
}

export type MarketCheckResult =
  | { outcome: 'ok'; price: number }
  | { outcome: 'unavailable' };

/** One GET against MarketCheck's base-tier predict endpoint. Never throws. */
export async function fetchMarketValue(lookup: MarketValueLookup): Promise<MarketCheckResult> {
  const key = env.MARKET_CHECK_API_KEY;
  // Not configured is a deployment state, not an error.
  if (!key) return { outcome: 'unavailable' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const url = new URL(ENDPOINT);
  url.searchParams.set('api_key', key);
  url.searchParams.set('vin', lookup.vin);
  url.searchParams.set('miles', String(lookup.miles));
  url.searchParams.set('dealer_type', DEALER_TYPE);
  url.searchParams.set('zip', lookup.zip);

  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });

    if (!response.ok) return failure(response.status);

    const body = (await response.json()) as unknown;
    const price = readPrice(body);
    if (price === undefined) return { outcome: 'unavailable' };

    return { outcome: 'ok', price };
  } catch {
    // Offline, blocked, slow, or malformed JSON. All the same to the caller.
    return { outcome: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 401 and 403 are logged rather than swallowed: both are operator problems that otherwise
 * present as a valuation that never arrives rather than something somebody has to go fix.
 */
function failure(status: number): MarketCheckResult {
  if (status === 401) {
    console.warn('MarketCheck rejected MARKET_CHECK_API_KEY (401). Valuation is off until it is fixed.');
  } else if (status === 403) {
    console.warn('MarketCheck call quota is spent (403). Valuation is degraded until the allowance resets.');
  } else {
    console.warn(`MarketCheck returned ${status} for a price prediction.`);
  }
  return { outcome: 'unavailable' };
}

/** Reads `marketcheck_price` off the response body as a finite positive number, or undefined. */
function readPrice(body: unknown): number | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const price = (body as Record<string, unknown>).marketcheck_price;
  return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : undefined;
}
