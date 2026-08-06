/**
 * Labor hours from Open Labor Project, mapped onto our own repair catalog. This is the
 * feed that fills `laborEstHours`, the column repairPricing.ts left null because Vehicle
 * Databases publishes labor as money only.
 *
 * OLP answers with ~480 job titles per engine per vehicle; we offer 12. `LABOR_JOB_SLUGS`
 * below is the whole of the mapping.
 *
 * WHAT THIS FEED IS: the vendor labels every row it has returned so far
 * `confidence: "estimated"`, and publishes no rate and no parts. So these are estimates
 * presented as book-time-shaped hours, NOT licensed OEM times. Two consequences are load-
 * bearing:
 *
 *   1. HOURS ARE DISPLAY ONLY. The verdict in quoteEvaluation.ts compares dollars, and
 *      must keep doing so. Do not start multiplying hours by a rate to build a fair range.
 *   2. NO DERIVED RATE. `laborRatePerHour` stays null. Dividing VDB's labor dollars by
 *      these hours does not give a shop rate -- VDB's dollars embed overhead, so the
 *      quotient lands well outside any real rate and would be published as though it were
 *      one. See the header of repairPricing.ts for the arithmetic.
 *
 * The stored `source` string carries the vendor's own confidence label, so a row on screen
 * can always be traced back to an estimate rather than a measurement.
 */
import {
  modelQueries,
  readLaborData,
  requestLaborTimes,
  type LaborApiResult,
} from './openLaborProject.js';
import type { ModelKey } from './modelFeed.js';

/**
 * Our catalog slug -> OLP's exact job slug.
 *
 * Hand-written rather than fuzzy-matched, for the same reason as `REPAIR_TITLES`: the near
 * misses are the dangerous part. OLP ships overlapping entries for the same job that
 * disagree with each other -- `brake-pads-front` is 1.0 h and `front-brake-pad-replacement`
 * is 1.5 h on the same vehicle, and `trans-fluid-change` (0.7 h) sits beside
 * `trans-flush` (1.0 h) and `automatic-transmission-fluid-filter-change` (1.5 h). Each
 * mapping below picks the entry whose title matches what our catalog row actually is, and
 * a job we cannot match exactly is left unmapped rather than approximated.
 *
 * `brake-pad-replacement` maps to the FRONT job. Our catalog row is axle-agnostic and OLP
 * splits front from rear; front is the job an owner is nearly always quoted, and it is the
 * cheaper of the two to be wrong about here.
 *
 * `timing-belt-inspection` is deliberately absent, as it is from `REPAIR_TITLES`: this
 * vehicle family is chain-driven and OLP lists no belt inspection at all.
 */
export const LABOR_JOB_SLUGS: Readonly<Record<string, string>> = {
  'brake-pad-replacement': 'brake-pads-front',
  'ac-compressor-replacement': 'ac-compressor',
  'oil-change-filter': 'oil-change',
  'transmission-flush': 'trans-flush',
  'ac-recharge': 'ac-recharge',
  'battery-replacement': 'battery',
  'alternator-replacement': 'alternator',
  'tire-rotation': 'tire-rotation',
  'coolant-flush': 'coolant-flush',
  'spark-plug-replacement': 'spark-plugs',
  'wheel-alignment': 'wheel-alignment',
};

/** One repair's labor time for one model, folded across engines. Hours, to a tenth. */
export interface FetchedLaborTime {
  /** Our catalog slug, already resolved from the OLP job slug. */
  slug: string;
  /** OLP's own job title, kept so a stored row can be traced back to its source. */
  sourceJob: string;
  /** Mean of the engines' own figures. What gets stored. */
  hours: number;
  /** Spread across engines, for provenance. Not stored as columns -- see `describe`. */
  lowHours: number;
  highHours: number;
  /** How many engine variants contributed. */
  engineCount: number;
  /** OLP's own label, e.g. "estimated". Recorded verbatim; see the header. */
  confidence: string;
}

export type LaborTimesResult =
  | { outcome: 'ok'; times: Map<string, FetchedLaborTime> }
  | { outcome: 'no_record' }
  | { outcome: 'unavailable' };

/**
 * Labor times for every catalog repair OLP knows for this model. One call per model, not
 * per repair: the endpoint returns every job at once, which is what makes this affordable
 * against a 10-per-day allowance.
 *
 * Only `no_record` is retried with a rewritten model name -- an `unavailable` means the
 * vendor is not answering, and a second call would only spend more of the allowance.
 */
export async function fetchLaborTimes(lookup: ModelKey): Promise<LaborTimesResult> {
  let last: LaborTimesResult = { outcome: 'no_record' };

  for (const query of modelQueries(lookup)) {
    const result = await requestLaborTimes(query);
    last = toLaborTimesResult(result);
    if (last.outcome !== 'no_record') return last;
  }

  return last;
}

/** Exported for testing: the parse half, with the transport already decided. */
export function toLaborTimesResult(result: LaborApiResult): LaborTimesResult {
  if (result.outcome !== 'ok') return result;

  const times = parseLaborTimes(result.body);
  // An unreadable success envelope is an unexpected shape, not an answer that this model
  // has no book times. Unavailable, so it is retried rather than cached for a week.
  if (times === undefined) return { outcome: 'unavailable' };

  return { outcome: 'ok', times };
}

/**
 * Exported for testing. OLP returns
 * `{ data: { make, model, engines: [ { engine, yearRange, laborTimes: [...] } ] } }`
 * where each labor time is `{ job, jobSlug, category, hours, lowRange, highRange,
 * confidence }`.
 *
 * `undefined` means the body was not the shape we expect. An empty map means it was, and
 * held none of the jobs we map -- a real answer about a thinly covered vehicle.
 */
export function parseLaborTimes(body: unknown): Map<string, FetchedLaborTime> | undefined {
  const data = readLaborData(body);
  if (!data) return undefined;

  const engines = data.engines;
  if (!Array.isArray(engines)) return undefined;

  const slugByJob = new Map(Object.entries(LABOR_JOB_SLUGS).map(([slug, job]) => [job, slug]));

  /** Every engine's figure for one of our slugs, before folding. */
  const collected = new Map<string, { job: string; confidence: string; rows: HoursRow[] }>();

  for (const engine of engines) {
    if (!engine || typeof engine !== 'object' || Array.isArray(engine)) continue;

    const rows = (engine as Record<string, unknown>).laborTimes;
    if (!Array.isArray(rows)) continue;

    // One engine listing the same job twice would otherwise weight it twice in the mean.
    const seen = new Set<string>();

    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      const record = row as Record<string, unknown>;

      const jobSlug = typeof record.jobSlug === 'string' ? record.jobSlug.trim() : undefined;
      if (!jobSlug) continue;

      const slug = slugByJob.get(jobSlug);
      // One of the ~470 jobs we do not offer.
      if (slug === undefined) continue;
      if (seen.has(slug)) continue;

      const hours = readHours(record);
      if (!hours) continue;

      seen.add(slug);

      const entry = collected.get(slug);
      if (entry) {
        entry.rows.push(hours);
      } else {
        collected.set(slug, {
          job: typeof record.job === 'string' && record.job.trim() ? record.job.trim() : jobSlug,
          confidence:
            typeof record.confidence === 'string' && record.confidence.trim()
              ? record.confidence.trim()
              : 'unlabelled',
          rows: [hours],
        });
      }
    }
  }

  const times = new Map<string, FetchedLaborTime>();
  for (const [slug, entry] of collected) {
    times.set(slug, fold(slug, entry.job, entry.confidence, entry.rows));
  }

  return times;
}

/** One engine's figures for one job. */
interface HoursRow {
  hours: number;
  low: number;
  high: number;
}

/**
 * Folds every engine's figure into one, because our benchmark key is year/make/model and
 * carries no engine -- we do not know which one the owner has.
 *
 * The mean of the engines' own `hours`, and the widest low/high, mirroring `union` in
 * repairPricing.ts. A mean is a compromise where the engines genuinely disagree (spark
 * plugs run 0.8 h on an inline-four and 1.5 h on a V6, where the rear bank is buried), so
 * the spread is carried into the provenance string rather than dropped: the stored figure
 * is a typical time for the model, which is what the screen claims it is.
 */
function fold(
  slug: string,
  sourceJob: string,
  confidence: string,
  rows: HoursRow[],
): FetchedLaborTime {
  const mean = rows.reduce((sum, row) => sum + row.hours, 0) / rows.length;

  return {
    slug,
    sourceJob,
    // Labor is quoted in tenths of an hour; anything finer is invented precision.
    hours: toTenths(mean),
    lowHours: toTenths(Math.min(...rows.map((row) => row.low))),
    highHours: toTenths(Math.max(...rows.map((row) => row.high))),
    engineCount: rows.length,
    confidence,
  };
}

/**
 * The three figures off one row. `hours` is required -- it is the one we store. The bounds
 * default to it when absent, and are ordered defensively so a low above its own high
 * cannot make the provenance string nonsense.
 */
function readHours(record: Record<string, unknown>): HoursRow | undefined {
  const hours = readNumber(record.hours);
  if (hours === undefined) return undefined;

  const low = readNumber(record.lowRange) ?? hours;
  const high = readNumber(record.highRange) ?? hours;

  return {
    hours,
    low: Math.min(low, hours, high),
    high: Math.max(low, hours, high),
  };
}

/**
 * Hours as a positive number. Zero and negative are rejected rather than clamped: a job
 * takes time, so either means we misread the field, and a zero would publish a repair as
 * requiring no labor at all.
 */
function readNumber(raw: unknown): number | undefined {
  const value = typeof raw === 'number' ? raw : Number(raw);
  // A 4,2 numeric column tops out at 99.99; a bigger figure is a misread, not a long job.
  if (!Number.isFinite(value) || value <= 0 || value > 99.99) return undefined;
  return value;
}

function toTenths(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Human-readable provenance for one labor time, appended to the benchmark's `source`.
 * Names the vendor's confidence label deliberately -- see the header.
 */
export function describeLaborSource(time: FetchedLaborTime): string {
  const spread =
    time.engineCount > 1 && time.lowHours !== time.highHours
      ? `, ${time.lowHours}-${time.highHours} h across ${time.engineCount} engines`
      : '';

  return `labor ${time.hours} h from Open Labor Project "${time.sourceJob}" (${time.confidence}${spread})`;
}
