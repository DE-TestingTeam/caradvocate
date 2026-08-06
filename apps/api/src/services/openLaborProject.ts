/**
 * Shared client for the Open Labor Project API, which publishes labor hours per
 * year/make/model -- the one thing Vehicle Databases does not (see repairPricing.ts).
 *
 * Same three-outcome contract as vehicleDatabases.ts, for the same reason: `no_record` is
 * a fact about the vehicle and safe to cache for the usual week, while `unavailable` (no
 * key, timeout, quota, bad key, 5xx) must never be cached, because caching it would
 * retract labor times we already hold.
 *
 * THE FREE TIER IS 10 REQUESTS PER DAY and answers 429 once spent. A sync makes at most
 * one call per model per week, so that is a real ceiling on how many models can be primed
 * in one day rather than a theoretical one. A 429 is logged, because a spent daily
 * allowance otherwise looks indistinguishable from a vendor that knows no book times.
 */
import { env } from '../env.js';

const BASE = 'https://openlaborproject.com/api/v1';
const TIMEOUT_MS = 8000;

export type LaborApiResult =
  | { outcome: 'ok'; body: unknown }
  | { outcome: 'no_record' }
  | { outcome: 'unavailable' };

/** The lookup as the API wants it: three query parameters, not path segments. */
export interface LaborQuery {
  year: number;
  make: string;
  model: string;
}

/** One GET against Open Labor Project. Never throws. */
export async function requestLaborTimes(query: LaborQuery): Promise<LaborApiResult> {
  const key = env.OPEN_LABOR_PROJECT_API_KEY;
  // Not configured is a deployment state, not an error.
  if (!key) return { outcome: 'unavailable' };

  // Lowercased to match the vendor's own documented example. Our ModelKey is uppercase
  // (services/modelFeed.ts), and the API has only ever been exercised in lower case.
  const params = new URLSearchParams({
    make: query.make.toLowerCase(),
    model: query.model.toLowerCase(),
    year: String(query.year),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE}/labor-times?${params.toString()}`, {
      signal: controller.signal,
      headers: { 'x-api-key': key, Accept: 'application/json' },
    });

    if (!response.ok) return failure(response.status, params.toString());

    const body = (await response.json()) as unknown;
    if (!isSuccessEnvelope(body)) return { outcome: 'unavailable' };

    return { outcome: 'ok', body };
  } catch {
    // Offline, blocked, slow, or malformed JSON. All the same to the caller.
    return { outcome: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Maps an HTTP status onto an outcome. 401 and 429 are logged rather than swallowed: both
 * are operator problems that otherwise present as missing data rather than as something
 * somebody has to go and fix.
 */
function failure(status: number, query: string): LaborApiResult {
  if (status === 404) {
    // We build every query here, so a 404 is about the vehicle, not the request.
    return { outcome: 'no_record' };
  }
  if (status === 401 || status === 403) {
    console.warn(
      `Open Labor Project rejected OPEN_LABOR_PROJECT_API_KEY (${status}). Labor times are off until it is fixed.`,
    );
  } else if (status === 429) {
    console.warn(
      'Open Labor Project daily request allowance is spent (429). Labor times are degraded until it resets.',
    );
  } else {
    console.warn(`Open Labor Project returned ${status} for ${query}.`);
  }
  return { outcome: 'unavailable' };
}

/**
 * The envelope is `{ data, meta, error }`. A non-null `error` beside a 200 is a shape we
 * have not seen and cannot interpret, so it counts as unavailable -- retried next week
 * rather than cached as "this car has no book times".
 */
function isSuccessEnvelope(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const record = body as Record<string, unknown>;
  if (record.error != null) return false;
  return record.data != null && typeof record.data === 'object' && !Array.isArray(record.data);
}

/**
 * The queries to try for a lookup, in order. Usually one.
 *
 * A hyphenated *model* gets a second attempt with spaces, mirroring `modelPaths` in
 * vehicleDatabases.ts -- vendors disagree on whether an F-150 is "f-150" or "f 150", and
 * a miss would otherwise read as a car with no book times. Costs a second request against
 * a 10-per-day allowance, so it is spent only on a `no_record`, never on an outage.
 */
export function modelQueries(key: LaborQuery): LaborQuery[] {
  const queries: LaborQuery[] = [key];

  if (key.model.includes('-')) {
    queries.push({ ...key, model: key.model.replaceAll('-', ' ') });
  }

  return queries;
}

/** Reads `data` off a success envelope as an object, or undefined if it is not one. */
export function readLaborData(body: unknown): Record<string, unknown> | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const data = (body as Record<string, unknown>).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  return data as Record<string, unknown>;
}
