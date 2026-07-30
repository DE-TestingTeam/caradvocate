# CarAdvocate

Consumer app that tells car owners whether a repair is necessary and whether a
shop's quote is fair.

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

Three caveats worth knowing:

- **No external client can connect.** It lives in the API process, so Postico,
  TablePlus and `psql` cannot attach. Use the app, or add a throwaway route.
- **One connection.** Fine for one dev; not a load-testing environment.
- **It does not survive a hard kill.** Because Postgres runs *inside* the API
  process, killing that process mid-write can leave `.pgdata` in a state PGlite
  cannot reopen — the database is then unrecoverable without a native Postgres 16
  to dump it. `apps/api/src/index.ts` handles SIGTERM and SIGINT and closes the
  database before exiting, which makes `kill`, `pkill` and Ctrl-C safe. **`kill -9`
  is not, and never will be.** Real Postgres has none of this fragility.

To wipe it and start over: `rm -rf .pgdata && npm run db:setup`.

For anything you would be annoyed to lose, use a real Postgres — see below. PGlite
is for getting started, not for data you care about.

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

### `db:seed` will not delete real accounts

Seeding truncates `users`, so run against a database somebody has actually signed up
to it deletes their account, their car, their recall answers and their service history.
That happened once here, which is why `seed()` now refuses when it finds any account
linked to a Supabase identity, naming the accounts at risk:

```
Refusing to seed …: it holds 1 real signed-up account(s).
  - someone@example.com
```

The demo users have `supabaseUserId` null by design, so reseeding a demo database is
unaffected. `SEED_WIPE_REAL_ACCOUNTS=1` overrides the guard, and exists so that the
answer to it is never "comment it out". `apps/api/test/schema.test.ts` asserts the
refusal, that it names the account, and that the account is still there afterwards.

Any other Postgres works the same way — Postgres.app, Homebrew, a Docker
container you run yourself. Point `DATABASE_URL` at it, leave
`DIRECT_DATABASE_URL` empty, and TLS stays off for localhost.

### A note on packages/shared

The shared contract is consumed as build output, not source, so it must be
compiled before the apps run. `npm install` does that automatically via
`postinstall`, and `npm run dev`, `test` and `build` each rebuild it first.

If you are editing `packages/shared` and want changes to propagate without
restarting, run `npm run dev:shared` in another terminal to watch it.

## Authentication

Sign-in is handled by **Supabase Auth**. Our API verifies the access token on
every request and never sees a password.

Configure it with two variables:

```
SUPABASE_URL=https://PROJECTREF.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
```

Both come from **Project Settings → API**. The anon key is public by design and
is served to the browser via `GET /api/auth/config` — the client asks the server
what mode it is in, so the two can never disagree. **Never put the
`service_role` key in `.env`.**

Older projects that sign with a shared secret instead of publishing a JWKS can
set `SUPABASE_JWT_SECRET` instead.

### The dev bypass

With none of those set, the API skips sign-in and treats every request as
`DEV_USER_EMAIL`, and the web app shows no login screen. That is what keeps
`npm run dev` working with zero configuration.

It cannot reach production: the API refuses to start when `NODE_ENV=production`
with no Supabase Auth configured.

### What is verified, and what is not

`apps/api/src/auth/verifyToken.ts` checks the signature, expiry, issuer (so a
validly-signed token from a *different* Supabase project is refused), audience
(`authenticated`, so anon tokens are refused), and that the subject is a UUID.

Those checks are covered by 20 tests that generate their own keypair and sign
their own tokens, because CI cannot reach Supabase. **What that does not prove is
that Supabase's real tokens carry the claims we expect.** Confirm it once: sign
in, and decode the `access_token` from the browser's session to check `iss`,
`aud`, `sub` and `email`.

### Profiles are created on first sign-in

There is no signup webhook. The first time a verified identity appears,
`apps/api/src/auth/provisionUser.ts` creates the profile and its default
subscription rows. If a profile already exists with the same email — the seeded
demo account, for instance — it is adopted rather than duplicated.

A new profile has no vehicle, so the app routes it to `/onboarding`.

### Google sign-in

The login screen has a "Continue with Google" button, but it only works once you
enable Google as a provider in **Authentication → Providers** in the Supabase
dashboard. Until then it returns an error. Nothing in the code needs to change.

### What is still missing

- **Paywall gating.** The PRD makes the Repair Cost Checker paid-only. Every new
  profile is currently created on the paid plan and nothing is gated.
- **Password reset.** Supabase provides the flow; no UI is wired to it yet.
- **Account deletion.** The schema cascades correctly, but nothing exposes it.

## Onboarding

A new user is sent to `/onboarding` until they have a vehicle.

Manual entry (year, make, model, mileage) is the primary path because it always
works. VIN lookup is an accelerator that prefills the same fields.

The VIN decode calls NHTSA's free vPIC API and has been verified against the live
service: `Make`, `Model`, `ModelYear` and `Trim` all arrive as
`parseVpicResponse` expects, with `Series` used when `Trim` is absent. Check it
yourself with:

```
curl 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/2HGFC2F53KH124821?format=json'
```

The parser stays defensive regardless — any unexpected shape, timeout or error
falls back to manual entry, so an upstream change degrades the accelerator rather
than blocking onboarding.

## Scheduled maintenance

Whether an upkeep job is due is **arithmetic, not data**: the interval, the last time
it was done, and today's odometer. `apps/api/src/services/maintenanceDue.ts` does it
on read and nothing is stored — the previous version of this table held a `status`
column, which meant nothing kept it true and the seed had to bake the answer into the
label (`'Oil Change - Due in 1,200 mi'`).

Two rules carry most of the weight, and both are asserted in
`apps/api/test/maintenance.test.ts`:

- **No interval, or nothing ever logged, is `unknown` — never `ok`.** There is no
  baseline to measure from, and a false all-clear about brakes is the worst thing this
  screen could say. The UI states *which* of the two is missing, since "unknown" alone
  reads like a bug.
- **With both a mileage and a time interval, whichever falls first wins.** That is how
  manufacturers write schedules ("every 10,000 miles or 12 months"); taking the later
  of the two would tell someone they are fine when they are a year overdue.

Each row shows its working — "4,400 mi past due · due at 64,000 · last done at
58,000" — because an owner told "overdue" with no reason has to trust us, and one
shown the subtraction can check it.

### Intervals are owner-supplied, and that is not a stopgap

The manufacturer's official schedule is licensed data. Rather than invent generic
intervals and present them as *this* car's schedule, the owner sets them.

If those schedules are ever bought, they fill in `interval_miles` and
`interval_months` on the same table and **nothing else changes** — same computation,
same UI, same contract. So this is also the cheap way to find out whether anyone uses
maintenance tracking before paying for the lists.

### Service records feed it

A record carries `mileage_at_service` and an optional `maintenance_item_id`. Both
exist so the calculation can work:

- **Without the odometer, no interval can be measured.** It stays optional — someone
  entering an old receipt may not know it — but the form says why it matters.
- **The link is explicit, never inferred.** Matching "oil and filter" to the oil-change
  job by description is the kind of guess that is wrong just often enough to tell
  someone their brakes are fine when they are not.

Deleting a job nulls the link rather than cascading: the work still happened.

Records can now be edited and deleted, which matters more than tidiness — a mistyped
odometer does not merely look wrong, it makes the app claim a job is due when it is not.

### Newly added cars have no valuation, on purpose

A car you just added has no valuation and no maintenance schedule, because neither
source is connected. The API returns absent values and the UI says "Not available
yet" rather than showing a zero or a plausible-looking number. `estMarketValue`,
`tradeInLow` and `tradeInHigh` are optional in the contract for exactly this
reason.

Safety recalls *are* connected — see below.

## Safety recalls

Recalls come from NHTSA's free recalls API, keyed by year/make/model:

```
curl 'https://api.nhtsa.gov/recalls/recallsByVehicle?make=honda&model=civic&modelYear=2019'
```

Like known issues, recalls belong to the **model** rather than the owner, so they
are global reference data (`model_recalls`) and one sync serves every owner of that
car. The first request for a model pays for the upstream fetch; after that it is a
local query for a week. See `apps/api/src/services/recallSync.ts`.

Three decisions in there are worth knowing about:

- **"No recalls" and "never checked" are different facts.** `model_recall_syncs`
  records them separately, and the API returns `checked` alongside the list, so the
  UI only ever shows an all-clear it can actually support.
- **A failed refresh never erases recalls.** Stale safety data beats none, so a
  failure advances only the attempt clock — it cannot retract an all-clear already
  earned, and it is retried on a 15-minute cooldown rather than on every request.
- **Urgency comes from NHTSA, not from us.** It publishes `parkIt` ("stop driving")
  and `parkOutSide` ("park away from buildings"); those map to high severity and
  everything else to medium. No recall is `low` — they are all safety defects.
- **Recalls never expire, and age never buries one.** Nothing is filtered by date.
  Within a severity the list is ordered **oldest first**, because a 2011 defect that
  was never remedied is more overdue than one issued last year — sorting by recency
  would push the longest-neglected item to the bottom. Undated campaigns sort last
  rather than masquerading as the oldest.

### Whether *your* car was repaired

NHTSA's feed is keyed by year/make/model, so it reports campaigns affecting *this
model* — not whether *this particular car* was ever fixed. There is no free way to
close that gap: NHTSA has no VIN-level recall API, and the per-VIN answer is sold
by manufacturers and resellers.

So the owner is asked. `vehicle_recall_status` records their answer per campaign,
and it is deliberately **three-state**: no row means unknown, which is not the same
as the owner saying it is outstanding. Both answers are reversible, because someone
who mis-taps on a safety recall must not be stuck with a warning greyed out.

Confirmed-done recalls stay in the list but sort to the bottom and recede — the
record is worth keeping and the owner may be misremembering. The badge reads
"Recall" rather than "Open recall" for the same reason. Where a VIN is on file the
list also links to NHTSA's VIN lookup, which queries the manufacturer behind the
scenes and *can* answer per-car.

A status is only accepted for a campaign that actually applies to the vehicle's
model; anything else is a 404, so the list cannot accumulate answers to questions
the car was never asked.

Two details of that API are easy to get wrong, and both are silent failures. Dates
are **DD/MM/YYYY** (`28/05/2020` is 28 May), and the flag is spelled `parkOutSide`
with a capital S. Both are covered in `apps/api/test/recalls.test.ts`.

Older campaigns are stored by NHTSA IN FULL CAPITALS, so `formatRecallProse`
rewrites overwhelmingly-uppercase text to sentence case for display and leaves
modern sentence-case prose untouched.

## Known issues

"Known Issues for Your Model" has two sources, and the UI distinguishes them
because they carry very different weight:

- **Curated** entries are written by us. There are three, for the seeded 2019
  Civic; they are placeholders for editorial content.
- **Owner reports** are complaints filed with NHTSA, aggregated by the component
  they concern. Free, real, and available for any model:

```
curl 'https://api.nhtsa.gov/complaints/complaintsByVehicle?make=nissan&model=pathfinder&modelYear=2011'
```

Complaints are **unverified first-hand accounts, not findings**. Recalls are the
official counterpart. So a complaint group is shown with its report count and any
casualties NHTSA recorded — "31 owner reports · 3 involved a crash" — rather than
asserted as a fault, and the list says where the numbers came from. Severity is
derived from those counts: harm reported is high, a repeated pattern is medium,
a couple of reports is low. Unlike recalls, `low` is meaningful here — two
complaints about a model is noise.

### The prose stays at NHTSA

My Car shows the *shape* of the problem — which systems, how often, how badly — and
links out for the accounts themselves. Each complaint runs to a paragraph and a
popular model has hundreds, so reproducing them buried the one thing the list is
for: seeing at a glance which systems are trouble. `apps/web/src/lib/nhtsa.ts`
builds the link, keyed by year/make/model exactly like the feeds.

Up to three representative complaints per component **are** still stored, because
the selection is the expensive part and grounding an Ask CA answer will want them.
They are simply not joined onto the known-issues response, which would be a
per-request query nothing renders — anything needing the prose should read
`model_owner_report_quotes` directly.

Which three, when something does: an account where someone crashed, caught fire or
was hurt leads, because that is the one that changes a decision; recency breaks the
tie, since a 2025 report describes the car being driven now while a 2013 one may
describe a fault long since fixed. Stubs shorter than 40 characters ("SEE SUMMARY")
are dropped, and text repeated by an owner filing twice is stored once.

### Two details that took measuring

**The dates are month-first.** `complaintsByVehicle` serves **MM/DD/YYYY** while
`recallsByVehicle`, on the same host, serves **DD/MM/YYYY**. This was confirmed by
scanning both feeds: recall dates reach 28 in the first segment, complaint dates
never exceed 12 there while reaching 31 in the second. The two parsers are
deliberately separate, and `apps/api/test/complaints.test.ts` asserts that
`"05/06/2020"` means 6 May as a complaint and 5 June as a recall. Sharing one
parser would corrupt every date that is not impossible to misread, silently.

**NHTSA's component taxonomy changed.** The same fuel problem is tagged
`FUEL SYSTEM`, `GASOLINE` or `FUEL/PROPULSION SYSTEM` depending on the era, and
one complaint often carries several. `CANONICAL_COMPONENT` in
`apps/api/src/services/complaints.ts` merges the confirmed clusters, and each
complaint is deduplicated after canonicalising so a triple-tagged one counts once.
On a 2019 Civic that turns three redundant rows of 63 / 62 / 62 into one true
count of **125 distinct complaints** — 63 filed under the old taxonomy, 62 under
the new, with no overlap. The map is deliberately minimal and unknown labels pass
through untouched.

### Mileage at failure

The JSON complaints API omits the odometer reading. NHTSA's bulk flat file has it,
and it is the one free number that is about *your* car rather than the model: "40,000–92,000 mi
in 6 of them" beside an engine complaint answers the question owners actually ask.

```bash
npm run ingest:mileage                 # downloads the current bulk file
npm run ingest:mileage -- ./cmpl.zip   # or reuse one already on disk
```

`scripts/ingestComplaintMileage.mts` streams the file through `unzip -p` — it is
~351MB zipped and gigabytes unzipped, so it is never written to disk — and keeps
only rows for models someone actually owns. Requires `unzip` on PATH.

Three honesty constraints are built in:

- **The range is the 25th–75th percentile**, not the extremes, so one complaint at
  600 miles does not stretch it past usefulness. Percentiles are nearest-rank, not
  interpolated: with six readings, interpolation invents precision.
- **`mileageSampleCount` is stored and shown** ("in 6 of them"). Only about two
  thirds of complaints report mileage, and a range from four readings should not look
  like one from forty.
- **Groups with fewer than four readings are skipped entirely**, and the script says
  how many it skipped rather than quietly covering less than it appears to.

Because the bulk file's `COMPDESC` is finer-grained than the API's `components`
("SERVICE BRAKES, HYDRAULIC" vs "SERVICE BRAKES"), both go through
`canonicalComponent`. Note the two feeds use commas differently — a separator
between components in the API, part of a single name in the bulk file — so the API
path splits before canonicalising. Verified on a 2011 Pathfinder, where reducing the
bulk file reproduces the API's groups and counts exactly.

The ingest only enriches component groups the API feed has already produced. If it
reports "no aggregate row", load the car in the app once so complaints sync first.

### Shared feed machinery

Recalls, complaints and crash-test ratings are all model-keyed NHTSA feeds with
identical freshness needs, so `apps/api/src/services/modelFeed.ts` owns the policy
once — the week-long trust window, the 15-minute retry cooldown, the case
normalising, and one `model_feed_syncs` table keyed by feed name.

Crash-test ratings were the third feed and cost exactly a fetcher and a table, which
is the evidence the split was drawn in the right place. A fourth (investigations)
should cost the same.

## Crash test ratings

NHTSA's free Safety Ratings (NCAP) API, keyed by year/make/model:

```
curl 'https://api.nhtsa.gov/SafetyRatings/modelyear/2019/make/honda/model/civic'
curl 'https://api.nhtsa.gov/SafetyRatings/VehicleId/14009'
```

Two steps, because the first returns only ids and descriptions. Both are mirrored
into `model_safety_ratings`, one row per tested variant.

### This feed names models differently from the other two

The detail worth knowing before touching this code. NCAP embeds the body style in the
model name, so a 2019 Ford lists as `F-150 SUPER CREW`, `F-150 SUPERCAB`, `F-250 CREW
CAB` and so on. An exact lookup for the `F-150` a VIN decode gives us returns
`Count: 0` — the car looks untested when it has been tested ten times over.

So `safetyRatings.ts` tries the exact name first and only widens if that finds
nothing: list the make's tested models, keep those that begin with ours, fetch each.
The ordering matters — `CIVIC` matches exactly and must not be widened into a scan.

Prefix, not substring, or `MUSTANG GT350R` would answer a query for `GT`. Matching is
case-insensitive because NHTSA's own labels are not clean: the live feed contains
`F-150 SUPER CREW DiESEL`, with a lowercase i.

Measured against the live service: a 2019 Civic matches exactly and yields 2 variants;
an F-150 widens to 10; a Transit to 9. The caps (12 model names, 24 variants) exist so
a one-character model name cannot turn a page load into a catalogue scan — `F` alone
matches 12 — and truncation is logged rather than silent.

### Variants are not averaged

NHTSA crash-tests each body style and drivetrain separately, and they genuinely
differ: the 2019 F-150's Super Crew scores 5 stars overall where the Regular Cab
scores 4, and the diesel variants have a rollover rating but no overall one. Averaging
them would produce a rating for a truck nobody drives, so each is a row and the
endpoint returns them worst-first — the same reasoning that sorts recalls by severity.

### "Not Rated" is not zero stars

Every rating column is nullable and every wire field optional, because NHTSA publishes
`"Not Rated"` for tests it never ran — most pre-2011 vehicles carry it on every field,
and a 2011 Audi A3 comes back untested on all four. A model that rendered that as a
zero-star car would tell an owner their car failed a test nobody performed.

`RolloverPossibility` needs the same care in the other direction: NHTSA sends `0.0`
for unrated variants, which reads as "cannot roll over" if passed through. It is
withheld unless the rollover test actually ran.

Driver-aid fitment (`Standard` / `Optional` / `No`) is carried because it is actionable
in a way stars are not. `No` is kept as a value rather than dropped: "this model never
offered lane-keep" is a finding, and collapsing it into absent would make it
indistinguishable from the older cars where NHTSA recorded nothing.

Fitment describes the *tested* variant, so the Ask CA block tells the model to have the
owner check their own trim rather than asserting their car has it.

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

## Ask CA

Set `ANTHROPIC_API_KEY` and Ask CA answers with Claude, grounded in the owner's own
car. Leave it unset and it falls back to the canned replies in
`apps/api/src/services/chatReplies.ts` — the same configuration-decides-the-mode
shape as the auth dev bypass, so a fresh clone still runs with nothing to set up. The
API says which mode it is in at startup.

```
ANTHROPIC_API_KEY=sk-ant-...
```

### Conversations are not stored

Leaving the Ask CA screen ends the conversation, and the way that is guaranteed is that
nothing is ever written down. There is no chat table and no `GET /api/chat`: the page
holds the turns in React state and sends them with the next question, so a close, a
refresh or a crash all clear it equally.

The alternative — persist, then delete on exit — fails exactly when it matters. A closed
tab, a refresh, a lost connection and a crash all skip the cleanup, and every miss leaves
rows that come back as history next visit. The failure mode of the cleanup is the feature
not happening, so the cleanup was removed along with the thing it had to clean up.
Cross-user leakage also stopped being possible rather than being defended against, which
is why `isolation.test.ts` no longer needs a chat case.

The tradeoff, stated plainly: history now arrives from the client, so an owner could hand
the model turns it never produced. That only lets them mislead themselves about their own
car — the grounding facts are still read from the database on every request — and the
request schema caps the conversation so an oversized body is rejected rather than
trimmed.

### The grounding is the feature

A model with no context can only recite general advice. `services/vehicleContext.ts`
assembles what this app actually knows about *this* car — recalls and whether the
owner marked them repaired, complaint counts with casualties and failure-mileage
ranges, a couple of owners' own words, computed upkeep status, and logged service
history with odometer readings. Asked about spongy brakes, the model can then say six
owners of this model reported brake problems clustering around 26,000 miles, one
involving a crash, and that the owner's own brake service was 8,000 miles ago.

**Provenance travels with every fact.** Each section states where it came from and
what it cannot support: recalls are official NHTSA findings but per-model, so nobody
can say whether *this* car was repaired; complaints are unverified first-hand
accounts, not confirmed faults; upkeep intervals are the owner's, not the
manufacturer's; service history is only what was logged here. Stripping that to save
tokens would remove exactly what stops the model overclaiming.

### Keeping it honest

A language model is the largest invention risk in this codebase, so the guardrails are
structural rather than merely requested:

- **The reply shape is a JSON schema**, so `urgency` and the CTA are values the UI
  already renders rather than prose to parse. The **CTA label is filled in
  server-side** — the model only chooses *whether* to offer it, so the wording cannot
  drift.
- **The parser drops what it cannot render**: an urgency level outside
  low/medium/high, an urgency with no explanation, an unrecognised CTA action. A reply
  that cannot be read throws rather than showing the owner raw JSON.
- **A failed call is admitted, not papered over.** If the model call fails, the owner
  gets a sentence saying the question was not answered — not a canned reply passed off
  as a real one. That is the whole point of the app applied to itself.
- **`stop_reason: "refusal"` is checked before reading content**, and
  `fallbacks: "default"` re-runs a declined request on Anthropic's recommended
  fallback.
- The system prompt forbids inventing recalls, prices, labour times, intervals or
  valuations; forbids stating a manufacturer's schedule the app does not have; and
  requires leading with a stop-driving recall regardless of what was asked.

Cost and latency notes: the instructions are byte-stable and cached, per-car facts go
in the messages so the cached prefix survives, `effort` is `medium` for an interactive
turn, and `max_tokens` has headroom because on Claude Opus 5 it caps thinking *and*
text together.

The live call has been exercised against a real 2011 Pathfinder: answers cite campaign
numbers correctly, honour the owner's own repaired/not-repaired answer, refuse to supply
a manufacturer service interval, decline to name a fair price while the benchmarks are
placeholders, and attribute complaints as unverified owner reports. First call ~24s
(cache write), subsequent ~10s.

One prompt rule exists only because of that run. Seven answers out of seven appended the
same open recall, including to "what is my car worth" — each mention defensible alone,
the aggregate a nag people learn to scroll past. The prompt now allows an unrepaired
recall to be raised unprompted once per conversation, with the stop-driving advisory
still overriding every turn. This is prompt behaviour, so no hermetic test covers it; if
that line is edited, re-run a three-turn conversation and check the recall is not
re-appended.

`apps/api/test/askca.test.ts` never touches the network: `setAskerForTesting` is the
seam, and it covers the facts block, the parser and the failure paths.

## Tests

```bash
npm test           # typecheck + API suite + end-to-end
npm run test:api   # 543 checks, no database required
npm run test:e2e   # 84 checks, full stack
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
| `apps/api/test/auth.test.ts` | Token verification against a locally generated keypair, and profile provisioning on first sign-in |
| `apps/api/test/onboarding.test.ts` | Vehicle creation, the no-vehicle empty state, and defensive VIN response parsing |
| `apps/api/test/recalls.test.ts` | NHTSA recall parsing (day-first dates, the `parkOutSide` spelling), the mirror, and the owner's own answer |
| `apps/api/test/complaints.test.ts` | Complaint aggregation, month-first dates, and mileage-at-failure percentiles |
| `apps/api/test/safetyRatings.test.ts` | NCAP parsing — above all that `"Not Rated"` becomes absent rather than zero stars — and the mirror |
| `apps/api/test/askca.test.ts` | The grounding block's provenance and "unknown" wording, the reply parser, and the route's failure paths |
| `scripts/e2e.mts` | The real production web bundle driven in jsdom against the real Express app on a real database |

The e2e suite is the one that catches contract drift between the two halves —
the failure mode neither side can see alone. It builds the web app with
`vite.smoke.config.ts`, which emits a classic IIFE bundle because jsdom cannot
execute ES modules, and polyfills `fetch`, `ResizeObserver` and
`structuredClone`, which jsdom omits.

## Database

20 tables in three groups. The distinction is enforced by convention and tested
by the isolation suite:

- **User-owned roots** carry `user_id`: `vehicles`, `service_records`,
  `assessments`, `chat_messages`, `user_features`. Every query filters on it.
- **Children** carry only a parent FK: `vehicle_value_points`,
  `maintenance_items`, `assessment_parts`, `assessment_labor_tasks`. They are
  reachable only through their parent, whose `user_id` filter authorises them.
  Denormalising `user_id` onto children would create a second source of truth
  that can disagree with the first.
- **Global reference data** has no owner: `repairs`, `repair_benchmarks`,
  `benchmark_parts`, `benchmark_labor_tasks`, `model_known_issues`,
  `model_recalls`, `model_owner_reports`, `model_owner_report_quotes`,
  `model_safety_ratings`, `model_feed_syncs`. All are keyed by year/make/model,
  because the answer is the same for every owner of the same car. The one
  exception is `vehicle_recall_status`, which is user-owned: NHTSA reports recalls
  per model and cannot know whether *this* car was repaired.

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

All routes require an authenticated user except `GET /api/health` and
`GET /api/auth/config`.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/auth/config` | Sign-in mode and public keys. No auth required |
| `GET` `PATCH` | `/api/vehicle` | The caller's single vehicle. `GET` 404s until one is added |
| `POST` | `/api/vehicle` | Onboarding. 409 if one already exists |
| `GET` | `/api/vehicle/decode/:vin` | VIN lookup. 404 means "use manual entry" |
| `GET` | `/api/vehicle/maintenance` | |
| `GET` | `/api/vehicle/known-issues` | Global, keyed by the caller's model |
| `GET` | `/api/vehicle/recalls` | Global. `checked: false` means NHTSA was never reached — not an all-clear |
| `PUT` `DELETE` | `/api/vehicle/recalls/:campaign` | The owner's own answer. 404 if the campaign is not this model's |
| `GET` | `/api/vehicle/safety` | Global. One row per NCAP-tested variant, worst-rated first |
| `GET` `POST` | `/api/service-records` | |
| `DELETE` | `/api/service-records/:id` | |
| `GET` `POST` | `/api/assessments` | `POST` snapshots the benchmark |
| `GET` | `/api/assessments/:id` | 404 for another tenant's id |
| `POST` | `/api/assessments/:id/complete` | Also writes a service record, in one transaction |
| `GET` | `/api/repairs` | Only repairs that have a benchmark |
| `POST` | `/api/chat` | Stateless: the client sends the turns so far, nothing is stored |
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
