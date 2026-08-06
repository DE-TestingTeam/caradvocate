/**
 * Probe the Open Labor Project API to answer three questions before we commit to it:
 *
 *   1. Does /api/v1/parts return MULTIPLE line items for a multi-part job, or one aggregate
 *      row? Their docs only demo `brake-pads-front`, a single-part job. An AC compressor is
 *      the real test -- a genuine breakdown names the compressor, the receiver/drier, the
 *      expansion valve and the refrigerant.
 *   2. Do their `job` slugs cover the 12 repairs we offer? `job` is required, so a repair
 *      with no slug gets no breakdown.
 *   3. Which tier is needed? /api/v1/engines is Builder+, so if parts vary by engine the $49
 *      tier is not enough.
 *
 * Read-only: GETs only, nothing touched in our database.
 *
 *   OPENLABOR_API_KEY=... npx tsx scripts/probeOpenLabor.mts
 */

const KEY = process.env.OPENLABOR_API_KEY;
if (!KEY) {
  console.error('Set OPENLABOR_API_KEY first. Sign up at https://openlaborproject.com/');
  process.exit(1);
}

const BASE = 'https://openlaborproject.com/api/v1';

/**
 * The docs excerpt does not state how the key is presented, so try the common shapes and
 * keep whichever authenticates.
 */
const AUTH_STYLES: Array<{ label: string; apply: (url: URL) => HeadersInit }> = [
  { label: 'Authorization: Bearer', apply: () => ({ Authorization: `Bearer ${KEY}` }) },
  { label: 'x-api-key', apply: () => ({ 'x-api-key': KEY }) },
  { label: 'X-Auth-Key', apply: () => ({ 'X-Auth-Key': KEY }) },
  {
    label: 'api_key query param',
    apply: (url) => {
      url.searchParams.set('api_key', KEY);
      return {};
    },
  },
];

let authStyle: (typeof AUTH_STYLES)[number] | null = null;

interface Probe {
  status: number;
  body: unknown;
}

async function get(path: string, params: Record<string, string> = {}): Promise<Probe> {
  const styles = authStyle ? [authStyle] : AUTH_STYLES;

  let last: Probe = { status: 0, body: null };
  for (const style of styles) {
    const url = new URL(`${BASE}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const headers = style.apply(url);

    let response: Response;
    try {
      response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      last = { status: 0, body: `request failed: ${(error as Error).message}` };
      continue;
    }

    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* leave as text -- an HTML error page is itself the finding */
    }

    // 401/403 means the style is wrong. Anything else, including a 404 for an unknown job
    // slug, means we authenticated.
    if (response.status !== 401 && response.status !== 403) {
      if (!authStyle) {
        authStyle = style;
        console.log(`Authenticated with "${style.label}".\n`);
      }
      return { status: response.status, body };
    }
    last = { status: response.status, body };
  }
  return last;
}

/**
 * Our repair slugs, paired with a guess at the Open Labor Project slug. Their naming is more
 * specific than ours, so the point of the probe is to find out which guesses land.
 */
const JOBS: Array<{ ours: string; guess: string; multiPart: boolean }> = [
  { ours: 'ac-compressor-replacement', guess: 'ac-compressor', multiPart: true },
  { ours: 'brake-pad-replacement', guess: 'brake-pads-front', multiPart: true },
  { ours: 'alternator-replacement', guess: 'alternator', multiPart: true },
  { ours: 'spark-plug-replacement', guess: 'spark-plugs', multiPart: true },
  { ours: 'coolant-flush', guess: 'coolant-flush', multiPart: true },
  { ours: 'transmission-flush', guess: 'transmission-fluid-flush', multiPart: true },
  { ours: 'oil-change-filter', guess: 'oil-change', multiPart: false },
  { ours: 'battery-replacement', guess: 'battery', multiPart: false },
  { ours: 'ac-recharge', guess: 'ac-recharge', multiPart: false },
  { ours: 'tire-rotation', guess: 'tire-rotation', multiPart: false },
  { ours: 'wheel-alignment', guess: 'wheel-alignment', multiPart: false },
];

/** A 2019 Civic: the vehicle whose VDB figures we have already verified by hand. */
const VEHICLE = { make: 'honda', model: 'civic', year: '2019' };

/** Count the plausible line-item arrays in a response, whatever they are called. */
function countLineItems(body: unknown): { count: number; where: string } | null {
  if (body === null || typeof body !== 'object') return null;
  const seen: Array<{ count: number; where: string }> = [];

  const walk = (node: unknown, path: string, depth: number) => {
    if (depth > 4 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      if (node.length && typeof node[0] === 'object') seen.push({ count: node.length, where: path });
      node.slice(0, 2).forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1));
      return;
    }
    for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k, depth + 1);
  };

  walk(body, '', 0);
  seen.sort((a, b) => b.count - a.count);
  return seen[0] ?? null;
}

async function main() {
  console.log(`Probing Open Labor Project against a ${VEHICLE.year} Honda Civic.\n`);

  // Q3 first: which endpoints does this key actually reach?
  console.log('--- Endpoint access (which tier does this key have?) ---');
  for (const path of ['/vehicles', '/engines', '/labor-times', '/parts']) {
    const params: Record<string, string> = { make: VEHICLE.make, model: VEHICLE.model };
    if (path !== '/vehicles' && path !== '/engines') params.year = VEHICLE.year;
    if (path === '/parts') params.job = JOBS[0].guess;
    const { status } = await get(path, params);
    const verdict = status === 200 ? 'OK' : status === 402 || status === 403 ? 'TIER LOCKED' : `HTTP ${status}`;
    console.log(`  ${path.padEnd(14)} ${verdict}`);
  }

  // Q1: the question the docs cannot answer.
  console.log('\n--- Line items per job (is this a real breakdown?) ---');
  const covered: string[] = [];
  const missing: string[] = [];

  for (const job of JOBS) {
    const { status, body } = await get('/parts', { ...VEHICLE, job: job.guess });
    if (status !== 200) {
      missing.push(`${job.ours} (tried "${job.guess}" -> HTTP ${status})`);
      continue;
    }
    covered.push(job.ours);
    const items = countLineItems(body);
    const n = items?.count ?? 0;
    const flag = job.multiPart && n <= 1 ? '  <-- AGGREGATE ONLY, not itemised' : '';
    console.log(`  ${job.guess.padEnd(26)} ${String(n).padStart(2)} item(s) at "${items?.where ?? '?'}"${flag}`);
  }

  // Q2: coverage.
  console.log(`\n--- Slug coverage: ${covered.length}/${JOBS.length} of our repairs ---`);
  if (missing.length) missing.forEach((m) => console.log(`  MISSING  ${m}`));

  // The raw shape for the job that decides it, so we can see the actual fields.
  console.log('\n--- Raw response: AC compressor (the deciding case) ---');
  const decider = await get('/parts', { ...VEHICLE, job: JOBS[0].guess });
  console.log(JSON.stringify(decider.body, null, 2).slice(0, 4000));

  console.log(`
Now read the raw shape above and check:
  - Are the rows DISTINCT parts (compressor, drier, expansion valve, refrigerant),
    or variants of one part (OE vs aftermarket vs remanufactured compressor)?
    Variants of one part are not a breakdown -- that is the failure mode to watch for.
  - Is there a quantity field? Six spark plugs at $12 is not $12.
  - Are the price ranges wide enough to be useless? A $40-$600 compressor tells an
    owner nothing, and a benchmark that cannot be wrong cannot help.
  - Does the sum of the line items sit inside the VDB parts range for this repair?
    Outside it, one of the two feeds is wrong and neither should ship.`);
}

await main();
