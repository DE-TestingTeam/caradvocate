/**
 * Interaction smoke test: drives the two flows that cross screens.
 *
 *  1. Mark a repair complete on /assessments -> dialog confirms -> the repair
 *     appears in My Car service history tagged "via Repair Cost Checker".
 *  2. Create an assessment on /assessments/new -> lands on a detail page that
 *     renders the Quote Evaluation card for the amount entered.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const DIST = path.resolve('dist-smoke');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

fs.writeFileSync(
  path.join(DIST, 'index.html'),
  '<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>flows</title></head>' +
    '<body><div id="root"></div><script src="/app.js"></script></body></html>',
);

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  let file = path.join(DIST, url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'text/plain' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(4174, r));

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push(e.message));
vc.on('error', (...a) => errors.push(a.join(' ')));

async function open(route) {
  const html = await (await fetch(`http://localhost:4174${route}`)).text();
  const dom = new JSDOM(html, {
    url: `http://localhost:4174${route}`,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
      window.structuredClone = (v) => JSON.parse(JSON.stringify(v));
    },
  });
  await settle(dom);
  return dom;
}

const settle = (dom, ms = 1200) => new Promise((r) => dom.window.setTimeout(r, ms));
const bodyText = (dom) => dom.window.document.body.textContent ?? '';

function findByText(dom, selector, text) {
  return [...dom.window.document.querySelectorAll(selector)].find((el) =>
    (el.textContent ?? '').trim().toLowerCase().includes(text.toLowerCase()),
  );
}

function click(dom, el) {
  el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, view: dom.window }));
}

function setInput(dom, el, value) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

const checks = [];
const check = (name, pass, detail = '') => checks.push({ name, pass, detail });

/* ------------------------------------------- flow 1: mark repair complete */
{
  const dom = await open('/assessments');

  const markLinks = [...dom.window.document.querySelectorAll('button')].filter((b) =>
    (b.textContent ?? '').includes('Mark repair as complete'),
  );
  check('two incomplete assessments offer "Mark repair as complete"', markLinks.length === 2, `found ${markLinks.length}`);

  click(dom, markLinks[0]);
  await settle(dom);

  const afterOpen = bodyText(dom);
  check('completion dialog opens', afterOpen.includes('Repair Completed'));
  check('dialog states history was updated', afterOpen.includes('Your service history on My Car has been updated'));
  check('dialog shows the repair name', afterOpen.includes('Brake Pad Replacement'), 'newest first');

  const done = findByText(dom, 'button', 'Done');
  check('dialog has a Done button', Boolean(done));
  click(dom, done);
  await settle(dom);

  check('dialog closes on Done', !bodyText(dom).includes('Your service history on My Car has been updated'));
  check('card flips to completed state', (bodyText(dom).match(/Repair completed/g) ?? []).length >= 2);

  // Navigate to My Car inside the same SPA session so mock state persists.
  const myCarLink = [...dom.window.document.querySelectorAll('a')].find((a) => a.getAttribute('href') === '/my-car');
  click(dom, myCarLink);
  await settle(dom, 1500);

  const myCar = bodyText(dom);
  check(
    'completed repair lands in service history tagged via Repair Cost Checker',
    myCar.includes('Brake Pad Replacement via Repair Cost Checker'),
  );
  dom.window.close();
}

/* --------------------------------------- flow 2: create a new assessment */
{
  const dom = await open('/assessments/new');

  const startDisabled = findByText(dom, 'button', 'Start assessment')?.disabled;
  check('Start assessment is disabled before any input', startDisabled === true);

  const oilChange = findByText(dom, 'button[role="option"]', 'Oil Change & Filter');
  check('repair picker lists Oil Change & Filter', Boolean(oilChange));
  click(dom, oilChange);
  await settle(dom, 300);

  const yesQuote = findByText(dom, 'button', 'Yes, I have a quote');
  click(dom, yesQuote);
  await settle(dom, 300);

  const drop = bodyText(dom);
  check('quote drop zone appears', drop.includes('Upload quote PDF') && drop.includes('or drag and drop here'));

  const amount = dom.window.document.querySelector('#quote-amount');
  check('quote amount input is present', Boolean(amount));
  setInput(dom, amount, '9999');
  await settle(dom, 300);

  const start = findByText(dom, 'button', 'Start assessment');
  check('Start assessment enables once both steps are answered', start.disabled === false);
  click(dom, start);
  await settle(dom, 1800);

  const detail = bodyText(dom);
  check('navigates to the new assessment detail', detail.includes('Oil Change & Filter'));
  check('detail renders the Quote Evaluation card', detail.includes('Quote Evaluation'));
  check('an out-of-range quote is judged Overpriced', detail.includes('Overpriced'));
  check('subline shows the entered quote', detail.includes('Quote: $9,999'));
  dom.window.close();
}

server.close();

console.log('INTERACTION CHECKS');
let failed = 0;
for (const c of checks) {
  if (!c.pass) failed += 1;
  console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail && !c.pass ? ` (${c.detail})` : ''}`);
}
console.log(`\n${checks.length - failed}/${checks.length} passed · JS errors: ${errors.length}`);
errors.slice(0, 8).forEach((e) => console.log(`  ${e.slice(0, 200)}`));
process.exit(failed === 0 && errors.length === 0 ? 0 : 1);
