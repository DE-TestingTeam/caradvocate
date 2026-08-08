/**
 * Client for MarketCheck's price-prediction API -- the estimated market value shown on My
 * Car's valuation card. A timeout, a non-200 or an unexpected body degrades the caller
 * rather than throwing; see services/marketValueSync.ts for how that is handled.
 *
 * Returns three outcomes, not two, because MarketCheck distinguishes them and the
 * difference matters: `no_record` is a fact about the vehicle safe to stop asking about
 * (a VIN too old for their model to decode at all), while `unavailable` (no key, timeout,
 * quota, bad key, 5xx) must be retried -- caching that as a verdict would permanently
 * blank a car's value over what was really a bad moment.
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
  | { outcome: 'no_record' }
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

    // The body, not just the status, decides what a 400 means -- see `failure`. Read
    // defensively: an error response is not guaranteed to be JSON, or to have a body at all.
    if (!response.ok) return failure(response.status, await readErrorDetail(response));

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

/** MarketCheck's wording when the predict endpoint cannot resolve the VIN it was handed. */
const DECODE_FAILURE = /failed to decode vin/i;

/**
 * Maps an HTTP response onto an outcome. 401 and 403 are logged rather than swallowed: both
 * are operator problems that otherwise present as a valuation that never arrives rather
 * than something somebody has to go fix.
 *
 * A 400 SAYING "FAILED TO DECODE VIN" IS NOT A FACT ABOUT THE CAR. This used to return
 * `no_record` on any 400, reasoning that since we build the VIN into the request ourselves, a
 * rejection must be about the vehicle -- the case in mind was a 1993 truck too old for a model
 * trained on recent listings.
 *
 * That inference is wrong, and it was checked: a 2018 Tesla returns the identical 400, while
 * `/v2/decode/car/{vin}/specs` returns 401 on the same key. The predict endpoint decodes the
 * VIN as its first step, so when the plan does not carry the decode entitlement, EVERY vehicle
 * fails this way -- old, new, real, whatever. The response cannot tell the two apart, because
 * a genuinely undecodable VIN produces the same message.
 *
 * Faced with that ambiguity this returns `unavailable`, which is the conservative outcome:
 * nothing is written, so the car keeps whatever value it had and the next visit tries again.
 * `no_record` is a verdict -- it stamps `market_value_checked_at`, blanks the card for a month
 * and tells the owner their car cannot be priced -- and a response that an account problem
 * also produces does not meet the bar for one.
 *
 * The cost is that a VIN that genuinely cannot be decoded is now re-asked on every page load
 * rather than settled once. That is the right trade while the ambiguity exists: a wasted call
 * is cheaper than telling someone something false about their car. It is also loud in the log,
 * so the account problem gets fixed rather than sitting behind a plausible-looking message.
 */
function failure(status: number, detail: string): MarketCheckResult {
  if (status === 400) {
    if (DECODE_FAILURE.test(detail)) {
      console.warn(
        'MarketCheck could not decode a VIN for pricing (400). If this is happening for every ' +
          'vehicle, the key lacks the VIN decode entitlement that the predict endpoint depends ' +
          'on -- check /v2/decode/car/{vin}/specs, which answers 401 in that case.',
      );
      return { outcome: 'unavailable' };
    }
    // A 400 we cannot read is not evidence of anything. An empty or non-JSON body happens on
    // gateway errors and truncated responses, and turning that into `no_record` would be the
    // same mistake as above: a verdict about someone's car drawn from a response that never
    // mentioned it. Anything unreadable retries.
    if (!detail.trim() || !detail.includes('{')) {
      console.warn(`MarketCheck returned an unreadable 400 for a price prediction: ${detail.slice(0, 120) || '(empty body)'}`);
      return { outcome: 'unavailable' };
    }

    // A readable 400 that is not a decode failure. We build the request ourselves, so a
    // specific complaint from MarketCheck at this point is a fact about the vehicle.
    return { outcome: 'no_record' };
  }
  if (status === 401) {
    console.warn('MarketCheck rejected MARKET_CHECK_API_KEY (401). Valuation is off until it is fixed.');
  } else if (status === 403) {
    console.warn('MarketCheck call quota is spent (403). Valuation is degraded until the allowance resets.');
  } else {
    console.warn(`MarketCheck returned ${status} for a price prediction.`);
  }
  return { outcome: 'unavailable' };
}

/**
 * The text of an error response, for classifying it. Best effort by design: the body may be
 * absent, truncated or not JSON, and none of that should turn a handled failure into a throw.
 * Returns '' when there is nothing to read, which no pattern matches.
 */
async function readErrorDetail(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/** Reads `marketcheck_price` off the response body as a finite positive number, or undefined. */
function readPrice(body: unknown): number | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const price = (body as Record<string, unknown>).marketcheck_price;
  return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : undefined;
}
