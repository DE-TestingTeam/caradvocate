# CarAdvocate

Consumer app for car owners facing a repair: what it should cost, and whether the
quote in their hand is fair.

```
apps/web        React 18 + Vite + Tailwind + shadcn/ui
apps/api        Express 5 + Drizzle ORM + Postgres
packages/shared Domain types and zod schemas both sides import
```

**Working prototype, incomplete product.** Every screen runs, but several features
behind them do not exist yet — notably the necessity check. Nobody is charged.
**[STATUS.md](STATUS.md) is the full picture** and the doc kept current; this README is
only how to run and change the code.

## Getting started

Node 20.6+ and a Postgres database (in practice a Supabase project).

```bash
npm install
# create .env — see Configuration
npm run db:setup     # migrate + seed
npm run dev          # API on :3000, web on :5173
```

Open http://localhost:5173. The dev server proxies `/api`, so there is no CORS config
and no base URL in the client.

## Configuration

`.env` at the repo root, gitignored. Validated on boot by `apps/api/src/env.ts`, which
documents each variable. Only the first two are required.

| Variable | Unset | Set |
|---|---|---|
| `DATABASE_URL` | **API will not start** | Postgres over `pg`. On Supabase, the pooled string |
| `SUPABASE_URL` + `SUPABASE_ANON_KEY` | **API will not start** | real auth, token verified per request |
| `DIRECT_DATABASE_URL` | falls back to `DATABASE_URL` | migrations only; required when `DATABASE_URL` is pooled |
| `PGSSLMODE` | TLS on for non-localhost | overrides that choice |
| `SUPABASE_JWT_SECRET` | — | legacy HS256 projects, in place of `SUPABASE_URL` |
| `ANTHROPIC_API_KEY` | Ask CA uses canned replies | Ask CA answers with Claude |
| `CARIMAGES_API_KEY` | My Car shows a placeholder | studio photo of the model |
| `VEHICLEDATABASES_API_KEY` | only the seeded demo car has pricing | repair pricing for the owner's own model |
| `OPEN_LABOR_PROJECT_API_KEY` | benchmarks show labor dollars, no hours | labor hours beside the pricing |
| `PAYWALL_PRICE_CENTS` | **`1499` — a placeholder** | the price the paywall shows |
| `PAYWALL_INTERVAL` | `month` | `month` or `year` |

Sign-in is mandatory everywhere, including localhost — there is no bypass mode. Never
put the Supabase `service_role` key in `.env`; the anon key is public by design, that
one is not. Both connection strings come from **Project Settings → Database →
Connection string** and are not interchangeable: migrations need the direct one (5432),
not the pooled one (6543).

## Commands

```bash
npm run dev            # API + web, watching
npm run typecheck      # every workspace — the only automated gate
npm run build          # shared, then api, then web
npm run db:generate    # schema.ts -> a new migration (offline)
npm run db:migrate     # apply migrations via DIRECT_DATABASE_URL
npm run db:seed        # reference data + two demo users (TRUNCATES users)
npm run db:pricing     # refresh reference pricing only — safe on a live database
npm run ingest:mileage # complaint mileage from NHTSA's bulk file (needs unzip)
```

There is no test suite, so the paywall gate, the per-user data filters and anything
reading an upstream feed have to be exercised by hand. `packages/shared` is consumed as
build output; `install`, `dev` and `build` compile it first.

## Things that will bite

**`db:seed` truncates `users`** — every account, car, recall answer and service record.
That happened once here, so it now refuses when it finds a real Supabase-linked account.
`SEED_WIPE_REAL_ACCOUNTS=1` overrides.

**Never edit a migration applied anywhere**, including a teammate's project. Add one.

**Migrations and code ship together.** `0013` must be applied before this code, then
`db:pricing` — until it runs, the app serves old invented figures under a real-looking
name. `0014` is written but unapplied and is a `DROP TABLE`.

**`PAYWALL_PRICE_CENTS` defaults to a placeholder**, and it is the figure the
experiment's result is denominated in. Set it before any cohort sees it.

**A car the vendor cannot price shows no repairs, and that is correct.** A fallback to
another vehicle's figures would be a regression — see `services/repairPricingSync.ts`.

**The RLS scripts in `apps/api/sql/` are applied by hand.** `rls-lockdown.sql` closes a
second door into the Supabase database that is open by default.

## Where things live

```
apps/api/src
  routes/       one router per resource, all under /api
  services/     upstream feeds, pricing, paywall, Ask CA — the real logic
  db/           schema, seed, fixtures, connection
  auth/         token verification and user provisioning
  middleware/   auth gate, paid gate, validation, error envelope
  drizzle/      migrations, append only        sql/  RLS, applied by hand
apps/web/src
  pages/        one per route in App.tsx
  components/   ui/ is shadcn; the rest grouped by screen
  lib/          api.ts and http.ts are the only modules that reach the server
packages/shared/src   types, zod schemas, error codes — imported by both
```

Conventions worth knowing: user-owned tables carry `user_id` and every query filters on
it; reference data is keyed by year/make/model instead. Money is integer whole dollars.
One error envelope, one module that calls `fetch`.

## Reading the paywall results

Nobody is charged — each tap is a willingness-to-pay signal, and the price travels with
the row so changing it does not re-label history.

```sql
select price_cents, interval, source, count(*), count(distinct user_id)
from paywall_intents group by 1, 2, 3;
```

Seeded accounts: Alex is past the paywall, Dana behind it, so `dana@example.com` shows
the paywall without editing anything. Real signups start free.

## Finding the reasoning

Every non-obvious decision lives in the header comment of the module implementing it,
so it cannot drift from the code.

| Module | Explains |
|---|---|
| `db/schema.ts` | the ownership model, and why each table is shaped as it is |
| `services/repairPricing.ts` | why the vendor's labor dollars never become book time |
| `services/repairPricingSync.ts` | why there is no pricing fallback to another car |
| `services/paywall.ts` | why the paywall takes no money, and what makes the signal valid |
| `services/askClaude.ts` | how Ask CA is kept from inventing things |
| `services/vehicleContext.ts` | what the model is told about the owner's car |

Anything with no wireframe — nav menu, edit dialogs, loading and error states — carries
a `NOTE:` comment at the point of use.
