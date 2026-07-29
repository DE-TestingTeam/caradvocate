/**
 * Full-stack end-to-end test.
 *
 * Runs the real Express app against a real Postgres (PGlite, in-process) and
 * drives the real production web bundle in jsdom. Nothing is mocked on either
 * side, so this is what catches contract drift between the two halves -- the
 * failure mode neither the API suite nor a frontend suite can see on its own.
 *
 * Run with: npm run test:e2e
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { JSDOM, VirtualConsole } from 'jsdom';
import { eq } from 'drizzle-orm';
import { createApp } from '../apps/api/src/app.js';
import { users } from '../apps/api/src/db/schema.js';
import { createTestDb } from '../apps/api/test/harness.js';
import { HttpError } from '../apps/api/src/lib/httpError.js';
import type { Database } from '../apps/api/src/db/index.js';

const WEB = path.resolve('apps/web');
const DIST = path.join(WEB, 'dist-smoke');

/* ------------------------------------------------------- build the frontend */

console.log('Building the web bundle...');
// jsdom cannot execute <script type="module">, so this config emits an IIFE.
execFileSync('npx', ['vite', 'build', '--config', 'vite.smoke.config.ts', '--mode', 'production'], {
  cwd: WEB,
  stdio: 'pipe',
  // The suite runs with NODE_ENV=test, which would make the React plugin emit the
  // dev JSX runtime (jsxDEV) that is absent from a production React build.
  env: { ...process.env, NODE_ENV: 'production' },
});

fs.writeFileSync(
  path.join(DIST, 'index.html'),
  '<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>CarAdvocate e2e</title>' +
    '<link rel="stylesheet" href="/style.css"></head><body><div id="root"></div>' +
    '<script src="/app.js"></script></body></html>',
);

/* --------------------------------------------------------- boot the real API */

console.log('Starting the API on PGlite...');
const { db, close: closeDb } = await createTestDb();

let actingEmail = 'alex.rivera@email.com';
const api = createApp(db as unknown as Database, {
  resolveUser: async (req) => {
    const [row] = await req.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, actingEmail))
      .limit(1);
    if (!row) throw HttpError.unauthenticated(`No such user: ${actingEmail}`);
    return row;
  },
});

const apiServer = await new Promise<http.Server>((resolve) => {
  const s = api.listen(0, () => resolve(s));
});
const apiPort = (apiServer.address() as import('node:net').AddressInfo).port;

/* ---------------- serve the bundle and proxy /api to the real server --------- */

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const webServer = http.createServer(async (req, res) => {
  const url = (req.url ?? '/').split('?')[0];

  if (url.startsWith('/api')) {
    // Same-origin proxy, mirroring what the Vite dev proxy does in development.
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);

    const upstream = await fetch(`http://127.0.0.1:${apiPort}${req.url}`, {
      method: req.method,
      headers: req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : undefined,
      body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
    });

    const payload = await upstream.text();
    res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' });
    res.end(payload);
    return;
  }

  let file = path.join(DIST, url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'text/plain' });
  fs.createReadStream(file).pipe(res);
});

await new Promise<void>((resolve) => webServer.listen(4300, resolve));
const ORIGIN = 'http://localhost:4300';

/* ----------------------------------------------------------- jsdom plumbing */

const consoleErrors: string[] = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e: Error) => consoleErrors.push(`jsdomError: ${e.message}`));
vc.on('error', (...args: unknown[]) => consoleErrors.push(`console.error: ${args.join(' ')}`));

async function open(route: string): Promise<JSDOM> {
  const html = await (await fetch(`${ORIGIN}${route}`)).text();
  const dom = new JSDOM(html, {
    url: `${ORIGIN}${route}`,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      // Present in every browser we target; jsdom omits both.
      // @ts-expect-error -- augmenting the jsdom window
      window.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
      // @ts-expect-error -- augmenting the jsdom window
      window.structuredClone = (value: unknown) => JSON.parse(JSON.stringify(value));
      // jsdom ships no fetch implementation. Bridge to Node's, resolving the
      // app's relative /api paths against the test origin the way a browser does.
      // @ts-expect-error -- augmenting the jsdom window
      window.fetch = (input: string | URL, init?: RequestInit) =>
        globalThis.fetch(new URL(String(input), ORIGIN), init);
      // @ts-expect-error -- augmenting the jsdom window
      window.Headers = Headers;
      // @ts-expect-error -- augmenting the jsdom window
      window.Request = Request;
      // @ts-expect-error -- augmenting the jsdom window
      window.Response = Response;
    },
  });
  await settle(dom, 1800);
  return dom;
}

const settle = (dom: JSDOM, ms = 1200) => new Promise((r) => dom.window.setTimeout(r, ms));
const text = (dom: JSDOM) => dom.window.document.body.textContent ?? '';

function findByText(dom: JSDOM, selector: string, needle: string): Element | undefined {
  return [...dom.window.document.querySelectorAll(selector)].find((el) =>
    (el.textContent ?? '').trim().toLowerCase().includes(needle.toLowerCase()),
  );
}

function click(dom: JSDOM, el: Element): void {
  el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, view: dom.window }));
}

function setInput(dom: JSDOM, el: Element, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

const checks: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = '') => checks.push({ name, pass, detail });

/* ============================ 1. every route renders server data ============ */

{
  const dom = await open('/my-car');
  const body = text(dom);
  check('My Car renders the vehicle from Postgres', body.includes('2019 Honda Civic'));
  check('My Car renders the market value', body.includes('$14,200'));
  check('My Car masks the VIN from the real column', body.includes('2HGFC2F53KH••••••'));
  check('My Car renders the trade-in range', body.includes('Trade in range $12,100–$14,600'));
  check('maintenance comes through with its recall badge', body.includes('Fuel Pump Control Unit') && body.includes('Open recall'));
  check('model known issues come through', body.includes('Transmission hesitation under load'));
  check('service history renders the cost-checker suffix', body.includes('Battery replacement via Repair Cost Checker'));
  check('no skeletons are left behind after load', !body.includes('undefined') && body.length > 500);
  dom.window.close();
}

{
  const dom = await open('/assessments');
  const body = text(dom);
  check('assessment list renders all three from the database', body.includes('Brake Pad Replacement') && body.includes('AC Compressor Replacement') && body.includes('Timing Belt Inspection'));
  check('the fair verdict badge is derived server-side', body.includes('Fair'));
  check('the overpriced verdict badge is derived server-side', body.includes('Overpriced'));
  check('an unquoted assessment shows the Assessed badge', body.includes('Assessed'));
  check('a completed assessment shows its completed state', body.includes('Repair completed'));
  check('list dates are formatted from real timestamps', body.includes('Jan 15, 2025'));
  dom.window.close();
}

{
  const dom = await open('/ask');
  const body = text(dom);
  check('chat history loads from the database', body.includes('My car makes a grinding sound when I brake'));
  check('the urgency callout survives the round trip', body.includes('Urgency: High'));
  check('the CTA survives the round trip', body.includes('CHECK REPAIR COSTS'));
  dom.window.close();
}

{
  const dom = await open('/account');
  const body = text(dom);
  check('account renders the seeded profile', body.includes('Alex Rivera') && body.includes('alex.rivera@email.com'));
  check('memberSince is reduced to a year', body.includes('Member since 2024'));
  check('the VIN is masked to its last four on Account', body.includes('••••4821'));
  check('Account and My Car agree on mileage', body.includes('68,400 mi'));
  check('subscription features render in order', body.includes('Repair Cost Checker') && body.includes('Paid plan'));
  dom.window.close();
}

/* ==================== 2. quote evaluation happens on the server ============= */

{
  const dom = await open('/assessments/new');
  check('the repair catalog loads from the API', Boolean(findByText(dom, 'button[role="option"]', 'Oil Change & Filter')));

  const start = findByText(dom, 'button', 'Start assessment') as HTMLButtonElement;
  check('Start assessment starts disabled', start.disabled === true);

  click(dom, findByText(dom, 'button[role="option"]', 'Oil Change & Filter')!);
  await settle(dom, 300);
  click(dom, findByText(dom, 'button', 'Yes, I have a quote')!);
  await settle(dom, 300);

  const amount = dom.window.document.querySelector('#quote-amount')!;
  setInput(dom, amount, '900');
  await settle(dom, 300);

  click(dom, findByText(dom, 'button', 'Start assessment')!);
  await settle(dom, 2500);

  const body = text(dom);
  check('creating an assessment navigates to its detail page', body.includes('Oil Change & Filter'));
  check('the server returned a quote evaluation', body.includes('Quote Evaluation'));
  check('a $900 quote against a $70-$140 benchmark is overpriced', body.includes('Overpriced'));
  check('the explanation was generated server-side', body.includes('above the expected range'));
  check('the detail page shows the quote in the subline', body.includes('Quote: $900'));
  check('benchmark parts were snapshotted onto the assessment', body.includes('Oil Filter'));
  dom.window.close();
}

/* ============ 3. completing a repair crosses screens through the database ==== */

{
  const dom = await open('/assessments');

  const markButtons = [...dom.window.document.querySelectorAll('button')].filter((b) =>
    (b.textContent ?? '').includes('Mark repair as complete'),
  );
  check('incomplete assessments offer completion', markButtons.length >= 2, `found ${markButtons.length}`);

  // Target the brake-pad card specifically. An earlier block created a newer
  // assessment, so position in the list is not a stable way to identify it.
  const brakeCardButton = markButtons.find((button) => {
    const card = button.closest('div.rounded-lg');
    return (card?.textContent ?? '').includes('Brake Pad Replacement');
  });
  check('the brake pad card is identifiable by name', Boolean(brakeCardButton));

  click(dom, brakeCardButton!);
  await settle(dom, 1500);
  check('the completion dialog confirms the write', text(dom).includes('Your service history on My Car has been updated'));

  click(dom, findByText(dom, 'button', 'Done')!);
  await settle(dom, 1500);
  check('the card flips to completed after the server write', (text(dom).match(/Repair completed/g) ?? []).length >= 2);

  // Navigate within the SPA; the new row must come back from Postgres.
  const myCarLink = [...dom.window.document.querySelectorAll('a')].find((a) => a.getAttribute('href') === '/my-car')!;
  click(dom, myCarLink);
  await settle(dom, 2000);

  check(
    'the completed repair appears in service history from the database',
    text(dom).includes('Brake Pad Replacement via Repair Cost Checker'),
  );

  // Confirm it is genuinely persisted, not just rendered optimistically.
  const persisted = await fetch(`${ORIGIN}/api/service-records`).then((r) => r.json());
  check(
    'the service record really exists server-side',
    persisted.some((r: any) => r.description === 'Brake Pad Replacement' && r.source === 'repair_cost_checker'),
  );
  dom.window.close();
}

/* ================= 4. a logged service round-trips to the server ============= */

{
  const dom = await open('/my-car');
  click(dom, findByText(dom, 'button', 'Log a service')!);
  await settle(dom, 500);

  setInput(dom, dom.window.document.querySelector('#svc-description')!, 'E2E cabin filter');
  setInput(dom, dom.window.document.querySelector('#svc-date')!, '2026-07-10');
  setInput(dom, dom.window.document.querySelector('#svc-cost')!, '45');
  await settle(dom, 300);

  click(dom, findByText(dom, 'button', 'Save record')!);
  await settle(dom, 2000);

  check('the logged service appears on screen', text(dom).includes('E2E cabin filter'));

  const persisted = await fetch(`${ORIGIN}/api/service-records`).then((r) => r.json());
  check(
    'the logged service was persisted as a manual record',
    persisted.some((r: any) => r.description === 'E2E cabin filter' && r.source === 'manual' && r.cost === 45),
  );
  dom.window.close();
}

/* ========== 5. the frontend renders a server error instead of hanging ======== */

{
  // Point the app at a user the database does not have, so every call 401s.
  actingEmail = 'nobody@example.com';
  const dom = await open('/my-car');
  const body = text(dom);
  check('a 401 renders an error state rather than endless skeletons', body.includes('Try again') || body.includes('No such user'));
  check('the error state does not render stale vehicle data', !body.includes('$14,200'));
  actingEmail = 'alex.rivera@email.com';
  dom.window.close();
}

/* ------------------------------------------------------------------ teardown */

await new Promise<void>((resolve) => webServer.close(() => resolve()));
await new Promise<void>((resolve) => apiServer.close(() => resolve()));
await closeDb();

console.log('\nEND-TO-END CHECKS');
let failed = 0;
for (const c of checks) {
  if (!c.pass) failed += 1;
  console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${!c.pass && c.detail ? ` (${c.detail})` : ''}`);
}

console.log(`\n${checks.length - failed}/${checks.length} passed · console errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 10).forEach((e) => console.log(`  ${e.slice(0, 200)}`));

process.exit(failed === 0 && consoleErrors.length === 0 ? 0 : 1);
