/**
 * Test database.
 *
 * PGlite is Postgres compiled to WebAssembly, so the suite gets real enums,
 * constraints and foreign keys without Docker or a running server. Migrations
 * are applied from the same ./drizzle folder production uses, which means a
 * broken migration fails the tests rather than surfacing on deploy.
 */
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '../src/db/schema.js';
import { seed } from '../src/db/seed.js';
import type { Database } from '../src/db/index.js';

export type TestDb = PgliteDatabase<typeof schema>;

/**
 * Resolves ./drizzle relative to this file.
 *
 * fileURLToPath rather than URL.pathname: pathname percent-encodes characters
 * like spaces, so a checkout under a path such as "CarAdvocate Wireframes/"
 * would fail to find the migrations.
 */
function migrationsFolder(): string {
  return fileURLToPath(new URL('../drizzle', import.meta.url));
}

export async function createTestDb(): Promise<{ db: TestDb; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });

  await migrate(db, { migrationsFolder: migrationsFolder() });
  // The seed and app code are written against the node-postgres Database type.
  // PGlite's driver is API-compatible for everything we use.
  await seed(db as unknown as Database);

  return { db, close: () => client.close() };
}
