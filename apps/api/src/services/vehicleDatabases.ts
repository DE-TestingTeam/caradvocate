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

/**
 * How long a vendor-wide refusal is honoured before one call is let through to test it.
 *
 * WHY THIS EXISTS. A 401 or a 403 is not about the vehicle being asked for -- a rejected key and
 * a spent call allowance both answer the same way to EVERY call until somebody acts. The retry
 * gates upstream are per model, so on 11 August 2026 six models sat on their own 15-minute and
 * hourly clocks, each independently rediscovering the same fact: roughly twenty-four guaranteed
 * 403s an hour while anyone was using the app.
 *
 * services/modelFeed.ts reasons that this is harmless, on the grounds that "a rejected call is
 * not a billed call". That is an assumption about someone else's billing, and if it is wrong the
 * allowance is being spent on being told the allowance is spent -- a spiral that cannot end while
 * the app is in use. This costs nothing to be right about either way.
 *
 * AN HOUR, not a day. The refusal we are actually recovering from ends on a monthly reset that we
 * cannot see, so the probe interval decides how long the app stays dark after the vendor comes
 * back. An hour caps that at an hour and costs at most ~24 calls a month; a day would cost one
 * and could leave the paid feature empty for a day after it had no reason to be.
 *
 * IN MEMORY, not a column. Losing it on restart costs exactly one extra probe, and a table would
 * make an operator's "clear it and try now" a migration rather than a restart.
 */
const REFUSAL_PROBE_MS = 60 * 60 * 1000;

/** When the vendor last refused everything, or undefined if it is not currently refusing. */
let refusedAt: Date | undefined;

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

  // Known to be refusing everything. Indistinguishable to the caller from the vendor being
  // unreachable, which is exactly what it is -- see REFUSAL_PROBE_MS.
  if (refusalInForce(new Date())) return { outcome: 'unavailable' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${BASE}${path}`, {
      signal: controller.signal,
      headers: { 'x-authkey': key, Accept: 'application/json' },
    });

    // The body is read only for a 400, and only to be logged: that is the one status whose
    // meaning callers cache as a fact about the vehicle. See `failure`.
    if (!response.ok) {
      const detail = response.status === 400 ? await readBodyText(response) : '';
      return failure(response.status, path, detail);
    }

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
function failure(status: number, path: string, detail = ''): VdbResult {
  if (status === 400) {
    /*
     * VDB's shape for "Record(s) were not found". We build every path here, so a 400 should be
     * about the vehicle rather than the request -- and callers treat it as one: repair pricing
     * caches it for the freshness window, and the schedule sync marks the car as having no
     * factory schedule FOREVER.
     *
     * LOGGED, because that assumption is now in doubt. On 11 August 2026 a 2004 Passat came back
     * `no_record` from the market-value endpoint during a burst of calls, then priced normally
     * through this same client minutes later. A 400 that is really a throttle -- the plans sell a
     * credits-per-SECOND limit, one on the entry tier -- would be cached as "this car has no
     * data" and never revisited. Nobody could tell which it had been afterwards, because the body
     * was discarded here. Now it is not, so the next occurrence is diagnosable rather than a
     * theory worth acting on blind.
     */
    console.warn(
      `Vehicle Databases answered 400 for ${path}, read as "no record": ${detail.slice(0, 200) || '(empty body)'}`,
    );
    return { outcome: 'no_record' };
  }
  if (status === 401) {
    refusedAt = new Date();
    console.warn(
      'Vehicle Databases rejected VEHICLEDATABASES_API_KEY (401). Repair pricing is off until it ' +
        'is fixed; no further calls will be made for an hour beyond one probe.',
    );
  } else if (status === 403) {
    refusedAt = new Date();
    console.warn(
      'Vehicle Databases call quota is spent (403). Repair pricing and factory schedules are ' +
        'degraded until the allowance resets; no further calls will be made for an hour beyond ' +
        'one probe.',
    );
  } else {
    console.warn(`Vehicle Databases returned ${status} for ${path}.`);
  }
  return { outcome: 'unavailable' };
}

/**
 * Whether the vendor is currently refusing everything -- and, when the probe interval has
 * elapsed, disarms itself so exactly ONE call gets through to find out.
 *
 * Disarming here rather than after a successful probe is what makes the probe a probe: if that
 * call is refused too, `failure` re-arms it and the next hour is quiet again. If it succeeds,
 * there was nothing to re-arm. Either way one call per interval reaches the vendor, never more.
 */
function refusalInForce(now: Date): boolean {
  if (!refusedAt) return false;
  if (now.getTime() - refusedAt.getTime() >= REFUSAL_PROBE_MS) {
    refusedAt = undefined;
    return false;
  }
  return true;
}

/**
 * Whether the vendor is refusing every call right now, for logging and for scripts that would
 * rather report a spent allowance than grind through a fleet making calls that cannot land.
 */
export function vehicleDatabasesIsRefusing(now: Date = new Date()): boolean {
  return refusedAt !== undefined && now.getTime() - refusedAt.getTime() < REFUSAL_PROBE_MS;
}

/** The error body as text, or empty if it cannot be read. Never throws -- this is for a log line. */
async function readBodyText(response: Response): Promise<string> {
  try {
    return (await response.text()).replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
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
