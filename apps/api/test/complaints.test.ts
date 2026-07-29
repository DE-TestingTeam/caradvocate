/**
 * NHTSA complaint aggregation, the local mirror, and the known-issues contract.
 *
 * The payload below is a real response shape captured from the live service.
 *
 * The single most important assertion in this file is the date one. NHTSA serves
 * complaints as **MM/DD/YYYY** and recalls as **DD/MM/YYYY** from the same host --
 * confirmed by scanning both feeds. Sharing one date parser between them would
 * corrupt every date that is not impossible to misread, and nothing would fail
 * loudly. See services/complaints.ts.
 */
import { asc, eq } from 'drizzle-orm';
import * as t from '../src/db/schema.js';
import { aggregateComplaints, canonicalComponent } from '../src/services/complaints.js';
import { getOwnerReports, setComplaintFetcherForTesting } from '../src/services/complaintSync.js';
import { parseRecallsResponse } from '../src/services/recalls.js';
import type { ComponentReports } from '../src/services/complaints.js';
import type { Database } from '../src/db/index.js';
import { check, section } from './assert.js';
import { modelMatches } from '../src/services/modelFeed.js';
import { goOffline } from './offline.js';
import { startTestServer } from './server.js';

/** Captured from api.nhtsa.gov for a 2011 Nissan Pathfinder. */
const LIVE_SHAPE = {
  count: 2,
  results: [
    {
      odiNumber: 11666317,
      manufacturer: 'Nissan North America, Inc.',
      crash: false,
      fire: false,
      numberOfInjuries: 0,
      numberOfDeaths: 0,
      dateOfIncident: '06/10/2025',
      dateComplaintFiled: '06/11/2025',
      components: 'SUSPENSION',
      summary: 'Rear sub frame has significant rust, snapped while driving at slow speed.',
    },
    {
      odiNumber: 11666318,
      crash: true,
      fire: false,
      numberOfInjuries: 2,
      numberOfDeaths: 0,
      dateOfIncident: '11/24/2024',
      components: 'SUSPENSION,AIR BAGS,SEAT BELTS',
      summary: 'Airbag did not deploy.',
    },
  ],
};

function group(overrides: Partial<ComponentReports> & { component: string }): ComponentReports {
  return {
    reportCount: 1,
    crashCount: 0,
    fireCount: 0,
    injuryCount: 0,
    deathCount: 0,
    quotes: [],
    ...overrides,
  };
}

export async function run(): Promise<void> {
  /* --------------------------------------------------------- aggregation */

  section('complaints: NHTSA aggregation');

  const parsed = aggregateComplaints(LIVE_SHAPE);
  const bySuspension = parsed.find((g) => g.component === 'SUSPENSION');
  const byAirbags = parsed.find((g) => g.component === 'AIR BAGS');

  check('components are grouped', parsed.length === 3, `got ${parsed.length}: ${parsed.map((g) => g.component)}`);
  check('a component named by two complaints counts twice', bySuspension?.reportCount === 2);
  check('a component named by one counts once', byAirbags?.reportCount === 1);
  check('groups are ordered most-reported first', parsed[0]?.component === 'SUSPENSION');

  check('crash flags are counted', bySuspension?.crashCount === 1, `got ${bySuspension?.crashCount}`);
  check('injuries are summed, not counted as one', bySuspension?.injuryCount === 2, `got ${bySuspension?.injuryCount}`);
  check('a complaint with no harm contributes nothing', byAirbags?.fireCount === 0);

  /* ---- the trap: this feed is month-first, the recalls feed is day-first ---- */

  check(
    'MM/DD/YYYY is read month-first (06/10 is 10 June)',
    bySuspension?.latestIncidentOn === '2025-06-10',
    `got ${bySuspension?.latestIncidentOn}`,
  );

  const unambiguous = aggregateComplaints({
    results: [{ components: 'ENGINE', dateOfIncident: '11/24/2024' }],
  });
  check(
    'a day over 12 in the second position parses',
    unambiguous[0]?.latestIncidentOn === '2024-11-24',
    `got ${unambiguous[0]?.latestIncidentOn}`,
  );

  // Guards the two parsers against being merged: the same string means different
  // days in each feed, and only this pair of assertions says so.
  const asComplaint = aggregateComplaints({ results: [{ components: 'ENGINE', dateOfIncident: '05/06/2020' }] });
  const asRecall = parseRecallsResponse({ results: [{ NHTSACampaignNumber: 'X', ReportReceivedDate: '05/06/2020' }] });
  check('"05/06/2020" is 6 May as a complaint', asComplaint[0]?.latestIncidentOn === '2020-05-06');
  check('"05/06/2020" is 5 June as a recall', asRecall[0]?.reportedOn === '2020-06-05');

  const impossible = aggregateComplaints({ results: [{ components: 'ENGINE', dateOfIncident: '02/31/2020' }] });
  check('31 February is discarded rather than rolled forward', impossible[0]?.latestIncidentOn === undefined);

  const latest = aggregateComplaints({
    results: [
      { components: 'ENGINE', dateOfIncident: '01/05/2020' },
      { components: 'ENGINE', dateOfIncident: '09/05/2023' },
      { components: 'ENGINE', dateOfIncident: '03/05/2021' },
    ],
  });
  check('the most recent incident wins the group', latest[0]?.latestIncidentOn === '2023-09-05');

  /* ------------------------------------------- taxonomy noise is collapsed */

  const fuel = aggregateComplaints({
    results: [
      // One complaint, three overlapping tags -- 62 of 63 fuel complaints on a
      // 2019 Civic look like this.
      { components: 'FUEL SYSTEM,GASOLINE,FUEL/PROPULSION SYSTEM' },
    ],
  });
  check('overlapping fuel tags collapse to one group', fuel.length === 1, `got ${fuel.map((g) => g.component)}`);
  check('the collapsed group is named FUEL SYSTEM', fuel[0]?.component === 'FUEL SYSTEM');
  check('and it counts the complaint once, not three times', fuel[0]?.reportCount === 1);

  /* ------------------------------------------- representative descriptions */

  const RUST = 'Rear sub frame has significant rust and snapped while driving at slow speed.';
  const CRASHED = 'The steering locked up without warning and I hit a guard rail at low speed.';
  const RECENT = 'Steering wheel shudders badly above forty miles per hour on a smooth road.';

  const quoted = aggregateComplaints({
    results: [
      { components: 'SUSPENSION', summary: RUST, dateOfIncident: '06/10/2025' },
      { components: 'SUSPENSION', summary: RECENT, dateOfIncident: '07/12/2025' },
      { components: 'SUSPENSION', summary: CRASHED, crash: true, dateOfIncident: '01/02/2020' },
    ],
  });

  check('descriptions are captured', quoted[0]?.quotes.length === 3, `got ${quoted[0]?.quotes.length}`);
  // The account where someone crashed leads even though it is the oldest: it is the
  // one that changes a decision.
  check('an account involving harm leads', quoted[0]?.quotes[0]?.text === CRASHED);
  check('recency orders the rest', quoted[0]?.quotes[1]?.text === RECENT, quoted[0]?.quotes[1]?.text);
  check('each description keeps its incident date', quoted[0]?.quotes[0]?.incidentOn === '2020-01-02');

  const capped = aggregateComplaints({
    results: Array.from({ length: 9 }, (_, i) => ({
      components: 'ENGINE',
      summary: `A distinct and sufficiently long account of engine trouble, number ${i}.`,
    })),
  });
  check('no more than three descriptions are kept', capped[0]?.quotes.length === 3, `got ${capped[0]?.quotes.length}`);
  check('the count still reflects every complaint', capped[0]?.reportCount === 9);

  const stub = aggregateComplaints({ results: [{ components: 'ENGINE', summary: 'SEE SUMMARY' }] });
  check('a stub too short to inform is not shown as an account', stub[0]?.quotes.length === 0);
  check('but the complaint still counts', stub[0]?.reportCount === 1);

  const duplicated = aggregateComplaints({
    results: [
      { components: 'ENGINE', summary: RUST },
      { components: 'ENGINE', summary: RUST.toUpperCase() },
    ],
  });
  check('the same account filed twice is shown once', duplicated[0]?.quotes.length === 1);

  const spaced = aggregateComplaints({
    results: [{ components: 'ENGINE', summary: 'Engine  stalled   without warning while merging onto a motorway.' }],
  });
  check('double spaces in an account are collapsed', spaced[0]?.quotes[0]?.text.includes('Engine stalled without'));

  /* --------------- the bulk file and the API agree on component names --------- */

  // The bulk file's COMPDESC is finer-grained and uses both separators inside one
  // component's name, where the API uses a comma between several. Both must reduce
  // to the same key or the mileage ingest silently matches nothing.
  check('a colon tail is dropped', canonicalComponent('LATCHES/LOCKS/LINKAGES:HOOD:LATCH') === 'LATCHES/LOCKS/LINKAGES');
  check('a comma tail is dropped', canonicalComponent('SERVICE BRAKES, HYDRAULIC') === 'SERVICE BRAKES');
  check('both at once', canonicalComponent('VISIBILITY:POWER WINDOW DEVICES AND CONTROLS') === 'VISIBILITY');
  check('an already-plain label is unchanged', canonicalComponent('ENGINE') === 'ENGINE');
  check('it is case-insensitive', canonicalComponent('service brakes') === 'SERVICE BRAKES');
  check('the canonical map still applies', canonicalComponent('FUEL/PROPULSION SYSTEM') === 'FUEL SYSTEM');
  check('the uncategorised bucket is rejected', canonicalComponent('UNKNOWN OR OTHER') === undefined);
  check('an empty label is rejected', canonicalComponent('') === undefined);

  const junk = aggregateComplaints({ results: [{ components: 'UNKNOWN OR OTHER' }] });
  check("NHTSA's uncategorised bucket is dropped", junk.length === 0);

  const mixed = aggregateComplaints({ results: [{ components: 'STEERING,UNKNOWN OR OTHER' }] });
  check('but a real component beside it survives', mixed.length === 1 && mixed[0].component === 'STEERING');

  const dupes = aggregateComplaints({ results: [{ components: 'ENGINE,ENGINE' }] });
  check('a repeated tag on one complaint counts once', dupes[0]?.reportCount === 1);

  const cased = aggregateComplaints({ results: [{ components: 'service brakes' }] });
  check('components are upper-cased so spellings cannot fork', cased[0]?.component === 'SERVICE BRAKES');

  const stringCounts = aggregateComplaints({
    results: [{ components: 'ENGINE', crash: 'true', numberOfInjuries: '3', numberOfDeaths: -1 }],
  });
  check('string flags and counts are tolerated', stringCounts[0]?.crashCount === 1 && stringCounts[0]?.injuryCount === 3);
  check('a negative count is treated as zero', stringCounts[0]?.deathCount === 0);

  for (const [label, payload] of [
    ['an empty body', {}],
    ['a null body', null],
    ['results that is not an array', { results: 'nope' }],
    ['a string instead of an object', 'nope'],
    ['results holding junk', { results: [null, 'x', 42, []] }],
    ['a complaint with no components', { results: [{ summary: 'something' }] }],
  ] as const) {
    let survived = true;
    try {
      aggregateComplaints(payload);
    } catch {
      survived = false;
    }
    check(`aggregation survives ${label}`, survived);
  }

  /* ------------------------------------------------- the mirror and route */

  section('complaints: the mirror and known issues');

  const { db, request, close } = await startTestServer();

  try {
    let fetches = 0;
    let upstream: ComponentReports[] | undefined = [
      group({
        component: 'STEERING',
        reportCount: 31,
        crashCount: 3,
        injuryCount: 1,
        quotes: [
          { text: 'The steering locked up without warning and I hit a guard rail.', incidentOn: '2024-11-24' },
          { text: 'Wheel shudders badly above forty miles per hour on smooth road.' },
        ],
      }),
      group({ component: 'SERVICE BRAKES', reportCount: 6 }),
      group({ component: 'TRIM', reportCount: 2 }),
    ];
    setComplaintFetcherForTesting(async () => {
      fetches += 1;
      return upstream;
    });

    // Alex's seeded 2019 Civic also has three curated known issues.
    const first = await request('GET', '/api/vehicle/known-issues');
    check('GET /api/vehicle/known-issues returns 200', first.status === 200, `got ${first.status}`);
    check('the complaint feed is fetched once', fetches === 1, `got ${fetches}`);
    check('a reached feed reports checked', first.body.checked === true);

    const issues: { label: string; source: string; severity: string; reportCount?: number }[] = first.body.issues;
    check('curated and reported issues are combined', issues.length === 6, `got ${issues.length}`);
    check('curated entries come first', issues[0].source === 'curated');
    check('a curated entry keeps its written label', issues[0].label === 'Transmission hesitation under load');
    check('a curated entry carries no invented report count', issues[0].reportCount === undefined);

    const reported = issues.filter((i) => i.source === 'owner_reports');
    check('reported entries are labelled as such', reported.length === 3, `got ${reported.length}`);
    check('the most-reported system comes first', reported[0].label === 'STEERING');
    check('its report count survives the round trip', reported[0].reportCount === 31);

    // Severity is derived from what NHTSA recorded, not from our opinion.
    check('a group involving a crash or injury is high', reported[0].severity === 'high');
    check('a repeatedly-reported harmless group is medium', reported[1].severity === 'medium');
    check('a group with a couple of reports is low, not dressed up', reported[2].severity === 'low');

    // The accounts are stored for anything that needs the prose, but deliberately
    // not served here: My Car shows counts and links to NHTSA, so joining them onto
    // every request would be work nothing renders.
    const wire = JSON.stringify(first.body);
    check('no complaint prose is sent to the client', !wire.includes('steering locked up'));
    check('report counts are, though', wire.includes('31'));

    const stored = await db.select().from(t.modelOwnerReportQuotes).orderBy(asc(t.modelOwnerReportQuotes.position));
    check('the accounts are still stored for later use', stored.length === 2, `got ${stored.length}`);
    check('their text is stored intact', stored[0]?.text.includes('steering locked up') === true);
    check('a stored account keeps its date', stored[0]?.incidentOn === '2024-11-24');
    check('a dateless account stores null rather than a guess', stored[1]?.incidentOn === null);
    check('their order is preserved', stored[1]?.text.includes('shudders') === true);

    const second = await request('GET', '/api/vehicle/known-issues');
    check('a second read is served from the mirror', fetches === 1, `refetched ${fetches} times`);
    check('the mirror returns the same issues', second.body.issues.length === 6);

    /* --------------------------------------------- counts are replaced, not added */

    upstream = [
      group({
        component: 'STEERING',
        reportCount: 40,
        crashCount: 4,
        quotes: [{ text: 'A newer account replacing the ones stored before.' }],
      }),
    ];
    const later = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    const resynced = await getOwnerReports(db as unknown as Database, { year: 2019, make: 'Honda', model: 'Civic' }, later);

    check('a stale mirror is refreshed', fetches === 2, `got ${fetches}`);
    check('a growing count replaces rather than accumulates', resynced.reports[0]?.reportCount === 40);
    check('components no longer reported are dropped', resynced.reports.length === 1, `got ${resynced.reports.length}`);

    // The aggregate is replaced wholesale on sync, so its accounts must go with it
    // via cascade rather than accumulating a longer list every week.
    const afterResync = await db.select().from(t.modelOwnerReportQuotes);
    check('a resync replaces accounts rather than appending', afterResync.length === 1, `got ${afterResync.length}`);
    check('the surviving account is the new one', afterResync[0]?.text.includes('newer account') === true);
    check('no account rows are orphaned by the replace', afterResync.every((q) => q.reportId === resynced.reports[0]?.id));

    /* ------------------------------ a failed refresh must not empty the list */

    upstream = undefined;
    const evenLater = new Date(later.getTime() + 8 * 24 * 60 * 60 * 1000);
    const afterFailure = await getOwnerReports(
      db as unknown as Database,
      { year: 2019, make: 'Honda', model: 'Civic' },
      evenLater,
    );
    check('existing reports survive a failed refresh', afterFailure.reports.length === 1);
    check('an earlier success still counts as checked', afterFailure.synced === true);

    /* ----------------------- never reaching NHTSA is not "nothing reported" */

    const unknown = { year: 1998, make: 'DeLorean', model: 'DMC-12' };
    upstream = undefined;
    const never = await getOwnerReports(db as unknown as Database, unknown, new Date());
    check('an unchecked model reports nothing', never.reports.length === 0);
    check('and does not claim to have been checked', never.synced === false);

    upstream = [];
    const clear = await getOwnerReports(db as unknown as Database, unknown, new Date(Date.now() + 30 * 60 * 1000));
    check('a model with no complaints has none', clear.reports.length === 0);
    check('but it does report having been checked', clear.synced === true);

    /* ------------------------------------------- one sync table, two feeds */

    const syncs = await db.select().from(t.modelFeedSyncs);
    const feeds = [...new Set(syncs.map((s) => s.feed))].sort();
    check('recalls and complaints share the sync table', feeds.includes('complaints'), feeds.join(','));
    check(
      'each feed tracks the same model independently',
      syncs.filter((s) => s.make === 'HONDA' && s.model === 'CIVIC').length >= 1,
    );

    const byLowercase = await db
      .select()
      .from(t.modelOwnerReports)
      .where(modelMatches(t.modelOwnerReports, { year: 2019, make: 'honda', model: 'civic' }));
    check('a differently-cased lookup finds the mirror', byLowercase.length === 1, `got ${byLowercase.length}`);

    /* --------------------------------------------- mileage at failure on the wire */

    section('complaints: mileage at failure');

    // Written by scripts/ingestComplaintMileage.mts, which the suite does not run --
    // it needs a 351MB download. What matters here is that the columns reach the
    // client correctly and that a partial row is treated as absent.
    const [target] = byLowercase;
    await db
      .update(t.modelOwnerReports)
      .set({ mileageSampleCount: 6, mileageLowMi: 40000, mileageMedianMi: 49900, mileageHighMi: 92000 })
      .where(eq(t.modelOwnerReports.id, target.id));

    const withMileage = await request('GET', '/api/vehicle/known-issues');
    const steeringIssue = withMileage.body.issues.find((i: any) => i.source === 'owner_reports');
    check('the mileage range reaches the client', steeringIssue?.mileage?.lowMi === 40000);
    check('the median comes through', steeringIssue?.mileage?.medianMi === 49900);
    check('the upper bound comes through', steeringIssue?.mileage?.highMi === 92000);
    // Carried separately from reportCount: the range rests on the subset of
    // complaints that recorded an odometer reading.
    check('the sample count is carried, not conflated with the report count', steeringIssue?.mileage?.sampleCount === 6);
    check('and it is smaller than the report count here', steeringIssue.mileage.sampleCount < steeringIssue.reportCount);

    // A half-written row would otherwise render as a range from undefined.
    await db
      .update(t.modelOwnerReports)
      .set({ mileageMedianMi: null })
      .where(eq(t.modelOwnerReports.id, target.id));
    const partial = await request('GET', '/api/vehicle/known-issues');
    check(
      'a partially-populated row is treated as no mileage at all',
      partial.body.issues.find((i: any) => i.source === 'owner_reports')?.mileage === undefined,
    );
  } finally {
    goOffline();
    await close();
  }
}
