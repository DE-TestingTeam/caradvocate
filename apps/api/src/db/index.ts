/**
 * Database client.
 *
 * Two drivers, one type. Route code sees `Database` and cannot tell which it got:
 *
 *   - `DATABASE_URL` set  -> real Postgres over `pg`. Supabase, Postgres.app,
 *     Homebrew, Docker; whatever the URL points at.
 *   - `DATABASE_URL` unset -> PGlite, Postgres compiled to WebAssembly, running
 *     in this process and persisting to PGLITE_DATA_DIR. Nothing to install, and
 *     the same Postgres 16 semantics: real enums, foreign keys, transactions.
 *
 * The fallback exists so a fresh clone runs with zero setup. It is a development
 * convenience, not a deployment target -- it holds one connection, lives inside
 * the API process, and is refused outright in production below.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzleNode, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { Pool } from 'pg';
import * as schema from './schema.js';
import { env } from '../env.js';
import { buildPoolConfig, migrationUrl } from './connection.js';

/**
 * Routes are written against the node-postgres flavour. The PGlite driver is
 * API-compatible across everything this app uses -- select, insert, update,
 * delete, transactions and the relational query builder -- so it is presented as
 * the same type rather than forcing every call site to handle a union.
 */
export type Database = NodePgDatabase<typeof schema>;

export type Driver = 'postgres' | 'pglite';

/** Which driver the current configuration selects. */
export function activeDriver(): Driver {
  return env.DATABASE_URL ? 'postgres' : 'pglite';
}

/** Absolute path of the PGlite data directory, resolved from the repo root. */
function pgliteDataDir(): string {
  const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
  return path.resolve(repoRoot, env.PGLITE_DATA_DIR);
}

let pool: Pool | undefined;
let pglite: PGlite | undefined;
let instance: Database | undefined;

export function getDb(): Database {
  if (instance) return instance;

  if (env.DATABASE_URL) {
    pool = new Pool(buildPoolConfig(env.DATABASE_URL, { sslMode: env.PGSSLMODE }));

    // Without this, a hosted provider dropping an idle connection becomes an
    // unhandled 'error' event and takes the process down.
    pool.on('error', (error) => {
      console.error('Idle Postgres client error:', error.message);
    });

    instance = drizzleNode(pool, { schema });
    return instance;
  }

  if (env.NODE_ENV === 'production') {
    throw new Error(
      'DATABASE_URL is required in production. The PGlite dev fallback is not a deployment target.',
    );
  }

  pglite = new PGlite(pgliteDataDir());
  instance = drizzlePglite(pglite, { schema }) as unknown as Database;
  return instance;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  await pglite?.close();
  pool = undefined;
  pglite = undefined;
  instance = undefined;
}

/**
 * A connection for migrations.
 *
 * On real Postgres this deliberately uses the direct (non-pooled) URL, because
 * DDL needs a stable session. On PGlite there is only one connection anyway.
 */
export function createMigrationDb(): { db: Database; close: () => Promise<void> } {
  if (env.DATABASE_URL) {
    const migrationPool = new Pool(buildPoolConfig(migrationTarget(), { sslMode: env.PGSSLMODE }));
    return {
      db: drizzleNode(migrationPool, { schema }),
      close: () => migrationPool.end(),
    };
  }

  const client = new PGlite(pgliteDataDir());
  return {
    db: drizzlePglite(client, { schema }) as unknown as Database,
    close: () => client.close(),
  };
}

/** Human-readable description of what we are about to connect to. */
export function describeTarget(): string {
  if (env.DATABASE_URL) {
    return migrationTarget().replace(/:[^:@/]*@/, ':***@');
  }
  return `PGlite at ${path.relative(process.cwd(), pgliteDataDir()) || env.PGLITE_DATA_DIR}`;
}

function migrationTarget(): string {
  if (!env.DATABASE_URL) return pgliteDataDir();
  return migrationUrl(env.DATABASE_URL, env.DIRECT_DATABASE_URL);
}

export { schema };
