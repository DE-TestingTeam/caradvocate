/**
 * Applies pending migrations from ./drizzle.
 *
 * Works against whichever driver the configuration selects: the direct
 * (non-pooled) connection on real Postgres, or the PGlite data directory when
 * DATABASE_URL is unset. Run with `npm run db:migrate`.
 */
import { fileURLToPath } from 'node:url';
import { migrate as migrateNode } from 'drizzle-orm/node-postgres/migrator';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { activeDriver, createMigrationDb, describeTarget } from './index.js';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

console.log(`Applying migrations to ${describeTarget()}`);

const { db, close } = createMigrationDb();

try {
  // The two migrators are not interchangeable: each speaks its own driver.
  if (activeDriver() === 'postgres') {
    await migrateNode(db, { migrationsFolder });
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migratePglite(db as any, { migrationsFolder });
  }
  console.log('Migrations applied.');
} finally {
  await close();
}
