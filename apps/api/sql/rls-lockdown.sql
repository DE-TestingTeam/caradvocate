-- ============================================================================
-- Close PostgREST access to the public schema.
--
-- WHY THIS EXISTS
--
-- A Supabase project ships two doors into the same Postgres database:
--
--   1. the Postgres wire protocol on :5432, which this app uses (src/db/index.ts
--      opens a `pg` pool there as the `postgres` role), and
--   2. PostgREST on https://<project>.supabase.co/rest/v1, reachable by anyone
--      holding the anon key.
--
-- The anon key is public by design -- auth/config.ts:61 serves it to the browser
-- so supabase-js can run sign-in. Supabase's stock grants give `anon` and
-- `authenticated` ALL privileges on every table in `public`, on the assumption
-- that row level security is the thing actually saying no. With RLS off, nothing
-- says no: an unauthenticated GET on /rest/v1/users returns every row, and the
-- DELETE and TRUNCATE grants are live too.
--
-- This script shuts door 2. It does not touch door 1.
--
-- WHY IT CANNOT BREAK THE APP
--
--   * The API connects as `postgres`, which has rolbypassrls = true. RLS is not
--     consulted for that role at all, so enabling it changes no query the app runs.
--   * apps/web only ever calls supabase.auth.* (lib/auth.tsx). There is not one
--     .from('<table>') call in apps/web/src, so no browser code reads tables
--     through PostgREST today. Auth lives in the `auth` schema and is untouched.
--   * `service_role` is deliberately left alone -- it is how server-side Supabase
--     clients and the Supabase dashboard reach data.
--
-- HOW TO APPLY -- pick one:
--
--   psql "$DATABASE_URL" -f apps/api/sql/rls-lockdown.sql
--
--   ...or paste it into the Supabase dashboard SQL editor.
--
--   ...or turn it into a real migration so it is reproducible on a fresh project:
--     1. cp apps/api/sql/rls-lockdown.sql apps/api/drizzle/0016_rls_lockdown.sql
--     2. add this entry to the "entries" array in drizzle/meta/_journal.json:
--          { "idx": 16, "version": "7", "when": <epoch ms, > 1785961401211>,
--            "tag": "0016_rls_lockdown", "breakpoints": true }
--     3. npm run db:migrate
--    Note drizzle-kit 0.36.4 does not track RLS or grants in its snapshots, so a
--    hand-written migration like this causes no drift on the next db:generate.
--
-- Everything below is idempotent and safe to run more than once.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Enable row level security on every table.
--
-- With RLS enabled and zero policies defined, Postgres denies all access to
-- non-bypassing roles -- deny-by-default. `postgres` is unaffected (BYPASSRLS).
-- This is the belt; the revokes below are the braces. Either alone would close
-- the hole, and having both means a stray future GRANT does not silently reopen it.
-- ----------------------------------------------------------------------------

alter table public.assessment_labor_tasks    enable row level security;
alter table public.assessment_parts          enable row level security;
alter table public.assessments               enable row level security;
alter table public.benchmark_labor_tasks     enable row level security;
alter table public.benchmark_parts           enable row level security;
alter table public.maintenance_items         enable row level security;
alter table public.model_feed_syncs          enable row level security;
alter table public.model_known_issues        enable row level security;
alter table public.model_owner_report_quotes enable row level security;
alter table public.model_owner_reports       enable row level security;
alter table public.model_recalls             enable row level security;
alter table public.paywall_intents           enable row level security;
alter table public.repair_benchmarks         enable row level security;
alter table public.repairs                   enable row level security;
alter table public.service_records           enable row level security;
alter table public.user_features             enable row level security;
alter table public.users                     enable row level security;
alter table public.vehicle_recall_status     enable row level security;
alter table public.vehicle_value_points      enable row level security;
alter table public.vehicles                  enable row level security;

-- ----------------------------------------------------------------------------
-- 2. Take away the stock grants.
--
-- Sequences matter as much as tables: INSERT rights are useless without nextval,
-- but a leftover sequence grant leaks row counts through currval/last_value.
-- ----------------------------------------------------------------------------

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all routines  in schema public from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Make it stick for tables created later.
--
-- Default privileges are recorded per creating role. Drizzle migrations run as
-- `postgres`, so this is the role whose defaults need changing -- otherwise the
-- next `db:migrate` that adds a table hands `anon` full rights on it again.
--
-- Note this does NOT enable RLS on future tables; Postgres has no default for
-- that. Add an `enable row level security` line to each new table's migration.
-- ----------------------------------------------------------------------------

alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on routines  from anon, authenticated;

commit;

-- ============================================================================
-- VERIFY
--
-- Expect 21 rows, rls_enabled = true, policies = 0 on every one:
--
--   select c.relname,
--          c.relrowsecurity as rls_enabled,
--          (select count(*) from pg_policies p
--             where p.schemaname = 'public' and p.tablename = c.relname) as policies
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relkind = 'r'
--    order by c.relname;
--
-- Expect zero rows -- no table privileges left for the public roles:
--
--   select grantee, table_name, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and grantee in ('anon', 'authenticated');
--
-- Then confirm from outside. This returned 3 rows of real user emails before the
-- lockdown; afterwards it should be [] or a 401/permission-denied error:
--
--   curl -s "$SUPABASE_URL/rest/v1/users?select=email&limit=3" \
--        -H "apikey: $SUPABASE_ANON_KEY" \
--        -H "Authorization: Bearer $SUPABASE_ANON_KEY"
--
-- And confirm the app is unharmed -- it should start and serve as normal:
--
--   npm run dev --workspace @caradvocate/api
-- ============================================================================

-- ============================================================================
-- ROLLBACK, if something unexpected depended on PostgREST access
--
--   begin;
--   grant all on all tables    in schema public to anon, authenticated;
--   grant all on all sequences in schema public to anon, authenticated;
--   alter table public.users disable row level security;  -- ... and the other 20
--   commit;
--
-- Restoring blanket grants restores the exposure. Prefer granting back only the
-- specific table and privilege you turned out to need, paired with a policy from
-- rls-policies.sql.
-- ============================================================================
