# CarAdvocate — what exists today

The app as the code currently stands. Last reviewed 9 August 2026 against the working tree and a
read-only pass over the shared database.

Where a number appears — table counts, coverage, row counts — it was measured against the live
database on that date rather than inferred from the code.

---

## 1. What the app is

A web app for car owners, answering two questions: **is this repair necessary?** and **is the
price fair?**

| Screen | What it does |
|---|---|
| **Login** | Email + password, or Continue with Google |
| **Onboarding** | Add your car, by VIN or by typing the details |
| **My Car** | Value, recalls, known issues, upkeep schedule, service history, photo |
| **Ask CA** | The AI chat (§3) |
| **Repair Cost Checker** | Pick a repair, see a fair price range, paste your quote, get a verdict |
| **Account** | Profile, car details, plan status |

Login is the only public screen. Everything else needs sign-in; the Repair Cost Checker also needs
the paywall tap.

Four invariants:

- **Sign-in is mandatory in every environment.** No test or bypass mode. The API refuses to start
  if it cannot verify a token.
- **Every owner only sees their own data.** Each user-owned table carries a `user_id` and every
  query filters on it.
- **Outside data is mirrored locally.** Recalls, complaints, pricing, labour hours and factory
  schedules are fetched per model, stored, and re-checked on a schedule. Pages load from our own
  database, so the app works when a supplier is down.
- **The API fails at startup, not on the first request** — it exits if the database URL is missing,
  the tables are absent, or auth is unconfigured.

---

## 2. Planned scope vs what exists

| Tier | Feature | Status |
|---|---|---|
| Free | Single-vehicle profile | ✅ |
| Free | User-entered service history | ✅ |
| Free | Value + trend line | ⚠️ Live via MarketCheck; needs VIN + zip, no trade-in range |
| Free | Recall schedule | ✅ |
| Free | Maintenance schedule | ✅ Factory intervals from Vehicle Databases, VIN required |
| Free | Model known issues | ✅ |
| Free | Ask CA Q&A + banded severity | ✅ |
| Paid | Necessity check | ❌ Inputs now collected, judgement unwritten |
| Paid | Parts benchmark | ⚠️ Total only, no itemisation |
| Paid | Labor baseline | ⚠️ Dollars and hours, no rate — and the hours barely show |
| Paid | Past assessments · "Repair complete" writeback | ✅ |
| Cut | OBD translation · Advocacy · Post-repair summary | ✅ Absent, as intended |

### The four gaps

**1. Necessity check — the paid tier's headline promise, and it is not there.** The recommendation
fields render, but nothing works them out. `services/repairPricingSync.ts` writes the same fixed
text for every repair on every car: *"Priced for your car"*, badge *ASSESSED*, and a body about
comparing quotes to a range. That is a pricing statement, not a judgement about whether the repair
is needed. The demo Civic reads better only because `db/fixtures.ts` has the answer typed in by
hand. Nothing reads symptoms, mileage, service history or complaint patterns.

This is the one place the product claim and the code genuinely disagree, and it is what the paywall
sells.

**The blocker was never the technique — it was the input.** The assessment recorded which repair and
what it cost, and nothing about why it came up. A shop proposing brake pads to someone reporting
grinding and a shop proposing them to someone in for an oil change are different questions, and the
app could not tell them apart. Three prerequisites were closed on 9 August:

- **The assessment asks why.** Migration `0022` adds `prompted_by` (symptom · warning light · shop
  suggested · routine upkeep · other), `symptom_notes` and `symptom_duration`. `ContextStep` collects
  them as step 2 — between the repair and the quote, so it reads as describing the problem rather
  than pricing it, and is asked before the owner anchors on a number. `prompted_by` is required for
  new rows; the four existing ones stay null, meaning *never asked*, which must stay distinct from
  *nothing to report*. A duration is stored only for a symptom or warning light — on routine upkeep
  it would later read as a reported symptom.
- **Complaint mileage is loaded.** `npm run ingest:mileage` had never run, so all 81 owner-report
  groups had counts and no mileage-at-failure. Now **28 of 81** carry one — 2019 Civic service brakes
  at a median 11,800 mi (n=15), 2021 RAV4 air bags at 30,000 (n=21). The other 51 have fewer than
  four odometer samples and are skipped by design, not missing.
- **Interval availability is settled** — see the factory-schedule note in §4.

**What remains is the shape of the judgement.** Recommended: compute the evidence deterministically
in code and let Claude write the prose from those signals only, never the band — the same split that
makes Ask CA's "Based on" line trustworthy. And reframe the claim from "is this necessary?" — a
diagnosis the app cannot make, and forbids Ask CA from attempting — to "does this hold up against
what we know?", with three bands including an explicit *not enough to say*.

**2. Value + trend line — working, with three limits.**

- **Both a VIN and a zip must be on file.** Onboarding lets an owner skip either; a car missing one
  shows "not available yet". Live: 3 of 6 cars have both.
- **The trend cannot be backfilled.** MarketCheck's predict endpoint takes no as-of date, and its
  history endpoint returns *listing* records — a different quantity, usually empty. Joining them
  would draw a trend that never happened. The line builds forward, one point per month. Live: the
  only real car with history has 1 point.
- **Some vehicles get a conclusive "cannot be estimated"** — MarketCheck returns HTTP 400 for a VIN
  outside its training data. Stored as `Vehicle.valuationUnavailable`, distinct from "unreachable,
  will retry", so the card says so rather than implying a price is coming. Live: 2 of the 3
  priceable cars are in this state — a high rate for a verdict meant to describe very old cars.

**Not sourced: the trade-in range.** Premium-tier MarketCheck data this key does not carry.
`tradeInLow`/`tradeInHigh` are null for every real car.

**3. Parts benchmark — one line, not a breakdown.** The vendor publishes no itemisation, so the
sync writes a single row reading "All parts for this repair". Minor.

**4. Labor baseline — no rate, and the hours barely show.**

- **No hourly rate exists** and neither vendor publishes one. It cannot be derived: labor dollars ÷
  Open Labor Project hours gives a number well outside any real shop rate. The mock's "$95/hr" has
  no source.
- **`LaborBaselineCard` needs the rate and hours together to show either.** So the "Labor Rate … ·
  Est. Time …" line has never rendered for a real car and never will, until a rate source appears
  or the card shows hours alone. Hours do appear in the task-breakdown rows.
- **The hours are estimates, not licensed book times.** Every Open Labor Project row is labelled
  `estimated` (1,454 of 1,454 across two vehicles), and its catalogue contradicts itself — front
  brake pads listed at both 1.0 h and 1.5 h for the same car. **The fair/overpriced verdict runs on
  dollars alone and must keep doing so.**

Gap 1 needs a product decision; gap 4 needs a licensed book-time source plus a decision about
showing hours without a rate; gap 3 is minor.

**A coverage limit gates the whole paid tier.** If the pricing vendor has nothing for the owner's
car, the Repair Cost Checker offers **no repairs at all** — deliberate, because another vehicle's
figures produce confidently wrong verdicts, but it makes vendor coverage a hard gate on the only
paid feature. Nobody has measured which cars real signups bring.

---

## 3. Ask CA

**The AI is never asked to remember anything about the car.** Every fact is looked up in our
database, handed to it, and it is told it may not go beyond them.

1. You type a question; the browser sends it with the last 10 messages.
2. **The conversation lives in the browser** (`sessionStorage`) — survives a refresh, dies with the
   tab, cleared on sign-out. There is no GET and no screen that could show an old conversation.
3. The API builds a **facts block about your car**, each item labelled with its source: the car
   itself; NHTSA recalls plus whether *you* said each was fixed; NHTSA complaints for the model
   grouped by component, with counts, deaths/injuries/crashes/fires, mileage range and up to two
   owners' own words; your upkeep schedule and what is due; your last 8 services. Each section
   states what missing data means — if NHTSA could not be reached, the block says *"This is NOT an
   all-clear."*
4. The question goes to Claude (`claude-sonnet-5`) with a fixed system prompt.
5. **The reply comes back in a fixed shape**: `text`, `urgency` (`low`/`medium`/`high`/none), `cta`.
6. The reply streams. What you see mid-stream is a preview the app throws away — the finished
   reply, the one that went through the checks, replaces it, and only that one can carry an urgency
   banner or button.

**Each answer shows what it was based on** — "Based on · Your 2019 Honda Civic · 4 NHTSA recalls for
this model · Your last 6 logged services". It cannot lie: the AI picks only *which kinds* of fact
it used from a fixed list of five, and the app writes the wording and counts from the facts it
actually assembled. A kind the block did not contain is dropped.

### What stops it making things up

Five enforcement points, not requests:

1. **The facts block is the only source**, and the AI is told so.
2. **Explicit prohibitions:** do not invent recalls, part prices, labour times, service intervals or
   resale values; do not state a manufacturer's schedule; do not diagnose; do not turn "we couldn't
   reach the data source" into "nothing's wrong"; do not repeat an owner complaint as fact.
3. **The reply shape is enforced by the API**, so `urgency` can only be a value the UI renders.
4. **The button's wording is set by our code**, not the AI.
5. **Streaming does not skip any of that** — the checks sit on the finished reply.

Behaviour rules:

- An unrepaired recall carrying NHTSA's *stop driving* or *park outside* warning leads the answer
  whatever you asked. The one thing allowed to interrupt.
- Otherwise an unrepaired recall is raised **once per conversation**, only when answering a question
  about the car.
- **A greeting gets a greeting** — one line, no car summary, no recall list, no banner.
- **A price question arrives at the Repair Cost Checker with the form filled in.** The assistant
  only ever *names* a repair; the API matches that name against the owner's own catalogue and
  supplies the id, so an invented name prefills nothing. A mentioned quote ("they want $640") is
  only ever the owner's own figure repeated back.
- **Recalls have three states in the facts block:** unreachable, model-not-listed, and a genuine
  all-clear (§4).

**Failure modes:** no Anthropic key → four cycling canned replies, announced at startup; a failed
call → a sentence saying so, never a canned reply dressed up as real; a safety refusal → asked to
rephrase; no car on file → deliberately uncaught, because it is a setup problem.

### The review log

`ask_transcripts` stores one row per exchange: question, answer as shown, `outcome`
(`answered`/`canned`/`declined`/`timed_out`/`failed`/`abandoned`), urgency, button label, which
fact kinds it used (`ask_transcript_sources`), duration, tokens, prior message count, model. The
facts block itself is not stored — kilobytes of reference data the database still holds; a reviewer
rebuilds it from `vehicle_id`.

Three load-bearing properties:

- **Nothing reads it back.** No GET, no mapper, no screen. Migration `0010` dropped `chat_messages`
  because that table *was* the rendered history, kept tidy by a delete-on-exit a closed tab skipped
  — so every miss resurfaced as turns the owner thought they had left behind.
- **Recording can never cost someone an answer.** The write happens after the reply is on the wire,
  and `services/askTranscripts.ts` swallows and logs its own failures.
- **Failures are recorded too**, including `abandoned`. A climbing abandoned rate is the clearest
  signal that answers are too slow.

**It is the most sensitive table in the schema**, handled on four fronts: rows cascade with the
user; the tables are excluded from `sql/rls-policies.sql` and RLS is on with no policies anywhere;
the app has no read path; and a **90-day retention window**
(`ASK_TRANSCRIPT_RETENTION_DAYS` in `env.ts`) is enforced nightly by
`scripts/pruneAskTranscripts.mts`. It is configurable so it can be **shortened** without a deploy —
lengthening it is a policy change. Unlike the write path, the prune **does not swallow failures**,
so a job that stops enforcing the window goes red.

### Cost and speed

Measured on the seeded Civic, warm cache, one location. The system prompt and facts block are
cached, so a follow-up only pays full price for the new question (7,741 tokens on the first turn).
**About 3 s for a greeting, 5–6 s for a real question**, down from a median 15 s. Three settings
account for it:

- **Extended thinking is off** — it cost a median 12.3 s before the first word (range 5.8–16.8)
  against 3.1 s, and roughly doubled every answer.
- **Reasoning effort stays at `medium`.** `low` was tried: `medium` grounded answers in the owner's
  own data 6/6 against 5/6, for ~180 ms. Thinking surfaced that data slightly more often too, which
  is why effort went up as thinking went off — change one and re-measure the other.
- **The facts block is built in one round of queries**, not three in sequence.

Every answer logs `Ask CA: 1234ms in=… out=… cacheRead=… cacheWrite=…`, the only instrumentation on
this path. **Watch `cacheRead`:** near zero across a conversation means the cached prefix is being
invalidated and every follow-up is charged in full.

---

## 4. Outside services

| Service | Used for |
|---|---|
| **Supabase** | Sign-in, and the Postgres database (the only required key) |
| **Anthropic (Claude)** | Ask CA answers (`claude-sonnet-5` — the only place Claude is used) |
| **NHTSA — recalls / complaints / vPIC** | Safety recalls, owner reports, VIN decoding |
| **CarImages** | Studio photo on My Car |
| **Vehicle Databases** | Parts and labour pricing, factory maintenance schedules |
| **Open Labor Project** | Labour hours per repair |
| **MarketCheck** | Market value estimate on My Car |

Which need a key, and what happens when one is unset, lives in the README's environment-variable
table — the single place that answers it, so the two cannot drift.

- **The three NHTSA feeds are free and need no key.** When one cannot be reached the app says so
  rather than implying an all-clear; a failed VIN decode drops the owner back to typing details.
- **Vehicle Databases is metered** and returns 403 on *every* call once the monthly allowance is
  spent. The code treats "no answer" differently from "no record", so a spent quota does not wipe
  out pricing we already hold.
- **Repair pricing is per model with no fallback.** No data means the checker shows nothing rather
  than another car's prices. A Pathfinder judged against Civic brake prices sends the owner to argue
  with a shop that did nothing wrong.
- **Factory maintenance schedules** come from the same vendor's repair-estimates feed, keyed by VIN
  so the trim is right, fetched **once per car and never refreshed** — a factory schedule does not
  change, and `vehicles.maintenance_schedule_checked_at` is the whole freshness policy. Rows are
  updated in place or appended, **never deleted**, because `service_records.maintenance_item_id`
  points at them. Every dollar figure in that response is ignored: it assumes $55/hour, about half a
  real shop rate. A car with no VIN gets nothing.

  **Four interval states, live on 9 August, and they are not interchangeable:** factory schedule
  present and authoritative (Pathfinder 6 jobs, F-350 4); vendor answered *no schedule exists for
  this car* (GMT-400, 0); never asked because there is no VIN (Golf, 0); and seeded demo values that
  are not the manufacturer's (Civic 5, RAV4 1). **Only the first may produce a "due / not due"
  signal** — an empty interval list is not evidence that nothing is due. The other three degrade to
  *not enough to say*. Two are recoverable: a VIN would fix the Golf, and **nothing in the app ever
  asks for one**.
- **Open Labor Project allows 10 calls per day** on the free tier, then 429. A sync makes at most one
  call per model per week, so the limit caps how many *different* cars can be primed in a day. Paid
  tier is $49/mo for 1,000/day.
- **MarketCheck needs a VIN and a zip on every call**, and is asked at most once a month per car, by
  the nightly sweep rather than a page load. The monthly rule lives once, in `marketValueDue`, so a
  steady fleet costs roughly *vehicles ÷ 30* calls a night. The sweep caps itself at 250 calls per
  run and logs when it does. The route call stays — it is what prices a car the moment it is added.
- **The CarImages photo is of the model, not your car**, and the supplier returns a generic
  placeholder for vehicles it lacks, indistinguishable from a real photo at our end.

### The NHTSA recall mirror

NHTSA's live recall API answers HTTP 400 for a model name it does not recognise — with a body
reading `{"Count":0,"Message":"Results returned successfully"}`, a success shape carrying a failure.
So a recall check has **three outcomes, not two** — `ok`, `model_not_listed`, `unreachable` — stored
in `model_feed_syncs.outcome` and carried to the screen and the Ask CA facts block.

A 400 usually means NHTSA files the car under a finer name than the owner's: a 2014 "F-350" is
"F-350 SD" to them. So `scripts/importNhtsaRecalls.mts` loads NHTSA's bulk recall catalogue into two
local tables and `services/recallMirror.ts` reads it. Three things to keep:

- **The mirror holds the vocabulary the *recall API* uses**, which is not NHTSA's published model
  list — that list offers "F-350 REGULAR CAB"/"SUPERCAB"/"SUPER CREW", all of which the recall
  endpoint refuses.
- **The live API is asked first; the mirror is the fallback.** The API normalises names and the flat
  file is raw, so some models are filed oddly there (a 2023 Ariya appears as "redundant ARIYA").
  Measured 57/60 models exact against the API, the three misses off by one campaign.
- **A mirror miss is never an all-clear.** Zero rows may only mean a different spelling, so the
  lookup answers "don't know" and the caller keeps reporting the feed as unreached. Showing "no open
  recalls" on a name mismatch is the failure this feature exists to prevent.

Two tables rather than one for size: denormalised the catalogue is 268 MB; split, 169,240 model rows
share 26,482 campaigns at 28 MB. Neither has an `id` — NHTSA's campaign number is the identifier —
and the importer replaces both outright on each run.

### Both pricing vendors are under review

Neither is committed to, and the Repair Cost Checker depends on both. Open Labor Project labels
every figure `estimated`, publishes no rate and no parts, and contradicts itself (§2 gap 4) — fine
for a rough duration, not for telling an owner a shop overbilled by a specific number of hours. That
needs Mitchell, ALLDATA or MOTOR, all materially more than $49/mo. Vehicle Databases has a small
monthly allowance and hard coverage gate.

Both sit behind the shared sync machinery in `services/modelFeed.ts` with their own client and
parser, so swapping either is contained work. A replacement must keep three properties:

1. **Three outcomes, not two** — "no record for this car" must be distinguishable from "the vendor
   did not answer", or a spent quota silently retracts data we hold.
2. **One call per model, not per repair** — what makes a metered plan affordable.
3. **No cross-vehicle substitution** — a vendor that quietly answers with a similar car's figures is
   worse than one that answers with nothing.

---

## 5. Architecture

```
apps/web        React 18 + Vite + Tailwind + shadcn/ui + React Router
apps/api        Express 5 + Drizzle ORM + Postgres
packages/shared Types and validation rules both sides import
```

- **One door to the server.** The browser talks to the API through a single module, the only place
  `fetch` is called. It attaches the Supabase access token to every request.
- **One door to the database.** All queries go through Drizzle in the API.
- **Auth is mounted once** in `app.ts`, so a new endpoint cannot forget it. Only `/api/health` and
  `/api/auth/config` are public. Mount order is load-bearing — a route added above the `requireUser`
  line is silently exposed.
- **Shared validation** in `packages/shared`, used by both sides, so the rules cannot drift.
- **23 tables in `schema.ts`**, in five groups: things you own (car, service records, assessments);
  things about a *model* everyone with that car shares (recalls, complaints, pricing); the reference
  catalogue of repairs; the Ask CA review log; and the NHTSA recall mirror. The shared database
  holds **29** — see §7.
- **Assessments are snapshots.** Running a repair check copies the prices in, so refreshing supplier
  pricing later never changes what you were shown.

**Endpoints — 27 authenticated, 2 public:** `/api/vehicle` (13 — car, VIN decode, maintenance jobs,
recalls and your answers to them, photo, known issues), `/api/service-records` (4),
`/api/assessments` (4, **paywalled**), `/api/account` (2), `/api/paywall` (2), `/api/repairs` (1),
`/api/chat` (1, POST only, the one endpoint that streams), plus `/api/health` and
`/api/auth/config`.

**Three scheduled jobs, all GitHub Actions**, spaced an hour apart because all three hold a Postgres
pool against the same database: `import-nhtsa-recalls.yml` at 08:00 UTC, `refresh-market-values.yml`
at 09:30, `prune-ask-transcripts.yml` at 10:30. None applies migrations and none is on the request
path, so a failed night degrades freshness rather than breaking the app. All need `DATABASE_URL` as
a repository secret; the market-value sweep also needs the vendor key (§8).

---

## 6. Sign-in and the paywall

Supabase handles sign-in in the browser (email + password, or Google) and returns an access token.
The API verifies it on every request — signature, expiry, issuer, audience, a valid user id and an
email. A validly-signed token from a *different* Supabase project is rejected. A profile row is
created the first time a verified person arrives.

**The browser fetches its Supabase credentials from the API** (`GET /api/auth/config`) rather than
baking them into the bundle, so the two cannot disagree about which project they use. That config
and the Supabase client both cache successes and evict failures, so a momentary API outage does not
wedge sign-in until reload. The failure message is split in two: "the server serves no credentials"
is a deployment to fix, "we could not reach the server" is usually momentary.

The project publishes a live JWKS serving a single **ES256** key, so the asymmetric path is in use
and `SUPABASE_JWT_SECRET` is unset and unneeded. Proven by test: a fabricated token with correct
issuer, `aud`, UUID subject, email and future expiry is still rejected on signature; and swapping in
another project's issuer is refused, so the issuer pin works. `npm run verify:token` checks the
claim fields against a real token — read from stdin, never printed, email masked unless
`--show-email`, running the API's own `verifyAccessToken` rather than a reimplementation. Get a
token by signing in and running in the browser console:

```js
JSON.parse(localStorage[Object.keys(localStorage).find(k => k.endsWith('-auth-token'))]).access_token
```

### The paywall — read this before any user test

The Repair Cost Checker is the only paid feature, and **it takes no money.** Tapping unlock charges
nothing, opens the feature permanently, and records the tap. The tap *is* the data — willingness to
pay, without building billing.

**Two offers side by side:** Unlimited at **$99.00/year**, Per-Incident at **$35.00/year plus $50.00
per parts-benchmark lookup**. Which shape of pricing people prefer is part of what this tests. Both
open all three paid features; the per-incident fee is disclosed on screen but not metered in v1.

- **The price and chosen offer are stored with the tap**, so changing a price mid-test leaves
  earlier records meaning what they meant.
- **The gate is enforced on the server** (a 402), not just hidden in the UI.
- **The prices live as the defaults in `env.ts`, and those defaults are the chosen prices.** They
  read like placeholders and are not; do not "fix" them. An override is for running a different
  cohort. The API prints both at startup.

`services/featureCatalog.ts` computes the Account screen's Subscription list from `users.plan`
alone; migration `0017` dropped the `user_features` table it replaced.

---

## 7. State of the database (verified live, read-only, 9 August)

- **29 tables** — 23 from this branch's `schema.ts`, six from another migration line (§8).
- **All 23 migrations this branch defines are applied**, checked against `information_schema` rather
  than drizzle's journal. 24 are applied in total; the odd one is `0016_factory_schedules` from the
  `maintenance` branch, identified by matching drizzle's sha256 hashes.
- **The recall import has run**: 26,482 campaigns, 169,240 model rows. The 2014 F-350 NHTSA's API
  refused by name now holds **6 recalls** via the mirror; a 1993 Chevrolet is correctly
  `model_not_listed` rather than looking like an outage.
- `ask_transcripts` holds 5 rows, all `answered` — worth knowing, because the write path fails
  silently by design, so an empty log would be ambiguous between "nobody asked" and "every insert is
  failing".
- **Owner-report mileage is populated**: 28 of 81 component groups carry a mileage-at-failure range
  after `ingest:mileage` was run for the first time. The rest have too few odometer samples.
- Row counts: 6 users, 6 vehicles, 10 service records, 4 assessments (0 with a recorded reason —
  all four predate `0022`), 2 paywall intents.

**Row-level security is closed.** Supabase serves the same database through PostgREST, reachable by
anyone holding the public anon key, and its stock grants give `anon`/`authenticated` everything on
the assumption RLS says no. It was off on 25 of 29 tables. After `rls-lockdown.sql`: **29 of 29
tables have RLS on and `anon`/`authenticated` hold zero grants** on tables, sequences and routines.
The app is unaffected — the API connects as `postgres`, whose `rolbypassrls` is true.

Three things follow:

- **`rls-policies.sql` is deliberately NOT run and should stay unrun.** It grants `select` back to
  `authenticated` for browser-direct PostgREST queries, and there is not one `.from()` call in
  `apps/web/src`. It also traps on `users.supabase_user_id` being null for seeded and dev rows,
  which would match `auth.uid()` never.
- **A table created through the Supabase dashboard arrives exposed** — `supabase_admin`'s default
  privileges still grant `anon`/`authenticated` full rights, and that is the role the dashboard uses.
- **Postgres has no default for RLS itself**, so: **a migration that adds a table adds an `enable row
  level security` line in the same file.** That belongs in review.

---

## 8. What still needs doing

### There is no automated test suite

Removed deliberately. `npm run typecheck` (every workspace plus `scripts/`) and `npm run build` are
the only automatic checks, and both pass. Nothing verifies behaviour, so the paywall gate, the
per-user filters and anything reading an outside feed must be checked by hand.

Ask CA is the exception, with two read-only checks; both cost model calls.

- **`npm run test:chat`** — 46 assertions across validation, access control, throttling, the
  event-stream wire format, reply integrity, the facts block, transcript storage and the streaming
  decoder. Its "transcript storage" section is the **browser's** `sessionStorage` thread, not the
  server-side review log — nothing covers the log. Run it twice, plain and with
  `ANTHROPIC_API_KEY=`, because the canned-reply path is a separate branch that has caught real bugs.
- **`npm run probe:ask`** — the prompt guardrails. Ten questions built to push at each rule, printing
  the answers. It reports rather than asserts. Run after any change to the prompt, the model, or the
  effort and thinking settings.

**Typecheck cannot see the database.** Drizzle's schema is TypeScript, so a column that exists in
code but not in Postgres compiles fine and fails on a live request — which happened on 8 August
(`column "outcome" does not exist` on My Car's recalls). Checking migrations against the live
database is the only thing that catches this.

### A second migration line runs against the same database

The shared database holds six tables this branch does not define — `vehicle_generations`,
`factory_schedule_services`, `factory_schedule_items`, `schedule_review_queue`, `extraction_runs`,
`schedule_requests` — plus `factory_generation_id` and `factory_schedule_applied_at` on `vehicles`.
All six are **empty**. This is the factory-schedule pipeline on a separate `maintenance` branch; the
only trace here is the untracked `scripts/maintenance-seed/cache/`.

**Why it is dangerous:** drizzle decides what to apply from a single number — the newest `created_at`
in `__drizzle_migrations`, whichever line wrote it. **Hashes are never consulted.** So a migration
the other line stamps later than one of ours that has not run yet does not defer ours; it skips it,
permanently and silently, while `db:migrate` reports success. It has been close: the factory line's
`0016_factory_schedules` applied at 16:29 on 6 August, and this branch's
`0016_vehicle_zip_market_value` was generated at 21:19 the same day.

**`db/migrationPrecheck.ts` now refuses rather than skipping** — it hashes each local migration,
computes which pending ones fall below the watermark, prints them with the fix (raise the `when` in
`meta/_journal.json`) and exits non-zero. Verified both ways against the live database.

**This is a guardrail, not a fix.** The fix is one migration line per database. Both branches also
define a file numbered `0016`, so a merge collides on the number too.

### The odometer

`vehicles.mileage` is read as current by three things — the maintenance due calculation, the price
sent to MarketCheck, and My Car's masthead — and the first is the one that matters: a stale figure
says a job is fine when it is overdue, the only failure in this app that costs an engine rather than
an argument. How it stays current:

- **Service records feed it.** `services/odometer.ts` raises `vehicles.mileage` whenever a logged
  service carries a higher reading. A one-way ratchet — an odometer is monotonic, so a higher reading
  is necessarily the later one and no date comparison is needed.
- **`vehicles.mileage_updated_at` records when the reading was TAKEN, not written.** `odometer.ts`
  stamps the *service date*, so logging a 2019 receipt at 90,000 miles raises the mileage without
  claiming the odometer was checked this morning. Onboarding and the Account PATCH stamp now, because
  there the owner is reading the dial as they type.
- **The staleness rule lives once, in `@caradvocate/shared`**: `mileageIsStale`, 90 days — about
  3,000 miles of drift, most of the way through an oil interval. **An unknown date counts as stale.**
- **`MileageCheck` on My Car asks the owner**, as a card rather than a modal. It prefills an estimate
  (last reading + ~1,000/month, rounded to 100), and **never stores it unless the owner submits** —
  writing a guess would stamp `mileage_updated_at` and turn it into something the app trusts.
- **The value card names the mileage its price was based on**, but only when that reading is stale.

Two deliberate omissions: a mileage bump does not clear `market_value_checked_at`, so the nightly
sweep picks the car up within the month rather than spending a vendor call per service log. And a
mistyped reading moves the car's mileage rather than one history row — the ratchet cannot tell a
correction from an older reading, so the owner fixes it in Account, whose PATCH deliberately accepts
a *lower* figure.

**Not yet seen in the wild.** Every account is younger than 90 days, so the prompt has never rendered
against live data. Connected-car telematics (Smartcar and similar) is the obvious alternative but
needs a 2016-or-newer car with a live subscription — close to the opposite of this audience. An
opt-in extra, never the mechanism relied on.

### Known placeholders and dead columns

- **The fair/overpriced verdict is deliberately simple** — quote against a price range, nothing else.
  No regional labour rates, no per-shop history. It only flags quotes that are *too high*; a
  suspiciously low quote is reported as fair.
- **Quote upload stores the filename only.** No PDF or photo parsing; you type the total.
  `assessments.quote_file_name` is written on create, never read, and is not in the shared domain
  type. Drop it whenever someone is writing a migration anyway.
- **`labor_rate_per_hour` is dead** — every real path writes null on purpose; only the demo seed puts
  a number in (§2 gap 4).

### Two NHTSA data-quality gaps

**1. The VIN decoder and the recall catalogue can name the same car differently — mitigated, not
fixed.** A 1993 truck decodes to `"GMT-400"`, an internal chassis code, while NHTSA's recall and
complaint APIs know it only as `"C/K"`, `"C10"`, `"C1500"`. Both feeds return zero, which on screen
is indistinguishable from a clean car. The mirror does not rescue this — the name is absent from the
bulk files too — but the answer is honest (`model_not_listed`). On top of that, `lib/vehicleAge.ts`
flags any vehicle 20 model-years or older (a blunt, deliberately cheap stand-in) and
`RecallsList`/`KnownIssuesList` show a caveat pointing at NHTSA's own VIN lookup.

**2. The recall API failing for one year of a current model — fixed by the mirror.** A 2014 F-350
returned HTTP 400 for every spelling tried while neighbouring years worked. The cause was
vocabulary, not missing data. That car now holds 6 recalls.

Whether other year/model gaps exist is unknown. The mirror should catch most naming cases, but the
only way one was found before was hitting it by chance on a real signup.

### Not built, and outside the agreed list

Password reset, account deletion, quote-document parsing, and a "safe to drive" verdict (Ask CA
returns an urgency band, not a safe-to-drive answer). Noted only because the README and the original
spec mention them.

### Product risks worth naming

- **Vendor coverage is per car**, which gates the whole paid tier (§2).
- **NHTSA's own data has confirmed gaps that read as "nothing's wrong" unless caveated.** A third,
  undiscovered gap would show as a silent all-clear until someone hit it.
- **The pricing supplier's call allowance is small enough to be the real limit.** Running out shows
  an owner "we couldn't reach our pricing source" on a feature they paid for.
- **Neither pricing vendor is settled** (§4), so a swap is likely before any real launch.
- **Deleting an account deletes its paywall taps too.** Export that data before honouring a deletion
  request or the experiment loses its result.
- **Ask CA is throttled per owner** — one answer in flight, 20 questions per five minutes, because it
  is the only endpoint that spends money per request. The counters are in memory, so they reset on
  restart and are per-process: a cost guard, not a security boundary. A real deployment wants them in
  Postgres or Redis.
- **An answer is abandoned after 45 seconds**, enforced by aborting the stream rather than the SDK's
  own timeout, because that applies per attempt and the SDK retries twice.

### Open questions

1. **Commit the assessment-context work.** Migration `0022` is applied to the shared database while
   `schema.ts`, `0022_assessment_context.sql`, `ContextStep.tsx`, the shared types and the route are
   still only in the working tree. Database ahead of the code is the wrong way round, and it is the
   same skew that produced `column "outcome" does not exist` on a live request on 8 August.
2. **Is `MARKET_CHECK_API_KEY` in the repository's GitHub Actions secrets?** Without it the nightly
   sweep exits early naming the cause and does nothing.
3. **Has the market-value sweep ever made a real vendor call?** `npm run refresh:values -- --dry-run`
   confirmed the cadence (0 due today, 3 at +31 days, three cars never due for lack of VIN or zip),
   but no run from inside the workflow has happened. Use `workflow_dispatch` with a small `--limit`.
4. **Talk to whoever owns the factory-schedule migration line** — one line per database is the fix.
5. **Run `npm run verify:token` with a real token** — the harness is built, it needs the credential.
6. **Re-check the Ask CA timings on more than one car**, and watch `cacheRead` (§3).
7. **Exercise the Account screen by hand** since `user_features` was dropped (§6).
8. **Price the licensed book-time options and trial a second pricing vendor** against a real list of
   signup vehicles (§4).
9. **Decide the shape of the necessity verdict** (§2 gap 1). Inputs are collected and the supporting
   data is loaded; what is left is how the band is produced.
10. **Nothing asks an owner for a VIN after onboarding**, so a car without one silently gets no
    valuation, no factory schedule and no interval signal (§4). One car of six is in this state.
