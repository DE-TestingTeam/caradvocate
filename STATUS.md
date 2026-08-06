# CarAdvocate — what exists today

A plain-language description of the app as the code currently stands.

Everything marked **Confirmed** was read directly in the source. Everything marked
**Needs checking** is something the code cannot tell us — usually a question about the
live environment (has this script been run against the real database?) rather than about
the code.

Last reviewed against the working tree on 6 August 2026.

---

## 1. What the app is

A web app for car owners. It answers two questions:

1. Is this repair actually necessary?
2. Is the price the shop quoted me fair?

It is a prototype, not a live business: the paid feature charges nobody (see §8).

---

## 2. What is built

Six areas of the app, all working end to end. **Confirmed** — each has a route in
`apps/web/src/App.tsx` and a matching API endpoint. The Repair Cost Checker is one row here
but four routes: the list, a new check, a detail view, and the "we can't price your car"
page.

This section is about the screens. It is not a claim that every planned feature behind
them is finished — §3 checks the agreed feature list one by one, and several are not.

| Screen | What it does |
|---|---|
| **Login** | Email + password, or "Continue with Google" |
| **Onboarding** | Add your car, by VIN or by typing the details |
| **My Car** | Recalls, problems other owners report, upkeep schedule, service history, a photo |
| **Ask CA** | The AI chat (see §4) |
| **Repair Cost Checker** | Pick a repair, see a fair price range, paste your quote, get a verdict |
| **Account** | Profile, car details, plan status |

Login is the only public one. Everything else needs sign-in, and the Repair Cost Checker
also needs the paywall tap — see §8.

Behind those screens:

- **Sign-in is mandatory in every environment, including a laptop.** There is no test or
  bypass mode. The API refuses to start if it has no way to verify a token.
- **Every owner only ever sees their own data.** Each user-owned table carries a
  `user_id` and every query filters on it.
- **Outside data is mirrored locally.** Recalls, owner complaints, repair pricing and
  labour hours are fetched once per car model, stored, and re-checked weekly. Pages load
  from our own database, so the app still works when a supplier is down.
- **The API fails loudly at startup**, not on the first request — it exits if the
  database URL is missing, if the tables are absent, or if auth is unconfigured.

---

## 3. Planned scope vs what exists

The agreed feature list, checked line by line against the code. "Built" means a real
person with a real car gets the thing — not that a screen exists or that the demo account
looks right.

| Tier | Feature | Status |
|---|---|---|
| Free / My Car | Single-vehicle profile | ✅ Built |
| Free / My Car | User-entered service history | ✅ Built |
| Free / My Car | Value + trend line | ❌ Screen built, no data |
| Free / My Car | Recall schedule | ✅ Built |
| Free / My Car | Maintenance schedule | ⚠️ Tracker built, starts empty |
| Free / My Car | Model known issues | ✅ Built |
| Free / Ask CA | Q&A + banded severity | ✅ Built, already merged |
| Paid / RCC | Necessity check | ❌ Not implemented |
| Paid / RCC | Parts benchmark | ⚠️ Total only, no itemisation |
| Paid / RCC | Labor baseline | ⚠️ Dollars and time, no rate — and the time barely shows |
| Paid / RCC | Past assessments | ✅ Built |
| Paid / RCC | "Repair complete" writeback | ✅ Built |
| Cut | OBD translation | ✅ Absent, as intended |
| Cut | Advocacy | ✅ Absent, as intended |
| Cut | Post-repair summary | ✅ Absent, as intended |

### The five gaps, in priority order

**1. Necessity check — the paid tier's headline promise, and it is not there.** The
recommendation fields exist and render, but nothing works them out. For a real car,
`services/repairPricingSync.ts` writes the same fixed text for every repair: headline
*"Priced for your car"*, badge *"ASSESSED"*, and a body about comparing quotes to a range.
That is a pricing statement, not a judgement about whether the repair is needed.

The demo Civic reads better only because that copy was typed by hand from the wireframes,
with the answer already in it — `db/fixtures.ts` contains *"At 68,400 miles with reported
grinding, brake pad replacement is recommended."* That sentence is fixed text. It says
"grinding" whatever the owner actually reported, and 68,400 miles whatever their odometer
says. Nothing reads symptoms, mileage, service history or complaint patterns to decide.

This is the one gap where the product claim and the code genuinely disagree, rather than
the feature merely being unfinished — and it is what the paywall sells.

**2. Value + trend line — the screen is finished, the data source does not exist.** The
card and both charts are built and the table is there, but only the demo seed ever writes
a value point. A real signup sees "Not available yet" permanently. Needs a valuation
vendor.

**3. Maintenance schedule — the tracker works, the schedule does not exist.** The
due/overdue calculation is real and careful: mileage or time, whichever comes first, with
a "due soon" margin. But a new owner starts with an empty list and has to type every job
and interval themselves. Manufacturer intervals are licensed data the app does not have.
If "maintenance schedule" is meant to arrive pre-filled, that part is unbuilt.

**4. Parts benchmark — one line rather than a breakdown.** The low/average/high range is
real vendor data. But the sync writes a single row reading "All parts for this repair" set
to the parts total, because the vendor publishes no itemisation. So the parts list renders
with exactly one entry.

**5. Labor baseline — time has arrived, the rate has not, and the screen barely shows
either.** Labor dollars are real. As of 6 August a second vendor, Open Labor Project,
fills labor *hours* per repair per model, so `labor_est_hours` is no longer always empty.
Three caveats, and they matter more than the win:

- **The hourly rate is still missing**, and neither vendor publishes one. It cannot be
  worked out from what we have: dividing the pricing vendor's labor dollars by these hours
  gives a number well outside any real shop rate, which is the same bad arithmetic the code
  has always refused. This is the reason the mock's "$95/hr" has no source.
- **The card needs the rate and the hours together to show anything.** It tests for both,
  so the title stays "Labor Baseline" rather than "OEM Labor & Time Baseline", and the
  "Labor Rate … · Est. Time …" line stays hidden. The hours reach the browser and are
  stored, but the only place they currently appear is the one task-breakdown row, as
  "Shop labor for this repair — 1 hr". **A small front-end change is needed** to show a
  time without a rate; nobody has decided whether to make it.
- **The hours are estimates, not licensed book times.** Every row the vendor returns is
  labelled `estimated` — 1,454 out of 1,454 across the two vehicles checked. The data does
  vary sensibly by engine (spark plugs 0.8 h on an inline-four, 1.5 h on a V6, which is
  right), but its catalogue contradicts itself: front brake pads are listed twice, at 1.0 h
  and 1.5 h, for the same car. So the hours are display-only. **The fair/overpriced verdict
  still runs on dollars alone and must keep doing so** — see §5.

Still missing for the mock: the per-task hour split (four named steps, each with its own
time). The vendor publishes one figure per job, not a decomposition.

### What kind of work each one is

Gaps 2 and 3 are **procurement rather than engineering** — each waits on a data vendor,
and the sync machinery to plug one in already exists and is shared by the recall,
complaint and pricing feeds. Gap 5 is now **half procurement, half a product decision**:
the hours are in, the rate needs either a vendor, a hand-curated regional table, or asking
the owner what their shop charges. Gap 4 is minor and may not be worth solving at all.

**Gap 1 needs a product decision first:** whether necessity is calculated from the mileage,
service history and complaint data already in the database, or answered by Claude the way
Ask CA already answers questions.

### A coverage limit that affects the whole paid tier

If the pricing vendor has nothing for the owner's car, the Repair Cost Checker offers **no
repairs at all**. That is deliberate — substituting another vehicle's figures would produce
confidently wrong verdicts — but it means vendor coverage is a hard gate on the only paid
feature, and nobody has yet measured which cars real signups actually bring.

---

## 4. How the AI chat works

This is the "Ask CA" screen. The short version: **the AI is never asked to remember
anything about the car. Every fact is looked up in our database first and handed to it,
and it is told it may not go beyond them.**

### Step by step

**1. You type a question.** The browser adds your message to the screen immediately and
sends it to the API, together with the conversation so far.

**2. The conversation is held by the browser, not the server.** There is no chat table
and no way to fetch old conversations. This is deliberate — the code comment explains that
saving-and-deleting fails exactly when it matters (a closed tab or a crash skips the cleanup,
and the leftover rows come back as "history"). The last 10 messages are sent with each new
question so follow-ups make sense.

The browser keeps the transcript **for the life of the tab**, so going to My Car to check a
recall and coming back does not throw the thread away. It is held in `sessionStorage`, not
`localStorage`: it survives navigation and a refresh, and the browser drops it when the tab
closes. Signing out clears it too, so the next person to sign in on a shared machine does not
inherit it. Still nothing on the server, and still nothing in the account.

**3. The API checks who you are** and looks up your car.

**4. The API builds a "facts block" about *your* car** from our database. It contains,
each labelled with where it came from:

- The car itself — year, make, model, trim, odometer, whether a VIN is on file
- **Safety recalls** from NHTSA, plus whether *you* have said each one was already fixed
- **What other owners report** — complaints filed with NHTSA for this model, grouped by
  component, with counts, any deaths/injuries/crashes/fires, the mileage range they were
  reported at, and up to two owners' own words
- **Your upkeep schedule** — the intervals you set, and whether each job is due
- **Your service history** — the last 8 things you logged

Each section says what it means when data is missing. For example, if NHTSA could not be
reached, the block literally says *"This is NOT an all-clear."*

**5. The question goes to Claude** (`claude-sonnet-5`) with:

- A fixed set of rules (the system prompt)
- The facts block
- The recent conversation
- Your question

**6. The reply comes back in a fixed shape**, not as free-form prose. The API requires
three fields:

- `text` — the answer
- `urgency` — `low`, `medium`, `high`, or nothing
- `cta` — either "show the Check Repair Costs button" or nothing

**7. The browser renders it** as a chat bubble, plus an urgency banner and a button if
those were set. The button goes to the Repair Cost Checker.

**Each answer shows what it was based on.** A quiet line under the reply — "Based on · Your
2019 Honda Civic · 4 NHTSA recalls for this model · Your last 6 logged services". This is the
grounding claim made visible instead of asked for on trust, and it is built so it cannot lie:
the AI picks only *which kinds* of fact it leaned on, from a fixed list of five, and the app
writes the wording and the counts from the facts it actually assembled. A kind the facts block
did not contain is dropped rather than shown. An answer that drew on nothing — a greeting, or
a question answered from general knowledge — shows no line at all.

**The answer appears as it is written.** The reply streams, so words appear a few at a time
rather than the screen sitting on a typing indicator until the whole answer is ready. What
you see while it is being written is a *preview* and the app throws it away: the finished
reply — the one that went through the checks in the next section — replaces it, and only
that one can carry an urgency banner or the button. Closing the tab mid-answer stops the
request rather than leaving it running.

### What stops it making things up

This is the part the product depends on, and it is enforced in four places rather than
just asked for:

1. **The facts block is the only source.** The AI is told those facts are the only thing
   it knows about the car.
2. **Explicit prohibitions.** Do not invent recalls, part prices, labour times, service
   intervals or resale values. Do not state a manufacturer's maintenance schedule (the
   app does not license that data). Do not diagnose — it cannot see or hear the car. Do
   not turn "we couldn't reach the data source" into "nothing's wrong". Do not repeat an
   owner complaint as an established fault.
3. **The reply shape is enforced by the API**, so `urgency` can only ever be one of three
   values the app knows how to display.
4. **The button's wording is set by our code, not the AI**, so it always matches what the
   app renders.
5. **Streaming does not skip any of that.** The words that appear while the answer is being
   written are unchecked model output, and the app treats them as such — it renders them and
   then discards them when the checked reply arrives. The checks sit on the finished reply,
   not on the stream, so the fast path cannot become the unchecked path.

Three more behaviour rules worth knowing:

- If a recall carries NHTSA's *stop driving* or *park outside* warning and you have not
  said it was repaired, the AI leads with it regardless of what you asked — including if
  all you said was "hi". This is the one thing allowed to interrupt, because the car should
  not be moving.
- Otherwise it raises an unrepaired recall **once per conversation**, and only when actually
  answering a question about the car. Repeating it every time teaches people to ignore it.
- **A greeting gets a greeting.** "Hi" or "thanks" is answered in one line, with no summary
  of the car, no recall list and no urgency banner. Volunteering everything the app knows in
  response to hello buried the facts that mattered under facts nobody asked for.
- **A price question is handed to the Repair Cost Checker, not apologised for.** The chat is
  given no pricing and must not invent a figure, but it used to say so by leading with "I don't
  have pricing data" — true of the chat, and wrong about the app, since pricing a repair against
  real figures is exactly what the paid feature does. It now points at the checker in a sentence
  and shows the button, including when the owner does not yet know which repair they need
  (choosing one is the checker's first step). It still names no number, and it does not promise
  what the checker will say — coverage is per model and not every car is priced.

### When things go wrong

- **No Anthropic API key configured** → the chat falls back to four canned replies that
  cycle. They are obviously generic, and the API prints `Ask CA: canned replies` at
  startup so this is visible.
- **The AI call fails** → you get a sentence saying the question was not answered. It
  does **not** quietly serve a canned reply dressed up as a real one.
- **A safety filter declines the question** → you are told to rephrase.
- **You have no car on file** → that error is deliberately *not* caught, because it is a
  setup problem and "something went wrong reaching the assistant" would hide it.

### Cost and speed

**Confirmed**, and measured against the seeded Civic on a live database rather than reasoned
about. The system prompt and the facts block are both cached, so a follow-up in the same
conversation only pays full price for the new question — confirmed in the logs (7,741 tokens
written on the first turn, read back on every turn after).

**Answers now take about 3 seconds for a greeting and 5–6 seconds for a real question.** Before
this work a real question took a median 15 seconds, and sometimes closer to 20.

Almost all of that came from one setting, and it was not the one we expected:

- **Extended thinking is now off.** Sonnet 5 thinks by default. On a real question that cost a
  median 12.3 seconds before the first word appeared — ranging 5.8 to 16.8 seconds run to run —
  against 3.1 seconds with it off. It also roughly doubled the length of every answer. On a
  greeting it made no difference: it correctly declines to think about "hi".
- **Reasoning effort stays at `medium`.** It was briefly dropped to `low` on the assumption that
  effort was the cost; measurement showed it was not. `medium` is worth keeping because with
  thinking off it grounded its answer in the owner's own recalls, complaints and service history
  in 6 of 6 test runs where `low` managed 5 of 6, for about 180ms.
- **Streaming** does not make an answer faster — it means the owner reads it as it is written
  instead of watching a spinner until all of it is ready.
- **The facts block is built in one round of database queries** instead of three in sequence.
  Roughly 2 seconds of pure waiting on a cold cache, on every message.

The tradeoff is worth naming: thinking did buy *something*. It surfaced the owner's own
complaint and recall data slightly more often, which is why effort went up as thinking went off.
The two are a pair — change one and the other needs re-measuring.

**Needs checking:** all of the above was measured on one car (the seeded 2019 Civic) with a warm
cache, from one location. The shape is not in doubt; the exact numbers will move. Each answer
logs its own duration and token usage (`Ask CA: 1234ms in=… out=… cacheRead=… cacheWrite=…`),
which is the only instrumentation on this path. Watch `cacheRead`: if it stays near zero across
a conversation, the cached prefix is being invalidated and every follow-up is being charged in
full.

---

## 5. Outside services used

| Service | Used for |
|---|---|
| **Supabase** | Sign-in, and the Postgres database |
| **Anthropic (Claude)** | Ask CA answers |
| **NHTSA — recalls** | Safety recalls per model |
| **NHTSA — complaints** | What owners report |
| **NHTSA — vPIC** | Decoding a VIN |
| **CarImages** | Studio photo on My Car |
| **Vehicle Databases** | Real parts and labour pricing |
| **Open Labor Project** | Labour hours per repair |

Which of these need a key, and what happens when one is unset, is in the README's
environment-variable table — the single place that answers it, so the two cannot drift
apart. Only Supabase is required; the API will not start without it.

Notes worth knowing:

- **The AI model is `claude-sonnet-5`.** That is the only place Claude is used in the
  product.
- **The three NHTSA feeds are free and need no key.** When one cannot be reached, the app
  says so rather than implying an all-clear: recalls and owner reports show as "unknown",
  and a failed VIN decode drops the owner back to typing the car's details by hand.
- **Vehicle Databases is metered.** Its monthly call allowance is finite and it returns a
  403 on *every* call once spent. The code deliberately treats "no answer" differently
  from "no record", so a spent quota does not wipe out pricing we already have.
- **Repair pricing is per car model, with no fallback.** If the supplier has nothing for
  your car, the Repair Cost Checker shows you nothing rather than another vehicle's
  prices. That is intentional and documented at length — a Pathfinder judged against
  Civic brake prices sends the owner to argue with a shop that did nothing wrong.
- **The CarImages photo is of the model, not your car**, and the supplier returns a
  generic placeholder for vehicles it doesn't have — indistinguishable from a real photo
  at our end. Nothing in the UI claims otherwise.
- **Open Labor Project is metered far more tightly.** The free tier allows **10 calls per
  day** and returns a 429 once spent. A sync makes at most one call per model per week, so
  the limit caps how many *different* cars can be primed in a day rather than how often one
  car refreshes. As with pricing, "no answer" is treated differently from "no record": an
  outage keeps the hours already stored rather than blanking them. The paid tier is $49/mo
  for 1,000 calls a day.
- **Neither pricing vendor publishes an hourly labour rate**, so the app has none. See §3,
  gap 5.

### Both pricing vendors are under review

**We are actively looking for alternatives to Open Labor Project and Vehicle Databases.**
Neither is committed to, and the Repair Cost Checker — the only paid feature — depends on
both. The reasons differ:

**Open Labor Project** labels every figure it returns `estimated`, publishes no rate and no
parts, and ships a catalogue that disagrees with itself on the same job for the same car
(full detail in §3, gap 5). It is good enough to display a rough duration. It is not good
enough to tell an owner a shop overbilled them by a specific number of hours, which is
where the product eventually wants to go. A licensed book-time source — Mitchell, ALLDATA
or MOTOR — is what that claim would need, and those cost materially more than $49/mo.

**Vehicle Databases** has two problems that are structural rather than fixable. Its monthly
call allowance is small enough to be the real limit on the paid tier (see the risks in §9),
and its coverage is a hard gate: no data for the owner's car means no repairs offered at
all, and nobody has yet measured which cars real signups actually bring. It also publishes
no parts itemisation, which is gap 4 on its own.

**What a replacement has to preserve.** Both feeds sit behind the shared sync machinery in
`services/modelFeed.ts` and each has its own client and parser, so swapping either one is
contained work rather than a rewrite. Any candidate has to keep three properties the
current code depends on:

1. **Three outcomes, not two** — "no record for this car" must be distinguishable from "the
   vendor did not answer", or a spent quota silently retracts data we already hold.
2. **One call per model, not per repair** — both current feeds return a whole catalogue for
   a vehicle in one response, which is what makes a metered plan affordable.
3. **No cross-vehicle substitution** — a vendor that quietly answers with a similar car's
   figures is worse than one that answers with nothing.

**Needs checking:** nobody has yet priced the licensed book-time options or trialled a
second pricing vendor for coverage against a real list of signup vehicles.

---

## 6. Architecture

```
apps/web        React 18 + Vite + Tailwind + shadcn/ui + React Router
apps/api        Express 5 + Drizzle ORM + Postgres
packages/shared Types and validation rules both sides import
```

The shape of it:

- **One door to the server.** The browser talks to the API through a single module, which
  is the only place `fetch` is called. It attaches the Supabase access token to every
  request.
- **One door to the database.** All queries go through Drizzle in the API. The browser
  never talks to the database directly.
- **Auth is mounted once**, so a new endpoint cannot forget it. Only `/api/health` and
  `/api/auth/config` are public.
- **Shared validation.** The rules for what a valid request looks like live in
  `packages/shared` and are used by both sides, so they cannot drift apart.
- **20 database tables**, in three groups: things you own (car, service records,
  assessments), things about a *model* that everyone with that car shares (recalls,
  complaints, pricing), and the reference catalogue of repairs.
- **Assessments are snapshots.** When you run a repair check, the prices are copied into
  the assessment. Refreshing supplier pricing later never changes what you were shown.

### The endpoints

**Confirmed** — 27 in total.

- `/api/vehicle` — your car, VIN decode, maintenance jobs, recalls and your answers to
  them, photo, known issues
- `/api/service-records` — log, edit, delete service history
- `/api/chat` — Ask CA (POST only; nothing is stored, so there is no GET). The one endpoint
  that streams its reply rather than returning it in one piece
- `/api/assessments` — the Repair Cost Checker (**paywalled**)
- `/api/repairs` — which repairs we can price for your car
- `/api/paywall` — the price on screen, and recording an unlock
- `/api/account` — profile
- `/api/health`, `/api/auth/config` — public

---

## 7. Sign-in, in detail

**Confirmed.** Supabase handles sign-in in the browser (email + password, or Google). It
hands back an access token. The API then verifies that token itself on every request —
signature, expiry, who issued it, who it is for, and that it carries a valid user id and
an email address. A validly-signed token from a *different* Supabase project is rejected.

The first time a verified person arrives, a profile row is created for them
automatically.

---

## 8. The paywall — read this before any user test

The Repair Cost Checker is the only paid feature, and **it takes no money.** The paywall
shows a price; tapping unlock charges nothing, opens the feature permanently, and records
the tap. The tap *is* the data — it measures willingness to pay without building billing.

Two things make that number trustworthy, and both are already handled:

- **The price is stored with the tap**, not looked up later. Change the price mid-test and
  earlier records still mean what they meant.
- **The gate is enforced on the server** (a 402 response), not just hidden in the UI. A
  typed URL or a stale tab cannot hand someone the feature without a tap.

**⚠️ The price is currently the placeholder, $14.99/month.** `PAYWALL_PRICE_CENTS` is not
set in `.env`, so the default applies. This is the number the entire experiment is
denominated in — set it deliberately before anyone sees it. The API prints it on every
startup.

---

## 9. What still needs doing

### Needs attention now

**There is no automated test suite.** It was removed deliberately. `npm run typecheck`
(every workspace plus `scripts/`) and `npm run build` are the only automatic checks, and
both pass. Nothing verifies behaviour, so the paywall gate, the per-user data filters and
anything that reads an outside feed have to be checked by hand after a change.

Ask CA is the exception, and has two checks of its own. Both are read-only and both cost model
calls.

`npm run test:chat` is the test plan, executable: 46 assertions across validation, access
control, throttling, the event-stream wire format, reply integrity, the facts block, transcript
storage and the streaming decoder. It exits non-zero on failure. Run it twice — plain, and with
`ANTHROPIC_API_KEY=` — because the canned-reply path is a separate branch and has caught real
bugs the configured path did not. Every case it covers, and every case it deliberately leaves to
a browser, is listed in its header and printed at the end of each run.

`npm run probe:ask` covers what assertions cannot: the prompt guardrails. It asks the real model
ten questions built to push at each rule — invent a price, state Honda's schedule, confirm a
complaint as a fault, give a flat "safe to drive" — and prints the answers. It reports rather
than asserts, because whether a reply respected a guardrail is a judgement a reader makes in a
second and a regex gets wrong. Run it after any change to the prompt, the model, or the effort
and thinking settings.

**A large amount of work is uncommitted.** Roughly 130 changed files, with nothing
committed since "Implement paywall for Repair Cost Checker". Worth committing in pieces
while the reasoning is fresh.

**Migrations are applied on the shared database.** Checked directly on 6 August: `0013`
(year/make/model on `repair_benchmarks`), `0014` (the crash-test table is gone) and `0015`
(`vehicles.maintenance_schedule_checked_at`) are all present. The database reports 17 applied
migrations against the 16 in this branch, and holds four tables this branch does not define
(`extraction_runs`, `factory_schedule_items`, `schedule_review_queue`, `vehicle_generations`),
so **the shared database is ahead of this branch** — someone is deploying migrations from
another one. Worth knowing before generating a new migration here.

**`db:pricing` still has to be run after `0013`.** The migration itself is applied (above),
but until `db:pricing` runs against a database, the app serves old invented figures under a
real-looking label. **Needs checking:** whether it has been run since `0013` landed.

**⚠️ Row-level security is off, and this is now confirmed rather than suspected.** Checked
directly on 6 August: **0 of 26 tables** in the shared database have RLS enabled, and no
policies exist. `apps/api/sql/rls-lockdown.sql` has never been run there.

This is not a theoretical gap. The Supabase anon key is public by design — it ships in the
browser bundle — and with RLS off it is enough to read every table directly, bypassing the API
entirely: `users`, `service_records`, `vehicles`, `paywall_intents`, all of it. The database
currently holds real accounts, not just the seeded demo ones. Every per-user filter in the API
is correct and none of it matters while the second door is open.

Applying `rls-lockdown.sql` and `rls-policies.sql` is the fix, and it needs doing before anyone
outside the team uses this. It is a live-database change that could break reads if the policies
and the API's access pattern disagree, so it wants a deliberate run and a check afterwards
rather than being folded into a code deploy.

### Gaps in the agreed feature list

Covered in full in §3, and not repeated here: the necessity check, the value trend, the
pre-filled maintenance schedule, parts itemisation, and the labour rate plus the front-end
change needed to show the hours we now have.

*(Crash-test safety ratings were removed entirely — see §10.)*

### Known placeholders

**The fair/overpriced verdict is deliberately simple.** It compares the quote to a price
range and nothing else — no regional labour rates, no history for the specific shop. It
also only flags quotes that are *too high*; a suspiciously low quote is reported as fair.

**Quote upload stores the filename only.** There is no PDF or photo parsing — you type
the total yourself.

### Not built, and outside the agreed list

Password reset, account deletion, quote-document parsing, and the "safe to drive" verdict
(Ask CA returns an urgency band but no safe-to-drive answer). None of these are in the
feature list in §3; they are noted because the README and the original spec mention them.

### Product risks worth naming

- **Coverage is per car**, which gates the whole paid tier — see the end of §3.
- **The pricing supplier's call allowance is small enough to be the real limit.** Running
  out shows an owner "we couldn't reach our pricing source" on a feature they paid for.
- **Neither pricing vendor is settled.** Both Vehicle Databases and Open Labor Project are
  under review and alternatives are being looked into — see §5. The paid feature rests on
  both, so a swap is likely before any real launch, and the labour hours are estimates
  rather than licensed book times in the meantime.
- **Deleting an account deletes its paywall taps too.** Export that data before honouring
  a deletion request or the experiment loses the result.
- **Ask CA is throttled per owner**: one answer in flight at a time and 20 questions per five
  minutes, because it is the only endpoint that spends money per request. The counters are held
  in memory, so they reset on restart and are per-process — a cost guard, not a security
  boundary, and a real deployment wants them in Postgres or Redis.
- **An answer is abandoned after 45 seconds.** Measured answers land around 5 seconds and the
  slowest observed was 17, so the ceiling only fires on a genuine hang; without it the SDK would
  wait ten minutes and retry twice.
- **Ask CA conversations are never stored**, which is right for privacy but means there is
  no record of what people actually ask. The browser now keeps a transcript for the life of the
  tab so navigation does not lose it, but nothing reaches the server or the account, so this is
  still true of the business.

### One thing that has never been verified against the real thing

Token verification has never run against a real Supabase token. **Needs checking:** sign
in once for real, decode the access token, and confirm the issuer, audience, subject and
email fields are what the API expects.