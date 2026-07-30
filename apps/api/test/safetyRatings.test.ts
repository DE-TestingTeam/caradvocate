/**
 * NHTSA crash-test rating parsing, the local mirror, and the wire contract.
 *
 * The payloads below are captured from api.nhtsa.gov, so the shapes are real. Three
 * things are worth guarding, because each is a silent failure:
 *
 *   - `"Not Rated"` must become absent, never zero. A car nobody crash-tested
 *     rendering as a zero-star car is the worst output this feed could produce.
 *   - `RolloverPossibility` is `0.0` on unrated variants, which would read as
 *     "cannot roll over" if passed through.
 *   - This feed capitalises `Results`, where recalls and complaints use `results`.
 */
import { and, eq } from 'drizzle-orm';
import * as t from '../src/db/schema.js';
import { fetchSafetyRatings, parseVariantDetail, readVariants } from '../src/services/safetyRatings.js';
import {
  getModelSafetyRatings,
  setSafetyRatingFetcherForTesting,
} from '../src/services/safetyRatingSync.js';
import type { FetchedSafetyRating } from '../src/services/safetyRatings.js';
import type { Database } from '../src/db/index.js';
import { check, section } from './assert.js';
import { goOffline } from './offline.js';
import { startTestServer } from './server.js';

/** Captured from the model listing for a 2019 Honda Civic. */
const LIVE_LISTING = {
  Count: 2,
  Message: 'Results returned successfully',
  Results: [
    { VehicleDescription: '2019 Honda CIVIC 4 DR FWD', VehicleId: 14009 },
    { VehicleDescription: '2019 Honda CIVIC 2 DR FWD', VehicleId: 14005 },
  ],
};

/** Captured from /SafetyRatings/VehicleId/13278 -- a fully rated variant. */
const LIVE_DETAIL = {
  Count: 1,
  Message: 'Results returned successfully',
  Results: [
    {
      VehicleDescription: '2019 Ford F-150 Super Crew PU/CC 4x2',
      OverallRating: '5',
      OverallFrontCrashRating: '5',
      OverallSideCrashRating: '5',
      RolloverRating: '4',
      RolloverPossibility: 0.191,
      NHTSAForwardCollisionWarning: 'Standard',
      NHTSALaneDepartureWarning: 'Optional',
      NHTSAElectronicStabilityControl: 'Standard',
      ComplaintsCount: 953,
      RecallsCount: 6,
    },
  ],
};

/** Captured from /SafetyRatings/VehicleId/1 -- a 2011 Audi A3, tested for nothing. */
const LIVE_UNRATED = {
  Count: 1,
  Results: [
    {
      VehicleDescription: '2011 Audi A3 4 DR FWD',
      OverallRating: 'Not Rated',
      OverallFrontCrashRating: 'Not Rated',
      OverallSideCrashRating: 'Not Rated',
      RolloverRating: 'Not Rated',
      RolloverPossibility: 0.0,
      NHTSAForwardCollisionWarning: 'No',
      NHTSALaneDepartureWarning: 'No',
      NHTSAElectronicStabilityControl: 'Standard',
    },
  ],
};

const CIVIC = { year: 2019, make: 'Honda', model: 'Civic' };
const REF = { ncapVehicleId: 13278, description: 'listing name' };

function variant(
  overrides: Partial<FetchedSafetyRating> & { ncapVehicleId: number },
): FetchedSafetyRating {
  return {
    description: `variant ${overrides.ncapVehicleId}`,
    overallRating: 5,
    frontCrashRating: 5,
    sideCrashRating: 5,
    rolloverRating: 4,
    rolloverPossibility: 0.191,
    forwardCollisionWarning: 'standard',
    laneDepartureWarning: 'optional',
    electronicStabilityControl: 'standard',
    ...overrides,
  };
}

export async function run(): Promise<void> {
  /* ------------------------------------------------------------- parsing */

  section('safety ratings: listing parsing');

  const listed = readVariants(LIVE_LISTING);
  check('a live-shape listing yields both variants', listed.length === 2, `got ${listed.length}`);
  check('the NHTSA vehicle id is extracted', listed[0]?.ncapVehicleId === 14009);
  check('the variant description is extracted', listed[0]?.description === '2019 Honda CIVIC 4 DR FWD');

  // The make-level listing uses VehicleId 0 as a placeholder, so zero is not an id.
  const placeholder = readVariants({ Results: [{ ModelYear: 2019, Make: 'FORD', Model: 'EDGE', VehicleId: 0 }] });
  check('a placeholder VehicleId of 0 is not treated as a variant', placeholder.length === 0);

  const duplicated = readVariants({ Results: [{ VehicleId: 7 }, { VehicleId: 7 }] });
  check('a variant listed twice is deduplicated', duplicated.length === 1);

  const unnamed = readVariants({ Results: [{ VehicleId: 7 }] });
  check('a variant with no description still gets a label', unnamed[0]?.description === 'NHTSA vehicle 7');

  // The trap: this feed capitalises Results.
  check('lowercase "results" is not read as the payload', readVariants({ results: [{ VehicleId: 7 }] }).length === 0);

  section('safety ratings: detail parsing');

  const rated = parseVariantDetail(REF, LIVE_DETAIL);
  check('a live-shape detail parses', rated !== undefined);
  check('string star ratings become numbers', rated?.overallRating === 5, `got ${rated?.overallRating}`);
  check('the front crash rating is read', rated?.frontCrashRating === 5);
  check('the rollover rating is read', rated?.rolloverRating === 4);
  check('the rollover possibility is read', rated?.rolloverPossibility === 0.191);
  check('the detail description wins over the listing name', rated?.description === '2019 Ford F-150 Super Crew PU/CC 4x2');
  check('"Standard" is normalised', rated?.forwardCollisionWarning === 'standard');
  check('"Optional" is normalised', rated?.laneDepartureWarning === 'optional');

  // The most important assertion in this file.
  const unrated = parseVariantDetail(REF, LIVE_UNRATED);
  check('"Not Rated" becomes absent, not zero', unrated?.overallRating === undefined, `got ${unrated?.overallRating}`);
  check('every unrated field is absent', unrated?.frontCrashRating === undefined && unrated?.rolloverRating === undefined);
  check(
    'a 0.0 rollover possibility is withheld rather than read as "cannot roll over"',
    unrated?.rolloverPossibility === undefined,
    `got ${unrated?.rolloverPossibility}`,
  );
  // "No" is a finding about the model, distinct from NHTSA recording nothing.
  check('"No" fitment is kept as a value', unrated?.forwardCollisionWarning === 'no');
  check('a fitted feature on an unrated car still comes through', unrated?.electronicStabilityControl === 'standard');

  const outOfRange = parseVariantDetail(REF, { Results: [{ OverallRating: '9', RolloverPossibility: 4 }] });
  check('a star rating outside 1-5 is discarded', outOfRange?.overallRating === undefined);
  check('a rollover possibility above 1 is discarded', outOfRange?.rolloverPossibility === undefined);

  const unknownFitment = parseVariantDetail(REF, { Results: [{ NHTSALaneDepartureWarning: 'Maybe' }] });
  check('an unrecognised fitment is dropped', unknownFitment?.laneDepartureWarning === undefined);

  check('an unknown VehicleId yields nothing', parseVariantDetail(REF, { Count: 0, Results: [] }) === undefined);

  for (const [label, payload] of [
    ['an empty body', {}],
    ['a null body', null],
    ['Results that is not an array', { Results: 'nope' }],
    ['a string instead of an object', 'nope'],
    ['Results holding junk', { Results: [null, 'x', 42, []] }],
  ] as const) {
    let survived = true;
    try {
      readVariants(payload);
      parseVariantDetail(REF, payload);
    } catch {
      survived = false;
    }
    check(`parsing survives ${label}`, survived);
  }

  /* -------------------------------------------------- the model-name widening */

  /*
   * The part of this integration with no counterpart in the other feeds, and the part
   * a captured payload cannot exercise: NCAP files an F-150 under five body-style
   * names, so an exact lookup for "F-150" finds nothing and the fetcher has to widen.
   *
   * These stub `fetch` rather than the fetcher seam, because the request sequence
   * *is* the logic under test.
   */
  section('safety ratings: NCAP model-name widening');

  const realFetch = globalThis.fetch;

  /**
   * Answers NCAP URLs from a list of pattern -> payload. Anything unmatched 404s.
   *
   * Patterns are anchored regexes rather than substrings, because `/model/F-150` is a
   * prefix of `/model/F-150%20SUPER%20CREW` and loose matching would have the stub
   * answer the widened lookup with the exact lookup's empty result -- testing the
   * stub instead of the code.
   */
  function stubNcap(routes: [RegExp, unknown][]): () => string[] {
    const seen: string[] = [];
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      seen.push(url);
      const hit = routes.find(([pattern]) => pattern.test(url));
      if (!hit) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(hit[1]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof globalThis.fetch;
    return () => seen;
  }

  try {
    /* -------------------------------------- an exact match must not widen */

    let calls = stubNcap([
      [/\/model\/Civic$/, LIVE_LISTING],
      [/\/VehicleId\/\d+$/, LIVE_DETAIL],
    ]);
    const exact = await fetchSafetyRatings(CIVIC);
    check('an exact model match yields its variants', exact?.length === 2, `got ${exact?.length}`);
    check(
      'and does not fall back to scanning the make',
      !calls().some((url) => /\/make\/Honda$/.test(url)),
      calls().join(' '),
    );

    /* ------------------------------------ a body-style-qualified model widens */

    calls = stubNcap([
      // NCAP has no plain "F-150", which is exactly the trap. Anchored, so it does
      // not also answer the qualified lookups below.
      [/\/model\/F-150$/, { Count: 0, Results: [] }],
      [
        /\/make\/Ford$/,
        {
          Count: 4,
          Results: [
            { ModelYear: 2019, Make: 'FORD', Model: 'F-150 SUPER CREW', VehicleId: 0 },
            // Lowercase i, as the live feed really has it.
            { ModelYear: 2019, Make: 'FORD', Model: 'F-150 SUPER CREW DiESEL', VehicleId: 0 },
            { ModelYear: 2019, Make: 'FORD', Model: 'FIESTA', VehicleId: 0 },
            { ModelYear: 2019, Make: 'FORD', Model: 'MUSTANG', VehicleId: 0 },
          ],
        },
      ],
      [/F-150%20SUPER%20CREW%20DiESEL$/, { Count: 1, Results: [{ VehicleId: 13282, VehicleDescription: 'diesel' }] }],
      [/F-150%20SUPER%20CREW$/, { Count: 1, Results: [{ VehicleId: 13278, VehicleDescription: 'super crew' }] }],
      [/\/VehicleId\/\d+$/, LIVE_DETAIL],
    ]);

    const widened = await fetchSafetyRatings({ year: 2019, make: 'Ford', model: 'F-150' });
    check('a model NCAP files under body-style names still resolves', (widened?.length ?? 0) > 0, `got ${widened?.length}`);
    check('both qualified names are followed', widened?.length === 2, `got ${widened?.length}`);
    const requested = calls();
    check('the make is listed only after the exact name misses', requested.some((url) => url.endsWith('/make/Ford')));
    // Prefix matching must not drag in the rest of the catalogue.
    check('an unrelated model is not fetched', !requested.some((url) => url.includes('FIESTA')));
    check('another unrelated model is not fetched', !requested.some((url) => url.includes('MUSTANG')));

    /* --------------------------------- prefix matching is anchored, not substring */

    calls = stubNcap([
      [/\/model\/150$/, { Count: 0, Results: [] }],
      [/\/make\/Ford$/, { Count: 1, Results: [{ Model: 'F-150 SUPER CREW', VehicleId: 0 }] }],
    ]);
    const substring = await fetchSafetyRatings({ year: 2019, make: 'Ford', model: '150' });
    check(
      '"150" does not match "F-150 SUPER CREW" -- prefix, not substring',
      substring?.length === 0,
      `got ${substring?.length}`,
    );

    /* ---------------- a failed widening is unreachable, not "never tested" */

    // The exact lookup answers honestly with nothing; the make listing then fails.
    // Returning [] here would be stored as a successful check and cached for a week,
    // leaving an F-150 reading "not crash-tested" because of one dropped request.
    calls = stubNcap([[/\/model\/F-150$/, { Count: 0, Results: [] }]]);
    const widenFailed = await fetchSafetyRatings({ year: 2019, make: 'Ford', model: 'F-150' });
    check(
      'a failed widening request reports unreachable, not an empty result',
      widenFailed === undefined,
      `got ${JSON.stringify(widenFailed)}`,
    );

    /* --------------------------- a genuinely untested model is still empty */

    calls = stubNcap([
      [/\/model\/DMC-12$/, { Count: 0, Results: [] }],
      [/\/make\/DeLorean$/, { Count: 0, Results: [] }],
    ]);
    const untestedModel = await fetchSafetyRatings({ year: 1998, make: 'DeLorean', model: 'DMC-12' });
    check(
      'a model NHTSA has genuinely never tested is empty, not unreachable',
      untestedModel?.length === 0,
      `got ${JSON.stringify(untestedModel)}`,
    );

    /* ------------------------- a dead variant does not sink the whole model */

    calls = stubNcap([
      [/\/model\/Civic$/, LIVE_LISTING],
      // Only one of the two ids resolves; the other 404s.
      [/\/VehicleId\/14009$/, LIVE_DETAIL],
    ]);
    const partial = await fetchSafetyRatings(CIVIC);
    check(
      'one variant failing still returns the others',
      partial?.length === 1,
      `got ${partial?.length}`,
    );

    /* ----------------------------- an unreachable first request is unreachable */

    calls = stubNcap([]);
    check('a failed first request reports unreachable', (await fetchSafetyRatings(CIVIC)) === undefined);
  } finally {
    globalThis.fetch = realFetch;
  }

  /* ---------------------------------------------------------- the mirror */

  section('safety ratings: the local mirror');

  const { db, request, close } = await startTestServer();

  try {
    let fetches = 0;
    let upstream: FetchedSafetyRating[] | undefined = [
      variant({ ncapVehicleId: 13278, description: 'F-150 4x2', overallRating: 5 }),
      variant({ ncapVehicleId: 13277, description: 'F-150 4x4', overallRating: 3 }),
      variant({
        ncapVehicleId: 13279,
        description: 'F-150 untested',
        overallRating: undefined,
        rolloverPossibility: undefined,
      }),
    ];
    setSafetyRatingFetcherForTesting(async () => {
      fetches += 1;
      return upstream;
    });

    const first = await request('GET', '/api/vehicle/safety');
    check('GET /api/vehicle/safety returns 200', first.status === 200, `got ${first.status}`);
    check('the first read fetches from upstream', fetches === 1, `got ${fetches}`);
    check('every tested variant comes back', first.body.variants.length === 3, `got ${first.body.variants.length}`);
    check('a reached upstream reports checked', first.body.checked === true);

    const order = first.body.variants.map((v: { description: string }) => v.description);

    // Variants are not averaged, and the worst result leads: a three-star cab must
    // not sit below the reassuring five-star one.
    check('the worst-rated variant sorts first', order[0] === 'F-150 4x4', order.join(','));
    check('the better-rated variant follows', order[1] === 'F-150 4x2', order.join(','));
    // No rating is not a bad rating.
    check('an untested variant sorts last, not as the worst', order[2] === 'F-150 untested', order.join(','));

    const worst = first.body.variants[0];
    check('stars reach the client as numbers', worst.overall === 3, `got ${worst.overall}`);
    check('the rollover possibility survives the numeric round trip', worst.rolloverPossibility === 0.191, `got ${worst.rolloverPossibility}`);
    check('fitment reaches the client', worst.forwardCollisionWarning === 'standard');
    check('an untested variant has no overall rating on the wire', first.body.variants[2].overall === undefined);

    const second = await request('GET', '/api/vehicle/safety');
    check('a second read is served from the mirror', fetches === 1, `refetched ${fetches} times`);
    check('the mirror returns the same count', second.body.variants.length === 3);

    /* ------------------------------------------ a retired variant is dropped */

    upstream = [variant({ ncapVehicleId: 13278, description: 'F-150 4x2 retested', overallRating: 4 })];
    const later = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    const resynced = await getModelSafetyRatings(db as unknown as Database, CIVIC, later);

    check('a stale mirror is refreshed', fetches === 2, `got ${fetches}`);
    check('variants NHTSA dropped are removed locally', resynced.variants.length === 1, `got ${resynced.variants.length}`);
    check('a revised rating is updated in place', resynced.variants[0]?.overallRating === 4);
    check('the surviving row keeps its NHTSA id', resynced.variants[0]?.ncapVehicleId === 13278);

    /* -------------------------------- a failed refresh must not blank the panel */

    upstream = undefined;
    const evenLater = new Date(later.getTime() + 8 * 24 * 60 * 60 * 1000);
    const afterFailure = await getModelSafetyRatings(db as unknown as Database, CIVIC, evenLater);

    check('a failed refresh was attempted', fetches === 3, `got ${fetches}`);
    check('existing ratings survive a failed refresh', afterFailure.variants.length === 1);
    check('an earlier success still counts as checked', afterFailure.synced === true);

    const immediately = new Date(evenLater.getTime() + 60 * 1000);
    await getModelSafetyRatings(db as unknown as Database, CIVIC, immediately);
    check('a failure is not retried on the next request', fetches === 3, `got ${fetches}`);

    const afterCooldown = new Date(evenLater.getTime() + 20 * 60 * 1000);
    await getModelSafetyRatings(db as unknown as Database, CIVIC, afterCooldown);
    check('a failure is retried once the cooldown passes', fetches === 4, `got ${fetches}`);

    /* --------------------- never reaching NHTSA is not "untested" */

    const unknown = { year: 1998, make: 'DeLorean', model: 'DMC-12' };
    upstream = undefined;
    const neverReached = await getModelSafetyRatings(db as unknown as Database, unknown, new Date());
    check('a model that was never checked has no ratings', neverReached.variants.length === 0);
    check('and does not claim to have been checked', neverReached.synced === false);

    /* ------------------------------ a genuine "never tested" is recorded */

    upstream = [];
    const untested = await getModelSafetyRatings(
      db as unknown as Database,
      unknown,
      new Date(Date.now() + 30 * 60 * 1000),
    );
    check('a model NHTSA never tested has no ratings', untested.variants.length === 0);
    check('but it does report having been checked', untested.synced === true);

    /* ------------------------------------------ make and model are normalised */

    const rows = await db
      .select()
      .from(t.modelSafetyRatings)
      .where(and(eq(t.modelSafetyRatings.make, 'HONDA'), eq(t.modelSafetyRatings.model, 'CIVIC')));
    check('make and model are stored uppercase so spellings cannot fork', rows.length === 1, `got ${rows.length}`);

    const lowercased = await getModelSafetyRatings(
      db as unknown as Database,
      { year: 2019, make: 'honda', model: 'civic' },
      new Date(),
    );
    check('a differently-cased lookup finds the same mirror', lowercased.variants.length === 1);

    /* ------------------------------------------------------ tenant isolation */

    // Ratings are global reference data, so Dana reads her own model's, not Alex's.
    const dana = await request('GET', '/api/vehicle/safety', { as: 'dana@example.com' });
    check('another owner gets their own model, not this one', dana.status === 200, `got ${dana.status}`);
    check(
      "a different model's ratings are not served from this model's mirror",
      dana.body.variants.every((v: { description: string }) => v.description !== 'F-150 4x2 retested'),
    );
  } finally {
    goOffline();
    await close();
  }
}
