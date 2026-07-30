/**
 * Ask CA: the grounding context, the reply parser, and the route's failure paths.
 *
 * No test here reaches the Anthropic API. What is testable without a key is
 * everything that decides whether an answer is honest:
 *
 *   - the facts block, including that every section carries its provenance and says
 *     "unknown" rather than "fine" when a source could not be reached
 *   - the reply parser, including that a model-supplied CTA label cannot drift
 *   - the route, including that a failed model call produces an honest sentence
 *     rather than a canned reply passed off as a real answer
 *
 * The live call itself has been exercised manually against a real car (see the Ask CA
 * section of the README for what it showed, including one prompt rule that only a live
 * multi-turn run could have surfaced). Nothing here re-runs it: a suite that needs a
 * paid API key to pass is a suite that gets skipped.
 */
import { eq } from 'drizzle-orm';
import * as t from '../src/db/schema.js';
import { parseReply, setAskerForTesting } from '../src/services/askClaude.js';
import { setComplaintFetcherForTesting } from '../src/services/complaintSync.js';
import { setRecallFetcherForTesting } from '../src/services/recallSync.js';
import { setSafetyRatingFetcherForTesting } from '../src/services/safetyRatingSync.js';
import { buildVehicleContext } from '../src/services/vehicleContext.js';
import type { AskInput } from '../src/services/askClaude.js';
import type { Database } from '../src/db/index.js';
import { check, section } from './assert.js';
import { goOffline } from './offline.js';
import { startTestServer } from './server.js';

export async function run(): Promise<void> {
  /* ---------------------------------------------------------- reply parsing */

  section('ask ca: reading the model reply');

  const plain = parseReply([{ type: 'text', text: JSON.stringify({ text: 'Have the brakes looked at.', urgency: null, cta: null }) }]);
  check('the answer is extracted', plain.text === 'Have the brakes looked at.');
  check('a null urgency stays absent', plain.urgency === undefined);
  check('a null cta stays absent', plain.cta === undefined);

  const full = parseReply([
    {
      type: 'text',
      text: JSON.stringify({
        text: 'This is an open recall.',
        urgency: { level: 'high', text: 'Urgency: High - stop driving' },
        cta: { action: 'start_assessment' },
      }),
    },
  ]);
  check('urgency comes through', full.urgency?.level === 'high');
  check('urgency text comes through', full.urgency?.text.includes('stop driving') === true);
  // The label is ours, not the model's, so it always matches what the UI renders.
  check('the CTA label is supplied by us, not the model', full.cta?.label === 'CHECK REPAIR COSTS');
  check('the CTA action is the one the UI knows', full.cta?.action === 'start_assessment');

  // A fallback boundary or thinking block means the JSON is not simply content[0].
  const withOtherBlocks = parseReply([
    { type: 'thinking', text: '' },
    { type: 'text', text: '{"text":"Answer.","urgency":null,' },
    { type: 'text', text: '"cta":null}' },
  ]);
  check('text blocks are joined and non-text ignored', withOtherBlocks.text === 'Answer.');

  const badUrgency = parseReply([
    { type: 'text', text: JSON.stringify({ text: 'Fine.', urgency: { level: 'critical', text: 'x' }, cta: null }) },
  ]);
  check('an urgency level the UI cannot render is dropped, not passed through', badUrgency.urgency === undefined);

  const emptyUrgencyText = parseReply([
    { type: 'text', text: JSON.stringify({ text: 'Fine.', urgency: { level: 'high', text: '   ' }, cta: null }) },
  ]);
  check('an urgency with no explanation is dropped', emptyUrgencyText.urgency === undefined);

  const foreignCta = parseReply([
    { type: 'text', text: JSON.stringify({ text: 'Fine.', urgency: null, cta: { action: 'wire_me_money' } }) },
  ]);
  check('an unknown CTA action is dropped', foreignCta.cta === undefined);

  for (const [label, blocks] of [
    ['no text blocks at all', [{ type: 'thinking', text: '' }]],
    ['text that is not JSON', [{ type: 'text', text: 'Sorry, I cannot help.' }]],
    ['JSON with no answer in it', [{ type: 'text', text: '{"urgency":null,"cta":null}' }]],
    ['an empty answer', [{ type: 'text', text: '{"text":"   ","urgency":null,"cta":null}' }]],
  ] as const) {
    let threw = false;
    try {
      parseReply([...blocks]);
    } catch {
      threw = true;
    }
    check(`${label} throws rather than showing the owner a blob`, threw);
  }

  /* --------------------------------------------------- the grounding facts */

  section('ask ca: the facts given to the model');

  const { db, request, close } = await startTestServer();

  try {
    setRecallFetcherForTesting(async () => [
      {
        campaignNumber: '23V751000',
        component: 'AIR BAGS',
        summary: 'The inflator may rupture.',
        consequence: 'Metal fragments can injure the driver.',
        remedy: 'Dealers will replace the inflator free of charge.',
        parkIt: true,
        parkOutside: false,
        reportedOn: '2023-10-19',
      },
    ]);
    setComplaintFetcherForTesting(async () => [
      {
        component: 'SERVICE BRAKES',
        reportCount: 6,
        crashCount: 1,
        fireCount: 0,
        injuryCount: 0,
        deathCount: 0,
        latestIncidentOn: '2025-02-17',
        quotes: [{ text: 'Brake pedal travels almost to the floor.' }],
      },
    ]);

    setSafetyRatingFetcherForTesting(async () => [
      {
        ncapVehicleId: 14009,
        description: '2019 Honda CIVIC 4 DR FWD',
        overallRating: 5,
        frontCrashRating: 5,
        sideCrashRating: 5,
        rolloverRating: 5,
        rolloverPossibility: 0.095,
        forwardCollisionWarning: 'standard',
        laneDepartureWarning: 'optional',
        electronicStabilityControl: 'standard',
      },
      // A variant NHTSA never crash-tested, to prove the block says untested rather
      // than implying a bad result.
      {
        ncapVehicleId: 14005,
        description: '2019 Honda CIVIC 2 DR FWD',
        forwardCollisionWarning: 'no',
      },
    ]);

    const [vehicle] = await db.select().from(t.vehicles).where(eq(t.vehicles.mileage, 68400));
    const context = await buildVehicleContext(db as unknown as Database, vehicle);

    check('the car itself is stated', context.includes('2019 Honda Civic'));
    check('the odometer is stated', context.includes('68,400 miles'));

    // Provenance is the point: the model has to be able to tell the owner the
    // difference between an official finding and an unverified complaint.
    check('recalls are labelled as official NHTSA campaigns', context.includes('official NHTSA campaigns'));
    check('the campaign number is included so a dealer can look it up', context.includes('23V751000'));
    check("NHTSA's stop-driving advisory is flagged in caps", context.includes('[NHTSA SAYS STOP DRIVING]'));
    check('an unanswered recall says the owner has not said', context.includes('the owner has not said whether this was repaired'));
    check('the per-model limit of recall data is stated', context.includes('cannot say whether THIS car was repaired'));

    check('complaints are labelled unverified', context.includes('unverified first-hand accounts'));
    check('and explicitly not confirmed faults', context.includes('NOT confirmed faults'));
    check('and not proof this car will develop it', context.includes('not proof this car will develop the same problem'));
    check('the complaint count is included', context.includes('6 reports'));
    check('casualties are included', context.includes('1 crash'));
    check("an owner's own words are quoted", context.includes('Brake pedal travels almost to the floor'));

    check("crash tests are labelled as NHTSA's own", context.includes("NHTSA's own 5-star crash tests"));
    check('the star scale is explained rather than assumed', context.includes('Stars are out of 5'));
    check('the overall rating appears', context.includes('5/5 overall'));
    check('the rollover chance is given as a percentage', context.includes('9.5%'));
    check('a standard driver aid is stated as standard', context.includes('forward collision warning was standard'));
    check('an optional one is stated as optional', context.includes('lane departure warning was optional'));
    // Fitment is per tested variant, so the model must not assert the owner's trim has it.
    check('the model is told to have the owner check their own trim', context.includes("the owner's own trim may differ"));
    check('ratings are scoped to the model, not this car', context.includes('results for the MODEL'));
    check('separate body styles are explained', context.includes('tests each body style and drivetrain separately'));
    // An untested variant must not read as a failed one.
    check('an untested variant says it has no rating', context.includes('no overall rating'));
    check('a feature never offered is stated as not offered', context.includes('was not offered'));

    check('upkeep intervals are attributed to the owner', context.includes('intervals the OWNER set'));
    check('the seeded overdue job appears', context.includes('Tyre rotation'));
    check('its computed status appears', context.includes('[overdue]'));
    check('upkeep status is described as computed, not authoritative', context.includes('Status is computed'));

    check('service history is flagged as incomplete', context.includes('Incomplete by nature'));
    check('a logged service appears with its odometer', context.includes('63,900 mi'));

    /* ------------------------- a source that could not be reached is "unknown" */

    setRecallFetcherForTesting(async () => undefined);
    setComplaintFetcherForTesting(async () => undefined);
    setSafetyRatingFetcherForTesting(async () => undefined);
    const [dana] = await db.select().from(t.vehicles).where(eq(t.vehicles.mileage, 31200));
    const unknownContext = await buildVehicleContext(db as unknown as Database, dana);

    // The single most important line in the whole block.
    check('an unreachable recall feed says recalls are unknown', unknownContext.includes('recalls are unknown'));
    check('and says explicitly that this is not an all-clear', unknownContext.includes('NOT an all-clear'));
    check('an unreachable complaint feed is not reported as no problems', unknownContext.includes('Do not treat that as "no known problems"'));
    check(
      'an unreachable crash-test feed is not reported as a bad result',
      unknownContext.includes('Not a sign the car did badly'),
    );

    /* -------------------------------------------------------- the route paths */

    section('ask ca: the route');

    setRecallFetcherForTesting(async () => []);
    setComplaintFetcherForTesting(async () => []);
    setSafetyRatingFetcherForTesting(async () => []);

    let seen: AskInput | undefined;
    setAskerForTesting(async (input) => {
      seen = input;
      return {
        role: 'assistant',
        text: 'Six owners reported brake problems on this model.',
        urgency: { level: 'medium', text: 'Urgency: Medium - have it inspected' },
      };
    });

    const asked = await request('POST', '/api/chat', {
      body: {
        text: 'My brakes feel spongy.',
        history: [
          { role: 'user', text: 'Is my car safe to drive?' },
          { role: 'assistant', text: 'There is one open recall.' },
        ],
      },
    });
    check('POST /api/chat returns 201', asked.status === 201, `got ${asked.status}`);
    check("the model's answer is what comes back", asked.body.assistant.text.includes('Six owners reported'));
    check('urgency survives the round trip', asked.body.assistant.urgency?.level === 'medium');
    check('the question is echoed back as the user turn', asked.body.user.text === 'My brakes feel spongy.');

    check('the question reached the model', seen?.question === 'My brakes feel spongy.');
    check("and so did this owner's car", seen?.vehicleContext.includes('2019 Honda Civic') === true);

    // The conversation is not stored, so a follow-up only makes sense if the turns the
    // client sent are the turns the model gets.
    check('the client-supplied conversation reached the model', seen?.history.length === 2);
    check('oldest turn first, as the model expects', seen?.history[0].text === 'Is my car safe to drive?');
    check('and the question itself is not duplicated into the history', !seen?.history.some((turn) => turn.text.includes('spongy')));

    // Nothing was written, so the next request starts from whatever the client sends --
    // which is what makes leaving the screen clear the conversation.
    const fresh = await request('POST', '/api/chat', { body: { text: 'Anything I missed?' } });
    check('a request with no history is answered as a fresh conversation', fresh.status === 201, `got ${fresh.status}`);
    check('and the model is given no prior turns', seen?.history.length === 0);

    /* --------------------------- more turns than one request should carry */

    const longRun = Array.from({ length: 30 }, (_, index) => ({
      role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      text: `turn ${index}`,
    }));
    await request('POST', '/api/chat', { body: { text: 'Still there?', history: longRun } });
    check('a long conversation is capped before it reaches the model', (seen?.history.length ?? 0) <= 10);
    check('and it is the most recent turns that survive', seen?.history.at(-1)?.text === 'turn 29');

    /* ------------------- a failure is honest, not a canned answer in disguise */

    setAskerForTesting(async () => {
      throw new Error('connection reset');
    });
    const failed = await request('POST', '/api/chat', { body: { text: 'Anything else?' } });
    check('a failed model call still returns 201 with a reply', failed.status === 201, `got ${failed.status}`);
    // The alternative -- silently serving a canned reply -- would be the app telling
    // the owner something it did not actually work out.
    check('the reply says the question was not answered', failed.body.assistant.text.includes('has not been answered'));
    check('and does not pretend to be an answer', !failed.body.assistant.text.includes('Six owners'));

    check('the question is still echoed back so the screen keeps the pair', failed.body.user.text === 'Anything else?');

    setAskerForTesting(async () => {
      throw new Error('That question was declined by a safety filter. Try rephrasing it.');
    });
    const declined = await request('POST', '/api/chat', { body: { text: 'Something refused.' } });
    check('a declined question says so rather than blaming the network', declined.body.assistant.text.includes('declined'));
  } finally {
    setAskerForTesting(undefined);
    goOffline();
    await close();
  }
}
