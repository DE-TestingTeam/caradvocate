/** Endpoint behaviour and response shapes the web client depends on. */
import { check, section } from './assert.js';
import { startTestServer } from './server.js';

export async function run(): Promise<void> {
  section('api endpoints');
  const { request, close } = await startTestServer();

  /* ------------------------------------------------------------- vehicle */

  const vehicle = await request('GET', '/api/vehicle');
  check('GET /api/vehicle returns 200', vehicle.status === 200, `got ${vehicle.status}`);
  check('vehicle is the seeded Civic', vehicle.body.year === 2019 && vehicle.body.model === 'Civic');
  check('vehicle mileage is 68,400', vehicle.body.mileage === 68400);
  check('vehicle value is $14,200', vehicle.body.estMarketValue === 14200);
  check('trade-in range is 12,100-14,600', vehicle.body.tradeInLow === 12100 && vehicle.body.tradeInHigh === 14600);
  check('valueTrend has 6 points, oldest first', vehicle.body.valueTrend.length === 6 && vehicle.body.valueTrend[0].month === 'Feb');
  check('full VIN is returned for the owner', vehicle.body.vin === '2HGFC2F53KH124821');

  const maintenance = await request('GET', '/api/vehicle/maintenance');
  check('maintenance returns 4 items in order', maintenance.body.length === 4 && maintenance.body[0].label === 'Fuel Pump Control Unit');
  check('recall status maps to open_recall', maintenance.body[0].status === 'open_recall');

  const issues = await request('GET', '/api/vehicle/known-issues');
  check('known issues returns 3 for the model', issues.body.length === 3, `got ${issues.body.length}`);
  check('AC compressor issue is high severity', issues.body.some((i: any) => i.severity === 'high' && i.label.includes('AC compressor')));

  const patched = await request('PATCH', '/api/vehicle', { body: { mileage: 69000 } });
  check('PATCH /api/vehicle updates mileage', patched.status === 200 && patched.body.mileage === 69000);
  await request('PATCH', '/api/vehicle', { body: { mileage: 68400 } });

  const badPatch = await request('PATCH', '/api/vehicle', { body: { mileage: -5 } });
  check('PATCH rejects negative mileage with 422', badPatch.status === 422, `got ${badPatch.status}`);
  check('validation errors name the offending field', badPatch.body.error.details?.[0]?.path === 'mileage');

  const emptyPatch = await request('PATCH', '/api/vehicle', { body: {} });
  check('PATCH rejects an empty body', emptyPatch.status === 422);

  /* ----------------------------------------------------- service records */

  const history = await request('GET', '/api/service-records');
  check('service history returns 5 records', history.body.length === 5, `got ${history.body.length}`);
  check('history is newest first', history.body[0].date === '2026-06-14');
  check('repair-cost-checker source is preserved', history.body[0].source === 'repair_cost_checker');

  const created = await request('POST', '/api/service-records', {
    body: { description: 'Wiper blades', date: '2026-07-01', cost: 28 },
  });
  check('POST /api/service-records returns 201', created.status === 201, `got ${created.status}`);
  check('manually logged records are marked manual', created.body.source === 'manual');

  const badRecord = await request('POST', '/api/service-records', {
    body: { description: '', date: '2026-13-45', cost: 1.5 },
  });
  check('POST rejects a blank description, bad date and fractional cost', badRecord.status === 422);
  check('all three field errors are reported', badRecord.body.error.details.length === 3, `got ${badRecord.body.error.details?.length}`);

  /* ------------------------------------------------------------ repairs */

  const repairs = await request('GET', '/api/repairs');
  check('repair catalog returns 12 benchmarked repairs', repairs.body.length === 12, `got ${repairs.body.length}`);
  check('catalog leads with Brake Pad Replacement', repairs.body[0].name === 'Brake Pad Replacement');

  /* -------------------------------------------------------- assessments */

  const list = await request('GET', '/api/assessments');
  check('assessments list returns 3', list.body.length === 3, `got ${list.body.length}`);
  check('assessments are newest first', list.body[0].repairName === 'Brake Pad Replacement');

  const quoted = list.body[0];
  check('quoted assessment exposes a quote', quoted.quote?.amount === 320);
  check('quote verdict is fair', quoted.quote?.verdict === 'fair');
  check('parts total is $140 with 5 items', quoted.parts.total === 140 && quoted.parts.items.length === 5);
  check('labor est hours came back as a number, not a string', quoted.labor.estHours === 1.5);
  check('labor tasks are ordered', quoted.labor.tasks[0].name === 'Remove wheels & calipers');
  check('fair total is 360-660', quoted.fairTotalLow === 360 && quoted.fairTotalHigh === 660);
  check('createdAt is an ISO date only', quoted.createdAt === '2025-01-15');

  const unquoted = list.body.find((a: any) => a.repairName === 'Timing Belt Inspection');
  check('unquoted assessment omits quote entirely', unquoted && !('quote' in unquoted));
  check('completed assessment carries completedAt', unquoted.completedAt === '2024-10-04');

  const detail = await request('GET', `/api/assessments/${quoted.id}`);
  check('GET /api/assessments/:id returns 200', detail.status === 200);

  const badId = await request('GET', '/api/assessments/not-a-uuid');
  check('a malformed id is a 422, not a 500', badId.status === 422, `got ${badId.status}`);

  const missing = await request('GET', '/api/assessments/11111111-1111-4111-8111-111111111111');
  check('an unknown id is a 404', missing.status === 404, `got ${missing.status}`);

  /* ------------------------------------------- create + evaluate a quote */

  const oilChange = repairs.body.find((r: any) => r.name === 'Oil Change & Filter');

  const noQuote = await request('POST', '/api/assessments', { body: { repairId: oilChange.id } });
  check('POST /api/assessments without a quote returns 201', noQuote.status === 201, `got ${noQuote.status}`);
  check('created assessment has no quote', !('quote' in noQuote.body));
  check('created assessment snapshots parts', noQuote.body.parts.items.length === 3);
  check('created assessment uses current vehicle mileage', noQuote.body.mileageAtAssessment === 68400);

  const fairQuote = await request('POST', '/api/assessments', { body: { repairId: oilChange.id, quoteAmount: 100 } });
  check('an in-range quote is judged fair', fairQuote.body.quote.verdict === 'fair', JSON.stringify(fairQuote.body.quote));
  check('fair explanation cites the range', fairQuote.body.quote.explanation.includes('$70-$140'));
  check('quote is split across parts and labor', fairQuote.body.quote.parts + fairQuote.body.quote.labor === 100);

  const highQuote = await request('POST', '/api/assessments', { body: { repairId: oilChange.id, quoteAmount: 400 } });
  check('an over-range quote is judged overpriced', highQuote.body.quote.verdict === 'overpriced');
  check('overpriced explanation says above', highQuote.body.quote.explanation.includes('above the expected range'));

  const unknownRepair = await request('POST', '/api/assessments', {
    body: { repairId: '11111111-1111-4111-8111-111111111111' },
  });
  check('creating against an unknown repair is a 404', unknownRepair.status === 404);

  /* --------------------------------------------------- complete a repair */

  const before = (await request('GET', '/api/service-records')).body.length;
  const completed = await request('POST', `/api/assessments/${quoted.id}/complete`, { body: { cost: 320 } });
  check('completing a repair returns 200', completed.status === 200, `got ${completed.status}`);
  check('completed assessment gains completedAt', Boolean(completed.body.completedAt));
  check('the verdict badge survives completion', completed.body.quote.verdict === 'fair');

  const after = await request('GET', '/api/service-records');
  check('completion adds exactly one service record', after.body.length === before + 1);
  check('the new record is attributed to the cost checker', after.body.some((r: any) => r.description === 'Brake Pad Replacement' && r.source === 'repair_cost_checker'));

  const again = await request('POST', `/api/assessments/${quoted.id}/complete`, { body: { cost: 320 } });
  check('completing twice is a 409 conflict', again.status === 409, `got ${again.status}`);

  /* --------------------------------------------------------------- chat */

  const chat = await request('GET', '/api/chat');
  check('chat history returns the 4 seeded messages', chat.body.length === 4, `got ${chat.body.length}`);
  check('chat is chronological', chat.body[0].role === 'user' && chat.body[0].text.includes('grinding sound'));
  check('urgency callout survives the round trip', chat.body[1].urgency?.level === 'high');
  check('CTA survives the round trip', chat.body[3].cta?.action === 'start_assessment');

  const sent = await request('POST', '/api/chat', { body: { text: 'Is that expensive?' } });
  check('POST /api/chat returns 201 with both messages', sent.status === 201 && sent.body.user && sent.body.assistant);
  check('the user message is echoed back', sent.body.user.text === 'Is that expensive?');
  check('an assistant reply is generated', sent.body.assistant.role === 'assistant' && sent.body.assistant.text.length > 0);

  const blank = await request('POST', '/api/chat', { body: { text: '   ' } });
  check('POST /api/chat rejects a blank message', blank.status === 422);

  /* ------------------------------------------------------------ account */

  const account = await request('GET', '/api/account');
  check('account returns the seeded profile', account.body.name === 'Alex Rivera' && account.body.email === 'alex.rivera@email.com');
  check('memberSince is reduced to a year', account.body.memberSince === '2024');
  check('subscription features are ordered', account.body.features[0].name === 'My Car' && account.body.features[2].status === 'Active');

  const renamed = await request('PATCH', '/api/account', { body: { name: 'Alexandra Rivera' } });
  check('PATCH /api/account updates the name', renamed.status === 200 && renamed.body.name === 'Alexandra Rivera');

  const badEmail = await request('PATCH', '/api/account', { body: { email: 'nope' } });
  check('PATCH /api/account rejects a bad email', badEmail.status === 422);

  /* -------------------------------------------------------------- misc */

  const health = await request('GET', '/api/health');
  check('health check needs no auth and returns ok', health.status === 200 && health.body.ok === true);

  const nonsense = await request('GET', '/api/does-not-exist');
  check('unknown endpoints return the standard 404 envelope', nonsense.status === 404 && nonsense.body.error.code === 'not_found');

  await close();
}
