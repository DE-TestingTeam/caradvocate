# CarAdvocate — what exists today

A plain-language description of the app as the code currently stands.

**Confirmed** means it was read in the source, or measured against the live database.
**Needs checking** means the code cannot answer it — usually a question about the live
environment. Every open question is collected at the end of §9.

Last reviewed on 9 August 2026, against the working tree and a read-only pass over the shared
database. Since the 8 August review: the NHTSA recall mirror landed, is committed, and is
described here for the first time (§5); migrations `0019` and `0020` were applied and the recall
import has run (§9); and the Ask CA review log took its first real rows (§4).

---

## 1. What the app is

A web app for car owners. It answers two questions:

1. Is this repair actually necessary?
2. Is the price the shop quoted me fair?

It is a prototype, not a live business: the paid feature charges nobody (see §8).

---

## 2. What is built

Six areas, all working end to end. **Confirmed** — each has a route in `apps/web/src/App.tsx`
and a matching API endpoint. (The Repair Cost Checker is one row here but four routes: the
list, a new check, a detail view, and the "we can't price your car" page.)

| Screen | What it does |
|---|---|
| **Login** | Email + password, or "Continue with Google" |
| **Onboarding** | Add your car, by VIN or by typing the details |
| **My Car** | Value, recalls, problems other owners report, upkeep schedule, service history, a photo |
| **Ask CA** | The AI chat (see §4) |
| **Repair Cost Checker** | Pick a repair, see a fair price range, paste your quote, get a verdict |
| **Account** | Profile, car details, plan status |

This is about the screens. It is not a claim that every planned feature behind them is
finished — §3 checks the agreed feature list one by one, and several are not.

Login is the only public screen. Everything else needs sign-in, and the Repair Cost Checker
also needs the paywall tap (§8).

Behind those screens:

- **Sign-in is mandatory in every environment, including a laptop.** No test or bypass mode.
  The API refuses to start if it cannot verify a token.
- **Every owner only ever sees their own data.** Each user-owned table carries a `user_id` and
  every query filters on it.
- **Outside data is mirrored locally.** Recalls, owner complaints, repair pricing and labour
  hours are fetched once per car model, stored, and re-checked weekly. Pages load from our own
  database, so the app still works when a supplier is down.
- **The API fails loudly at startup**, not on the first request — it exits if the database URL
  is missing, if the tables are absent, or if auth is unconfigured.

---

## 3. Planned scope vs what exists

The agreed feature list, checked line by line against the code. "Built" means a real person
with a real car gets the thing — not that a screen exists or that the demo account looks right.

| Tier | Feature | Status |
|---|---|---|
| Free / My Car | Single-vehicle profile | ✅ Built |
| Free / My Car | User-entered service history | ✅ Built |
| Free / My Car | Value + trend line | ⚠️ Live via MarketCheck, refreshed nightly; needs VIN + zip, priced off a possibly-stale odometer, trade-in range still missing |
| Free / My Car | Recall schedule | ✅ Built |
| Free / My Car | Maintenance schedule | ⚠️ Tracker built, starts empty |
| Free / My Car | Model known issues | ✅ Built |
| Free / Ask CA | Q&A + banded severity | ✅ Built |
| Paid / RCC | Necessity check | ❌ Not implemented |
| Paid / RCC | Parts benchmark | ⚠️ Total only, no itemisation |
| Paid / RCC | Labor baseline | ⚠️ Dollars and time, no rate — and the time barely shows |
| Paid / RCC | Past assessments | ✅ Built |
| Paid / RCC | "Repair complete" writeback | ✅ Built |
| Cut | OBD translation · Advocacy · Post-repair summary | ✅ Absent, as intended |

### The five gaps, in priority order

**1. Necessity check — the paid tier's headline promise, and it is not there.** The
recommendation fields exist and render, but nothing works them out. For a real car,
`services/repairPricingSync.ts` writes the same fixed text for every repair: headline *"Priced
for your car"*, badge *"ASSESSED"*, and a body about comparing quotes to a range. That is a
pricing statement, not a judgement about whether the repair is needed.

The demo Civic reads better only because that copy was typed by hand from the wireframes with
the answer already in it — `db/fixtures.ts` contains *"At 68,400 miles with reported grinding,
brake pad replacement is recommended."* That sentence is fixed text. It says "grinding"
whatever the owner reported, and 68,400 miles whatever their odometer says. Nothing reads
symptoms, mileage, service history or complaint patterns to decide.

This is the one gap where the product claim and the code genuinely disagree, rather than the
feature merely being unfinished — and it is what the paywall sells. **It needs a product
decision first:** whether necessity is calculated from the mileage, service history and
complaint data already in the database, or answered by Claude the way Ask CA already answers
questions.

**2. Value + trend line — working, with four real limits.** MarketCheck prices a real car from
actual dealer listings (`services/marketCheck.ts`, `services/marketValueSync.ts`). The refresh
rule is monthly, and a nightly job now sweeps every due car
(`scripts/refreshMarketValues.mts`) — before that, a car was only re-priced when its owner
happened to open the app, so the chart held one point per month in which somebody signed in.
Four things still keep this short of the original ask:

- **Both a VIN and a zip code have to be on file.** MarketCheck requires both, and onboarding
  lets an owner skip either; a car missing one shows "not available yet". Live on 9 August:
  **3 of the 6 cars on file have both.**
- **The price is only as current as the odometer we hold**, which for most owners is what they
  typed at signup. The call takes `miles`, so a stale reading prices the car high. Half-fixed —
  see §9, "The odometer is only half-solved".
- **The trend cannot be backfilled.** Confirmed against MarketCheck's docs: the predict endpoint
  takes no date parameter, so there is nothing to ask "what was this worth in March".
  `/v2/history/car/{vin}` is not the answer either — it returns *listing* records (what a dealer
  asked while the car sat on a lot), empty for a car its owner has driven for years and never
  listed, and where it is not empty it is a different quantity from a predicted value. Joining
  the two would draw a trend that never happened. MarketCheck sells a separate Historical Price
  API, not on this tier. So the line is built going forward, one point per month, from whenever
  VIN and zip are both in place. Live: the only real car with history has **1 point** (the Civic
  and RAV4 show 6 each; those are seeded demo rows).
- **Some vehicles get a conclusive "cannot be estimated", not a retry loop.** MarketCheck
  returns a real HTTP 400 for a VIN old enough to fall outside its training data (a 1993 truck,
  confirmed). That is stored as distinct from "vendor unreachable, will retry"
  (`Vehicle.valuationUnavailable`), so the card says so instead of implying a price is still
  coming. Live: **2 of the 3 priceable cars are in this state** — checked, no price stored.
  Two out of three is a high rate for a verdict meant to describe unusually old vehicles, and
  it is worth reading alongside the standing question in `marketCheck.ts` about whether this
  key carries the VIN-decode entitlement the predict endpoint depends on.

**Not sourced yet: the trade-in range.** MarketCheck's percentile data is a Premium-tier
feature and this key is not known to carry it. `tradeInLow`/`tradeInHigh` are null for every
real car — confirmed live, the only two rows holding values are the seeded demo cars.

**3. Maintenance schedule — the tracker works, the schedule does not exist.** The due/overdue
calculation is real: mileage or time, whichever comes first, with a "due soon" margin. But a
new owner starts with an empty list and has to type every job and interval themselves.
Manufacturer intervals are licensed data the app does not have. If "maintenance schedule" is
meant to arrive pre-filled, that part is unbuilt.

The calculation is also only as good as its input, and it reads `vehicles.mileage` as the
current odometer. A stale figure here does not merely look wrong: it tells someone a job is
fine when it is overdue, which is the one failure mode in this app that can cost an engine
rather than an argument. Half-fixed — see §9.

*(A separate branch is building manufacturer schedules with a Claude research pipeline. It is
not part of this branch — see §9, "A second migration line".)*

**4. Parts benchmark — one line rather than a breakdown.** The low/average/high range is real
vendor data, but the sync writes a single row reading "All parts for this repair" set to the
parts total, because the vendor publishes no itemisation. So the parts list renders with
exactly one entry. Minor, and may not be worth solving.

**5. Labor baseline — time has arrived, the rate has not, and the screen barely shows either.**
Labor dollars are real, and Open Labor Project fills labor *hours* per repair per model. Three
caveats, and they matter more than the win:

- **The hourly rate is still missing**, and neither vendor publishes one. It cannot be derived:
  dividing the pricing vendor's labor dollars by these hours gives a number well outside any
  real shop rate. This is why the mock's "$95/hr" has no source.
- **The card needs the rate and the hours together to show anything.** It tests for both, so
  the title stays "Labor Baseline" rather than "OEM Labor & Time Baseline" and the "Labor Rate
  … · Est. Time …" line stays hidden. The hours reach the browser and are stored, but the only
  place they appear is one task-breakdown row: "Shop labor for this repair — 1 hr". **A small
  front-end change would show a time without a rate**; nobody has decided whether to make it.
- **The hours are estimates, not licensed book times.** Every row the vendor returns is
  labelled `estimated` — 1,454 out of 1,454 across two vehicles checked. The data varies
  sensibly by engine (spark plugs 0.8 h on an inline-four, 1.5 h on a V6), but its catalogue
  contradicts itself: front brake pads are listed twice, at 1.0 h and 1.5 h, for the same car.
  So the hours are display-only. **The fair/overpriced verdict still runs on dollars alone and
  must keep doing so.**

Still missing for the mock: the per-task hour split. The vendor publishes one figure per job,
not a decomposition.

**What kind of work each is.** Gap 1 needs a product decision. Gap 3 is procurement — it waits
on a manufacturer-schedule source, and the sync machinery to plug one in already exists. Gap 5
is half procurement, half product decision: the rate needs a vendor, a hand-curated regional
table, or asking the owner what their shop charges. Gap 4 is minor.

### A coverage limit that affects the whole paid tier

If the pricing vendor has nothing for the owner's car, the Repair Cost Checker offers **no
repairs at all**. That is deliberate — substituting another vehicle's figures would produce
confidently wrong verdicts — but it makes vendor coverage a hard gate on the only paid feature,
and nobody has measured which cars real signups actually bring.

---

## 4. How the AI chat works

This is the "Ask CA" screen. The short version: **the AI is never asked to remember anything
about the car. Every fact is looked up in our database first and handed to it, and it is told
it may not go beyond them.**

### Step by step

1. **You type a question.** The browser shows your message immediately and sends it to the API
   with the conversation so far (last 10 messages, so follow-ups make sense).
2. **The conversation is held by the browser, not the server.** No GET, no screen that could show
   an old one. This is deliberate: saving-and-deleting fails exactly when it matters, because a
   closed tab or a crash skips the cleanup and the leftover rows come back as "history". The
   transcript lives in `sessionStorage`, so it survives navigation and a refresh and dies with
   the tab; signing out clears it, so the next person on a shared machine does not inherit it.
   *(Exchanges are separately written to a review log — see below. Nothing the server keeps can
   come back to an owner as history.)*
3. **The API checks who you are** and looks up your car.
4. **The API builds a "facts block" about *your* car**, each item labelled with its source: the
   car itself (year, make, model, trim, odometer, whether a VIN is on file); **safety recalls**
   from NHTSA plus whether *you* said each was fixed; **what other owners report** (NHTSA
   complaints for this model, grouped by component, with counts, any deaths/injuries/crashes/
   fires, the mileage range reported, and up to two owners' own words); **your upkeep schedule**
   and whether each job is due; **your last 8 logged services**. Each section says what it means
   when data is missing — if NHTSA could not be reached, the block literally says *"This is NOT
   an all-clear."*
5. **The question goes to Claude** (`claude-sonnet-5`) with a fixed system prompt, the facts
   block, the recent conversation, and your question.
6. **The reply comes back in a fixed shape**, not free-form prose: `text`, `urgency`
   (`low`/`medium`/`high`/nothing), and `cta` (show the Check Repair Costs button, or nothing).
7. **The browser renders it** as a chat bubble, plus an urgency banner and button if set.

**Each answer shows what it was based on.** A quiet line under the reply — "Based on · Your 2019
Honda Civic · 4 NHTSA recalls for this model · Your last 6 logged services". It is built so it
cannot lie: the AI picks only *which kinds* of fact it leaned on, from a fixed list of five, and
the app writes the wording and counts from the facts it actually assembled. A kind the facts
block did not contain is dropped. An answer that drew on nothing shows no line at all.

**The answer appears as it is written.** The reply streams, so words appear a few at a time
instead of a spinner. What you see mid-stream is a *preview* the app throws away: the finished
reply — the one that went through the checks below — replaces it, and only that one can carry
an urgency banner or the button. Closing the tab stops the request rather than leaving it
running.

### What stops it making things up

Enforced in five places rather than asked for:

1. **The facts block is the only source.** The AI is told those facts are all it knows.
2. **Explicit prohibitions.** Do not invent recalls, part prices, labour times, service
   intervals or resale values. Do not state a manufacturer's maintenance schedule (not
   licensed). Do not diagnose — it cannot see or hear the car. Do not turn "we couldn't reach
   the data source" into "nothing's wrong". Do not repeat an owner complaint as an established
   fault.
3. **The reply shape is enforced by the API**, so `urgency` can only be a value the app knows
   how to display.
4. **The button's wording is set by our code, not the AI.**
5. **Streaming does not skip any of that.** The checks sit on the finished reply, not the
   stream, so the fast path cannot become the unchecked path.

Behaviour rules worth knowing:

- If a recall carries NHTSA's *stop driving* or *park outside* warning and you have not said it
  was repaired, the AI leads with it whatever you asked — including if all you said was "hi".
  This is the one thing allowed to interrupt, because the car should not be moving.
- Otherwise it raises an unrepaired recall **once per conversation**, and only when actually
  answering a question about the car. Repeating it teaches people to ignore it.
- **A greeting gets a greeting** — one line, no car summary, no recall list, no urgency banner.
- **A price question arrives at the Repair Cost Checker with the form already filled in.** When
  the question is clearly about one of the twelve jobs the checker covers, the button carries
  that repair through and preselects it, and a mentioned quote ("they want $640") lands in the
  quote box. Everything is editable and the form says where the values came from. The assistant
  only ever *names* a repair — the API matches that name against the owner's own catalogue and
  supplies the id, so an invented name prefills nothing rather than selecting the wrong job.
  The quote is only ever the owner's own figure repeated back. A job the checker does not cover
  gets told so rather than sent to a form that cannot help.
- **A price question is handed to the checker, not apologised for.** It used to lead with "I
  don't have pricing data" — true of the chat, wrong about the app. It now points at the checker
  in a sentence and shows the button, including when the owner does not yet know which repair
  they need. It names no number and does not promise what the checker will say.
- **Recalls have three states in the facts block, not two.** "NHTSA could not be reached",
  "NHTSA does not list recalls under this car's model name" and a genuine all-clear now read
  differently, because the honest answer differs: the second means nothing is down, the name is
  wrong, and a VIN check at nhtsa.gov settles it today. See §5.

### When things go wrong

- **No Anthropic API key** → four canned replies that cycle. They are obviously generic, and
  the API prints `Ask CA: canned replies` at startup.
- **The AI call fails** → a sentence saying the question was not answered. It does **not**
  quietly serve a canned reply dressed up as a real one.
- **A safety filter declines** → you are told to rephrase.
- **You have no car on file** → deliberately *not* caught, because it is a setup problem and a
  generic error would hide it.

### Every exchange is recorded for quality assurance

**Confirmed and live.** `ask_transcripts` stores one row per exchange: the question, the answer
as the owner saw it, and enough context to judge it — `outcome` (`answered`, `canned`,
`declined`, `timed_out`, `failed`, `abandoned`), urgency band and button label, which facts it
leaned on (child table `ask_transcript_sources`), duration and token counts, how many prior
messages, and which model answered.

Three properties are load-bearing, and each is why this is safe where the old `chat_messages`
table was not:

- **Nothing reads it back.** No GET, no mapper, no screen. Migration `0010` dropped
  `chat_messages` because that table *was* the history the screen rendered, kept tidy by a
  delete-on-exit that a closed tab skipped — so every miss resurfaced as turns the owner thought
  they had left behind. A write-only log cannot do that.
- **Recording can never cost someone an answer.** The write happens after the reply is on the
  wire, and `services/askTranscripts.ts` swallows and logs its own failures.
- **Failures are recorded too**, including `abandoned` when the owner closes the tab mid-answer.
  A climbing abandoned rate is the clearest available signal that answers are too slow.

**Deliberately not stored: the facts block.** It runs to kilobytes per exchange and is mostly
reference data the database still holds, so the source rows record *which* blocks were used. A
reviewer who needs the exact wording rebuilds it from the transcript's `vehicle_id`.

**⚠️ This is personal data, and one decision is outstanding.** Owners describe their cars, their
money and sometimes themselves. Two things are handled: rows cascade with the user, so deleting
an account takes its transcripts, and the tables are excluded from `sql/rls-policies.sql` so no
browser key can read them. **There is still no retention window** — transcripts live forever. 90
days is a reasonable default, but the number is a product decision nobody has made. Decide it
before the log holds much.

### Cost and speed

**Confirmed**, measured against the seeded Civic on a live database. The system prompt and facts
block are both cached, so a follow-up only pays full price for the new question (7,741 tokens
written on the first turn, read back on every turn after).

**Answers take about 3 seconds for a greeting and 5–6 for a real question**, down from a median
15 seconds and sometimes closer to 20. Almost all of that came from one setting, and not the
expected one:

- **Extended thinking is off.** Sonnet 5 thinks by default; on a real question that cost a
  median 12.3 seconds before the first word (range 5.8–16.8) against 3.1 with it off, and
  roughly doubled every answer's length. On a greeting it made no difference — it correctly
  declines to think about "hi".
- **Reasoning effort stays at `medium`.** It was briefly dropped to `low` on the assumption that
  effort was the cost; measurement showed it was not. `medium` grounded its answer in the
  owner's own data in 6 of 6 test runs where `low` managed 5 of 6, for about 180 ms.
- **Streaming** does not make an answer faster — the owner reads it as it is written.
- **The facts block is built in one round of queries** instead of three in sequence. That was
  roughly 2 seconds of pure waiting on a cold cache, on every message.

Thinking did buy *something*: it surfaced the owner's own complaint and recall data slightly
more often, which is why effort went up as thinking went off. Change one and re-measure the
other.

**Needs checking:** all of this was measured on one car with a warm cache, from one location.
The shape is not in doubt; the exact numbers will move. Each answer logs its own duration and
tokens (`Ask CA: 1234ms in=… out=… cacheRead=… cacheWrite=…`), which is the only instrumentation
on this path. Watch `cacheRead`: if it stays near zero across a conversation, the cached prefix
is being invalidated and every follow-up is charged in full.

---

## 5. Outside services used

| Service | Used for |
|---|---|
| **Supabase** | Sign-in, and the Postgres database |
| **Anthropic (Claude)** | Ask CA answers (`claude-sonnet-5` — the only place Claude is used) |
| **NHTSA — recalls / complaints / vPIC** | Safety recalls, what owners report, VIN decoding |
| **CarImages** | Studio photo on My Car |
| **Vehicle Databases** | Real parts and labour pricing |
| **Open Labor Project** | Labour hours per repair |
| **MarketCheck** | Market value estimate on My Car |

Which need a key, and what happens when one is unset, is in the README's environment-variable
table — the single place that answers it, so the two cannot drift. Only Supabase is required;
the API will not start without it.

- **The three NHTSA feeds are free and need no key.** When one cannot be reached the app says
  so rather than implying an all-clear: recalls and owner reports show as "unknown", and a
  failed VIN decode drops the owner back to typing the details by hand.
- **Vehicle Databases is metered.** Its monthly allowance is finite and it returns 403 on
  *every* call once spent. The code treats "no answer" differently from "no record", so a spent
  quota does not wipe out pricing we already have.
- **Repair pricing is per car model, with no fallback.** No data for your car means the checker
  shows nothing rather than another vehicle's prices. A Pathfinder judged against Civic brake
  prices sends the owner to argue with a shop that did nothing wrong.
- **The CarImages photo is of the model, not your car**, and the supplier returns a generic
  placeholder for vehicles it doesn't have — indistinguishable from a real photo at our end.
  Nothing in the UI claims otherwise.
- **Open Labor Project is metered far more tightly**: **10 calls per day** on the free tier,
  then 429. A sync makes at most one call per model per week, so the limit caps how many
  *different* cars can be primed in a day rather than how often one refreshes. An outage keeps
  the hours already stored. The paid tier is $49/mo for 1,000 calls a day.
- **Neither pricing vendor publishes an hourly labour rate**, so the app has none (§3, gap 5).
- **MarketCheck needs a VIN and a zip on every call**, and is asked at most once a month per
  car. Same three-outcome discipline as the others: a price, a conclusive "cannot decode this
  VIN" (cached, so a car that will never price is not re-asked every visit), or an outage that
  is retried rather than remembered.
- **MarketCheck is asked by a nightly job, not a page load** (`refresh-market-values.yml`, 09:30
  UTC, clear of the 08:00 recall import). The monthly rule lives in one place —
  `marketValueDue` in `services/marketValueSync.ts`, which both the sweep and the routes call —
  so a steady fleet costs roughly *vehicles ÷ 30* calls a night, and a night with nothing due
  costs one query and no vendor calls. The sweep caps itself at 250 calls per run and logs when
  it does; that matters on the first run, when every eligible car falls due at once. The route
  call stays, because it is what prices a car the moment it is added.

### The NHTSA recall mirror

**New, and the biggest change since 8 August.** NHTSA's live recall API answers HTTP 400 for a
model name it does not recognise — with a body that reads `{"Count":0,"Message":"Results
returned successfully"}`, a success shape carrying a failure. That was being recorded as "could
not reach NHTSA", which told owners a federal database was down when it had replied in under a
second, and left the model on a retry ladder re-asking a settled question.

So a recall check now has **three outcomes, not two** — `ok`, `model_not_listed`, `unreachable`
— stored in `model_feed_syncs.outcome` (migration `0020`) and carried all the way to the screen
and the Ask CA facts block.

A 400 is usually recoverable, because it normally means NHTSA files the car under a finer name
than the owner's: a 2014 "F-350" is "F-350 SD" to them. Resolving that needs NHTSA's own
vocabulary, which is why `scripts/importNhtsaRecalls.mts` loads their entire bulk recall
catalogue into two local tables (migration `0019`) and `services/recallMirror.ts` reads it.

Four design points worth keeping:

- **The mirror holds the vocabulary the *recall API* uses.** NHTSA's published model list is a
  different dictionary — it offers "F-350 REGULAR CAB"/"SUPERCAB"/"SUPER CREW", and the recall
  endpoint answers 400 for all three. The bulk files say "F-350 SD" and "F-350 SUPER DUTY", and
  the recall endpoint answers those with 5 and 1 campaigns. This is the dictionary that matches
  the door we knock on.
- **The live API is asked first; the mirror is the fallback.** The API normalises model names
  before answering and the flat file is raw, so a handful of models are filed oddly in the file
  (a 2023 Ariya appears as "redundant ARIYA"). Measured at 57/60 models exact against the API,
  with the three misses off by a single campaign rather than empty.
- **A mirror miss is never an all-clear.** Zero rows in the file may only mean the model is
  spelled differently there, so the lookup answers "don't know" rather than "none", and the
  caller keeps reporting the feed as unreached. Showing "no open recalls" on the strength of a
  name mismatch is the failure this whole feature exists to prevent.
- **Two tables, not one, for size.** Denormalised the catalogue is 268 MB — the same paragraphs
  repeated for every model a campaign names. Split, 169,240 model rows share 26,482 campaigns
  and it is 28 MB. Neither table has an `id`: NHTSA's campaign number is already the identifier,
  and the importer replaces both outright on each run.

### Both pricing vendors are under review

**We are actively looking for alternatives to Open Labor Project and Vehicle Databases.**
Neither is committed to, and the Repair Cost Checker — the only paid feature — depends on both.

**Open Labor Project** labels every figure `estimated`, publishes no rate and no parts, and
ships a catalogue that disagrees with itself on the same job for the same car (§3, gap 5). Good
enough to display a rough duration; not good enough to tell an owner a shop overbilled them by a
specific number of hours, which is where the product wants to go. That claim needs a licensed
book-time source — Mitchell, ALLDATA or MOTOR — and those cost materially more than $49/mo.

**Vehicle Databases** has two structural problems: its monthly allowance is small enough to be
the real limit on the paid tier, and its coverage is a hard gate (no data for the owner's car
means no repairs offered at all). It also publishes no parts itemisation, which is gap 4.

**What a replacement has to preserve.** Both feeds sit behind the shared sync machinery in
`services/modelFeed.ts` with their own client and parser, so swapping either is contained work
rather than a rewrite. Any candidate must keep three properties:

1. **Three outcomes, not two** — "no record for this car" must be distinguishable from "the
   vendor did not answer", or a spent quota silently retracts data we hold.
2. **One call per model, not per repair** — both current feeds return a whole catalogue per
   vehicle in one response, which is what makes a metered plan affordable.
3. **No cross-vehicle substitution** — a vendor that quietly answers with a similar car's
   figures is worse than one that answers with nothing.

---

## 6. Architecture

```
apps/web        React 18 + Vite + Tailwind + shadcn/ui + React Router
apps/api        Express 5 + Drizzle ORM + Postgres
packages/shared Types and validation rules both sides import
```

- **One door to the server.** The browser talks to the API through a single module, the only
  place `fetch` is called. It attaches the Supabase access token to every request.
- **One door to the database.** All queries go through Drizzle in the API. The browser never
  talks to the database directly.
- **Auth is mounted once**, so a new endpoint cannot forget it. Only `/api/health` and
  `/api/auth/config` are public.
- **Shared validation.** What a valid request looks like lives in `packages/shared` and is used
  by both sides, so the rules cannot drift.
- **23 tables defined in `schema.ts`**, in five groups: things you own (car, service records,
  assessments), things about a *model* everyone with that car shares (recalls, complaints,
  pricing), the reference catalogue of repairs, the Ask CA review log, and the NHTSA recall
  mirror. The shared database holds **29** — see §9.
- **Assessments are snapshots.** Running a repair check copies the prices into the assessment.
  Refreshing supplier pricing later never changes what you were shown.
- **Two scheduled jobs, both GitHub Actions**, committed as of 8 August:
  `import-nhtsa-recalls.yml` mirrors NHTSA's catalogue nightly at 08:00 UTC;
  `refresh-market-values.yml` re-prices due cars at 09:30. Neither applies migrations and
  neither is on the request path, so a failed night degrades freshness rather than breaking the
  app. Both need repository secrets to work at all — see §9.

### The endpoints

**Confirmed — 27 in total.**

- `/api/vehicle` — your car, VIN decode, maintenance jobs, recalls and your answers to them,
  photo, known issues
- `/api/service-records` — log, edit, delete service history
- `/api/chat` — Ask CA (POST only; still no GET — the exchange goes to the review log and
  nothing reads it back). The one endpoint that streams its reply
- `/api/assessments` — the Repair Cost Checker (**paywalled**)
- `/api/repairs` — which repairs we can price for your car
- `/api/paywall` — the price on screen, and recording an unlock
- `/api/account` — profile
- `/api/health`, `/api/auth/config` — public

---

## 7. Sign-in

**Confirmed.** Supabase handles sign-in in the browser (email + password, or Google) and hands
back an access token. The API verifies that token itself on every request — signature, expiry,
issuer, audience, and that it carries a valid user id and an email. A validly-signed token from
a *different* Supabase project is rejected. The first time a verified person arrives, a profile
row is created automatically.

---

## 8. The paywall — read this before any user test

The Repair Cost Checker is the only paid feature, and **it takes no money.** The paywall shows a
price; tapping unlock charges nothing, opens the feature permanently, and records the tap. The
tap *is* the data — it measures willingness to pay without building billing.

**Two offers are shown side by side, not one:** an Unlimited subscription and a cheaper
Per-Incident subscription with a separate per-lookup fee for the parts benchmark — because which
shape of pricing people prefer is itself part of what this prototype tests. Both open all three
paid features the same way; the per-incident fee is disclosed on screen but not metered in v1.

Two things make the recorded numbers trustworthy, and both are handled:

- **The price and the chosen offer are stored with the tap**, not looked up later. Change a
  price mid-test and earlier records still mean what they meant.
- **The gate is enforced on the server** (a 402), not just hidden in the UI. A typed URL or a
  stale tab cannot hand someone the feature without a tap.

**⚠️ Both prices are placeholders.** `PAYWALL_ALL_YOU_CAN_EAT_PRICE_CENTS` defaults to
$99.00/year and `PAYWALL_PER_INCIDENT_PRICE_CENTS` to $35.00/year plus a $50.00 per-incident
fee — neither set in `.env`. These are the numbers the entire experiment is denominated in; set
them deliberately before anyone sees them. The API prints both at startup.

**`services/featureCatalog.ts` replaces the `user_features` table.** The Account screen's
Subscription list used to be rows written per-owner at signup; it is now computed from
`users.plan` alone, since every free row was identical and every paid row moved with one
boolean. Migration `0017` drops the table. **Needs checking:** read from the diff, not exercised
by hand against a real Account screen.

---

## 9. What still needs doing

### There is no automated test suite

It was removed deliberately. `npm run typecheck` (every workspace plus `scripts/`) and
`npm run build` are the only automatic checks, and both pass. Nothing verifies behaviour, so the
paywall gate, the per-user data filters and anything reading an outside feed have to be checked
by hand after a change.

Ask CA is the exception, with two read-only checks of its own; both cost model calls.

- **`npm run test:chat`** is the test plan, executable: 46 assertions across validation, access
  control, throttling, the event-stream wire format, reply integrity, the facts block,
  transcript storage and the streaming decoder. Exits non-zero on failure. Its "transcript
  storage" section is the **browser's** `sessionStorage` thread, not the server-side review log
  — nothing yet covers the log. Run it twice, plain and with `ANTHROPIC_API_KEY=`, because the
  canned-reply path is a separate branch that has caught real bugs the configured path did not.
- **`npm run probe:ask`** covers what assertions cannot: the prompt guardrails. It asks the real
  model ten questions built to push at each rule — invent a price, state Honda's schedule,
  confirm a complaint as a fault, give a flat "safe to drive" — and prints the answers. It
  reports rather than asserts, because whether a reply respected a guardrail is a judgement a
  reader makes in a second and a regex gets wrong. Run it after any change to the prompt, the
  model, or the effort and thinking settings.

**And typecheck cannot see the database.** On 8 August a dev-server log showed `column "outcome"
does not exist` thrown on the request path (`routes/vehicle.ts` → `getModelRecalls` →
`readSyncState`) — My Car's recalls section failing for a real request, because code expecting a
column shipped ahead of the migration adding it. `npm run typecheck` was blind to it: drizzle's
schema is TypeScript, so the column existed as far as the compiler was concerned. That gap is
closed, and the lesson stands — confirming migrations against the live database rather than
drizzle's journal is the only check that catches this class of bug.

### ✅ Row-level security — closed on 9 August

**`rls-lockdown.sql` was run against the shared database and verified from both sides.** This
was the top item on this list for three days; it is done.

**What it was.** Supabase serves the same database through a second door — PostgREST, reachable
by anyone holding the anon key, which is public by design because the browser needs it to sign
in. Supabase's stock grants give `anon` and `authenticated` everything, on the assumption that
RLS is what says no. RLS was off on 25 of 29 tables and there were no policies anywhere, so
nothing said no. Every per-user filter in the API was correct and none of it mattered.

**It was confirmed from the open internet, not reasoned about.** Before the fix, a plain `curl`
carrying only the anon key returned real account emails and real VINs:

```
curl "$SUPABASE_URL/rest/v1/users?select=email&limit=3" -H "apikey: $SUPABASE_ANON_KEY" ...
→ [{"email":"alex.rivera@email.com"}, {"email":"dana@example.com"}, {"email":"hweider@gmail.com"}]
```

The same call against `ask_transcripts` returned `[]`, because `0018` had switched RLS on there.
That contrast was the whole fix in one line: the mechanism worked, it was simply switched off
nearly everywhere.

**After: 29 of 29 tables have RLS on, and `anon`/`authenticated` hold zero grants** — on tables,
sequences and routines alike. The same `curl` now returns `42501 permission denied` for `users`,
`vehicles`, `service_records`, `paywall_intents`, `assessments` and `model_recalls`. Row counts
are identical before and after (6 users, 6 vehicles, 10 service records, 4 assessments, 2
paywall intents, 5 transcripts, 169,240 mirror rows) — this granted and revoked privileges, it
touched no data.

**The app is unaffected, checked rather than assumed.** The API connects as `postgres`, whose
`rolbypassrls` is `true`, so RLS is never consulted for any query it runs. Confirmed live after
the change: the API starts clean, `/api/health` returns `{"ok":true}`, `/api/auth/config`
serves, and an unauthenticated `/api/vehicle` returns 401 — an auth refusal, not a database
error.

**Two bugs in the scripts had to be fixed first, and they were the same bug twice:**

- `rls-lockdown.sql` listed `user_features`, dropped by migration `0017`. `alter table` on a
  missing table is an error rather than a no-op, and the script runs in one transaction, so that
  one line had been aborting the entire lockdown. This is why it had never applied.
- `rls-policies.sql` still had the identical fault — a `grant` and a policy on the same dead
  table — so it would have failed the same way. Removed.

`rls-lockdown.sql` also named only 21 tables against a live 29. It now covers all of them: the
two recall-mirror tables, plus the six belonging to the factory-schedule migration line in their
own block, so it stays obvious this branch does not define them. The list was diffed against
`pg_class` before running — an exact match, so it could neither abort on a missing table nor
silently skip a live one.

**`rls-policies.sql` was deliberately NOT run, and should stay unrun for now.** It grants
`select` *back* to `authenticated` so the browser can query PostgREST directly, and there is not
one `.from()` call in `apps/web/src` — it would widen access for a capability nothing uses. Its
own header says as much. It also carries a trap: `users.supabase_user_id` is null for seeded and
dev-stub rows, so those accounts would match `auth.uid()` never and go invisible to browser
queries while still showing in the app. Backfill that column before leaning on it. The lockdown
alone is the complete fix.

**⚠️ Two residual holes, both about tables that do not exist yet.** The lockdown reset the
default privileges for tables created by `postgres`, which is the role drizzle migrations run
as — so a new migration no longer hands `anon` rights on its table. But:

1. **`supabase_admin`'s default privileges still grant `anon` and `authenticated` full rights**,
   and that is the role the Supabase dashboard creates tables as. A table made by clicking
   around in the dashboard arrives exposed.
2. **Postgres has no default for RLS itself.** Every new table needs its own
   `enable row level security` line whatever created it.

So the rule for anything new, and it belongs in review: **a migration that adds a table adds an
`enable row level security` line in the same file.** `0018` and `0019` both already do this.

### The odometer is only half-solved, and the unfixed half is the one that matters

`vehicles.mileage` was written in exactly two places — onboarding and the Account edit dialog —
and nothing ever asked again. For most owners it sat frozen at whatever they typed on signup
day, while three things downstream read it as current: the maintenance due calculation, the
price sent to MarketCheck, and My Car's masthead.

**Fixed: service records now feed the car's mileage.** `services/odometer.ts` raises
`vehicles.mileage` whenever a logged service carries a higher reading, on both the create and
the correct path. The readings were already being typed in and already used for the maintenance
calculation — they were simply never fed back to the car. It is a one-way ratchet that compares
no dates on purpose: an odometer is monotonic, so a higher reading is necessarily the later one,
which is what lets this work without a `mileage_updated_at` column.

**Not fixed, and it is the larger half.** A car that is not serviced is not read either. What is
still needed is to ask the owner directly — a prompt on My Car when the reading is stale,
pre-filled with an estimate they confirm or correct — plus the `mileage_updated_at` column that
would make "stale" answerable at all. **Right now the app cannot tell a reading taken this week
from one typed two years ago**, which is also why the value card cannot say what mileage its
estimate is based on. That column is the prerequisite for both, and it is the next piece of work
here.

Two deliberate omissions, so neither reads as an oversight later. A mileage bump does not clear
`market_value_checked_at`, so the car is not re-priced immediately — the nightly sweep picks it
up within the month rather than spending a vendor call on every service log. And a mistyped
reading now moves the car's mileage rather than one history row; correcting the record will not
walk it back, because the ratchet cannot tell a correction from an older reading. The owner
fixes it in Account, where that number has always been editable.

The obvious thing to reach for is connected-car telematics (Smartcar and similar — OAuth into
the owner's manufacturer account, read the odometer directly). It needs a 2016-or-newer car with
a live connected-services subscription, close to the opposite of this app's audience, so it can
be an opt-in extra but never the mechanism the app relies on.

### State of the database (verified live, read-only, 9 August)

- **29 tables.** 23 are defined by this branch's `schema.ts`; the other six come from a separate
  migration line (below).
- **Migrations `0019` and `0020` are applied**, along with everything before them —
  `nhtsa_recall_campaigns` and `nhtsa_recall_models` both exist, and `model_feed_syncs` carries
  `outcome`. Checked against `information_schema`, not drizzle's journal.
- **The recall import has run against the shared database**: 26,482 campaigns and 169,240 model
  rows.
- **It is already earning its keep.** The 2014 Ford F-350 that NHTSA's API refused by name now
  holds **6 recalls**, resolved through the mirror. The 1993 Chevrolet is correctly recorded as
  `model_not_listed` — NHTSA answered, the name is not one they file under, and the mirror has
  no match either. That is an honest "unknown", not an all-clear, and it no longer looks like an
  outage.
- **Migration `0018` (the Ask CA review log) is applied and working.** `ask_transcripts` holds
  **5 rows, all `outcome = 'answered'`**, written on 8 August. This closes an open question: the
  write path fails silently by design, so an empty log was ambiguous between "nobody asked" and
  "every insert is failing". It is neither.
- Row counts: 6 users, 6 vehicles, 10 service records, 4 assessments, 2 paywall intents.

### A second migration line runs against the same database

The shared database holds six tables this branch does not define — `vehicle_generations`,
`factory_schedule_services`, `factory_schedule_items`, `schedule_review_queue`,
`extraction_runs`, `schedule_requests` — plus two extra columns on `vehicles`
(`factory_generation_id`, `factory_schedule_applied_at`). All six are **empty**.

This is the factory-schedule pipeline: a separate `maintenance` branch that researches
manufacturer service schedules and would eventually fill gap 3. It is not merged, its tables
carry no data, and the only trace of it in this working tree is the untracked
`scripts/maintenance-seed/cache/` output.

**The drift is real and worth a conversation before anyone generates a new migration here:**
drizzle's journal shows **22 migrations applied** against **21 in this branch's
`meta/_journal.json`**. The two lines share one journal and neither knows about the other.

### Uncommitted right now

- **The RLS fixes to `apps/api/sql/rls-lockdown.sql` and `rls-policies.sql`**, and this file. The
  lockdown is already applied to the shared database; the script edits that made it applicable
  are not yet committed.
- `scripts/maintenance-seed/cache/` — untracked output from the other branch, above.

`npm run typecheck` passes across every workspace and `npm run build` succeeds.

### Known placeholders

- **The fair/overpriced verdict is deliberately simple.** It compares the quote to a price range
  and nothing else — no regional labour rates, no history for the specific shop. It also only
  flags quotes that are *too high*; a suspiciously low quote is reported as fair.
- **Quote upload stores the filename only, and nothing reads it back.** There is no PDF or photo
  parsing; you type the total. `assessments.quote_file_name` is written on create and never read
  anywhere, and it is not in the shared domain type, so it never reaches the browser. A dead
  column rather than a half-finished feature — drop it whenever someone is writing a migration
  anyway.
- **`labor_rate_per_hour` is dead too, for a different reason.** Every real code path writes
  `null` on purpose (there is no vendor rate to write); only the demo seed puts a number in. So
  the "Labor Rate … · Est. Time …" line in `LaborBaselineCard` **has never rendered for a real
  car and never will**, until either a rate source appears or the card shows hours alone.

### Two NHTSA data-quality gaps, and where they stand

Both surfaced from real signups rather than from reading code.

**1. NHTSA's VIN decoder and its recall catalogue can name the same car differently — mitigated,
not fixed.** A 1993 truck decoded to model `"GMT-400"`, an internal chassis platform code, while
NHTSA's recall and complaint APIs only know that truck as `"C/K"`, `"C10"`, `"C1500"` and
similar. Queried with `GMT-400`, both feeds return zero results, which on screen is
indistinguishable from a genuinely clean car. Confirmed directly against NHTSA's endpoints.

The mirror does not rescue this one — the name is absent from the bulk files too — but the
answer is now honest: `model_not_listed` rather than "could not be reached". On top of that,
`lib/vehicleAge.ts` flags any vehicle 20 model-years or older (a blunt, deliberately cheap
stand-in — detecting a specific name mismatch would cost a vendor call per car), and
`RecallsList`/`KnownIssuesList` show a caveat beside the list, whether empty or not, pointing at
NHTSA's own VIN lookup as a second check.

**2. NHTSA's recall API failing for one year of a current model — now fixed by the mirror.** A
2014 Ford F-350 returned `HTTP 400` with body `{"Message":"Results returned
successfully","results":[]}` for every spelling tried. The same query for 2010, 2013 and 2018
F-350s, and 2014 heavy trucks from three other manufacturers, all returned real data. The cause
turned out to be vocabulary, not a hole in NHTSA's data: they file that truck as "F-350 SD" and
"F-350 SUPER DUTY", names their own published model list does not offer. The mirror supplies
them, and that car now holds 6 recalls (verified live).

**Needs checking:** whether other year/model gaps like these exist. The mirror should catch most
naming cases automatically now, but the only way one was found before was hitting it by chance
on a real signup.

### Not built, and outside the agreed list

Password reset, account deletion, quote-document parsing, and the "safe to drive" verdict (Ask
CA returns an urgency band but no safe-to-drive answer). None are in the §3 feature list; they
are noted because the README and the original spec mention them.

### Product risks worth naming

- **Coverage is per car**, which gates the whole paid tier — see the end of §3.
- **NHTSA's own data has confirmed gaps that read as "nothing's wrong" unless caveated.** One of
  the two found so far is now fixed by the mirror; the other is caveated. A third, undiscovered
  gap would show as a silent all-clear until someone hits it.
- **The pricing supplier's call allowance is small enough to be the real limit.** Running out
  shows an owner "we couldn't reach our pricing source" on a feature they paid for.
- **Neither pricing vendor is settled** (§5). The paid feature rests on both, so a swap is likely
  before any real launch, and the labour hours are estimates rather than licensed book times in
  the meantime.
- **Deleting an account deletes its paywall taps too.** Export that data before honouring a
  deletion request or the experiment loses the result.
- **Ask CA is throttled per owner**: one answer in flight at a time, 20 questions per five
  minutes, because it is the only endpoint that spends money per request. The counters are in
  memory, so they reset on restart and are per-process — a cost guard, not a security boundary.
  A real deployment wants them in Postgres or Redis.
- **An answer is abandoned after 45 seconds.** Measured answers land around 5 seconds and the
  slowest observed was 17, so the ceiling only fires on a genuine hang; without it the SDK would
  wait ten minutes and retry twice.
- **The Ask CA log holds sensitive data with no expiry** (§4). It is API-only and now sealed
  behind RLS like everything else, but it is still the most sensitive table in the schema and it
  keeps everything forever. Set a retention period.

### Open questions, in one place

1. ~~Apply the RLS lockdown.~~ **Done 9 August** — 29 of 29 tables locked, zero public grants,
   verified from outside. See above. What remains from it: keep an `enable row level security`
   line in every migration that adds a table, and treat a table created through the Supabase
   dashboard as exposed until checked.
2. **Set a retention window for `ask_transcripts`.** Now the top item. Product decision, and
   cheapest to make while the log holds 5 rows.
3. **Set the two paywall prices deliberately** (§8). They are placeholders and the whole
   experiment is denominated in them.
4. **Is `MARKET_CHECK_API_KEY` in the repository's GitHub Actions secrets?** `DATABASE_URL` is
   already there for the recall import, but the market-value sweep needs the vendor key too.
   Without it the sweep exits early naming the cause — chosen over letting it run, because every
   call would return `unavailable` and the log would look like a vendor outage. Until it is set,
   the nightly job does nothing. (Could not be checked here; no `gh` CLI available.)
5. **Has the market-value sweep ever made a real vendor call?** `npm run refresh:values --
   --dry-run` is read-only and was run on 8 August: 6 vehicles, 0 due, a true negative (the
   three eligible cars were priced on 7 August, so they are 29 days off). Re-running the rule
   against future dates confirms the cadence — 0 due at +29 days, 3 at +31, still 3 at +40, and
   the other three never become due because they lack a VIN or zip. But no run from inside the
   workflow has happened. Use `workflow_dispatch` with a small `--limit` for the first one
   rather than waiting for the cron to find out.
6. **Has `db:pricing` been run since `0013` landed?** The migration is applied, but until
   `db:pricing` runs the app serves old invented figures under a real-looking label.
7. **Talk to whoever owns the factory-schedule migration line** before generating a new
   migration here. See "A second migration line" above.
8. **Verify a real Supabase token end to end.** Token verification has never run against one.
   Sign in for real, decode the access token, and confirm the issuer, audience, subject and
   email fields are what the API expects.
9. **Re-check the Ask CA timings on more than one car** (§4), and watch `cacheRead`.
10. **Exercise the Account screen by hand** since `user_features` was dropped (§8).
11. **Price the licensed book-time options and trial a second pricing vendor** for coverage
    against a real list of signup vehicles (§5).
