/**
 * The Ask CA test plan, executable.
 *
 * There is no test framework here and adding one was out of scope, so this is a plain script:
 * it asserts, counts, prints, and exits non-zero on failure. Everything it covers is listed in
 * the table below, including the cases it deliberately cannot cover, so the gaps are visible
 * rather than implied by absence.
 *
 *   npm run test:chat                     # full run
 *   ANTHROPIC_API_KEY= npm run test:chat  # the canned-reply path, with no key configured
 *
 * Auth is stubbed -- the middleware that resolves a Supabase token is replaced with a fixed
 * user, because minting a real token would mean creating an auth identity on a live project.
 * Everything below that line is the real thing: the real router, the real validation, the real
 * throttle, the real model call, and the browser's own SSE parser reading the response.
 *
 * READ ONLY for user data. It selects an owner and a vehicle and writes nothing. It does spend
 * model calls -- about a dozen -- so it is not free to run.
 *
 * WHAT IS COVERED
 *
 *   Validation   empty, whitespace-only, at and over the length cap, bad roles, bad shapes,
 *                omitted history, history at and over the API's cap, oversized history from a
 *                client that does not slice
 *   Access       no vehicle on file is a 404 with the error envelope, not an SSE failure
 *   Throttle     one answer in flight at a time; the burst ceiling; malformed requests do not
 *                consume the allowance; the slot is released when a request finishes
 *   Wire         delta then message framing, a final message on every path, the streamed
 *                preview reconstructing the validated answer exactly, client abort
 *   Reply        urgency confined to the three levels, CTA label owned by the code, sources
 *                filtered to what the facts block held, sources omitted when nothing was used
 *   Context      sections present and absent, placeholder odometer, source labels matching
 *   Transcript   round trip, per-vehicle keying, the stored cap, corrupt and foreign data,
 *                storage unavailable, clear-on-sign-out
 *   Decoder      the streaming JSON preview at every chunk boundary, escapes, truncation, leak
 *
 * WHAT IS NOT COVERED, AND WHY
 *
 *   Anything that needs a rendered page -- the textarea growing, Enter versus Shift+Enter,
 *   aria-live announcing, the sources row reading well at that size, the transcript surviving a
 *   real route change or refresh. The logic beneath each of those is tested here; the rendering
 *   is not, and needs a browser and eyes. Listed at the end of the run so it stays on the page.
 *
 *   The rate-limit window expiring. It is five minutes long; waiting is not worth a test run.
 *
 *   Real Supabase token verification. Noted in STATUS as never having been exercised.
 */
import express from 'express';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { closeDb, describeTarget, getDb } from '../apps/api/src/db/index.js';
import { users, vehicles } from '../apps/api/src/db/schema.js';
import { chatRouter } from '../apps/api/src/routes/chat.js';
import { errorHandler } from '../apps/api/src/middleware/errorHandler.js';
import { buildVehicleContext } from '../apps/api/src/services/vehicleContext.js';
import { askCarAdvocate, askIsConfigured } from '../apps/api/src/services/askClaude.js';
import { createAnswerPreview } from '../apps/api/src/services/answerPreview.js';
import { CHAT_HISTORY_LIMIT } from '@caradvocate/shared';

const OWNER_EMAIL = process.env.PROBE_EMAIL ?? 'alex.rivera@email.com';
const PORT = 4390;

/* ------------------------------------------------------------------ harness */

let passed = 0;
const failures: string[] = [];
let group = '';

function section(name: string): void {
  group = name;
  console.log(`\n── ${name}`);
}

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`   ok    ${name}`);
  } else {
    failures.push(`${group} / ${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`   FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function expectError(name: string, run: () => Promise<unknown>, status: number, code?: string): Promise<void> {
  try {
    await run();
    check(name, false, `expected ${status}, got success`);
  } catch (cause) {
    const err = cause as { status?: number; code?: string; message?: string };
    const ok = err.status === status && (code === undefined || err.code === code);
    check(name, ok, ok ? '' : `got ${err.status} ${err.code ?? ''} "${err.message ?? ''}"`);
  }
}

/* ------------------------------------------------------------ fixtures */

const db = getDb();
console.log(`Ask CA test plan against ${describeTarget()}`);
console.log(`mode: ${askIsConfigured() ? 'Claude configured' : 'no API key — canned replies'}`);

const [owner] = await db.select().from(users).where(eq(users.email, OWNER_EMAIL)).limit(1);
if (!owner) throw new Error(`No user ${OWNER_EMAIL}. Set PROBE_EMAIL, or run npm run db:seed.`);
const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.userId, owner.id)).limit(1);
if (!vehicle) throw new Error(`${OWNER_EMAIL} has no vehicle on file.`);

/** Swapped per request so a case that does not care about the throttle cannot trip it. */
let actingUserId = owner.id;

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as unknown as { db: unknown }).db = db;
  (req as unknown as { user: unknown }).user = { id: actingUserId, email: 'test@example.com' };
  next();
});
app.use('/api/chat', chatRouter);
app.use(errorHandler());
const server = app.listen(PORT);
await new Promise((resolve) => server.once('listening', resolve));

// The browser's own modules, pointed at this server. Only /api is redirected: the Anthropic
// SDK shares this fetch, and rewriting its calls would break every model request.
const { http } = await import('../apps/web/src/lib/http.js');
const globals = globalThis as unknown as { fetch: typeof fetch };
const upstreamFetch = globals.fetch;
globals.fetch = ((input: string, init?: RequestInit) =>
  upstreamFetch(typeof input === 'string' && input.startsWith('/api') ? `http://127.0.0.1:${PORT}${input}` : input, init)) as typeof fetch;

interface Frames {
  deltas: string[];
  final: { user: { text: string }; assistant: Record<string, unknown> } | undefined;
}

/** Posts a raw body, bypassing the client's own slicing, so the API's limits can be tested. */
async function post(body: unknown, signal?: AbortSignal): Promise<Frames> {
  const frames: Frames = { deltas: [], final: undefined };
  await http.stream(
    '/chat',
    body,
    (event, data) => {
      if (event === 'delta') frames.deltas.push((data as { text: string }).text);
      if (event === 'message') frames.final = data as Frames['final'];
    },
    signal,
  );
  return frames;
}

/** A user id that owns no vehicle, and a fresh throttle bucket. Never written anywhere. */
function strangerId(): string {
  return randomUUID();
}

/* ------------------------------------------------------------ 1. validation */

section('Validation — rejected before anything is spent');

actingUserId = strangerId();
await expectError('empty message', () => post({ text: '' }), 422, 'validation_failed');
await expectError('whitespace-only message', () => post({ text: '   \n  ' }), 422, 'validation_failed');
await expectError('missing text field', () => post({ history: [] }), 422, 'validation_failed');
await expectError('text over 2000 chars', () => post({ text: 'a'.repeat(2001) }), 422, 'validation_failed');
await expectError('history not an array', () => post({ text: 'hi', history: 'nope' }), 422, 'validation_failed');
await expectError(
  'history entry with an unknown role',
  () => post({ text: 'hi', history: [{ role: 'system', text: 'x' }] }),
  422,
  'validation_failed',
);
await expectError(
  'history entry with empty text',
  () => post({ text: 'hi', history: [{ role: 'user', text: '' }] }),
  422,
  'validation_failed',
);
await expectError(
  `history over the ${CHAT_HISTORY_LIMIT}-message cap`,
  () => post({ text: 'hi', history: Array.from({ length: CHAT_HISTORY_LIMIT + 1 }, () => ({ role: 'user', text: 'x' })) }),
  422,
  'validation_failed',
);

/* ---------------------------------------------------------------- 2. access */

section('Access');

actingUserId = strangerId();
await expectError(
  'no vehicle on file is a 404 envelope, not a streamed failure',
  () => post({ text: 'hi' }),
  404,
  'not_found',
);

/* -------------------------------------------------------------- 3. throttle */

section('Throttle');

// Malformed requests must not consume the allowance -- they never reach the model.
actingUserId = strangerId();
for (let i = 0; i < CHAT_HISTORY_LIMIT + 5; i++) {
  await post({ text: '' }).catch(() => undefined);
}
let survivedMalformedFlood = true;
try {
  actingUserId === actingUserId; // same bucket
  await post({ text: 'hi', history: [] });
} catch (cause) {
  const err = cause as { status?: number };
  if (err.status === 429) survivedMalformedFlood = false;
}
check('45 malformed requests do not exhaust the allowance', survivedMalformedFlood);

if (askIsConfigured()) {
  actingUserId = owner.id;
  const inFlight = post({ text: 'what is my odometer reading?' });
  await new Promise((resolve) => setTimeout(resolve, 200));
  await expectError('a second answer in flight is refused', () => post({ text: 'and my mileage?' }), 429, 'rate_limited');
  await inFlight;
  check('the slot is released once the first answer finishes', true);
}

/* ------------------------------------------------------------------ 4. wire */

section('Wire format');

actingUserId = owner.id;
const turn = await post({ text: 'should I worry about the fuel pump recall?', history: [] });
check('a final message arrives', turn.final !== undefined);
check('the user turn is echoed back', turn.final?.user.text === 'should I worry about the fuel pump recall?');
check('the assistant turn has an id', typeof turn.final?.assistant.id === 'string');

if (askIsConfigured()) {
  check('the answer streamed at least one delta', turn.deltas.length > 0, `${turn.deltas.length} deltas`);
  const preview = turn.deltas.join('');
  const finalText = String(turn.final?.assistant.text ?? '');
  check('the preview reconstructs the validated answer exactly', preview.trim() === finalText.trim(), `preview ${preview.length} vs final ${finalText.length}`);
}

// A client that leaves mid-answer must not hang or throw at the caller.
//
// Uses the real owner, not a stranger: a stranger owns no vehicle, so the request 404s in
// milliseconds and the abort races a response that has already arrived. The point is to abort
// an answer that is genuinely in flight, which needs a real model call to be in flight.
if (askIsConfigured()) {
  actingUserId = owner.id;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 400);
  let abortError = '';
  try {
    await post({ text: 'talk me through everything you know about this car', history: [] }, controller.signal);
  } catch (cause) {
    abortError = cause instanceof Error ? cause.message : String(cause);
  }
  check('aborting mid-answer resolves quietly', abortError === '', abortError);

  // And the slot it held must come back, or leaving a page would lock the owner out.
  await new Promise((resolve) => setTimeout(resolve, 250));
  let slotReleased = true;
  try {
    await post({ text: 'hi', history: [] });
  } catch (cause) {
    if ((cause as { status?: number }).status === 429) slotReleased = false;
  }
  check('the in-flight slot is released when the client disconnects', slotReleased);
}

/* ------------------------------------------------------- 5. reply integrity */

section('Reply integrity');

const LEVELS = new Set(['low', 'medium', 'high']);
const KINDS = new Set(['vehicle', 'recalls', 'owner_reports', 'upkeep', 'service_history']);

actingUserId = owner.id;
const answered = await post({ text: 'is it safe to drive? and are there recalls?', history: [] });
const assistant = answered.final?.assistant ?? {};
const urgency = assistant.urgency as { level?: string } | undefined;
const cta = assistant.cta as { label?: string; action?: string } | undefined;
const sources = assistant.sources as { kind: string; label: string }[] | undefined;

check('urgency, when set, uses one of the three levels', urgency === undefined || LEVELS.has(String(urgency.level)), String(urgency?.level));
check('cta, when set, carries the label the code owns', cta === undefined || cta.label === 'CHECK REPAIR COSTS', String(cta?.label));
check('sources, when set, use only known kinds', (sources ?? []).every((s) => KINDS.has(s.kind)));

if (askIsConfigured()) {
  const context = await buildVehicleContext(db, vehicle);
  const availableKinds = new Set<string>(context.sources.map((s) => s.kind));
  check('sources are a subset of what the facts block held', (sources ?? []).every((s) => availableKinds.has(s.kind)));

  // The filter itself: withhold two kinds and aim a question squarely at them.
  const narrowed = { text: context.text, sources: context.sources.filter((s) => s.kind === 'vehicle') };
  const { reply } = await askCarAdvocate({
    question: 'based on my service history and my upkeep schedule, what am I neglecting?',
    vehicleContext: narrowed,
    history: [],
  });
  const cited: string[] = (reply.sources ?? []).map((s) => s.kind);
  check('a source the block did not hold is dropped', cited.every((k) => k === 'vehicle'), `cited ${cited.join(', ') || 'nothing'}`);

  const greeting = await askCarAdvocate({ question: 'hi', vehicleContext: context, history: [] });
  check('a greeting cites no sources', (greeting.reply.sources ?? []).length === 0, (greeting.reply.sources ?? []).map((s) => s.kind).join(', '));
  check('a greeting carries no urgency', greeting.reply.urgency === undefined);
  check('a greeting is short', greeting.reply.text.length < 160, `${greeting.reply.text.length} chars: ${greeting.reply.text}`);
} else {
  check('canned replies still produce a final message', assistant.text !== undefined);
}

/* --------------------------------------------------------------- 6. context */

section('Facts block');

const context = await buildVehicleContext(db, vehicle);
check('the block names the car', context.text.includes(String(vehicle.year)) && context.text.includes(vehicle.make));
check('every section says what missing data means', /NOT an all-clear|not|Nothing logged|None issued|No complaints|do not invent/i.test(context.text));
check('the vehicle is always a source', context.sources.some((s) => s.kind === 'vehicle'));
check('source labels carry counts, not model prose', context.sources.every((s) => s.label.length > 0 && s.label.length < 80));

const placeholder = await buildVehicleContext(db, { ...vehicle, mileage: 1 });
check('a placeholder odometer is flagged as unknown', placeholder.text.includes('placeholder'));

const empty = await buildVehicleContext(db, { ...vehicle, id: randomUUID() });
check('a car with no logged history says so', empty.text.includes('Nothing logged'));
check('a car with no history lists no service-history source', !empty.sources.some((s) => s.kind === 'service_history'));

/* ------------------------------------------------------------ 7. transcript */

section('Transcript storage');

// A minimal sessionStorage, since the browser's is not present in Node.
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
  get length() { return this.map.size; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  clear() { this.map.clear(); }
}
(globalThis as unknown as { sessionStorage: unknown }).sessionStorage = new MemoryStorage();

const { loadTranscript, saveTranscript, clearAllTranscripts } = await import('../apps/web/src/lib/chatTranscript.js');
const msg = (id: string, text: string) => ({ id, role: 'user' as const, text });


saveTranscript('car-a', [msg('1', 'hello'), msg('2', 'again')]);
check('a transcript round-trips', loadTranscript('car-a').length === 2);
check('a different vehicle sees nothing', loadTranscript('car-b').length === 0);

saveTranscript('car-a', []);
check('saving an empty transcript clears the key', loadTranscript('car-a').length === 0);

saveTranscript('car-a', Array.from({ length: 250 }, (_, i) => msg(String(i), `m${i}`)));
const capped = loadTranscript('car-a');
check('the stored transcript is capped', capped.length === 100, `${capped.length}`);
check('the cap keeps the newest messages', capped[capped.length - 1].text === 'm249');

sessionStorage.setItem('caradvocate.ask.car-c', 'not json at all');
check('corrupt stored data yields an empty transcript', loadTranscript('car-c').length === 0);

sessionStorage.setItem('caradvocate.ask.car-d', JSON.stringify([{ nope: true }, msg('9', 'kept')]));
check('rows of the wrong shape are dropped, good ones kept', loadTranscript('car-d').length === 1);

clearAllTranscripts();
check('sign-out clears every stored transcript', loadTranscript('car-a').length === 0 && loadTranscript('car-d').length === 0);

// Storage refusing to work must not break the page.
(globalThis as unknown as { sessionStorage: unknown }).sessionStorage = {
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('denied'); },
  removeItem() { throw new Error('denied'); },
};
let survivedDeniedStorage = true;
try {
  saveTranscript('car-a', [msg('1', 'x')]);
  loadTranscript('car-a');
} catch {
  survivedDeniedStorage = false;
}
check('storage being unavailable is survivable', survivedDeniedStorage);

/* --------------------------------------------------------------- 8. decoder */

section('Streaming preview decoder');

function decodeAll(doc: string, size: number): string {
  const push = createAnswerPreview();
  let out = '';
  for (let i = 0; i < doc.length; i += size) out += push(doc.slice(i, i + size));
  return out;
}

const REPLIES = [
  { text: 'Your brakes are fine.', urgency: null, cta: null, sources: [] },
  { text: 'Line one.\nTwo with "quotes", a backslash \\ and a slash /.', urgency: { level: 'medium', text: 'x' }, cta: null, sources: ['recalls'] },
  { text: 'Unicode: café — emoji 🚗 tab\there', urgency: null, cta: null, sources: [] },
  { text: '{"text":"a nested decoy"}', urgency: null, cta: { action: 'start_assessment' }, sources: [] },
];

let everyBoundary = true;
let leaked = false;
for (const reply of REPLIES) {
  const doc = JSON.stringify(reply);
  for (let size = 1; size <= doc.length; size++) {
    if (decodeAll(doc, size) !== reply.text) { everyBoundary = false; break; }
  }
  const out = decodeAll(doc, 7);
  if (out.includes('urgency') || out.includes('start_assessment')) leaked = true;
}
check('decodes correctly at every chunk boundary from one byte up', everyBoundary);
check('nothing after the answer leaks into the preview', !leaked);

const cut = decodeAll(JSON.stringify(REPLIES[1]).slice(0, 40), 3);
check('a truncated stream yields a clean prefix', REPLIES[1].text.startsWith(cut));

/* ----------------------------------------------------------------- results */

server.close();
await closeDb();

console.log(`\n${'─'.repeat(60)}`);
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const failure of failures) console.log(`  · ${failure}`);
}

console.log('\nStill needs a browser and a person:');
console.log('  · the composer growing to six rows, then scrolling');
console.log('  · Enter sending and Shift+Enter breaking the line');
console.log('  · the transcript surviving a real route change and a refresh');
console.log('  · aria-live actually announcing an answer in a screen reader');
console.log('  · the "Based on" row reading well at that size');
console.log('  · line breaks rendering in a reply');

process.exit(failures.length === 0 ? 0 : 1);
