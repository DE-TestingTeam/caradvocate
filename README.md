# CarAdvocate

Consumer app that tells car owners whether a repair is necessary and whether a
shop's quote is fair.

```
apps/web        React 18 + Vite + Tailwind + shadcn/ui
apps/api        Express 5 + Drizzle ORM + Postgres
packages/shared Domain types and zod schemas both sides import
```

Every non-obvious decision is documented in the header comment of the module that
implements it, so it cannot drift from the code. Start with
`apps/api/src/db/schema.ts` and `apps/api/src/services/`.

## Getting started

Requires Node 20.6+ and a Postgres database (in practice a Supabase project).

```bash
npm install
# create .env — see Configuration
npm run db:setup     # migrate + seed
npm run dev          # API on :3000, web on :5173
```

Open http://localhost:5173. The web dev server proxies `/api` to the API, so there
is no CORS config and no base URL in the client.

## Configuration

`.env` at the repo root, gitignored. `DATABASE_URL` is required; everything else is
optional and switches a subsystem from its fallback to the real thing. Validated on
boot by `apps/api/src/env.ts`, which documents each one.

| Variable | Unset | Set |
|---|---|---|
| `DATABASE_URL` | **API will not start** | Postgres over `pg`. On Supabase, the pooled string |
| `DIRECT_DATABASE_URL` | falls back to `DATABASE_URL` | migrations only; required when `DATABASE_URL` is pooled |
| `PGSSLMODE` | TLS on for non-localhost | overrides that choice |
| `SUPABASE_URL` + `SUPABASE_ANON_KEY` | no sign-in; every request is `DEV_USER_EMAIL` | real auth, token verified per request |
| `SUPABASE_JWT_SECRET` | — | legacy shared-secret projects (HS256) |
| `ANTHROPIC_API_KEY` | Ask CA uses canned replies | Ask CA answers with Claude |
| `CARIMAGES_API_KEY` | My Car shows a placeholder | studio photo of the model |
| `PAYWALL_PRICE_CENTS` | **`1499` — a placeholder** | the price the paywall shows |
| `PAYWALL_INTERVAL` | `month` | `month` or `year` |
| `DEV_USER_EMAIL` | `alex.rivera@email.com` | who the dev bypass acts as |

The API prints which mode it chose at startup. Never put the Supabase
`service_role` key in `.env` — the anon key is public by design, that one is not.

On Supabase both connection strings come from **Project Settings → Database →
Connection string**, and are not interchangeable: the pooled one (port 6543) cannot
provide the stable session DDL needs, so migrations use the direct one (5432). See
`apps/api/src/db/connection.ts`.

## Commands

```bash
npm run dev            # API + web, watching
npm test               # typecheck + API suite + e2e
npm run test:api       # 602 checks, no database needed
npm run test:e2e       # 93 checks, full stack
npm run build          # shared, then api, then web
npm run db:generate    # schema.ts -> a new migration (offline)
npm run db:migrate     # apply migrations via DIRECT_DATABASE_URL
npm run db:seed        # reference data + two demo users
npm run ingest:mileage # complaint mileage from NHTSA's bulk file (needs unzip)
```

`packages/shared` is consumed as build output, so it must compile before the apps
run. `install`, `dev`, `test` and `build` all handle that; `npm run dev:shared`
watches it if you are editing it live.

## Things that will bite

**`db:seed` truncates `users`.** Run against a database someone has signed up to,
it deletes their account, car, recall answers and service history. That happened
once here, so `seed()` now refuses when it finds an account linked to a Supabase
identity and names the accounts at risk. `SEED_WIPE_REAL_ACCOUNTS=1` overrides it.

**Never edit a migration that has been applied anywhere**, including a teammate's
project. Add a new one.

**`PAYWALL_PRICE_CENTS` defaults to a placeholder.** It is the price shown to real
people and the figure the prototype's result is denominated in, so set it
deliberately before any cohort sees it. The API prints it on every boot.

## The paywall

The Repair Cost Checker is the one paid surface, and v1 takes no money: the paywall
shows a price, tapping unlock charges nothing and opens the feature, and the tap is
recorded as a willingness-to-pay signal. That is the spec's design — it measures WTP
at a price point without building billing.

Two things make the number trustworthy, and both are easy to break:

- **The price travels with the tap.** `paywall_intents` stores the price and cadence
  that were on screen, not a foreign key to config. Change the price mid-test and
  earlier rows still mean what they meant.
- **The gate is enforced server-side.** `apps/api/src/middleware/requirePaid.ts`
  returns 402 on `/api/assessments` for a free account. The client gate is what the
  owner sees; this is what makes a recorded tap mean they chose to open it. Without
  it, a typed URL or a stale tab hands someone the feature with no tap, and the
  conversion rate is quietly wrong.

The screen states the price before the button and discloses that nothing is charged
on the same screen, above the fold — no card is requested and nothing is billed. It
does not say "free" above the button, because a tap on something free measures
nothing.

Reading the results:

```sql
select price_cents, interval, source, count(*), count(distinct user_id)
from paywall_intents group by 1, 2, 3;
```

`source` is the entry point — `repair_cost_checker` (the gate itself, including
arrivals from Ask CA's "CHECK REPAIR COSTS" answer) or `account`. A second tap by the
same owner is a second row on purpose: re-deciding at a new price is the finding.

Seeded accounts: Alex is past the paywall (the wireframes show the feature in use, and
he is the dev-bypass account); Dana is behind it, so
`DEV_USER_EMAIL=dana@example.com` shows the paywall without editing anything. Every
real signup starts free.

## Tests

Neither suite reads `DATABASE_URL` or needs a database running: both build their own
in-memory PGlite instance (`apps/api/test/harness.ts`), migrated and seeded per run.
So migrations, enums, foreign keys and cascades are genuinely exercised, CI needs no
secret, and a test run cannot reach real data. Suites live in `apps/api/test/`;
`test/offline.ts` keeps every upstream unreachable unless a suite installs its own
fetcher.

`scripts/e2e.mts` is the one that catches contract drift between the two halves — it
builds the real production bundle and drives it in jsdom against the real Express
app.

## Architecture notes

**Data ownership.** User-owned tables carry `user_id` and every query filters on it.
Their children carry only a parent FK and are authorised through that parent.
Reference data (`repairs`, `repair_benchmarks`, `model_*`) has no owner and is keyed
by year/make/model, because the answer is the same for every owner of the same car.
`apps/api/test/isolation.test.ts` enforces the boundary. Money is integer whole
dollars.

**API.** Routers in `apps/api/src/routes/`, all under `/api` and all requiring auth
except `GET /api/health` and `GET /api/auth/config`. Errors use one envelope, typed
as `ApiErrorBody`; codes map to status in `packages/shared/src/errors.ts`.

**Frontend.** `apps/web/src/lib/api.ts` is the only module that talks to the server
and `http.ts` the only place that calls `fetch`. Reads go through `useApi(...)`,
dialog writes through `useWrite(...)`. Every screen renders loading, error and
loaded. `invalidateAll()` re-runs every query after a mutation — deliberately crude;
swap in React Query when requests get frequent.

## Known gaps

**Benchmark pricing is placeholder data.** The "your quote is fair" judgement
compares against hand-seeded `repair_benchmarks` rows; only the brake-pad figures
come from the wireframes, and the rest are marked as invented in
`apps/api/src/db/fixtures.ts`. Sourcing real parts pricing and OEM labor times is a
licensing problem, not an engineering one. Assessments snapshot their figures at
creation, so real pricing can land without rewriting history.

**Not built:** password reset, account deletion, quote-PDF parsing, `safe_to_drive`
on the urgency triage (the spec's paid triage output; Ask CA returns `urgency` but no
safe-to-drive verdict), Car Value Tracking (needs a valuation vendor), and
factory-scheduled maintenance intervals (licensed data — owners set their own).

**Deleting an account takes its `paywall_intents` rows with it** (they cascade).
Export before honouring a deletion request, or the PoC loses that data point.

**Unverified:** token verification is covered by tests using a locally generated
keypair, since CI cannot reach Supabase. Confirm real tokens once by decoding an
`access_token` and checking `iss`, `aud`, `sub`, `email`.

Anything with no wireframe — nav menu, edit dialogs, loading and error states — is
marked with a `NOTE:` comment at the point of use.
