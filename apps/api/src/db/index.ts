/**
 * Database client. One driver: real Postgres over `pg`, at whatever `DATABASE_URL` points
 * at -- Supabase, Postgres.app, Homebrew, a Docker container.
 */
import { sql } from 'drizzle-orm';
import { drizzle as drizzleNode, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';
import { env } from '../env.js';
import { buildPoolConfig, migrationUrl } from './connection.js';

/** The type every route and service is written against. */
export type Database = NodePgDatabase<typeof schema>;

let pool: Pool | undefined;
let instance: Database | undefined;

/**
 * The shared pool, created on first call and reused. Throws when `DATABASE_URL` is unset rather
 * than returning a client that fails on its first query.
 */
export function getDb(): Database {
  if (instance) return instance;

  if (!env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is required. Set it to a Postgres connection string -- see the README.',
    );
  }

  pool = new Pool(buildPoolConfig(env.DATABASE_URL, { sslMode: env.PGSSLMODE }));

  // Without this, a hosted provider dropping an idle connection becomes an unhandled
  // 'error' event and takes the process down.
  pool.on('error', (error) => {
    console.error('Idle Postgres client error:', error.message);
  });

  instance = drizzleNode(pool, { schema });
  return instance;
}

/**
 * Confirms the schema has been created. A never-migrated Supabase project connects fine
 * while holding no tables, and without this the server starts happily and then fails on
 * the first request with a raw `relation "users" does not exist`.
 */
export async function assertSchemaPresent(db: Database): Promise<void> {
  const result = await db.execute(sql`select to_regclass('public.users') is not null as present`);
  const rows = (result as unknown as { rows?: { present?: boolean }[] }).rows ?? [];

  if (!rows[0]?.present) {
    throw new Error(
      `No schema found in ${describeTarget()}. Run \`npm run db:setup\` to create the tables and seed reference data.`,
    );
  }
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  instance = undefined;
}

/**
 * A connection for migrations, on the direct (non-pooled) URL: DDL needs a stable session,
 * and migrations through a transaction pooler fail in ways that are hard to read.
 */
export function createMigrationDb(): { db: Database; close: () => Promise<void> } {
  const migrationPool = new Pool(buildPoolConfig(migrationTarget(), { sslMode: env.PGSSLMODE }));
  return {
    db: drizzleNode(migrationPool, { schema }),
    close: () => migrationPool.end(),
  };
}

/**
 * Human-readable description of the connection target, password redacted. Never throws,
 * even with no DATABASE_URL: it is used inside error messages, and one that threw would
 * replace the message the caller needs with its own.
 */
export function describeTarget(): string {
  if (!env.DATABASE_URL) return 'the connected database';
  return migrationTarget().replace(/:[^:@/]*@/, ':***@');
}

function migrationTarget(): string {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required. Set it to a Postgres connection string.');
  }
  return migrationUrl(env.DATABASE_URL, env.DIRECT_DATABASE_URL);
}

export { schema };
