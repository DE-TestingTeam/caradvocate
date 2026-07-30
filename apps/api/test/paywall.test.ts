/**
 * The v1 paywall: the gate, and the purchase-intent record behind it.
 *
 * This is the prototype's measurement instrument, so the tests are about the
 * integrity of the measurement rather than about the UI:
 *
 *   - A free owner must not be able to reach the paid feature. If they can, some
 *     taps are missing from the data and the conversion rate is wrong.
 *   - The recorded price must be the price that was on screen, not whatever the
 *     config says at analysis time.
 *   - A second tap must record a second row. Re-deciding at a new price is the
 *     finding, and de-duplicating it would erase exactly that.
 *   - Nobody is charged, and the gate is not a licence check -- unlocking is
 *     one-way and needs no receipt.
 *
 * Dana is the seeded account still behind the paywall; Alex is seeded past it.
 */
import { asc, eq } from 'drizzle-orm';
import * as t from '../src/db/schema.js';
import { check, section } from './assert.js';
import { startTestServer } from './server.js';

const DANA = 'dana@example.com';

export async function run(): Promise<void> {
  section('paywall (fake, v1)');
  const { db, request, close } = await startTestServer();

  try {
    /* ------------------------------------------------------------- the offer */

    const offer = await request('GET', '/api/paywall', { as: DANA });
    check('the paywall is readable by a free owner', offer.status === 200, `got ${offer.status}`);
    check('and says they are not past it', offer.body.unlocked === false);
    check('it carries a price in whole cents', Number.isInteger(offer.body.priceCents));
    check('a positive one', offer.body.priceCents > 0, `got ${offer.body.priceCents}`);
    check('a currency the client can format', offer.body.currency === 'USD');
    // The spec is explicit that v1 tests a subscription, never per-incident pricing.
    check(
      'a subscription cadence, not a one-off',
      offer.body.interval === 'month' || offer.body.interval === 'year',
      `got ${offer.body.interval}`,
    );
    check('and what unlocking includes', Array.isArray(offer.body.includes) && offer.body.includes.length > 0);

    const alexOffer = await request('GET', '/api/paywall');
    check('an already-unlocked owner is told so', alexOffer.body.unlocked === true);

    /* -------------------------------------------------- the gate actually gates */

    // Each of these is a way into the paid feature. A hole in any one of them is a
    // free owner getting the feature without a tap, which is a hole in the data.
    const listed = await request('GET', '/api/assessments', { as: DANA });
    check('a free owner cannot list assessments', listed.status === 402, `got ${listed.status}`);
    check(
      'and is told why, in a code the client can act on',
      listed.body.error?.code === 'payment_required',
      JSON.stringify(listed.body),
    );

    const created = await request('POST', '/api/assessments', {
      as: DANA,
      body: { repairId: '00000000-0000-0000-0000-000000000000' },
    });
    check('a free owner cannot create one', created.status === 402, `got ${created.status}`);

    const [danasOwn] = await db
      .select()
      .from(t.assessments)
      .where(eq(t.assessments.repairName, 'Dana private brake job'));

    // Her own row, not someone else's: this is the gate refusing, not authorisation.
    const readOwn = await request('GET', `/api/assessments/${danasOwn.id}`, { as: DANA });
    check(
      'the gate refuses even her own existing assessment',
      readOwn.status === 402,
      `got ${readOwn.status}`,
    );

    const completed = await request('POST', `/api/assessments/${danasOwn.id}/complete`, {
      as: DANA,
      body: { cost: 400 },
    });
    check('and refuses completing one', completed.status === 402, `got ${completed.status}`);

    // Free features stay free. The spec keeps chat and My Car open to everyone.
    const chat = await request('POST', '/api/chat', {
      as: DANA,
      body: { text: 'Is my car ok?', history: [] },
    });
    // Success rather than an exact code: api.test.ts owns chat's status contract, and
    // all this suite claims is that the gate is not in the way.
    check('chat is not behind the paywall', chat.status < 400, `got ${chat.status}`);
    const myCar = await request('GET', '/api/vehicle', { as: DANA });
    check('nor is My Car', myCar.status < 400, `got ${myCar.status}`);

    /* ----------------------------------------------------------- the unlock tap */

    const unlocked = await request('POST', '/api/paywall/unlock', {
      as: DANA,
      body: { source: 'repair_cost_checker' },
    });
    check('unlocking answers 200', unlocked.status === 200, `got ${unlocked.status}`);
    check('and reports the owner is now past the paywall', unlocked.body.unlocked === true);

    const [intent] = await db
      .select()
      .from(t.paywallIntents)
      .orderBy(asc(t.paywallIntents.createdAt));

    check('the tap was recorded', Boolean(intent));
    check(
      'against the price that was on screen, not read back from config later',
      intent.priceCents === offer.body.priceCents,
      `recorded ${intent?.priceCents}, shown ${offer.body.priceCents}`,
    );
    check('with the cadence it was offered at', intent.interval === offer.body.interval);
    check(
      'and where it was tapped, so conversion can be read by entry point',
      intent.source === 'repair_cost_checker',
      `got ${intent?.source}`,
    );

    /* ------------------------------------------------ and the feature is open */

    const afterList = await request('GET', '/api/assessments', { as: DANA });
    check('the paid feature opens immediately', afterList.status === 200, `got ${afterList.status}`);
    check('showing her own assessment', afterList.body.length === 1, `got ${afterList.body.length}`);

    const account = await request('GET', '/api/account', { as: DANA });
    check('the account reads as paid', account.body.plan === 'paid', `got ${account.body.plan}`);

    const checker = account.body.features.find((f: any) => f.name === 'Repair Cost Checker');
    check('and the Account feature row no longer says Locked', checker?.status === 'Active', `got ${checker?.status}`);
    // Widening that update to every row would have relabelled these two.
    check(
      'while the free features are untouched',
      account.body.features
        .filter((f: any) => f.name !== 'Repair Cost Checker')
        .every((f: any) => f.status === 'Included'),
      JSON.stringify(account.body.features),
    );

    /* ------------------------------------------- a second decision is a second row */

    const again = await request('POST', '/api/paywall/unlock', {
      as: DANA,
      body: { source: 'account' },
    });
    check('tapping again is not an error', again.status === 200, `got ${again.status}`);

    const allIntents = await db
      .select()
      .from(t.paywallIntents)
      .where(eq(t.paywallIntents.userId, intent.userId));
    check(
      'and is recorded rather than de-duplicated',
      allIntents.length === 2,
      `got ${allIntents.length}`,
    );

    /* ------------------------------------------------------------- validation */

    const noSource = await request('POST', '/api/paywall/unlock', { as: DANA, body: {} });
    check(
      'an unlock with no source is rejected, not attributed to a guess',
      noSource.status === 422,
      `got ${noSource.status}`,
    );

    const badSource = await request('POST', '/api/paywall/unlock', {
      as: DANA,
      body: { source: 'somewhere_else' },
    });
    check('as is an unrecognised one', badSource.status === 422, `got ${badSource.status}`);

    /* ----------------------------------------------- one owner, one unlock state */

    const alexIntents = await db.select().from(t.paywallIntents);
    check(
      "Dana's taps did not unlock anyone else",
      alexIntents.every((row) => row.userId === intent.userId),
    );
  } finally {
    await close();
  }
}
