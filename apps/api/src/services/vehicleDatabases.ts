/**
 * Shared client for the Vehicle Databases API. A timeout, a non-200 or an unexpected
 * body degrades the caller rather than throwing.
 *
 * Returns three outcomes, not two, because VDB distinguishes them and the difference
 * is expensive to lose: `no_record` is a fact safe to cache for the usual week, while
 * `unavailable` (no key, timeout, quota, bad key, 5xx) must not be cached -- doing so
 * would retract pricing we already had. Notably, a spent monthly allowance answers 403
 * on *every* call, so reading that as "no record" would unprice the whole catalog.
 */
import { env } from '../env.js';

const BASE = 'https://api.vehicledatabases.com';

/**
 * Enough for the pricing calls, which answer in well under a second. Overridable because
 * `/repair-estimates` is a different weight of request -- 28KB across twenty service
 * intervals, measured at 3.7-4.1s -- and an eight-second ceiling left it one slow moment from
 * being recorded as an outage. See services/maintenanceSchedule.ts.
 */
const TIMEOUT_MS = 8000;

export type VdbResult =
  | { outcome: 'ok'; body: unknown }
  | { outcome: 'no_record' }
  | { outcome: 'unavailable' };

/**
 * One GET against VDB. Never throws. `path` is already-encoded and absolute from the
 * host, e.g. `/vehicle-repairs/v2/2019/HONDA/CIVIC`.
 */
export async function requestVehicleDatabases(
  path: string,
  timeoutMs: number = TIMEOUT_MS,
): Promise<VdbResult> {
  const key = env.VEHICLEDATABASES_API_KEY;
  // Not configured is a deployment state, not an error.
  if (!key) return { outcome: 'unavailable' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${BASE}${path}`, {
      signal: controller.signal,
      headers: { 'x-authkey': key, Accept: 'application/json' },
    });

    if (!response.ok) return failure(response.status, path);

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
 * Maps an HTTP status onto an outcome. 401 and 403 are logged rather than swallowed:
 * both are operator problems that otherwise present as missing data rather than as
 * something somebody has to go and fix.
 */
function failure(status: number, path: string): VdbResult {
  if (status === 400) {
    // VDB's shape for "Record(s) were not found". We build every path here, so a 400
    // is about the vehicle rather than the request.
    return { outcome: 'no_record' };
  }
  if (status === 401) {
    console.warn('Vehicle Databases rejected VEHICLEDATABASES_API_KEY (401). Repair pricing is off until it is fixed.');
  } else if (status === 403) {
    console.warn('Vehicle Databases call quota is spent (403). Repair pricing is degraded until the allowance resets.');
  } else {
    console.warn(`Vehicle Databases returned ${status} for ${path}.`);
  }
  return { outcome: 'unavailable' };
}

function isSuccessEnvelope(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  return (body as Record<string, unknown>).status === 'success';
}

/**
 * The year/make/model path segments to try for a lookup, in order. Usually one.
 *
 * A hyphenated *model* gets a second attempt with spaces: VDB files "F-150" as "F 150"
 * and answers the hyphenated form with a flat 400, so it would otherwise read as an
 * unpriced car. The make is never rewritten -- VDB's own make list is genuinely
 * hyphenated ("Mercedes-Benz"), so de-hyphenating it would break more than it fixes.
 */
export function modelPaths(key: { year: number; make: string; model: string }): string[] {
  const make = encodeURIComponent(key.make);
  const paths = [`${key.year}/${make}/${encodeURIComponent(key.model)}`];

  if (key.model.includes('-')) {
    paths.push(`${key.year}/${make}/${encodeURIComponent(key.model.replaceAll('-', ' '))}`);
  }

  return paths;
}

/** Reads `data` off a success envelope as an object, or undefined if it is not one. */
export function readData(body: unknown): Record<string, unknown> | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const data = (body as Record<string, unknown>).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  return data as Record<string, unknown>;
}
