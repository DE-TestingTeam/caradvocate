/**
 * Turns a connection string into a `pg` pool config.
 *
 * Kept separate from db/index.ts so it can be unit tested without opening a
 * socket -- the rules below are easy to get subtly wrong and impossible to check
 * by reading.
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
    /**
     * Supabase (and most hosted Postgres) terminate TLS with a certificate from
     * a CA that Node does not ship. Verification is therefore disabled, which
     * means the connection is encrypted but the server is not authenticated.
     *
     * That is the standard arrangement for hosted Postgres and is what the
     * `?sslmode=require` in their connection strings asks for. To get full
     * verification, download the project CA certificate and pass it as `ca`
     * here with rejectUnauthorized: true.
     */
    config.ssl = { rejectUnauthorized: false };
  }

  if (isTransactionPooler(url)) {
    /**
     * Supabase's transaction-mode pooler (Supavisor, port 6543) hands a
     * different backend to each transaction, so server-side prepared statements
     * and session state do not survive. Drizzle's normal queries use unnamed
     * statements and are fine; `.prepare()` and LISTEN/NOTIFY are not.
     *
     * A smaller local pool also matters: the pooler multiplexes for us, and
     * every client here consumes one of the project's connection slots.
     */
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
 * Migrations must not run through a transaction pooler: DDL wants a stable
 * session, and Supabase documents the direct connection for exactly this. Falls
 * back to DATABASE_URL when no direct URL is configured (e.g. plain local
 * Postgres, where they are the same thing).
 */
export function migrationUrl(databaseUrl: string, directUrl?: string): string {
  return directUrl && directUrl.length > 0 ? directUrl : databaseUrl;
}
