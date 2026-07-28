# CarAdvocate — Frontend

Consumer app that tells car owners whether a repair is necessary and whether a shop's
quote is fair. Built from the wireframes in `../` (the eight PNGs one level up).

**This is the frontend only.** It runs entirely on typed mock data — there is no
Express server and no Postgres yet. Every screen is clickable end to end.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

Other scripts:

| Script | What it does |
|---|---|
| `npm run build` | Typecheck, then production build to `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Typecheck + both headless test suites below |
| `npm run test:smoke` | Renders all 7 routes in jsdom, asserts wireframe copy and figures are present, fails on any console error |
| `npm run test:flows` | Drives the two cross-screen flows (mark-complete → service history, create assessment → detail) |

The test suites build through `vite.smoke.config.ts`, which emits a classic IIFE
bundle because jsdom cannot execute `<script type="module">`. That config exists
only for testing; it is not part of the app build.

## Screens

| Route | Screen | Wireframe |
|---|---|---|
| `/my-car` | My Car dashboard | `viewport-mobile.png` |
| `/ask` | Ask CA chat | `viewport-mobile-1.png` |
| `/assessments` | Repair Assessment list | `assessment-list-mobile.png` |
| `/assessments/new` | New Repair Assessment | `new-assessment-mobile.png` |
| `/assessments/:id` | Assessment detail | `viewport-mobile-2.png` (no quote) and `viewport-mobile-3.png` (with quote) |
| `/account` | Account | `Account.png` |

The Repair Completed dialog (`viewport-mobile-4.png`) is a modal, not a route. It
opens from both the list and the detail screen.

Assessment detail is a **single component** that conditionally renders the
quote-dependent pieces. To see both states in the seeded data:

- `/assessments/asm_brake_pad` — with a $320 quote
- `/assessments/asm_timing_belt` — no quote (shows the tip callout instead)

## Where the mock data lives

```
src/mocks/            Fixtures transcribed from the wireframes
src/lib/store.ts      In-memory database seeded from those fixtures
src/lib/api.ts        The only seam the UI talks to — async, ~200-400ms latency
src/lib/useApi.ts     Hook wrapping api calls with loading/error state
src/types/index.ts    Domain contract the backend will implement
```

**Invariant:** nothing imports from `src/mocks/` except `store.ts` and `api.ts`.
Components only ever call `api.ts`. This is enforceable with a grep and worth keeping:

```bash
grep -rn "from '@/mocks" src --include=*.tsx --include=*.ts | grep -v "src/lib/"
```

Mutations (log a service, complete a repair, create an assessment, edit profile)
persist in memory across navigation but reset on page reload.

## Pointing this at a real Express API

Only `src/lib/api.ts` changes. Replace each function body with a `fetch` call and
delete `src/lib/store.ts` and `src/mocks/`. For example:

```ts
// before
export function getVehicle(): Promise<Vehicle> {
  return delay(db.vehicle);
}

// after
export function getVehicle(): Promise<Vehicle> {
  return http<Vehicle>('/api/vehicle');
}
```

Suggested endpoint mapping:

| api.ts function | Endpoint |
|---|---|
| `getVehicle` / `updateVehicle` | `GET` / `PATCH /api/vehicle` |
| `getMaintenance` | `GET /api/vehicle/maintenance` |
| `getKnownIssues` | `GET /api/vehicle/known-issues` |
| `getServiceHistory` / `addServiceRecord` | `GET` / `POST /api/service-records` |
| `listAssessments` / `createAssessment` | `GET` / `POST /api/assessments` |
| `getAssessment` | `GET /api/assessments/:id` |
| `completeAssessment` | `POST /api/assessments/:id/complete` |
| `getRepairCatalog` | `GET /api/repairs` |
| `getChatHistory` / `sendChatMessage` | `GET` / `POST /api/chat` |
| `getAccount` / `updateAccount` | `GET` / `PATCH /api/account` |

Add a Vite dev proxy so relative paths work without CORS:

```ts
// vite.config.ts
server: { proxy: { '/api': 'http://localhost:3000' } }
```

Two behaviors currently faked in the frontend belong on the server once it exists:

- **Quote evaluation.** `buildQuoteEvaluation()` in `api.ts` decides fair vs.
  overpriced by comparing the quote to the benchmark range. Real pricing logic
  should return the verdict and explanation from the backend.
- **Ask CA replies.** `sendChatMessage()` returns a canned reply from
  `src/mocks/askResponses.ts`. Swap for the LLM endpoint; the `ChatMessage` type
  already carries the optional urgency callout and CTA the UI renders.

Also replace `useApi.ts`'s global-invalidation approach with React Query or SWR
once requests are real — per-key caching matters then, and it does not now.

## Decisions worth knowing

**One vehicle fixture.** The wireframes disagree: My Car shows a 2019 Honda Civic
at 68,400 mi, Account shows a 2019 Honda CR-V EX at 48,250 mi. Both screens read
`src/mocks/vehicle.ts` so they cannot drift. It currently holds the Civic — change
it there if the CR-V is correct.

**Completion is not a status.** The wireframes show Timing Belt Inspection badged
`ASSESSED` *and* marked "Repair completed", so the verdict badge and completion are
independent. `Assessment` has an optional `completedAt`; the badge derives from
`quote.verdict`. See `src/lib/assessment.ts`.

**Two conflicting brake-pad ranges.** The Quote Evaluation copy cites $280–$400
while the Fair Total Estimate card reads $360–$660. Both are transcribed as-is
rather than reconciled, since we do not know which the real pricing model produces.

**Only two verdicts.** `FAIR` and `OVERPRICED` are the only ones in the wireframes,
so `QuoteVerdict` has two members. A below-benchmark quote is currently reported as
fair.

**Uploaded quote PDFs are not parsed.** The drop zone captures a filename for
display only. A numeric quote input sits below it (not in the wireframes) because
the detail screen needs an amount.

Anything else with no wireframe — the nav menu contents, the log-service and edit
dialogs, loading skeletons, empty states — is marked with a `NOTE:` comment at the
point of use.

## Stack

React 18 · TypeScript (strict) · Vite · Tailwind CSS 3 · shadcn/ui (Radix
primitives, default neutral theme) · React Router 6 · Recharts · lucide-react

The shadcn primitives in `src/components/ui/` were added as source rather than via
the CLI, so they are yours to edit. Mobile-first: built to the wireframes at 375px,
widening to multi-column at `md:`/`lg:`.
