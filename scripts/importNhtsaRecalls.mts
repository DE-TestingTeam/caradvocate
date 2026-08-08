/**
 * Mirrors NHTSA's entire recall catalog into `nhtsa_recall_campaigns` and
 * `nhtsa_recall_models`, from the bulk flat files they refresh daily.
 *
 *   npm run import:recalls              # downloads both current files
 *   npm run import:recalls -- --dry-run # parse and report, write nothing
 *   npm run import:recalls -- ./pre.zip ./post.zip   # reuse files already on disk
 *
 * WHY: the live API is the only thing between an owner and "could not reach the NHTSA recall
 * database", and it is avoidable -- this is the same data, published as a file. Once mirrored,
 * services/recallMirror.ts answers whenever api.nhtsa.gov does not.
 *
 * BOTH FILES ARE REQUIRED. The split is by campaign date, not model year, so PRE_2010 is not
 * "old cars nobody drives" -- it is every campaign issued before 2010, which includes most of
 * the recalls on a 1998 Corolla. Loading POST_2010 alone leaves that car showing no recalls at
 * all, which is the exact false all-clear this feature exists to prevent.
 *
 * Requires `unzip` on PATH. Follows ingestComplaintMileage.mts, which streams NHTSA's
 * complaint file the same way.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createWriteStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { closeDb, getDb, describeTarget } from '../apps/api/src/db/index.js';
import { nhtsaRecallCampaigns, nhtsaRecallModels } from '../apps/api/src/db/schema.js';

const BASE = 'https://static.nhtsa.gov/odi/ffdd/rcl';
const FILES = [
  { name: 'FLAT_RCL_PRE_2010.zip', minBytes: 5_000_000 },
  { name: 'FLAT_RCL_POST_2010.zip', minBytes: 10_000_000 },
] as const;

/** Field positions in FLAT_RCL*.txt, 1-indexed. Every row carries 29. */
const F = {
  CAMPAIGN: 2,
  MAKE: 3,
  MODEL: 4,
  YEAR: 5,
  COMPONENT: 7,
  /**
   * The date the API calls `ReportReceivedDate`, as yyyymmdd. Confirmed against it: campaign
   * 23V657000 is 20230928 here and "28/09/2023" there. Field 13 is a later, different date --
   * using it would skew the recall ordering by weeks.
   */
  REPORTED: 16,
  SUMMARY: 20,
  CONSEQUENCE: 21,
  REMEDY: 22,
  /** Capital S in the API's spelling of the second one; here they are just columns. */
  PARK_IT: 28,
  PARK_OUTSIDE: 29,
} as const;

const FIELD_COUNT = 29;

/**
 * Floors the parse must clear before anything is replaced.
 *
 * The catalog only grows, and measured 169,240 model rows over 26,482 campaigns on 8 Aug 2026.
 * A run that comes back with materially less than that has not found less data -- it has failed
 * to read what is there, most likely a truncated download or a changed layout. Replacing a good
 * mirror with that would take recalls off cars that have them, so a short parse aborts instead.
 *
 * Set well below today's figures rather than just under them: this guards against a broken
 * parse, and a floor that trails the real count too closely turns ordinary variation into a
 * failed night.
 */
const MIN_MODEL_ROWS = 140_000;
const MIN_CAMPAIGNS = 22_000;

/** Postgres caps a statement at 65535 parameters; the widest row here is 8 columns. */
const BATCH = 2_000;

interface ModelRow {
  year: number;
  make: string;
  model: string;
  campaignNumber: string;
  component: string;
  parkIt: boolean;
  parkOutside: boolean;
  reportedOn: string | null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const provided = args.filter((a) => !a.startsWith('--'));

  const campaigns = new Map<string, { summary: string; consequence: string; remedy: string }>();
  const models = new Map<string, ModelRow>();

  let scanned = 0;
  let skipped = 0;

  for (const [i, file] of FILES.entries()) {
    const zipPath = provided[i] ?? (await download(file.name, file.minBytes));
    console.log(`Reading ${path.basename(zipPath)} ...`);

    await streamRows(zipPath, (fields) => {
      scanned += 1;

      // Blank separator lines appear a handful of times in PRE_2010. Nothing else is short.
      if (fields.length !== FIELD_COUNT) {
        skipped += 1;
        return;
      }

      const campaignNumber = text(fields[F.CAMPAIGN - 1]);
      if (!campaignNumber) return;

      const year = Number(fields[F.YEAR - 1]);
      const make = text(fields[F.MAKE - 1]).toUpperCase();
      const model = text(fields[F.MODEL - 1]).toUpperCase();

      // 9999 is NHTSA's "no particular year" filler, used for equipment recalls -- tyres,
      // child seats, trailer parts. Lookups are by exact year, so those rows could never
      // match a vehicle and are dropped rather than stored unreachable.
      if (!Number.isInteger(year) || year < 1900 || year > 2100) return;
      if (!make || !model) return;

      // One campaign's prose serves every model it names; keeping it per model is what
      // makes the denormalised catalog 268MB instead of 33MB.
      if (!campaigns.has(campaignNumber)) {
        campaigns.set(campaignNumber, {
          summary: text(fields[F.SUMMARY - 1]),
          consequence: text(fields[F.CONSEQUENCE - 1]),
          remedy: text(fields[F.REMEDY - 1]),
        });
      }

      // NHTSA lists the same campaign twice for a model occasionally, as the API does.
      models.set(`${year}|${make}|${model}|${campaignNumber}`, {
        year,
        make,
        model,
        campaignNumber,
        component: text(fields[F.COMPONENT - 1]) || 'Unspecified',
        parkIt: isYes(fields[F.PARK_IT - 1]),
        parkOutside: isYes(fields[F.PARK_OUTSIDE - 1]),
        reportedOn: isoDate(fields[F.REPORTED - 1]),
      });
    });
  }

  console.log(
    `\nScanned ${scanned.toLocaleString()} rows -> ${models.size.toLocaleString()} model rows over ` +
      `${campaigns.size.toLocaleString()} campaigns.`,
  );
  if (skipped > 0) console.log(`  (${skipped} blank or malformed line(s) skipped.)`);

  if (models.size < MIN_MODEL_ROWS || campaigns.size < MIN_CAMPAIGNS) {
    throw new Error(
      `Refusing to replace the mirror: parsed ${models.size} model rows over ${campaigns.size} ` +
        `campaigns, below the floor of ${MIN_MODEL_ROWS}/${MIN_CAMPAIGNS}. The existing mirror is ` +
        `untouched. Check the download completed and NHTSA has not changed the file layout.`,
    );
  }

  if (dryRun) {
    console.log('\n--dry-run: nothing written.');
    return;
  }

  const db = getDb();
  console.log(`\nDatabase: ${describeTarget()}`);

  // One transaction, so a failure part-way leaves yesterday's mirror serving rather than an
  // empty table. These two tables are wholly derived from the files just parsed and nothing
  // references them, which is what makes replacing them outright safe -- no other table is
  // touched here, and none should ever be.
  await db.transaction(async (tx) => {
    await tx.delete(nhtsaRecallModels);
    await tx.delete(nhtsaRecallCampaigns);

    const campaignRows = [...campaigns].map(([campaignNumber, prose]) => ({ campaignNumber, ...prose }));
    for (let i = 0; i < campaignRows.length; i += BATCH) {
      await tx.insert(nhtsaRecallCampaigns).values(campaignRows.slice(i, i + BATCH));
    }

    const modelRows = [...models.values()];
    for (let i = 0; i < modelRows.length; i += BATCH) {
      await tx.insert(nhtsaRecallModels).values(modelRows.slice(i, i + BATCH));
      if ((i / BATCH) % 25 === 0) {
        console.log(`  ${Math.min(i + BATCH, modelRows.length).toLocaleString()} / ${modelRows.length.toLocaleString()}`);
      }
    }
  });

  console.log(`\nMirror replaced: ${models.size.toLocaleString()} model rows, ${campaigns.size.toLocaleString()} campaigns.`);
  await closeDb();
}

/** NHTSA pads with double spaces and stray carriage returns; collapse both. */
function text(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function isYes(value: string | undefined): boolean {
  return /^(yes|true)$/i.test((value ?? '').trim());
}

/** yyyymmdd -> ISO yyyy-mm-dd. Anything else is treated as no date at all. */
function isoDate(value: string | undefined): string | null {
  const raw = (value ?? '').trim();
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (!match) return null;

  const [, year, month, day] = match;
  const iso = `${year}-${month}-${day}`;
  // A round trip rejects the impossible dates the pattern lets through, e.g. 31 February.
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return null;

  return iso;
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

/** Downloads one bulk file to a temp path, reusing it if already there. */
async function download(name: string, minBytes: number): Promise<string> {
  const target = path.join(tmpdir(), `nhtsa-${name}`);

  const existing = await stat(target).catch(() => undefined);
  if (existing && existing.size >= minBytes) {
    console.log(`Reusing ${target} (${(existing.size / 1048576).toFixed(0)}MB). Delete it to force a fresh download.`);
    return target;
  }

  console.log(`Downloading ${BASE}/${name} ...`);
  const response = await fetch(`${BASE}/${name}`);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed for ${name} (${response.status})`);
  }
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(target)).catch(async (error) => {
    await unlink(target).catch(() => undefined);
    throw error;
  });

  const written = await stat(target);
  // A truncated download parses as valid-but-short, which the row floors would catch later;
  // catching it here names the actual problem.
  if (written.size < minBytes) {
    await unlink(target).catch(() => undefined);
    throw new Error(`${name} downloaded only ${written.size} bytes, expected at least ${minBytes}.`);
  }

  console.log(`Downloaded ${(written.size / 1048576).toFixed(0)}MB.`);
  return target;
}

await main();
