/**
 * Repair pricing from Vehicle Databases, mapped onto our own repair catalog. This is the
 * feed the "is my quote fair" judgement rests on.
 *
 * VDB answers with 76 repair titles per vehicle; we offer 12. `REPAIR_TITLES` below is
 * the whole of the mapping.
 *
 * WHAT THIS FEED DOES NOT PUBLISH: money and only money -- a parts, labor and total range
 * per shop channel, with no parts itemisation and no labor times. Nothing here derives a
 * time from a dollar figure, and nothing should. VDB's labor dollars embed shop overhead
 * and do not divide back into book time at any sane rate: at $95/hr a Civic oil change
 * comes out at 0.48 h (really ~0.3) and an AC compressor at 11.35 h (really ~4), and a
 * fabricated 11-hour job beside a real dollar figure discredits the figure. The separate
 * /repair-estimates/{vin} endpoint does publish times, but only for factory-scheduled
 * maintenance; do not mix the two bases into one benchmark.
 *
 * Hours now come from a second vendor instead -- see services/laborTimes.ts, which fills
 * `laborEstHours` alongside these figures. `laborRatePerHour` is still nobody's to fill:
 * dividing these dollars by those hours is the same bad arithmetic as above.
 *
 * INDEPENDENT *AND* DEALER: VDB prices each title for both, and 35 of the 76 titles are
 * dealer-only. The fair range is the UNION of whichever channels are present -- a
 * deliberate bias towards forgiveness, since evaluateQuote only flags quotes above
 * `fairTotalHigh`, and an independent-only range would tell an owner paying an ordinary
 * dealer price they were overcharged (brake pads: independent tops out at $317, a dealer
 * starts at $338).
 */
import {
  modelPaths,
  readData,
  requestVehicleDatabases,
  type VdbResult,
} from './vehicleDatabases.js';
import type { ModelKey } from './modelFeed.js';

/**
 * Our catalog slug -> VDB's exact repair title.
 *
 * Hand-written rather than fuzzy-matched on purpose: the near misses are the dangerous
 * part. VDB lists "Brakes - Replace Pads", "... Pads & Rotors", "... Pads & Resurface
 * Rotors" and "... Replace Rotors" as four separately-priced jobs, and matching a pads
 * quote against the pads-and-rotors range ($271-$396 vs $614-$714) would call a rip-off
 * fair. A missing mapping costs one unpriced repair; a wrong one costs the verdict.
 *
 * `timing-belt-inspection` is deliberately absent: VDB prices a timing belt
 * *replacement* (~$950) and no inspection, so pricing one off the other would overstate
 * it tenfold. GET /api/repairs drops the unpriced row from the picker.
 */
export const REPAIR_TITLES: Readonly<Record<string, string>> = {
  'brake-pad-replacement': 'Brakes - Replace Pads',
  'ac-compressor-replacement': 'Air Conditioning - Replace Compressor',
  'oil-change-filter': 'Oil Change',
  'transmission-flush': 'Transmission Fluid - Flush',
  'ac-recharge': 'Air Conditioning - Recharge',
  'battery-replacement': 'Battery - Replace',
  'alternator-replacement': 'Alternator Replacement',
  'tire-rotation': 'Tire(s) - Rotate',
  'coolant-flush': 'Coolant - Flush',
  'spark-plug-replacement': 'Spark Plugs - Replace',
  'wheel-alignment': 'Wheels - Alignment',
};

/** One repair's pricing for one model, normalised for storage. Whole dollars. */
export interface FetchedRepairBenchmark {
  /** Our catalog slug, already resolved from the VDB title. */
  slug: string;
  /** VDB's own title, kept so a stored row can be traced back to its source. */
  sourceTitle: string;
  partsTotal: number;
  partsLow: number;
  partsHigh: number;
  laborTotal: number;
  fairTotalLow: number;
  fairTotalHigh: number;
  /** Which channels contributed, for the provenance note on the row. */
  channels: ('independent' | 'dealer')[];
}

export type RepairPricingResult =
  | { outcome: 'ok'; benchmarks: FetchedRepairBenchmark[] }
  | { outcome: 'no_record' }
  | { outcome: 'unavailable' };

/**
 * Pricing for every catalog repair VDB knows for this model. One call per model, not per
 * repair: the endpoint returns all 76 titles at once, which is what makes a weekly
 * refresh affordable against a metered quota.
 *
 * A hyphenated model name gets a second attempt with spaces (see `modelPaths`). Only
 * `no_record` is retried -- an `unavailable` means the vendor is not answering.
 */
export async function fetchRepairPricing(lookup: ModelKey): Promise<RepairPricingResult> {
  let last: RepairPricingResult = { outcome: 'no_record' };

  for (const path of modelPaths(lookup)) {
    const result = await requestVehicleDatabases(`/vehicle-repairs/v2/${path}`);
    last = toPricingResult(result);
    if (last.outcome !== 'no_record') return last;
  }

  return last;
}

/** Exported for testing: the parse half, with the transport already decided. */
export function toPricingResult(result: VdbResult): RepairPricingResult {
  if (result.outcome !== 'ok') return result;

  const benchmarks = parseRepairPricing(result.body);
  // An unreadable success envelope is an unexpected shape, not an answer that this model
  // has no pricing. Unavailable, so it is retried rather than cached for a week.
  if (benchmarks === undefined) return { outcome: 'unavailable' };

  return { outcome: 'ok', benchmarks };
}

/**
 * Exported for testing. VDB returns
 * `{ data: { repair: [ { title, costs: { independent: [...], dealer: [...] } } ] } }`
 * where each cost entry is `{ name: 'part' | 'labor' | 'total', average, high, low }`.
 *
 * `undefined` means the body was not the shape we expect. An empty array means it was,
 * and held none of the titles we price -- a real answer about a thinly covered vehicle.
 */
export function parseRepairPricing(body: unknown): FetchedRepairBenchmark[] | undefined {
  const data = readData(body);
  if (!data) return undefined;

  const rows = data.repair;
  if (!Array.isArray(rows)) return undefined;

  const slugByTitle = new Map(Object.entries(REPAIR_TITLES).map(([slug, title]) => [title, slug]));

  const benchmarks: FetchedRepairBenchmark[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const record = row as Record<string, unknown>;

    const title = typeof record.title === 'string' ? record.title.trim() : undefined;
    if (!title) continue;

    const slug = slugByTitle.get(title);
    // One of the 65 titles we do not offer.
    if (slug === undefined) continue;
    // A duplicate title would otherwise fight itself through the upsert on every sync.
    if (seen.has(slug)) continue;

    const benchmark = toBenchmark(slug, title, record.costs);
    if (!benchmark) continue;

    seen.add(slug);
    benchmarks.push(benchmark);
  }

  return benchmarks;
}

/** One channel's figures for one cost line. */
interface CostLine {
  low: number;
  average: number;
  high: number;
}

/**
 * Folds the channels present into one set of figures, or undefined when the row cannot
 * support a benchmark. A total range is required -- it is what the verdict compares
 * against. Parts and labor are presentation, and a zero parts total is legitimate (VDB
 * prices a tire rotation as pure labor), so they default rather than disqualify.
 */
function toBenchmark(
  slug: string,
  sourceTitle: string,
  rawCosts: unknown,
): FetchedRepairBenchmark | undefined {
  if (!rawCosts || typeof rawCosts !== 'object' || Array.isArray(rawCosts)) return undefined;
  const costs = rawCosts as Record<string, unknown>;

  const channels: ('independent' | 'dealer')[] = [];
  const lines: Record<string, CostLine[]> = { part: [], labor: [], total: [] };

  for (const channel of ['independent', 'dealer'] as const) {
    const entries = readChannel(costs[channel]);
    // An empty array is how VDB says this channel does not price this job.
    if (entries.size === 0) continue;

    channels.push(channel);
    for (const [name, line] of entries) lines[name]?.push(line);
  }

  const total = union(lines.total);
  if (!total) return undefined;

  const parts = union(lines.part);
  const labor = union(lines.labor);

  return {
    slug,
    sourceTitle,
    partsTotal: parts?.average ?? 0,
    partsLow: parts?.low ?? 0,
    partsHigh: parts?.high ?? 0,
    laborTotal: labor?.average ?? 0,
    fairTotalLow: total.low,
    fairTotalHigh: total.high,
    channels,
  };
}

/** The `part`/`labor`/`total` lines of one channel, keyed by name. */
function readChannel(raw: unknown): Map<string, CostLine> {
  const lines = new Map<string, CostLine>();
  if (!Array.isArray(raw)) return lines;

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;

    const name = typeof record.name === 'string' ? record.name.trim().toLowerCase() : undefined;
    if (name !== 'part' && name !== 'labor' && name !== 'total') continue;

    const low = readMoney(record.low);
    const average = readMoney(record.average);
    const high = readMoney(record.high);
    if (low === undefined || average === undefined || high === undefined) continue;

    // Keeps the range coherent if VDB ever sends the bounds out of order, so a low above
    // its own high cannot make every quote look fair.
    lines.set(name, {
      low: Math.min(low, average, high),
      average,
      high: Math.max(low, average, high),
    });
  }

  return lines;
}

/**
 * The union across channels: widest range, mean of the averages. The average is the mean
 * of the channels' own averages rather than the midpoint of the union, so it stays a
 * figure VDB published rather than one derived from its extremes.
 */
function union(lines: CostLine[]): CostLine | undefined {
  if (lines.length === 0) return undefined;

  return {
    low: Math.min(...lines.map((line) => line.low)),
    average: Math.round(lines.reduce((sum, line) => sum + line.average, 0) / lines.length),
    high: Math.max(...lines.map((line) => line.high)),
  };
}

/**
 * Money as whole dollars, matching the rest of the schema. Negative is rejected rather
 * than clamped: it means we misread the field, and a negative bound would silently widen
 * a fair range to cover everything.
 */
function readMoney(raw: unknown): number | undefined {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value);
}
