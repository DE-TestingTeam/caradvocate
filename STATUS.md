# CarAdvocate — what exists today

A plain-language description of the app as the code currently stands.

Everything marked **Confirmed** was read directly in the source. Everything marked
**Needs checking** is something the code cannot tell us — usually a question about the
live environment (has this script been run against the real database?) rather than about
the code.

Last reviewed against the working tree on 7 August 2026. The 6 August pass covered the
whole codebase; this pass re-verified the areas that changed since — vehicle valuation,
the paywall and onboarding restructuring, and two NHTSA data-quality gaps found while
testing real signups — against the source, a live database read, and the vendors
themselves. Sections untouched by that work still reflect the 6 August pass.

**Amended 7–8 August:** Ask CA exchanges are now recorded for quality assurance. This reverses
a standing "nothing is stored" claim that ran through §4, §6 and §9, so those three sections
were rewritten rather than annotated. A schema audit in the same pass found two dead columns
and one live bug in `sql/rls-lockdown.sql`; both are noted where they belong below.
**Migration `0018` was applied to the shared database on 8 August and verified** — see §9.

**Amended again 8 August, and this one changes a claim rather than adding to it.** "Refreshed
monthly" was true of the rule and false of the practice: the valuation only ever refreshed when an
owner opened the app, so the trend chart held one reading per month in which somebody signed in.
A nightly job now sweeps every due car (§3 gap 2, §5, §9). The same pass found that
`vehicles.mileage` — which the valuation *and* the maintenance calculation both read as current —
was written at onboarding and then never again for most owners. Half of that is now fixed and half
is not; both halves are described in §9 under "The odometer is only half-solved". No migration was
needed for any of it.

Also in this pass, and not tracked further because this file covers what the app does rather than
how it looks: primary buttons went from near-black to the brand green (one token, `--primary` in
`index.css`), page subtitles dropped to `text-sm` to match Ask CA's, and `PageHeader` gained an
`action` slot so a page's primary button sits on the title row.

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
| Free / My Car | Value + trend line | ⚠️ Live via MarketCheck, refreshed nightly; needs VIN + zip, priced off a possibly-stale odometer, trade-in range still missing |
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

**2. Value + trend line — resolved as of 7 August, with four real limits left.** MarketCheck
now prices a real car from actual dealer listings (`services/marketCheck.ts`,
`services/marketValueSync.ts`), refreshed monthly. **Amended 8 August:** "refreshed monthly" was
a claim about the rule, not about what happened. `ensureMarketValue` was only reachable from
GET/PATCH `/api/vehicle`, so a car was re-priced when its owner happened to open the app — which
is fine for the number on the card, read at exactly that moment, and wrong for a chart that is
supposed to be six readings a month apart. What it actually held was one point per month in which
somebody signed in; an owner away for the summer came back to a chart missing the summer.
`scripts/refreshMarketValues.mts` now sweeps every due car nightly, so the points land a month
apart whether anyone visits or not. Four things still keep this short of the original ask:

- **Both a VIN and a zip code have to be on file.** MarketCheck's endpoint requires both to
  localize the estimate, and onboarding lets an owner skip either — a car missing one shows
  "not available yet" rather than a number, same as before this vendor existed. Live figure on
  8 August: **3 of the 6 cars on file have both**, two have a VIN but no zip, one has neither.
- **The price is only as current as the odometer we hold**, which for most owners is the figure
  they typed at signup. The call takes `miles`, so a car whose stored mileage is a year stale is
  priced as a car with a year fewer miles on it, and the estimate reads high. Partly fixed on
  8 August; see §9, "The odometer is only half-solved".
- **The trend cannot be backfilled — re-confirmed against MarketCheck's own docs on 8 August,**
  because it is the obvious thing to reach for and the reason is easy to get wrong. The predict
  endpoint takes `api_key`, `vin`, `miles`, `dealer_type`, `zip`, `city`, `state` and
  `is_certified` and **no date parameter of any kind**, so there is nothing to ask "what was this
  worth in March". `/v2/history/car/{vin}` is not the answer either: it returns *listing* records
  (what a dealer was asking while the car sat on a lot), which is empty for the ordinary case of a
  car its owner has driven for years and never listed, and where it is not empty it is a different
  quantity from a predicted value — joining the two would draw a trend that never happened.
  MarketCheck does sell a separate Historical Price API; it is not on this tier and would be a
  commercial conversation, not a code change. The "last 6 mo" line is therefore built going
  forward, one point per month, starting from whenever VIN and zip are both in place.
- **Some vehicles get a conclusive "cannot be estimated," not a retry loop.** MarketCheck
  returns a real HTTP 400 for a VIN old enough to fall outside its training data (a 1993
  truck, confirmed) rather than a price. That is stored as distinct from "vendor
  unreachable, will retry" (`Vehicle.valuationUnavailable`), so the card says so instead of
  perpetually implying a price is still coming. Live on 8 August: **2 of the 3 priceable cars are
  in this state** — checked, no price stored — which is worth reading alongside the standing
  question in `marketCheck.ts` about whether this key carries the VIN-decode entitlement the
  predict endpoint depends on. Two cars out of three is a high rate for a verdict that is supposed
  to describe unusually old vehicles.

**Not sourced yet: the trade-in range.** MarketCheck's percentile data (low/high across
comparable listings) is a Premium-tier feature and the key here is not known to carry it —
`tradeInLow`/`tradeInHigh` stay null for every real car until that is confirmed or upgraded.

**3. Maintenance schedule — the tracker works, the schedule does not exist.** The
due/overdue calculation is real and careful: mileage or time, whichever comes first, with
a "due soon" margin. But a new owner starts with an empty list and has to type every job
and interval themselves. Manufacturer intervals are licensed data the app does not have.
If "maintenance schedule" is meant to arrive pre-filled, that part is unbuilt.

**Amended 8 August:** careful about the wrong thing, as it turns out. The calculation is sound but
its input was not — it reads `vehicles.mileage` as the current odometer, and for most owners that
number had not been touched since signup. A stale figure does not merely look wrong here: it tells
someone a job is fine when it is overdue, which is the one failure mode in this app that can cost
an engine rather than an argument. Partly fixed the same day; see §9.

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

Gap 2 is resolved (see above); gap 3 is still **procurement rather than engineering** —
it waits on a manufacturer-schedule vendor, and the sync machinery to plug one in already
exists and is shared by the recall, complaint and pricing feeds. Gap 5 is now **half
procurement, half a product decision**:
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

**2. The conversation is held by the browser, not the server.** There is no way to fetch an
old conversation — no GET, and no screen that could show one. This is deliberate: the code
comment explains that saving-and-deleting fails exactly when it matters (a closed tab or a
crash skips the cleanup, and the leftover rows come back as "history"). The last 10 messages
are sent with each new question so follow-ups make sense.

The browser keeps the transcript **for the life of the tab**, so going to My Car to check a
recall and coming back does not throw the thread away. It is held in `sessionStorage`, not
`localStorage`: it survives navigation and a refresh, and the browser drops it when the tab
closes. Signing out clears it too, so the next person to sign in on a shared machine does not
inherit it.

**Separately, every exchange is now written down for review** — see the new subsection at the
end of this section. The two are not in tension, and the distinction is the whole design: what
the *owner* sees is still only what their tab is holding, and nothing the server keeps can ever
come back to them as history.

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
- **A price question arrives at the Repair Cost Checker with the form already filled in.** When
  the question is clearly about one of the twelve jobs the checker covers, the button carries
  that repair through and preselects it, and if the owner mentioned what they were quoted
  ("they want $640") that lands in the quote box too. Everything is editable, the button says
  what it is about to open with, and the form says where the values came from. The assistant
  only ever *names* a repair — the API matches that name against the owner's own catalogue and
  supplies the id, so a name it invented prefills nothing rather than selecting the wrong job.
  The quote is only ever the owner's own figure repeated back; the assistant has no pricing and
  never puts an estimate there. A job the checker does not cover gets told so rather than being
  sent to a form that cannot help.
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

### Every exchange is recorded for quality assurance (new, 7–8 August)

**Confirmed in the source, and live: migration `0018` was applied to the shared database on 8
August (§9).** You cannot review the quality of an answer you never kept, so `ask_transcripts`
now stores one row per exchange: the question, the answer as the owner saw it, and enough
context to judge it.

| Recorded | Why it is worth having |
|---|---|
| Question and answer | The review itself. On a failure, the actual sentence shown — not a code |
| `outcome` | `answered`, `canned`, `declined`, `timed_out`, `failed`, `abandoned`. Makes "every answer that failed last week" one query |
| Urgency band and button label | Spots an answer that badged something high-urgency when it should not have |
| Which facts it leaned on | A child table, `ask_transcript_sources`. The difference between right and right by luck |
| Duration and token counts | Previously `console.log` only, so a slow or expensive answer could not be found again |
| How many prior messages | A bad answer on turn one and a bad answer on turn nine are different bugs |
| Which model answered | So changing the model does not make old rows look like they came from the new one |

Three properties are load-bearing, and each one is why this is safe where the old
`chat_messages` table was not:

- **Nothing reads it back.** No GET, no mapper turning a row into a chat message, no screen.
  Migration `0010` dropped `chat_messages` because that table *was* the history the screen
  rendered, kept tidy by a delete-on-exit that a closed tab or crash skipped — so every miss
  resurfaced as turns the owner thought they had left behind. A write-only log cannot do that;
  the worst a stale row does is sit in a review queue.
- **Recording can never cost someone an answer.** The write happens after the reply is on the
  wire, and `services/askTranscripts.ts` swallows its own failures and logs them. A missing
  transcript is a gap in a review queue; a 500 on a delivered answer would be a real fault.
- **Failures are recorded too**, including `abandoned` when the owner closes the tab mid-answer.
  That row carries no answer — there was none — but a climbing abandoned rate is the clearest
  signal available that answers are too slow.

**What is deliberately not stored: the facts block that grounded the answer.** It runs to
kilobytes per exchange and is mostly reference data the database still holds, so the source rows
record *which* blocks were used instead. A reviewer who needs a block's exact wording rebuilds it
from the transcript's `vehicle_id`. Storing the full prompt is a small change if the review turns
out to need it, at a large storage cost.

**⚠️ This is personal data, and one decision is outstanding.** Owners describe their cars, their
money and sometimes themselves. Two things are handled: rows cascade with the user, so deleting
an account takes its transcripts, and the tables are deliberately excluded from
`sql/rls-policies.sql` so no browser key can ever read them. **What does not exist yet is a
retention window** — transcripts currently live forever. 90 days is a reasonable default, but the
number is a product decision nobody has made. Decide it before the log has anything real in it.

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
| **MarketCheck** | Market value estimate on My Car |

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
- **MarketCheck needs a VIN and a zip code on every call**, and is asked at most once a
  month per car rather than once ever — a price moves with mileage and the market, unlike a
  fixed factory schedule. Same three-outcome discipline as the other vendors: a price, a
  conclusive "cannot decode this VIN" (cached, so a car that will never price is not
  re-asked every visit — see §3, gap 2), or an outage that is retried rather than
  remembered.
- **MarketCheck is now asked by a nightly job, not by a page load** (`refresh-market-values.yml`,
  daily at 09:30 UTC, clear of the 08:00 recall import). The monthly rule is unchanged and still
  lives in one place — `marketValueDue` in `services/marketValueSync.ts`, which both the sweep and
  the routes call — so a steady fleet costs roughly *vehicles ÷ 30* calls a night rather than one
  per car per night, and a night with nothing due costs one query and no vendor calls. The sweep
  caps itself at 250 calls per run and says so in the log when it does; that matters on the first
  run, when every eligible car falls due at once. The route call stays, because it is what prices a
  car the moment it is added instead of leaving it blank until the next sweep.

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
- **21 database tables**, in four groups: things you own (car, service records,
  assessments), things about a *model* that everyone with that car shares (recalls,
  complaints, pricing), the reference catalogue of repairs, and — new on 7 August — the Ask
  CA review log, which belongs to nobody's screen. (The count was wrong before this pass, not
  just out of date: it read 20 when `user_features` had already gone in `0017`, leaving 19.
  Migration `0018` adds two.)
- **Assessments are snapshots.** When you run a repair check, the prices are copied into
  the assessment. Refreshing supplier pricing later never changes what you were shown.
- **Two things run on a schedule, both as GitHub Actions**, and neither is committed yet — the
  whole `.github/` directory is still untracked as of 8 August. `import-nhtsa-recalls.yml` mirrors
  NHTSA's recall catalogue nightly at 08:00 UTC; that one belongs to the recall-mirror work in
  flight alongside this (`services/recallMirror.ts`, migration `0019`), which is not described in
  this file yet and needs its own pass. `refresh-market-values.yml` re-prices due cars at 09:30
  UTC. Neither applies migrations and neither is on the request path, so a failed night degrades
  freshness rather than breaking the app. Both need repository secrets to work at all — see §9.

### The endpoints

**Confirmed** — 27 in total.

- `/api/vehicle` — your car, VIN decode, maintenance jobs, recalls and your answers to
  them, photo, known issues
- `/api/service-records` — log, edit, delete service history
- `/api/chat` — Ask CA (POST only. There is still no GET: the exchange is written to the
  review log, and nothing can read it back out). The one endpoint that streams its reply
  rather than returning it in one piece
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

**As of the merge folded in on 7 August, two offers are shown side by side, not one.** An
Unlimited subscription and a cheaper Per-Incident subscription with a separate per-lookup
fee for the parts benchmark — because which shape of pricing people prefer is itself part
of what this prototype is testing. Both open all three paid features the same way; the
per-incident fee is disclosed on screen but not actually metered yet in v1.

Two things make the recorded numbers trustworthy, and both are already handled:

- **The price and which offer was chosen are stored with the tap**, not looked up later.
  Change either price mid-test and earlier records still mean what they meant.
- **The gate is enforced on the server** (a 402 response), not just hidden in the UI. A
  typed URL or a stale tab cannot hand someone the feature without a tap.

**⚠️ Both prices are currently placeholders.** `PAYWALL_ALL_YOU_CAN_EAT_PRICE_CENTS`
defaults to $99.00/year and `PAYWALL_PER_INCIDENT_PRICE_CENTS` to $35.00/year plus a
$50.00 per-incident fee — none set in `.env`. These are the numbers the entire experiment
is denominated in — set them deliberately before anyone sees them. The API prints both on
every startup.

**Also new: `services/featureCatalog.ts` replaces the `user_features` table.** The
Account screen's Subscription list used to be rows written per-owner at signup
(`provisionUser.ts`); it is now computed from `users.plan` alone, since every free row was
identical for everyone and every paid row moved with one boolean anyway. Migration `0017`
drops `user_features` entirely. **Needs checking:** this was read from the diff and the new
service, not exercised by hand against a real Account screen since the merge.

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
storage and the streaming decoder. It exits non-zero on failure. Its "transcript storage"
section is the **browser's** `sessionStorage` thread, not the new server-side review log — the
word now means two different things, and nothing yet covers the log. **Needs checking:** the
46 assertions still pass unchanged (nothing in them asserted that the server stores nothing),
but that was read from the source rather than run, since the suite costs model calls. Run it twice — plain, and with
`ANTHROPIC_API_KEY=` — because the canned-reply path is a separate branch and has caught real
bugs the configured path did not. Every case it covers, and every case it deliberately leaves to
a browser, is listed in its header and printed at the end of each run.

`npm run probe:ask` covers what assertions cannot: the prompt guardrails. It asks the real model
ten questions built to push at each rule — invent a price, state Honda's schedule, confirm a
complaint as a fault, give a flat "safe to drive" — and prints the answers. It reports rather
than asserts, because whether a reply respected a guardrail is a judgement a reader makes in a
second and a regex gets wrong. Run it after any change to the prompt, the model, or the effort
and thinking settings.

**The odometer is only half-solved, and the unfixed half is the one that matters.** Found 8
August: `vehicles.mileage` was written in exactly two places — onboarding and the Account edit
dialog — and nothing ever asked again. For most owners it therefore sat frozen at whatever they
typed the day they signed up, while three things downstream read it as current: the maintenance
due calculation (§3, gap 3), the price sent to MarketCheck (§3, gap 2), and My Car's masthead.

Fixed the same day: **service records now feed the car's mileage.**
`services/odometer.ts` raises `vehicles.mileage` whenever a logged service carries a higher
reading, on both the create and the correct path. The readings were already being typed into
`LogServiceDialog` and already used for the maintenance calculation — they simply were never fed
back to the car itself. It is a one-way ratchet, and deliberately compares no dates: an odometer is
monotonic, so a higher reading is necessarily the later one, which is what lets this work without a
`mileage_updated_at` column to compare against.

**Not fixed, and it is the larger half.** A car that is not serviced is not read either, so this
closes the free half of the gap and not the whole one. What is still needed is to ask the owner
directly — a prompt on My Car when the reading is stale, pre-filled with an estimate the owner
confirms or corrects, plus the `mileage_updated_at` column that would make "stale" answerable at
all. **Right now the app cannot tell a reading taken this week from one typed two years ago**, which
is also why the value card cannot say what mileage its estimate is based on. That column is the
prerequisite for both, and it is the next piece of work here.

Worth recording, since it is the obvious thing to reach for: the only true automation for this is
connected-car telematics (Smartcar and similar — OAuth into the owner's manufacturer account, read
the odometer directly). It needs a 2016-or-newer car with a live connected-services subscription,
which is close to the opposite of this app's audience, so it can be an opt-in extra for some users
and never the mechanism the app relies on.

**Two deliberate omissions in the fix, so neither reads as an oversight later.** A mileage bump does
not clear `market_value_checked_at`, so the car is not re-priced immediately — the nightly sweep
picks it up within the month, rather than spending a vendor call on every service log. And a
mistyped reading now moves the car's mileage rather than just one history row; correcting the record
will not walk it back, because the ratchet cannot tell a correction from an older reading. The owner
fixes it in Account, where that number has always been editable.

**The 6 August backlog has landed.** The `mycar` branch (valuation, paywall, onboarding
rework) merged into `develop` on 7 August. What is uncommitted now is small and specific:
this pass's NHTSA edge-case fixes (`marketCheck.ts`'s third outcome, the age caveat and
VIN-lookup fallback links in `RecallsList`/`KnownIssuesList`), the Ask CA review log
(`schema.ts`, `services/askTranscripts.ts`, `routes/chat.ts`, migration `0018`, and the
`rls-lockdown.sql` fix), the 8 August odometer and nightly-sweep work above
(`services/odometer.ts`, `routes/serviceRecords.ts`, `services/marketValueSync.ts`,
`scripts/refreshMarketValues.mts`, `.github/workflows/refresh-market-values.yml`), the My Car
layout and button-colour changes, and this file. `npm run typecheck` passes across every workspace
and `npm run build` succeeds.

**It is no longer small, and one piece of it is undescribed.** Also uncommitted on 8 August: a
local mirror of NHTSA's recall catalogue — `services/recallMirror.ts`,
`scripts/importNhtsaRecalls.mts`, `.github/workflows/import-nhtsa-recalls.yml`, new tables in
`schema.ts`, and **migration `0019`, which is written but not applied to the shared database.**
That work is not covered anywhere in this file and was not reviewed in this pass; §2, §5 and the
migration list in this section all need updating for it. Flagged rather than described, because
guessing at what it does from the diff is how this file would start being wrong. Note that the
migration list above stops at `0018` for that reason, not because `0019` does not exist.

**Needs checking: `MARKET_CHECK_API_KEY` has to be added to the repository's GitHub Actions
secrets.** `DATABASE_URL` is already there for the recall import, but the new workflow needs the
vendor key as well. Without it the sweep exits early with a message naming the cause — chosen over
letting it run, because every call would return `unavailable` and the log would look like a vendor
outage rather than a missing secret. Until the secret is set, the nightly job does nothing.

**How much of the sweep is confirmed, and how.** `npm run refresh:values -- --dry-run` is
read-only — one query, no vendor calls, no writes — and it was run against the shared database on
8 August: 6 vehicles on file, 0 due, which is a true negative rather than an empty filter (the
three eligible cars were priced on 7 August, so they are 29 days off). Re-running the same
`marketValueDue` rule against future dates confirms the cadence: 0 due at +29 days, 3 at +31, and
still 3 at +40 — the other three never become due, correctly, because they are the cars missing a
VIN or a zip. **Not confirmed:** an actual vendor call from inside the workflow, since nothing is
due for another month and no run has happened yet. Use `workflow_dispatch` with a small `--limit`
for the first real run rather than waiting for the cron to find out.

**Migration `0018` (the Ask CA review log) is applied — run and verified directly on 8
August.** Both tables exist with the intended columns, all three foreign keys cascade as
designed, and RLS is on for both. The public schema went from 25 tables to 27, and the row
counts of every existing table were checked before and after and are unchanged (6 users, 6
vehicles, 9 service records, 3 assessments, 2 paywall intents). `ask_transcripts` is at 0 rows,
as expected — nothing has been asked since.

**Needs checking:** that a real question actually lands a row. The write path has not been
exercised against the live tables yet, and it is designed to fail silently
(`services/askTranscripts.ts` catches its own errors so a QA write can never cost an owner an
answer). So an empty log is genuinely ambiguous: it looks the same whether nobody asked
anything or every insert is failing. Ask one question through the UI and confirm the row
appears, once, before trusting the emptiness.

**Migrations `0016` and `0017` are applied on the shared database — checked directly on 7
August**, not inferred: `pricing_model` exists on both `users` and `paywall_intents`,
`user_features` is gone, and `vehicles.zip` / `vehicles.market_value_checked_at` both
exist and hold real data for at least one live account. `0013`–`0015` were confirmed on 6
August and nothing since has touched them. **Still true and still worth knowing:** the
shared database holds tables this branch does not define — **checked directly on 7
August, and it is now six, not four**: the same `extraction_runs`,
`factory_schedule_items`, `schedule_review_queue` and `vehicle_generations` from 6 August,
plus `factory_schedule_services` and `schedule_requests`. Someone is actively deploying a
separate migration line against this database (the factory-schedule pipeline mentioned
nowhere else in this file) — worth a direct conversation before anyone here generates a
new migration, since drizzle's own journal has no idea that line exists.

**`db:pricing` still has to be run after `0013`.** The migration itself is applied (above),
but until `db:pricing` runs against a database, the app serves old invented figures under a
real-looking label. **Needs checking:** whether it has been run since `0013` landed.

**⚠️ Row-level security is off on everything except the two newest tables.** Re-checked
directly on 8 August, after `0018`: **2 of 27 tables** in the shared database have RLS enabled,
and those two are `ask_transcripts` and `ask_transcript_sources`, which `0018` switched on
itself. The other 25 are open, and no policies exist anywhere.
`apps/api/sql/rls-lockdown.sql` has still never been run. (The 6 August reading was 0 of 26;
the table count moved because `0017` dropped `user_features` and `0018` added two.)

**And the lockdown script would have failed if anyone had tried.** Found in this pass, now
fixed: it still listed `user_features`, which migration `0017` dropped. `alter table` on a
missing table is an error rather than a no-op, and the script runs inside one transaction, so
that single line aborted the entire lockdown — every table left open. If anyone believes they
have already run this, they have not; check for RLS directly rather than trusting the memory of
a run.

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

Covered in full in §3, and not repeated here: the necessity check, the pre-filled
maintenance schedule, parts itemisation, and the labour rate plus the front-end change
needed to show the hours we now have. (The value trend is no longer one of these — see §3,
gap 2 — though the trade-in range within it still is.)

*(Crash-test safety ratings were removed entirely — see §10.)*

### Known placeholders

**The fair/overpriced verdict is deliberately simple.** It compares the quote to a price
range and nothing else — no regional labour rates, no history for the specific shop. It
also only flags quotes that are *too high*; a suspiciously low quote is reported as fair.

**Quote upload stores the filename only — and nothing ever reads it back.** There is no PDF or
photo parsing; you type the total yourself. Found in this pass: `assessments.quote_file_name` is
written when an assessment is created and then never read anywhere. It is not in the shared
domain type, so it never even reaches the browser. It is a dead column rather than a
half-finished feature, and can be dropped whenever someone is writing a migration anyway.

**`labor_rate_per_hour` is dead in the database too, for a different reason.** Every real code
path writes `null` on purpose (there is no vendor rate to write — §3, gap 5); only the demo seed
puts a number in. The consequence is worth stating plainly because it is invisible otherwise:
the "Labor Rate … · Est. Time …" line in `LaborBaselineCard` is gated on that value, so **it has
never rendered for a real car and never will** until either a rate source appears or the card is
changed to show hours alone.

### Two NHTSA data-quality gaps, found testing real signups (7 August)

Both surfaced from actual new accounts, not from reading the code, and both are now
mitigated in the UI rather than fixed — because neither one is ours to fix.

**1. NHTSA's own VIN decoder and its own recall/complaint catalog can name the same car
differently.** A 1993 truck decoded to model `"GMT-400"` — an internal chassis platform
code — while NHTSA's recall and complaint APIs only recognize that same truck under
`"C/K"`, `"C10"`, `"C1500"` and similar. Queried with `GMT-400`, both feeds correctly
return zero results, which is indistinguishable on screen from a genuinely clean car.
Confirmed directly against NHTSA's endpoints, not assumed.

Mitigation: `lib/vehicleAge.ts` flags any vehicle 20 model-years or older (a blunt,
deliberately cheap stand-in — there is no way to detect a specific name mismatch without an
extra vendor call per car) and `RecallsList`/`KnownIssuesList` show a caveat beside the
list, whether it is empty or not, pointing at NHTSA's own VIN lookup as a second check.

**2. NHTSA's recall/complaint API can fail for one specific year of an otherwise normal,
current model — with a response shaped like success.** A 2014 Ford F-350 returned
`HTTP 400` with body `{"Message":"Results returned successfully","results":[]}` for every
spelling tried, including NHTSA's own cataloged cab-configuration names. The same query
against 2010, 2013 and 2018 F-350s, and 2014 heavy trucks from three other manufacturers,
all returned real data. This is a narrow gap in NHTSA's own database for that exact
year/make/model — not a naming issue, not something any request-shape change fixes, and
not something the app's retry logic can route around, since `model_feed_syncs` already
correctly records this as "attempted, not succeeded" rather than caching a false
all-clear. It will keep retrying on the standard cooldown, and will keep failing until
NHTSA's own data changes.

Mitigation: both list components now offer NHTSA's own VIN or model lookup as an
immediate alternative whenever the feed itself has not succeeded, not only once the
vehicle turns out to be old — that page queries NHTSA's manufacturer-fed system directly
and is not subject to whatever is wrong with `recallsByVehicle` for this one row.

**Needs checking:** whether other narrow year/model gaps like the second one exist for
common trucks and vans, since the only way found so far was hitting one by chance on a
real signup.

### Not built, and outside the agreed list

Password reset, account deletion, quote-document parsing, and the "safe to drive" verdict
(Ask CA returns an urgency band but no safe-to-drive answer). None of these are in the
feature list in §3; they are noted because the README and the original spec mention them.

### Product risks worth naming

- **Coverage is per car**, which gates the whole paid tier — see the end of §3.
- **NHTSA's own data has real, confirmed gaps that read as "nothing's wrong" unless
  caveated.** Two distinct ones found so far, both in §9 — an old vehicle whose model name
  doesn't match NHTSA's own catalog, and a specific 2014 Ford truck line NHTSA's API fails
  for outright. Both are now caveated in the UI rather than fixed, since neither is fixable
  on our end; a third, undiscovered gap would show as a silent all-clear until someone
  hits it.
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
- **Ask CA exchanges are now recorded, and the risk has inverted.** This used to read "never
  stored, so there is no record of what people actually ask" — that gap is closed (§4), and the
  new exposure is the opposite one: the database will hold what owners typed about their cars,
  their money and sometimes themselves, with no retention window and no expiry. It is
  API-only and excluded from the browser-readable policies, but it is the most sensitive table
  in the schema and it currently keeps everything forever. Set a retention period.
- **The review log makes the RLS gap above worse, not merely unchanged.** While the second
  door is open, "the anon key can read every table" now includes people's chat transcripts.
  Applying `rls-lockdown.sql` was already the top item; this raises what it costs to skip.

### One thing that has never been verified against the real thing

Token verification has never run against a real Supabase token. **Needs checking:** sign
in once for real, decode the access token, and confirm the issuer, audience, subject and
email fields are what the API expects.