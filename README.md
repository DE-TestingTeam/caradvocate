# CarAdvocate

Consumer app that tells car owners whether a repair is necessary and whether a
shop's quote is fair. Built from the wireframes in the parent folder.

```
apps/web        React 18 + Vite + Tailwind + shadcn/ui
apps/api        Express 5 + Drizzle ORM + Postgres
packages/shared Domain types and zod schemas both sides import
```

## Getting started

Requires Node 20.6+. Nothing else — no Docker, no Postgres install, no account.

```bash
npm install
npm run db:setup     # creates and seeds a local database
npm run dev          # API on :3000, web on :5173
```

Open http://localhost:5173. That is the whole setup. The web dev server proxies
`/api` to the API, so there is no CORS config and no base URL in the client.

### How that works with no database installed

With `DATABASE_URL` unset, the API runs on **PGlite** — Postgres 16 compiled to
WebAssembly, inside the API process, persisting to `.pgdata/` (gitignored). Real
enums, foreign keys and transactions; your writes survive restarts. It is the
same engine the test suites use.

It is a development convenience, not a deployment target, and the API refuses to
start with it when `NODE_ENV=production`.

Two caveats worth knowing:

- **No external client can connect.** It lives in the API process, so Postico,
  TablePlus and `psql` cannot attach. Use the app, or add a throwaway route.
- **One connection.** Fine for one dev; not a load-testing environment.

To wipe it and start over: `rm -rf .pgdata && npm run db:setup`.

### Switching to Supabase

Set `DATABASE_URL` and the API uses real Postgres over `pg` instead. No code
changes — the driver is chosen from config alone.

```bash
cp .env.example .env    # paste your connection strings
npm run db:setup        # migrate + seed the Supabase project
npm run dev
```

Both strings come from **Project Settings → Database → Connection string**. You
need both, and they are not interchangeable:

| Variable | Which string | Used by |
|---|---|---|
| `DATABASE_URL` | **Transaction pooler**, port 6543 | the API at runtime |
| `DIRECT_DATABASE_URL` | **Direct connection**, port 5432 | `npm run db:migrate` only |

Why two: the transaction pooler gives each transaction a different backend
connection, which is what a web server wants but cannot provide the stable
session DDL needs. Migrations through the pooler fail in ways that are hard to
read, so `db:migrate` deliberately uses the direct string.

Notes:

- The pooled username includes your project ref (`postgres.abcdefgh…`); the
  direct one is just `postgres`. Easy to mix up.
- TLS turns on automatically for any non-localhost host — Supabase refuses
  unencrypted connections. Certificate verification is off, because Node does not
  ship Supabase's CA: the connection is encrypted but the server is not
  authenticated. That is what their `sslmode=require` strings ask for. To harden
  it, download the project CA cert and pass it as `ca` in
  `apps/api/src/db/connection.ts`. Override the automatic choice with `PGSSLMODE`.
- Do not call `.prepare()` on Drizzle queries, and avoid `LISTEN`/`NOTIFY`.
  Neither survives transaction pooling. Ordinary Drizzle queries are fine.
- `.env` is gitignored, and your database password is in it. Keep it that way.

Since your Supabase plan is a team one, give each developer their own project or
branch rather than sharing one database. `npm run db:setup` rebuilds any of them
in seconds.

Any other Postgres works the same way — Postgres.app, Homebrew, a Docker
container you run yourself. Point `DATABASE_URL` at it, leave
`DIRECT_DATABASE_URL` empty, and TLS stays off for localhost.

### A note on packages/shared

The shared contract is consumed as build output, not source, so it must be
compiled before the apps run. `npm install` does that automatically via
`postinstall`, and `npm run dev`, `test` and `build` each rebuild it first.

If you are editing `packages/shared` and want changes to propagate without
restarting, run `npm run dev:shared` in another terminal to watch it.

## Authentication is stubbed — read this before deploying

There is no login. Every request is attributed to `DEV_USER_EMAIL`, resolved in
**`apps/api/src/middleware/currentUser.ts`**. That file is the only place that
decides who is calling, and it throws on startup if `NODE_ENV=production`, so it
cannot ship by accident.

What is already done, and is the expensive part:

- Every user-owned table carries `user_id` from the first migration.
- Every query filters on `req.user.id`. Cross-tenant access returns 404, never a
  row — asserted by 34 tests in `apps/api/test/isolation.test.ts`.
- `createApp(db, { resolveUser })` takes the resolver as an argument, which is
  where real session verification plugs in.

What is left:

1. A `sessions` table (or JWTs, if you prefer stateless).
2. Credentials — password hashes with argon2/bcrypt, or an OAuth provider.
3. `POST /api/auth/login`, `/logout`, `/refresh`, and a signup flow that creates
   the user, their vehicle, and their default subscription features together.
4. Replace the body of `resolveUser` with: read the signed httpOnly cookie,
   verify signature and expiry, check revocation, load the user, throw
   `HttpError.unauthenticated()` on any failure.
5. CSRF protection on cookie-authenticated mutations, and rate limiting on login.

Nothing in step 4 touches route code. That was the point of doing the ownership
model first.

### Supabase Auth is the shortest path here

Since you are already on Supabase, its Auth product removes most of steps 1–3:
it owns the users table, password hashing, email verification, OAuth providers
and password reset. What you would do:

1. Let Supabase Auth own identity. It creates rows in its own `auth.users`
   schema; our `public.users` row becomes a profile keyed by that id.
2. On the client, use `@supabase/supabase-js` to sign in and get a JWT.
3. Send it to our API (`Authorization: Bearer …`), and in `resolveUser` verify it
   against the project's JWKS, then look up the profile by the `sub` claim.

Two things to be deliberate about:

- **Do not skip our API and let the browser query Postgres directly.** That is
  the default Supabase pattern and it moves authorisation into Row Level
  Security policies. Our ownership model currently lives in Express, and the
  isolation suite tests it there. Mixing both means two places to get right.
- If you *do* want to adopt RLS later, the schema is ready for it — every
  user-owned table already has the `user_id` column a policy would key on.

## The real open question: benchmark pricing

The product claim is "your $320 quote is fair." That judgement is made in
`apps/api/src/services/quoteEvaluation.ts`, which compares the quote to a range
in `repair_benchmarks` — and those rows are **hand-seeded placeholders**.

Only the brake-pad figures come from the wireframes. The other eleven repairs are
plausible invented numbers, marked as such in `apps/api/src/db/fixtures.ts`.

Sourcing real parts pricing and OEM labor times is a licensing and data problem,
not an engineering one, and no amount of further building de-risks it. The schema
is ready for it: benchmarks are global reference data, and assessments snapshot
their figures at creation time so refreshing pricing never rewrites history a
user has already seen.

Ask CA is stubbed the same way — `apps/api/src/services/chatReplies.ts` cycles
canned replies with no model call. The `ChatMessage` contract already carries the
urgency callout and CTA the UI renders, so swapping in a real model is a
drop-in.

## Tests

```bash
npm test           # typecheck + API suite + end-to-end
npm run test:api   # 138 checks, no database required
npm run test:e2e   # 40 checks, full stack
```

Neither suite touches Supabase, or needs any database running. Both use
**PGlite** — the same engine as the dev fallback above, but in memory rather than
on disk, so every run starts from a clean seeded database. Migrations, enums,
foreign keys and cascades are all genuinely exercised. A broken migration fails the tests rather than
surfacing on deploy, and CI never consumes a connection slot or needs a secret.

| Suite | What it covers |
|---|---|
| `apps/api/test/schema.test.ts` | Migrations apply; enum and FK rejection; cascade behaviour; wireframe figures survive seeding |
| `apps/api/test/api.test.ts` | Every endpoint's status codes, response shapes and validation errors |
| `apps/api/test/isolation.test.ts` | A second seeded tenant cannot be read, completed, or deleted by the first |
| `apps/api/test/connection.test.ts` | TLS and pooler rules for Supabase connection strings, which cannot be checked against a live project from CI |
| `scripts/e2e.mts` | The real production web bundle driven in jsdom against the real Express app on a real database |

The e2e suite is the one that catches contract drift between the two halves —
the failure mode neither side can see alone. It builds the web app with
`vite.smoke.config.ts`, which emits a classic IIFE bundle because jsdom cannot
execute ES modules, and polyfills `fetch`, `ResizeObserver` and
`structuredClone`, which jsdom omits.

## Database

15 tables in three groups. The distinction is enforced by convention and tested
by the isolation suite:

- **User-owned roots** carry `user_id`: `vehicles`, `service_records`,
  `assessments`, `chat_messages`, `user_features`. Every query filters on it.
- **Children** carry only a parent FK: `vehicle_value_points`,
  `maintenance_items`, `assessment_parts`, `assessment_labor_tasks`. They are
  reachable only through their parent, whose `user_id` filter authorises them.
  Denormalising `user_id` onto children would create a second source of truth
  that can disagree with the first.
- **Global reference data** has no owner: `repairs`, `repair_benchmarks`,
  `benchmark_parts`, `benchmark_labor_tasks`, `model_known_issues`. "Known Issues
  for Your Model" is keyed by year/make/model, because the answer is the same for
  every owner of the same car.

Money is stored as integer whole dollars. Labor hours are `numeric(4,2)` and are
converted to numbers in `apps/api/src/mappers.ts` — Drizzle returns `numeric` as
a string, and that conversion is asserted by a test.

Changing the schema:

```bash
# edit apps/api/src/db/schema.ts
npm run db:generate   # writes a new migration to apps/api/drizzle/
npm run db:migrate    # applies it via DIRECT_DATABASE_URL
```

`db:generate` only reads the schema file and never connects, so it works offline.
`db:migrate` needs the direct connection string.

Never edit a migration that has been applied anywhere — including to a teammate's
Supabase project. Add a new one instead.

## API

All routes require an authenticated user except `GET /api/health`.

| Method | Path | Notes |
|---|---|---|
| `GET` `PATCH` | `/api/vehicle` | The caller's single vehicle |
| `GET` | `/api/vehicle/maintenance` | |
| `GET` | `/api/vehicle/known-issues` | Global, keyed by the caller's model |
| `GET` `POST` | `/api/service-records` | |
| `DELETE` | `/api/service-records/:id` | |
| `GET` `POST` | `/api/assessments` | `POST` snapshots the benchmark |
| `GET` | `/api/assessments/:id` | 404 for another tenant's id |
| `POST` | `/api/assessments/:id/complete` | Also writes a service record, in one transaction |
| `GET` | `/api/repairs` | Only repairs that have a benchmark |
| `GET` `POST` | `/api/chat` | |
| `GET` `PATCH` | `/api/account` | |

Errors always use one envelope, typed as `ApiErrorBody` in the shared package:

```json
{ "error": { "code": "validation_failed", "message": "...", "details": [{ "path": "mileage", "message": "..." }] } }
```

Codes map to status in `packages/shared/src/errors.ts`: `validation_failed` 422,
`unauthenticated` 401, `not_found` 404, `conflict` 409, `internal_error` 500.

## Frontend

`apps/web/src/lib/api.ts` is the only module that talks to the server, and
`http.ts` is the only place that calls `fetch`. Components call `useApi(...)` and
get `{ data, loading, error }`.

Every screen renders three states: loading (skeletons shaped like the real
layout), error (`ErrorState`, with a retry that re-runs every query), and
loaded. The error state matters now that data comes from a server — without it a
stopped API leaves skeletons spinning forever.

`useApi` invalidates globally: any mutation calls `invalidateAll()` and every
query re-runs. That is deliberately crude. Once requests are real and frequent,
replace it with React Query or SWR for per-key caching.

## Decisions worth knowing

**One vehicle fixture.** The wireframes disagree — My Car shows a 2019 Honda Civic
at 68,400 mi, Account shows a 2019 Honda CR-V EX at 48,250 mi. One row serves
both screens so they cannot drift. It currently holds the Civic; change it in
`apps/api/src/db/fixtures.ts`.

**Two conflicting brake-pad ranges.** The Quote Evaluation copy cites $280–$400
while the Fair Total card reads $360–$660. The card wins, because it is the
headline figure the user is shown. Both are noted in the fixtures.

**Completion is not a status.** The wireframes show an assessment badged
`ASSESSED` *and* marked complete, so `completed_at` is independent of the quote
verdict. See `apps/web/src/lib/assessment.ts`.

**Only two verdicts.** `fair` and `overpriced` are the only ones in the
wireframes. A below-benchmark quote is currently reported as fair — being told a
cheap quote is fine is the less harmful error, but revisit it if the product
wants to flag lowballs that signal skipped work.

**Uploaded quote PDFs are not parsed.** The drop zone captures a filename for
display; a numeric input beside it supplies the actual amount.

Anything with no wireframe — the nav menu, the edit dialogs, loading and error
states — is marked with a `NOTE:` comment at the point of use.
