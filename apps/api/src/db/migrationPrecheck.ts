/**
 * Refuses to migrate when drizzle would silently skip one of our migrations.
 *
 * THE PROBLEM THIS EXISTS FOR. Two branches write migrations into the same
 * `drizzle.__drizzle_migrations` table on the same database: this one, and the factory-schedule
 * line on the `maintenance` branch (see STATUS.md, "A second migration line"). Drizzle decides
 * what to apply like this -- from drizzle-orm/pg-core/dialect.js, verified in node_modules:
 *
 *   select id, hash, created_at from __drizzle_migrations order by created_at desc limit 1
 *   ...
 *   if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis) { apply }
 *
 * It compares each local migration's journal `when` against ONE number -- the newest `created_at`
 * in the table, whichever line put it there -- and it never looks at hashes to make that decision.
 * So if the other line applies a migration stamped later than one of ours that has not run yet,
 * ours is skipped. Not deferred: skipped, permanently and silently, with `db:migrate` reporting
 * "Migrations applied." The table or column simply never appears, and the first anyone hears of it
 * is `column "..." does not exist` on a request -- which already happened once on 8 August, from a
 * different cause but with exactly this signature.
 *
 * It has been closer than it looks. The factory-schedule `0016_factory_schedules` was applied at
 * 16:29 on 6 August; our own `0016_vehicle_zip_market_value` was generated at 21:19 the same day.
 * Five hours the other way and the zip column would have gone missing with no error.
 *
 * WHY A PRECHECK RATHER THAN A FIX. The real fix is one migration line per database, and that is a
 * conversation with whoever owns the other branch, not a code change. Until then this makes the
 * failure loud: it cannot stop the two lines from interleaving, but it can guarantee nobody
 * discovers the consequence from a 500 in production.
 *
 * It is deliberately read-only and runs before `migrate()`, so a refusal leaves the database
 * exactly as it was.
 */
import { sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Database } from './index.js';

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

/** Index signature so this satisfies `db.execute`'s `Record<string, unknown>` constraint. */
interface AppliedRow extends Record<string, unknown> {
  hash: string;
  created_at: string | number;
}

export interface PrecheckReport {
  /** Ours, already in the table. */
  applied: JournalEntry[];
  /** Ours, not yet applied, and safe to apply -- newer than everything in the table. */
  pending: JournalEntry[];
  /** Ours, not yet applied, and older than the watermark. Drizzle will NOT apply these. */
  skipped: JournalEntry[];
  /** Applied migrations whose hash matches no file here -- the other line's. */
  foreign: number;
  /** Newest `created_at` in the table, or null on a database with no migrations yet. */
  watermark: number | null;
}

export async function precheckMigrations(
  db: Database,
  migrationsFolder: string,
): Promise<PrecheckReport> {
  const journal = JSON.parse(
    readFileSync(`${migrationsFolder}/meta/_journal.json`, 'utf8'),
  ) as { entries: JournalEntry[] };

  // Same hash drizzle computes: sha256 of the raw file, no normalisation (readMigrationFiles).
  const hashOf = (entry: JournalEntry) =>
    createHash('sha256')
      .update(readFileSync(`${migrationsFolder}/${entry.tag}.sql`, 'utf8'))
      .digest('hex');

  const rows = await readApplied(db);

  // A database that has never been migrated has nothing to conflict with, and drizzle creates the
  // table itself. Everything is pending and nothing can be skipped.
  if (rows === null) {
    return { applied: [], pending: journal.entries, skipped: [], foreign: 0, watermark: null };
  }

  const appliedHashes = new Set(rows.map((row) => row.hash));
  const watermark = rows.length
    ? Math.max(...rows.map((row) => Number(row.created_at)))
    : null;

  const report: PrecheckReport = {
    applied: [],
    pending: [],
    skipped: [],
    foreign: rows.length,
    watermark,
  };

  for (const entry of journal.entries) {
    if (appliedHashes.has(hashOf(entry))) {
      report.applied.push(entry);
      report.foreign -= 1;
      continue;
    }
    // Strictly greater, matching drizzle's `<` comparison exactly. An unapplied migration whose
    // `when` equals the watermark is skipped too, which is why this is not `>=`.
    if (watermark === null || entry.when > watermark) report.pending.push(entry);
    else report.skipped.push(entry);
  }

  return report;
}

/** Applied rows, or null when the migrations table does not exist yet. */
async function readApplied(db: Database): Promise<AppliedRow[] | null> {
  const exists = await db.execute<{ present: boolean }>(sql`
    select exists (
      select 1 from information_schema.tables
      where table_schema = 'drizzle' and table_name = '__drizzle_migrations'
    ) as present`);

  if (!exists.rows[0]?.present) return null;

  const applied = await db.execute<AppliedRow>(
    sql`select hash, created_at from drizzle.__drizzle_migrations`,
  );
  return applied.rows;
}

/**
 * The message shown when a migration would be skipped. Names the fix rather than the symptom:
 * regenerating the journal timestamp is the one thing that makes drizzle see the migration again.
 */
export function describeSkipped(report: PrecheckReport): string {
  const names = report.skipped.map((entry) => `  - ${entry.tag} (when ${entry.when})`).join('\n');
  const watermark = report.watermark ?? 0;

  return (
    `Refusing to migrate: drizzle would silently skip ${report.skipped.length} migration(s).\n\n` +
    `${names}\n\n` +
    `Each was generated before the newest migration already applied to this database\n` +
    `(${watermark}, ${new Date(watermark).toISOString()}), and drizzle only applies migrations\n` +
    `stamped later than that. It would report success and apply nothing.\n\n` +
    `This happens because a second migration line -- the factory-schedule work on the\n` +
    `\`maintenance\` branch -- writes to the same drizzle.__drizzle_migrations table.\n` +
    `See STATUS.md, "A second migration line".\n\n` +
    `To fix: raise the \`when\` value of each migration above in\n` +
    `apps/api/drizzle/meta/_journal.json above ${watermark}, then run this again.\n` +
    `The SQL itself needs no change -- only the timestamp drizzle sorts on.`
  );
}
