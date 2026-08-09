/**
 * Applies pending migrations from ./drizzle, on the direct (non-pooled) connection. Run with
 * `npm run db:migrate`.
 */
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createMigrationDb, describeTarget } from './index.js';
import { describeSkipped, precheckMigrations } from './migrationPrecheck.js';
import { env } from '../env.js';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

// Checked before the log line below, so the run does not announce a target it has not got.
if (!env.DIRECT_DATABASE_URL && !env.DATABASE_URL) {
  console.error(
    'DATABASE_URL is required to apply migrations. Set it to a Postgres connection\n' +
      'string, and DIRECT_DATABASE_URL too if it points at a transaction pooler.',
  );
  process.exit(1);
}

console.log(`Applying migrations to ${describeTarget()}`);

const { db, close } = createMigrationDb();

try {
  // Before anything is written: a second migration line shares this table, and drizzle skips
  // rather than errors when the two interleave badly. See migrationPrecheck.ts.
  const report = await precheckMigrations(db, migrationsFolder);

  if (report.foreign > 0) {
    console.log(
      `Note: ${report.foreign} applied migration(s) come from another branch's migration line. ` +
        'See STATUS.md, "A second migration line".',
    );
  }

  if (report.skipped.length > 0) {
    console.error(`\n${describeSkipped(report)}\n`);
    process.exitCode = 1;
  } else if (report.pending.length === 0) {
    console.log('Nothing to apply -- every migration on this branch is already in place.');
  } else {
    console.log(`Applying ${report.pending.length} migration(s): ` +
      report.pending.map((entry) => entry.tag).join(', '));
    await migrate(db, { migrationsFolder });
    console.log('Migrations applied.');
  }
} finally {
  await close();
}
