/**
 * NHTSA recall parsing, the local mirror, and the wire contract.
 *
 * Unlike the VIN decoder, this parser was written against a response captured from
 * the live service, so the payload below is a real one (trimmed). The two details
 * worth guarding are NHTSA's DD/MM/YYYY dates and the `parkOutSide` spelling --
 * both are silent failures if read wrong: one shifts dates by months, the other
 * downgrades the most urgent recalls it publishes.
 */
import { and, eq } from 'drizzle-orm';
import * as t from '../src/db/schema.js';
import { parseRecallsResponse } from '../src/services/recalls.js';
import { getModelRecalls, setRecallFetcherForTesting } from '../src/services/recallSync.js';
import type { FetchedRecall } from '../src/services/recalls.js';
import type { Database } from '../src/db/index.js';
import { check, section } from './assert.js';
import { goOffline } from './offline.js';
import { startTestServer } from './server.js';

/** Captured from api.nhtsa.gov for a 2019 Honda Civic. */
const LIVE_SHAPE = {
  Count: 1,
  Message: 'Results returned successfully',
  results: [
    {
      Manufacturer: 'Honda (American Honda Motor Co.)',
      NHTSACampaignNumber: '20V314000',
      parkIt: false,
      parkOutSide: false,
      overTheAirUpdate: false,
      ReportReceivedDate: '28/05/2020',
      Component: 'FUEL SYSTEM, GASOLINE:DELIVERY:FUEL PUMP',
      Summary: 'The low-pressure fuel pump inside the fuel tank  may fail.',
      Consequence: 'If the fuel pump fails, the engine can stall while driving.',
      Remedy: 'Dealers will replace the fuel pump assembly, free of charge.',
      ModelYear: '2019',
      Make: 'HONDA',
      Model: 'CIVIC',
    },
  ],
};

const CIVIC = { year: 2019, make: 'Honda', model: 'Civic' };

function recall(overrides: Partial<FetchedRecall> & { campaignNumber: string }): FetchedRecall {
  return {
    component: 'STEERING',
    summary: 'summary',
    consequence: 'consequence',
    remedy: 'remedy',
    parkIt: false,
    parkOutside: false,
    ...overrides,
  };
}

export async function run(): Promise<void> {
  /* ------------------------------------------------------------- parsing */

  section('recalls: NHTSA response parsing');

  const parsed = parseRecallsResponse(LIVE_SHAPE);
  check('a live-shape response yields one recall', parsed.length === 1, `got ${parsed.length}`);
  check('the campaign number is extracted', parsed[0]?.campaignNumber === '20V314000');
  check('the component is extracted', parsed[0]?.component === 'FUEL SYSTEM, GASOLINE:DELIVERY:FUEL PUMP');
  check('the consequence is extracted', parsed[0]?.consequence.startsWith('If the fuel pump fails'));
  check('NHTSA double spaces are collapsed', parsed[0]?.summary === 'The low-pressure fuel pump inside the fuel tank may fail.');

  // The trap: 28/05/2020 is 28 May, not 5 February.
  check('DD/MM/YYYY is read day-first', parsed[0]?.reportedOn === '2020-05-28', `got ${parsed[0]?.reportedOn}`);

  const ambiguous = parseRecallsResponse({
    results: [{ NHTSACampaignNumber: '24V744000', ReportReceivedDate: '03/10/2024' }],
  });
  check('an ambiguous date is still day-first', ambiguous[0]?.reportedOn === '2024-10-03', `got ${ambiguous[0]?.reportedOn}`);

  const impossible = parseRecallsResponse({
    results: [{ NHTSACampaignNumber: 'X', ReportReceivedDate: '31/02/2020' }],
  });
  check('31 February is discarded rather than rolled forward', impossible[0]?.reportedOn === undefined);

  const noDate = parseRecallsResponse({ results: [{ NHTSACampaignNumber: 'X', ReportReceivedDate: 'soon' }] });
  check('an unparseable date leaves the recall standing', noDate.length === 1 && noDate[0].reportedOn === undefined);

  // The other trap: capital S.
  const parkFlags = parseRecallsResponse({
    results: [{ NHTSACampaignNumber: 'X', parkIt: true, parkOutSide: true }],
  });
  check('parkIt is read', parkFlags[0]?.parkIt === true);
  check('parkOutSide is read despite the capital S', parkFlags[0]?.parkOutside === true);

  const stringFlags = parseRecallsResponse({
    results: [{ NHTSACampaignNumber: 'X', parkIt: 'true', parkOutSide: 'No' }],
  });
  check('string boolean forms are tolerated', stringFlags[0]?.parkIt === true && stringFlags[0]?.parkOutside === false);

  const noNumber = parseRecallsResponse({ results: [{ Component: 'BRAKES' }] });
  check('a campaign with no number is dropped', noNumber.length === 0);

  const duplicated = parseRecallsResponse({
    results: [{ NHTSACampaignNumber: 'DUP' }, { NHTSACampaignNumber: 'DUP' }],
  });
  check('a campaign listed twice is deduplicated', duplicated.length === 1);

  const missingText = parseRecallsResponse({ results: [{ NHTSACampaignNumber: 'X' }] });
  check('a recall with no component says so rather than showing blank', missingText[0]?.component === 'Unspecified');
  check('missing prose becomes empty, not undefined', missingText[0]?.summary === '');

  check('an all-clear parses to no recalls', parseRecallsResponse({ Count: 0, results: [] }).length === 0);

  for (const [label, payload] of [
    ['an empty body', {}],
    ['a null body', null],
    ['results that is not an array', { results: 'nope' }],
    ['a string instead of an object', 'nope'],
    ['results holding junk', { results: [null, 'x', 42, []] }],
  ] as const) {
    let survived = true;
    try {
      parseRecallsResponse(payload);
    } catch {
      survived = false;
    }
    check(`parsing survives ${label}`, survived);
  }

  /* ---------------------------------------------------------- the mirror */

  section('recalls: the local mirror');

  const { db, request, close } = await startTestServer();

  try {
    let fetches = 0;
    let upstream: FetchedRecall[] | undefined = [
      recall({ campaignNumber: 'ROUTINE', reportedOn: '2020-01-01' }),
      recall({ campaignNumber: 'URGENT', parkIt: true, reportedOn: '2019-01-01' }),
      recall({ campaignNumber: 'OUTSIDE', parkOutside: true, reportedOn: '2018-01-01' }),
      // A decade-old campaign nobody ever actioned, and one with no date at all.
      recall({ campaignNumber: 'ANCIENT', reportedOn: '2011-12-19' }),
      recall({ campaignNumber: 'UNDATED' }),
    ];
    setRecallFetcherForTesting(async () => {
      fetches += 1;
      return upstream;
    });

    const first = await request('GET', '/api/vehicle/recalls');
    check('GET /api/vehicle/recalls returns 200', first.status === 200, `got ${first.status}`);
    check('the first read fetches from upstream', fetches === 1, `got ${fetches}`);
    check('every campaign comes back', first.body.recalls.length === 5, `got ${first.body.recalls.length}`);
    check('a reached upstream reports checked', first.body.checked === true);

    const order = first.body.recalls.map((r: { campaignNumber: string }) => r.campaignNumber);

    // Urgency wins over age: a routine recall must not outrank a stop-driving one
    // however old it is.
    check('stop-driving sorts first', order[0] === 'URGENT', order.join(','));
    check('park-outside sorts second', order[1] === 'OUTSIDE', order.join(','));

    // Age does not retire a recall. The oldest unremedied defect is the most
    // overdue, so it leads the ordinary ones rather than sinking below them.
    check('a 2011 campaign is kept, not aged out', order.includes('ANCIENT'));
    check('the longest-outstanding recall leads the ordinary ones', order[2] === 'ANCIENT', order.join(','));
    check('a newer ordinary recall follows it', order[3] === 'ROUTINE', order.join(','));
    check('an undated campaign sorts last, not as the oldest', order[4] === 'UNDATED', order.join(','));

    check('a park-it recall is high severity', first.body.recalls[0].severity === 'high');
    check('an old ordinary recall is still medium, never low', first.body.recalls[2].severity === 'medium');
    check('the campaign number reaches the client', typeof first.body.recalls[0].campaignNumber === 'string');

    const second = await request('GET', '/api/vehicle/recalls');
    check('a second read is served from the mirror', fetches === 1, `refetched ${fetches} times`);
    check('the mirror returns the same count', second.body.recalls.length === 5);

    /* ------------------------------------------- a retired campaign is dropped */

    upstream = [recall({ campaignNumber: 'ROUTINE', summary: 'revised text', reportedOn: '2020-01-01' })];
    // A week and a day later, so the successful check has aged out.
    const later = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    const resynced = await getModelRecalls(db as unknown as Database, CIVIC, later);

    check('a stale mirror is refreshed', fetches === 2, `got ${fetches}`);
    check('campaigns NHTSA dropped are removed locally', resynced.recalls.length === 1, `got ${resynced.recalls.length}`);
    check('a revised summary is updated in place', resynced.recalls[0]?.summary === 'revised text');
    check('the surviving row keeps its campaign number', resynced.recalls[0]?.campaignNumber === 'ROUTINE');

    /* --------------------------------- a failed refresh must not erase warnings */

    upstream = undefined;
    const evenLater = new Date(later.getTime() + 8 * 24 * 60 * 60 * 1000);
    const afterFailure = await getModelRecalls(db as unknown as Database, CIVIC, evenLater);

    check('a failed refresh was attempted', fetches === 3, `got ${fetches}`);
    check('existing recalls survive a failed refresh', afterFailure.recalls.length === 1);
    check('an earlier success still counts as checked', afterFailure.synced === true);

    // ...and it must not hammer NHTSA on every request while it is down.
    const immediately = new Date(evenLater.getTime() + 60 * 1000);
    await getModelRecalls(db as unknown as Database, CIVIC, immediately);
    check('a failure is not retried on the next request', fetches === 3, `got ${fetches}`);

    const afterCooldown = new Date(evenLater.getTime() + 20 * 60 * 1000);
    await getModelRecalls(db as unknown as Database, CIVIC, afterCooldown);
    check('a failure is retried once the cooldown passes', fetches === 4, `got ${fetches}`);

    /* ------------------------- never reaching NHTSA is not an all-clear */

    const unknown = { year: 1998, make: 'DeLorean', model: 'DMC-12' };
    upstream = undefined;
    const neverReached = await getModelRecalls(db as unknown as Database, unknown, new Date());
    check('a model that was never checked reports no recalls', neverReached.recalls.length === 0);
    check('and does not claim to have been checked', neverReached.synced === false);

    /* ------------------------------------------ a genuine all-clear is recorded */

    upstream = [];
    const clear = await getModelRecalls(db as unknown as Database, unknown, new Date(Date.now() + 30 * 60 * 1000));
    check('a model with no recalls has none', clear.recalls.length === 0);
    check('but it does report having been checked', clear.synced === true);

    /* ---------------------------------------------- make and model are normalised */

    const rows = await db
      .select()
      .from(t.modelRecalls)
      .where(and(eq(t.modelRecalls.make, 'HONDA'), eq(t.modelRecalls.model, 'CIVIC')));
    check('make and model are stored uppercase so spellings cannot fork', rows.length === 1, `got ${rows.length}`);

    const lowercased = await getModelRecalls(db as unknown as Database, { year: 2019, make: 'honda', model: 'civic' }, new Date());
    check('a differently-cased lookup finds the same mirror', lowercased.recalls.length === 1);
  } finally {
    goOffline();
    await close();
  }
}
