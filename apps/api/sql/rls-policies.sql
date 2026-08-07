-- ============================================================================
-- Per-table RLS policies, for reading tables straight from the browser.
--
-- OPTIONAL. Only apply this if you want apps/web to call PostgREST
-- (supabase.from('vehicles').select()) instead of going through the Express API.
-- Today it does neither -- there is no .from() call anywhere in apps/web/src --
-- so rls-lockdown.sql alone is a complete fix and this file is future work.
--
-- Run rls-lockdown.sql FIRST. This file grants privileges back, narrowly, and
-- assumes RLS is already enabled everywhere.
--
-- Everything here is SELECT-only and scoped to `authenticated`. Writes stay with
-- the API, which owns the business rules -- the paywall in services/paywall.ts is
-- not something an INSERT policy can express.
--
--   psql "$DATABASE_URL" -f apps/api/sql/rls-lockdown.sql
--   psql "$DATABASE_URL" -f apps/api/sql/rls-policies.sql
--
-- ---------------------------------------------------------------------------
-- HOW OWNERSHIP WORKS HERE
--
-- Supabase's auth.uid() returns the `sub` of the caller's JWT, which is the
-- Supabase identity. Your rows are not keyed by it. `users.supabase_user_id`
-- (schema.ts:64) is the bridge, and everything else hangs off `users.id`:
--
--   auth.uid() -> users.supabase_user_id -> users.id -> vehicles.user_id -> ...
--
-- Four shapes result, and every table falls into one of them:
--
--   users                                          matched on supabase_user_id
--   vehicles assessments service_records           direct   user_id
--     paywall_intents
--   maintenance_items vehicle_recall_status        join via vehicles
--     vehicle_value_points
--   assessment_parts assessment_labor_tasks        join via assessments
--   repairs repair_benchmarks benchmark_*          shared catalog, no owner
--     model_* (except model_feed_syncs)
--
-- Two tables are deliberately absent from all four, and must stay absent: ask_transcripts
-- and ask_transcript_sources. They are a QA log, not the owner's data to read back -- the
-- app has no screen for them (schema.ts), so a SELECT policy would grant a capability
-- nothing needs and hand the browser the most sensitive rows in the database.
--
-- KNOWN LIMITATION -- read before relying on this
--
-- users.supabase_user_id is nullable, and schema.ts:58-63 says seeded and dev-stub
-- users have it null. Those rows match auth.uid() never, so they and everything
-- they own become invisible to browser queries. The API still sees them (it
-- bypasses RLS), which makes for a confusing split: data visible in the app but
-- absent from a direct query. Backfill supabase_user_id before leaning on this.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- The bridge, as a function.
--
-- Inlining `select id from users where supabase_user_id = auth.uid()` into twenty
-- policies would be twenty places to get wrong, and it recurses: a policy on
-- `users` that queries `users` re-enters itself. SECURITY DEFINER runs the lookup
-- as the owner, sidestepping both problems.
--
-- STABLE lets the planner call it once per statement rather than once per row.
-- The pinned search_path is required: without it, a caller-controlled path could
-- point `users` at a table they own -- the standard SECURITY DEFINER footgun.
-- ----------------------------------------------------------------------------

create or replace function public.app_user_id()
  returns uuid
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select id from public.users where supabase_user_id = (select auth.uid()) limit 1;
$$;

revoke all     on function public.app_user_id() from public, anon, authenticated;
grant  execute on function public.app_user_id() to authenticated;

-- ----------------------------------------------------------------------------
-- 1. The caller's own profile row.
-- ----------------------------------------------------------------------------

grant select on public.users to authenticated;

create policy users_select_self on public.users
  for select to authenticated
  using (supabase_user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- 2. Tables owned directly, via user_id.
--
-- auth.uid() is wrapped in a scalar subquery -- `(select auth.uid())` -- so
-- Postgres hoists it into an InitPlan and evaluates it once instead of per row.
-- app_user_id() being STABLE gets the same treatment. On a sequential scan the
-- difference is large; this is the single most common RLS performance mistake.
-- ----------------------------------------------------------------------------

grant select on public.vehicles, public.assessments, public.service_records,
                public.user_features, public.paywall_intents
  to authenticated;

create policy vehicles_select_own on public.vehicles
  for select to authenticated
  using (user_id = public.app_user_id());

create policy assessments_select_own on public.assessments
  for select to authenticated
  using (user_id = public.app_user_id());

create policy service_records_select_own on public.service_records
  for select to authenticated
  using (user_id = public.app_user_id());

create policy user_features_select_own on public.user_features
  for select to authenticated
  using (user_id = public.app_user_id());

create policy paywall_intents_select_own on public.paywall_intents
  for select to authenticated
  using (user_id = public.app_user_id());

-- ----------------------------------------------------------------------------
-- 3. Tables reached through a vehicle.
--
-- These carry vehicle_id and no user_id, so ownership is one hop away. The inner
-- select is itself subject to the vehicles policy above, which is harmless -- it
-- filters to the caller's vehicles, which is exactly the set wanted.
-- ----------------------------------------------------------------------------

grant select on public.maintenance_items, public.vehicle_recall_status,
                public.vehicle_value_points
  to authenticated;

create policy maintenance_items_select_own on public.maintenance_items
  for select to authenticated
  using (vehicle_id in (select id from public.vehicles
                         where user_id = public.app_user_id()));

create policy vehicle_recall_status_select_own on public.vehicle_recall_status
  for select to authenticated
  using (vehicle_id in (select id from public.vehicles
                         where user_id = public.app_user_id()));

create policy vehicle_value_points_select_own on public.vehicle_value_points
  for select to authenticated
  using (vehicle_id in (select id from public.vehicles
                         where user_id = public.app_user_id()));

-- ----------------------------------------------------------------------------
-- 4. Assessment line items.
--
-- Filtered on assessments.user_id rather than nesting through vehicles, because
-- assessments already carries the owner and one hop beats two.
-- ----------------------------------------------------------------------------

grant select on public.assessment_parts, public.assessment_labor_tasks
  to authenticated;

create policy assessment_parts_select_own on public.assessment_parts
  for select to authenticated
  using (assessment_id in (select id from public.assessments
                            where user_id = public.app_user_id()));

create policy assessment_labor_tasks_select_own on public.assessment_labor_tasks
  for select to authenticated
  using (assessment_id in (select id from public.assessments
                            where user_id = public.app_user_id()));

-- ----------------------------------------------------------------------------
-- 5. Shared catalog.
--
-- Repair definitions, cost benchmarks, NHTSA recalls and owner reports. Nobody
-- owns these -- they are the same for every account -- so the policy is simply
-- "signed in". `to authenticated` still keeps them off the open internet.
--
-- Widen to `anon` only for tables a logged-out visitor genuinely needs; that
-- puts them back on the public web, which for the model_* feeds may well be
-- fine, and for your derived benchmark pricing is a product decision.
-- ----------------------------------------------------------------------------

grant select on public.repairs, public.repair_benchmarks, public.benchmark_parts,
                public.benchmark_labor_tasks, public.model_recalls,
                public.model_known_issues, public.model_owner_reports,
                public.model_owner_report_quotes
  to authenticated;

create policy repairs_select_all on public.repairs
  for select to authenticated using (true);

create policy repair_benchmarks_select_all on public.repair_benchmarks
  for select to authenticated using (true);

create policy benchmark_parts_select_all on public.benchmark_parts
  for select to authenticated using (true);

create policy benchmark_labor_tasks_select_all on public.benchmark_labor_tasks
  for select to authenticated using (true);

create policy model_recalls_select_all on public.model_recalls
  for select to authenticated using (true);

create policy model_known_issues_select_all on public.model_known_issues
  for select to authenticated using (true);

create policy model_owner_reports_select_all on public.model_owner_reports
  for select to authenticated using (true);

create policy model_owner_report_quotes_select_all on public.model_owner_report_quotes
  for select to authenticated using (true);

-- ----------------------------------------------------------------------------
-- 6. model_feed_syncs is intentionally absent.
--
-- It records when each NHTSA feed last ran -- operational bookkeeping with no
-- reason to leave the server. No grant, no policy: it stays locked to the API.
-- ----------------------------------------------------------------------------

commit;

-- ============================================================================
-- INDEXES
--
-- A policy predicate runs on every candidate row, so the columns it filters on
-- want indexes. Check what already exists before adding these -- the schema may
-- cover some already:
--
--   select tablename, indexname, indexdef from pg_indexes
--    where schemaname = 'public' order by tablename;
--
--   create index concurrently if not exists users_supabase_user_id_idx
--     on public.users (supabase_user_id);
--   create index concurrently if not exists vehicles_user_id_idx
--     on public.vehicles (user_id);
--   create index concurrently if not exists assessments_user_id_idx
--     on public.assessments (user_id);
--
-- `concurrently` cannot run inside a transaction, which is why these sit outside
-- the commit above rather than in it.
-- ============================================================================

-- ============================================================================
-- VERIFY -- do this with a real token, not by reading the policies.
--
-- Sign in as a test user in the browser, take the access_token from the session,
-- and confirm you see your rows and only your rows:
--
--   curl -s "$SUPABASE_URL/rest/v1/vehicles?select=id,user_id" \
--        -H "apikey: $SUPABASE_ANON_KEY" \
--        -H "Authorization: Bearer <access_token>"
--
-- Then confirm the anon key alone still gets nothing:
--
--   curl -s "$SUPABASE_URL/rest/v1/vehicles?select=id" \
--        -H "apikey: $SUPABASE_ANON_KEY" \
--        -H "Authorization: Bearer $SUPABASE_ANON_KEY"
--
-- A policy that is wrong in the permissive direction looks identical to a correct
-- one until someone else's row comes back, so test with two accounts.
-- ============================================================================
