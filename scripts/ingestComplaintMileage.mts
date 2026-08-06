/**
 * Fills in mileage-at-failure on the owner-report aggregates. NHTSA's JSON complaints API omits
 * the odometer reading; their bulk flat file has it (`MILES`), so this is the only way to answer
 * "is this going to happen to me, and when?"
 *
 *   npm run ingest:mileage                 # downloads the current file
 *   npm run ingest:mileage -- ./cmpl.zip   # or reuse one already on disk
 *
 * Three things shape the design. The file is ~351MB zipped and gigabytes unzipped, so it is
 * streamed through `unzip -p` and only rows for models our users own are kept. Its COMPDESC is
 * finer-grained than the API's `components` ("SERVICE BRAKES, HYDRAULIC" vs "SERVICE BRAKES"),
 * so it is reduced to the same shape before matching -- verified against a 2011 Pathfinder,
 * where the reduced counts match the API's groups exactly. And only about two thirds of
 * complaints report an odometer, so the sample count is stored alongside the range.
 *
 * Requires `unzip` on PATH.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createWriteStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb, describeTarget } from '../apps/api/src/db/index.js';
import { modelOwnerReports, vehicles } from '../apps/api/src/db/schema.js';
import { canonicalComponent } from '../apps/api/src/services/complaints.js';

const BULK_URL = 'https://static.nhtsa.gov/odi/ffdd/cmpl/FLAT_CMPL.zip';

/** Field positions in FLAT_CMPL.txt, 1-indexed per NHTSA's CMPL.txt. */
const F = { MAKE: 4, MODEL: 5, YEAR: 6, COMPDESC: 12, MILES: 18 } as const;

/** Below this a percentile range is arithmetic, not evidence. */
const MIN_SAMPLES = 4;

/** An implausible odometer reading is a typo, not data. */
const MAX_PLAUSIBLE_MI = 500_000;

type ModelKey = string;
const keyOf = (year: number, make: string, model: string) => `${year}|${make}|${model}`;

async function main(): Promise<void> {
  const db = getDb();
  console.log(`Database: ${describeTarget()}`);

  // Only models someone owns: every make would be millions of rows nobody reads.
  const owned = await db
    .selectDistinct({ year: vehicles.year, make: vehicles.make, model: vehicles.model })
    .from(vehicles);

  if (owned.length === 0) {
    console.log('No vehicles on file, so there is nothing to enrich.');
    await closeDb();
    return;
  }

  const wanted = new Map<ModelKey, { year: number; make: string; model: string }>();
  for (const v of owned) {
    wanted.set(keyOf(v.year, v.make.trim().toUpperCase(), v.model.trim().toUpperCase()), {
      year: v.year,
      make: v.make.trim().toUpperCase(),
      model: v.model.trim().toUpperCase(),
    });
  }
  console.log(`Enriching ${wanted.size} model(s): ${[...wanted.values()].map((m) => `${m.year} ${m.make} ${m.model}`).join(', ')}`);

  const zipPath = process.argv[2] ?? (await download());

  /** model|component -> mileages */
  const samples = new Map<string, number[]>();
  let scanned = 0;
  let matched = 0;
  let malformed = 0;

  await streamRows(zipPath, (fields) => {
    scanned += 1;

    // A complaint description containing a newline splits into junk continuation
    // lines. Everything needed sits before it, so a short row is simply skipped.
    if (fields.length < F.MILES) {
      malformed += 1;
      return;
    }

    const year = Number(fields[F.YEAR - 1]);
    if (!Number.isInteger(year)) return;

    const make = (fields[F.MAKE - 1] ?? '').trim().toUpperCase();
    const model = (fields[F.MODEL - 1] ?? '').trim().toUpperCase();
    if (!wanted.has(keyOf(year, make, model))) return;

    const component = canonicalComponent(fields[F.COMPDESC - 1] ?? '');
    if (!component) return;

    const miles = Number(fields[F.MILES - 1]);
    if (!Number.isFinite(miles) || miles <= 0 || miles > MAX_PLAUSIBLE_MI) return;

    matched += 1;
    const key = `${keyOf(year, make, model)}|${component}`;
    const list = samples.get(key) ?? [];
    list.push(Math.round(miles));
    samples.set(key, list);
  });

  console.log(`Scanned ${scanned.toLocaleString()} rows; ${matched.toLocaleString()} carried usable mileage for these models.`);
  if (malformed > 0) {
    console.log(`  (${malformed.toLocaleString()} rows skipped as malformed -- embedded newlines in complaint text.)`);
  }

  let written = 0;
  let tooThin = 0;
  let unmatched = 0;

  for (const [key, mileages] of samples) {
    const [yearStr, make, model, component] = key.split('|');
    const stats = percentiles(mileages);

    if (stats.count < MIN_SAMPLES) {
      tooThin += 1;
      continue;
    }

    const result = await db
      .update(modelOwnerReports)
      .set({
        mileageSampleCount: stats.count,
        mileageLowMi: stats.p25,
        mileageMedianMi: stats.median,
        mileageHighMi: stats.p75,
      })
      .where(
        and(
          eq(modelOwnerReports.year, Number(yearStr)),
          eq(modelOwnerReports.make, make),
          eq(modelOwnerReports.model, model),
          eq(modelOwnerReports.component, component),
        ),
      )
      .returning({ id: modelOwnerReports.id });

    if (result.length === 0) {
      // The API feed has no such component group, so there is nothing to attach the mileage to.
      unmatched += 1;
      console.log(`  no aggregate row for ${yearStr} ${make} ${model} / ${component} -- run the app once to sync complaints first`);
    } else {
      written += result.length;
      console.log(`  ${yearStr} ${make} ${model} / ${component}: ${stats.p25.toLocaleString()}-${stats.p75.toLocaleString()} mi (median ${stats.median.toLocaleString()}, n=${stats.count})`);
    }
  }

  console.log(`\nUpdated ${written} component group(s).`);
  if (tooThin > 0) console.log(`Skipped ${tooThin} group(s) with fewer than ${MIN_SAMPLES} mileage samples.`);
  if (unmatched > 0) console.log(`${unmatched} group(s) had mileage but no aggregate row yet.`);

  await closeDb();
}

/**
 * Nearest-rank percentiles, not interpolated: with a handful of samples an interpolated value
 * invents a precision the data does not have.
 */
function percentiles(values: number[]): { count: number; p25: number; median: number; p75: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(fraction * (sorted.length - 1)))];
  return { count: sorted.length, p25: at(0.25), median: at(0.5), p75: at(0.75) };
}

/** Streams the zip's single member through `unzip -p`, one row per callback. */
async function streamRows(zipPath: string, onRow: (fields: string[]) => void): Promise<void> {
  const child = spawn('unzip', ['-p', zipPath], { stdio: ['ignore', 'pipe', 'pipe'] });

  child.on('error', (error) => {
    throw new Error(`Could not run unzip (is it on PATH?): ${error.message}`);
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line) onRow(line.split('\t'));
  }

  const code: number = await new Promise((resolve) => child.on('close', resolve));
  // unzip exits 0 normally, but SIGPIPE-ish teardown can yield others once the stream is fully
  // consumed, so only a failure with no rows read should throw.
  if (code !== 0 && stderr.trim()) {
    throw new Error(`unzip failed (${code}): ${stderr.trim().slice(0, 200)}`);
  }
}

/** Downloads the current bulk file to a temp path, reusing it if already there. */
async function download(): Promise<string> {
  const target = path.join(tmpdir(), 'nhtsa-FLAT_CMPL.zip');

  const existing = await stat(target).catch(() => undefined);
  if (existing && existing.size > 1_000_000) {
    console.log(`Reusing ${target} (${(existing.size / 1048576).toFixed(0)}MB). Delete it to force a fresh download.`);
    return target;
  }

  console.log(`Downloading ${BULK_URL} ...`);
  const response = await fetch(BULK_URL);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status})`);
  }
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(target)).catch(async (error) => {
    await unlink(target).catch(() => undefined);
    throw error;
  });

  const written = await stat(target);
  console.log(`Downloaded ${(written.size / 1048576).toFixed(0)}MB.`);
  return target;
}

await main();
