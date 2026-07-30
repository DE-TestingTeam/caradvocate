/**
 * Applies pending migrations from ./drizzle.
 *
 * Uses the direct (non-pooled) connection -- see createMigrationDb. Run with
 * `npm run db:migrate`.
 */
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createMigrationDb, describeTarget } from './index.js';
import { env } from '../env.js';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

// Checked before the log line below, so the run does not announce a target it has
// not got and then fail with a stack trace.
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
  await migrate(db, { migrationsFolder });
  console.log('Migrations applied.');
} finally {
  await close();
}
