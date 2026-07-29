/**
 * Connection-config rules.
 *
 * These cannot be verified against a live Supabase project from CI, and getting
 * them wrong fails in ways that are hard to read -- "connection terminated
 * unexpectedly" for missing TLS, or silent prepared-statement errors through the
 * pooler. So the decisions are asserted directly here.
 *
 * The URL shapes below are the formats Supabase hands out.
 */
import { buildPoolConfig, isTransactionPooler, migrationUrl } from '../src/db/connection.js';
import { check, section } from './assert.js';

const SUPABASE_POOLED =
  'postgresql://postgres.abcdefghijklmnop:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres';
const SUPABASE_SESSION =
  'postgresql://postgres.abcdefghijklmnop:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres';
const SUPABASE_DIRECT = 'postgresql://postgres:secret@db.abcdefghijklmnop.supabase.co:5432/postgres';
const LOCAL = 'postgresql://caradvocate:caradvocate@localhost:5432/caradvocate';

export async function run(): Promise<void> {
  section('connection config');

  /* --------------------------------------------------------------- TLS */

  const pooled = buildPoolConfig(SUPABASE_POOLED);
  check('Supabase pooled connection enables TLS', Boolean(pooled.ssl));
  check(
    'TLS does not verify the hosted CA, which Node does not ship',
    typeof pooled.ssl === 'object' && pooled.ssl.rejectUnauthorized === false,
  );

  check('Supabase direct connection enables TLS', Boolean(buildPoolConfig(SUPABASE_DIRECT).ssl));
  check('Supabase session-mode pooler enables TLS', Boolean(buildPoolConfig(SUPABASE_SESSION).ssl));

  const local = buildPoolConfig(LOCAL);
  check('localhost does not use TLS', local.ssl === undefined);
  check('127.0.0.1 does not use TLS', buildPoolConfig(LOCAL.replace('localhost', '127.0.0.1')).ssl === undefined);

  /* ------------------------------------------------------- SSL overrides */

  check(
    'PGSSLMODE=disable wins over the automatic choice',
    buildPoolConfig(SUPABASE_POOLED, { sslMode: 'disable' }).ssl === undefined,
  );
  check(
    'PGSSLMODE=require forces TLS even on localhost',
    Boolean(buildPoolConfig(LOCAL, { sslMode: 'require' }).ssl),
  );
  check(
    '?sslmode=require in the URL forces TLS',
    Boolean(buildPoolConfig(`${LOCAL}?sslmode=require`).ssl),
  );
  check(
    '?sslmode=disable in the URL disables TLS',
    buildPoolConfig(`${SUPABASE_POOLED}?sslmode=disable`).ssl === undefined,
  );
  check(
    'the sslmode Supabase already puts in its strings is honoured',
    Boolean(buildPoolConfig(`${SUPABASE_POOLED}?sslmode=require`).ssl),
  );
  check(
    'a stray query string does not break parsing',
    Boolean(buildPoolConfig(`${SUPABASE_POOLED}?application_name=caradvocate`).ssl),
  );

  /* ----------------------------------------------------- pooler detection */

  check('port 6543 is recognised as the transaction pooler', isTransactionPooler(new URL(SUPABASE_POOLED)));
  check('the pooler hostname is recognised regardless of port', isTransactionPooler(new URL(SUPABASE_SESSION)));
  check('a direct Supabase host is not a pooler', !isTransactionPooler(new URL(SUPABASE_DIRECT)));
  check('localhost is not a pooler', !isTransactionPooler(new URL(LOCAL)));

  check('the pool is capped when going through the pooler', pooled.max === 5, `got ${pooled.max}`);
  check('a direct connection is left uncapped', buildPoolConfig(SUPABASE_DIRECT).max === undefined);
  check('local Postgres is left uncapped', local.max === undefined);

  /* ------------------------------------------------------ migration target */

  check(
    'migrations prefer the direct URL when one is set',
    migrationUrl(SUPABASE_POOLED, SUPABASE_DIRECT) === SUPABASE_DIRECT,
  );
  check(
    'migrations fall back to DATABASE_URL when no direct URL exists',
    migrationUrl(LOCAL, undefined) === LOCAL,
  );
  check(
    'an empty direct URL is treated as unset, not as a valid target',
    migrationUrl(LOCAL, '') === LOCAL,
  );

  /* ------------------------------------------------- credentials preserved */

  check(
    'the connection string is passed through untouched',
    pooled.connectionString === SUPABASE_POOLED,
  );
}
