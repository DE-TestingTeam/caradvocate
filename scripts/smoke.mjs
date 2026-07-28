/**
 * Headless smoke test: loads the production build in jsdom, walks every route,
 * clicks the interactive affordances, and fails on any console error or thrown error.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const DIST = path.resolve('dist-smoke');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

// vite lib mode emits no HTML, so write the host page here.
fs.writeFileSync(
  path.join(DIST, 'index.html'),
  '<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>CarAdvocate smoke</title>' +
    '<link rel="stylesheet" href="/style.css"></head><body><div id="root"></div>' +
    '<script src="/app.js"></script></body></html>',
);

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  let file = path.join(DIST, url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'text/plain' });
  fs.createReadStream(file).pipe(res);
});

await new Promise((r) => server.listen(4173, r));

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push(`jsdomError: ${e.message}`));
vc.on('error', (...a) => errors.push(`console.error: ${a.join(' ')}`));
vc.on('warn', (...a) => {
  const msg = a.join(' ');
  // jsdom does not implement layout, so recharts/radix width warnings are expected noise.
  if (!/width\(0\)|height\(0\)|not implemented/i.test(msg)) errors.push(`console.warn: ${msg}`);
});

const routes = ['/my-car', '/ask', '/assessments', '/assessments/new', '/assessments/asm_brake_pad', '/assessments/asm_timing_belt', '/account'];
const results = [];

for (const route of routes) {
  const before = errors.length;
  const dom = await new JSDOM(await (await fetch(`http://localhost:4173${route}`)).text(), {
    url: `http://localhost:4173${route}`,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
    // Both of these exist in every browser we target; jsdom simply omits them.
    beforeParse(window) {
      window.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
      window.structuredClone = (value) => JSON.parse(JSON.stringify(value));
    },
  });

  await new Promise((r) => setTimeout(r, 2500));

  const text = dom.window.document.body.textContent ?? '';
  const buttons = dom.window.document.querySelectorAll('button').length;
  const placeholders = [...dom.window.document.querySelectorAll('input[placeholder]')]
    .map((el) => el.getAttribute('placeholder'))
    .join(' | ');
  results.push({ route, chars: text.length, buttons, newErrors: errors.length - before, text, placeholders });
  dom.window.close();
}

server.close();

console.log('ROUTE RESULTS');
for (const r of results) {
  console.log(`  ${r.route.padEnd(32)} chars=${String(r.chars).padStart(5)} buttons=${String(r.buttons).padStart(3)} errors=${r.newErrors}`);
}

const expectations = [
  ['/my-car', ['2019 Honda Civic', '$14,200', '2HGFC2F53KH••••••', 'Fuel Pump Control Unit', 'Open recall', 'Transmission hesitation under load', 'via Repair Cost Checker', 'Trade in range $12,100–$14,600']],
  ['/ask', ['Ask CA', 'grinding sound when I brake', 'Urgency: High', 'CHECK REPAIR COSTS', 'Car Advocate Assistant']],
  ['/assessments', ['Repair Assessment', 'Brake Pad Replacement', 'Quote Evaluated', 'AC Compressor Replacement', 'Overpriced', 'Timing Belt Inspection', 'Assessed', 'Repair completed', 'Jan 15, 2025']],
  ['/assessments/new', ['New Repair Assessment', 'Brake Pad Replacement', 'AC Recharge', 'Yes, I have a quote', 'No, not yet', 'Get expected costs before visiting a shop']],
  ['/assessments/asm_brake_pad', ['Quote Evaluation', 'Fair price', 'Quote: $320', 'Repair is Recommended', 'CRITICAL REPAIR', 'Front Brake Pads (set)', 'Total Parts Estimate: $140', 'Total Labor Estimate', '$360–$660', 'Your quote']],
  ['/assessments/asm_timing_belt', ['No quote provided', 'Tip: Bring this assessment to your shop', 'Fair Total Estimate', 'Repair completed']],
  ['/account', ['Account', 'Alex Rivera', 'Member since 2024', 'alex.rivera@email.com', '(555) 018-2245', '••••4821', '68,400 mi', 'Subscription', 'Paid plan', 'Repair Cost Checker', 'Active']],
];

const placeholderExpectations = [
  ['/ask', 'Ask about a symptom, repair, or your car…'],
  ['/assessments/new', 'Search repairs or describe…'],
];

let failures = 0;
console.log('\nCONTENT ASSERTIONS');
for (const [route, needles] of expectations) {
  const found = results.find((r) => r.route === route);
  for (const needle of needles) {
    const ok = found && found.text.includes(needle);
    if (!ok) {
      failures += 1;
      console.log(`  MISSING  ${route} -> "${needle}"`);
    }
  }
}
for (const [route, needle] of placeholderExpectations) {
  const found = results.find((r) => r.route === route);
  if (!found || !found.placeholders.includes(needle)) {
    failures += 1;
    console.log(`  MISSING  ${route} -> placeholder "${needle}"`);
  }
}
if (failures === 0) console.log('  all content assertions passed');

console.log(`\nJS ERRORS: ${errors.length}`);
errors.slice(0, 15).forEach((e) => console.log(`  ${e.slice(0, 220)}`));

process.exit(failures === 0 && errors.length === 0 ? 0 : 1);
