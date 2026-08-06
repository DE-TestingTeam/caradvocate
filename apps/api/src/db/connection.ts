/**
 * Turns a connection string into a `pg` pool config. Separate from db/index.ts so it can be
 * unit tested without opening a socket.
 */
import type { PoolConfig } from 'pg';

export interface ConnectionOptions {
  /** Overrides the automatic decision. Mirrors libpq's PGSSLMODE. */
  sslMode?: 'require' | 'disable' | 'prefer';
}

/** Hosts that are genuinely local and therefore safe without TLS. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

export function buildPoolConfig(databaseUrl: string, options: ConnectionOptions = {}): PoolConfig {
  const url = new URL(databaseUrl);
  const explicitMode = options.sslMode ?? (url.searchParams.get('sslmode') as ConnectionOptions['sslMode']);

  const config: PoolConfig = { connectionString: databaseUrl };

  if (needsSsl(url.hostname, explicitMode)) {
    // Supabase and most hosted Postgres terminate TLS with a CA that Node does not ship, so
    // the connection is encrypted but the server is not authenticated -- which is what the
    // `?sslmode=require` in their connection strings asks for. For full verification, pass
    // the project CA certificate as `ca` with rejectUnauthorized: true.
    config.ssl = { rejectUnauthorized: false };
  }

  if (isTransactionPooler(url)) {
    // Supavisor hands a different backend to each transaction, so prepared statements and
    // session state do not survive -- Drizzle's unnamed statements are fine, `.prepare()`
    // and LISTEN/NOTIFY are not. The pool stays small because the pooler multiplexes for us
    // and every client consumes one of the project's connection slots.
    config.max = 5;
  }

  return config;
}

function needsSsl(hostname: string, mode: ConnectionOptions['sslMode']): boolean {
  if (mode === 'disable') return false;
  if (mode === 'require') return true;
  // Default: anything not on this machine gets TLS.
  return !LOCAL_HOSTS.has(hostname);
}

/** Supabase exposes transaction-mode pooling on 6543 and session mode on 5432. */
export function isTransactionPooler(url: URL): boolean {
  return url.port === '6543' || url.hostname.includes('pooler.supabase.com');
}

/**
 * Migrations must not run through a transaction pooler -- DDL wants a stable session. Falls
 * back to DATABASE_URL when no direct URL is configured, as with plain local Postgres.
 */
export function migrationUrl(databaseUrl: string, directUrl?: string): string {
  return directUrl && directUrl.length > 0 ? directUrl : databaseUrl;
}
