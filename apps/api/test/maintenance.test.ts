/**
 * Scheduled maintenance: the due calculation, and the endpoints around it.
 *
 * The calculation is the whole feature, so most of this file is arithmetic with no
 * database involved. Two rules matter more than the rest:
 *
 *   - No interval, or nothing ever logged, means `unknown` -- never `ok`. There is no
 *     baseline to measure from, and a false all-clear about brakes is the worst thing
 *     this screen could say.
 *   - With both a mileage and a time interval, whichever falls first wins. Taking the
 *     later of the two would tell someone they are fine when they are a year overdue.
 */
import { eq } from 'drizzle-orm';
import * as t from '../src/db/schema.js';
import { byUrgency, toMaintenanceItem } from '../src/services/maintenanceDue.js';
import { check, section } from './assert.js';
import { goOffline } from './offline.js';
import { startTestServer } from './server.js';

const TODAY = new Date('2026-07-29T00:00:00Z');

function job(overrides: Partial<Parameters<typeof toMaintenanceItem>[0]> = {}) {
  return { id: 'job-1', label: 'Oil & filter', intervalMiles: null, intervalMonths: null, ...overrides };
}

export async function run(): Promise<void> {
  section('maintenance: the due calculation');

  /* ------------------------------------------------- nothing to measure from */

  const noInterval = toMaintenanceItem(job(), { date: '2026-01-01', mileage: 60000 }, {
    currentMileage: 68400,
    today: TODAY,
  });
  check('no interval means unknown, not ok', noInterval.status === 'unknown');
  check('and it says an interval is what is missing', noInterval.unknownReason === 'no_interval');

  const neverServiced = toMaintenanceItem(job({ intervalMiles: 5000 }), undefined, {
    currentMileage: 68400,
    today: TODAY,
  });
  check('never serviced means unknown too', neverServiced.status === 'unknown');
  check('and it says so', neverServiced.unknownReason === 'never_serviced');
  check('no due mileage is invented without a baseline', neverServiced.dueAtMileage === undefined);

  // An interval in miles with no odometer at the last service leaves nothing to
  // subtract, even though both an interval and a service exist.
  const noBaselineMileage = toMaintenanceItem(job({ intervalMiles: 5000 }), { date: '2026-01-01', mileage: null }, {
    currentMileage: 68400,
    today: TODAY,
  });
  check('a mileage interval with no recorded odometer is unknown', noBaselineMileage.status === 'unknown');

  /* ------------------------------------------------------- mileage intervals */

  const context = { currentMileage: 68400, today: TODAY };

  const overdue = toMaintenanceItem(job({ intervalMiles: 6000 }), { date: '2024-06-19', mileage: 58000 }, context);
  check('past the interval is overdue', overdue.status === 'overdue');
  check('the due mileage is shown', overdue.dueAtMileage === 64000);
  check('miles remaining goes negative when overdue', overdue.milesRemaining === -4400);

  const dueSoon = toMaintenanceItem(job({ intervalMiles: 5000 }), { date: '2026-02-14', mileage: 63900 }, context);
  check('within 500 miles is due soon', dueSoon.status === 'due_soon', `got ${dueSoon.status}`);
  check('and remaining miles are reported', dueSoon.milesRemaining === 500);

  const ok = toMaintenanceItem(job({ intervalMiles: 15000 }), { date: '2025-08-30', mileage: 60000 }, context);
  check('well inside the interval is ok', ok.status === 'ok');
  check('with the miles left', ok.milesRemaining === 6600);

  const exactlyDue = toMaintenanceItem(job({ intervalMiles: 5000 }), { date: '2026-01-01', mileage: 63400 }, context);
  check('landing exactly on the due mileage is due_soon, not overdue', exactlyDue.status === 'due_soon');

  /* ---------------------------------------------------------- time intervals */

  const timeOverdue = toMaintenanceItem(job({ intervalMonths: 12 }), { date: '2025-01-15', mileage: null }, context);
  check('past a time interval is overdue', timeOverdue.status === 'overdue');
  check('the due date is reported', timeOverdue.dueOn === '2026-01-15');

  const timeOk = toMaintenanceItem(job({ intervalMonths: 12 }), { date: '2026-06-01', mileage: null }, context);
  check('inside a time interval is ok', timeOk.status === 'ok', `got ${timeOk.status}`);
  check('with its due date', timeOk.dueOn === '2027-06-01');

  // 31 January plus one month is 28 February; letting Date roll over would push the
  // due date into March and quietly grant an extra few days.
  const clamped = toMaintenanceItem(job({ intervalMonths: 1 }), { date: '2026-01-31', mileage: null }, context);
  check('adding a month clamps to the end of a short month', clamped.dueOn === '2026-02-28', `got ${clamped.dueOn}`);

  /* ------------------------------------------- whichever falls first wins */

  // Fine on mileage, a year late on time. Reporting `ok` here is the failure this
  // pair of assertions exists to prevent.
  const lateInTime = toMaintenanceItem(
    job({ intervalMiles: 5000, intervalMonths: 12 }),
    { date: '2024-01-01', mileage: 68000 },
    context,
  );
  check('time overdue beats mileage ok', lateInTime.status === 'overdue', `got ${lateInTime.status}`);

  const lateInMiles = toMaintenanceItem(
    job({ intervalMiles: 5000, intervalMonths: 12 }),
    { date: '2026-07-01', mileage: 60000 },
    context,
  );
  check('mileage overdue beats time ok', lateInMiles.status === 'overdue', `got ${lateInMiles.status}`);

  const bothFine = toMaintenanceItem(
    job({ intervalMiles: 20000, intervalMonths: 24 }),
    { date: '2026-06-01', mileage: 66000 },
    context,
  );
  check('both inside their interval is ok', bothFine.status === 'ok');

  /* ----------------------------------------------------------------- sorting */

  const sorted = [
    { status: 'ok' as const },
    { status: 'unknown' as const },
    { status: 'overdue' as const },
    { status: 'due_soon' as const },
  ]
    .map((s) => ({ id: 'x', label: 'x', ...s }))
    .sort(byUrgency)
    .map((i) => i.status);
  check('anything needing attention sorts to the top', sorted.join(',') === 'overdue,due_soon,unknown,ok', sorted.join(','));

  /* --------------------------------------------------------- the endpoints */

  section('maintenance: the endpoints');

  const { db, request, close } = await startTestServer();

  try {
    const listed = await request('GET', '/api/vehicle/maintenance');
    check('GET returns the seeded jobs', listed.status === 200 && listed.body.length === 5, `got ${listed.body.length}`);

    const byLabel = new Map<string, any>(listed.body.map((i: any) => [i.label, i]));
    // The seed is built so every outcome appears; if these drift the seed is lying
    // about what the feature does.
    check('the tyre job is overdue', byLabel.get('Tyre rotation')?.status === 'overdue');
    check('the oil job is due soon', byLabel.get('Oil & filter')?.status === 'due_soon', byLabel.get('Oil & filter')?.status);
    check('the cabin filter is ok', byLabel.get('Cabin air filter')?.status === 'ok');
    check('brake fluid has no interval, so unknown', byLabel.get('Brake fluid flush')?.unknownReason === 'no_interval');
    check('coolant has never been done, so unknown', byLabel.get('Coolant flush')?.unknownReason === 'never_serviced');
    check('the overdue job is listed first', listed.body[0].label === 'Tyre rotation');
    check('the working is shown, not just the verdict', byLabel.get('Tyre rotation')?.dueAtMileage === 64000);

    /* ------------------------------------------------------------- creating */

    const created = await request('POST', '/api/vehicle/maintenance', {
      body: { label: 'Air filter', intervalMiles: 12000 },
    });
    check('POST returns 201', created.status === 201, `got ${created.status}`);
    check('a new job with no history is unknown', created.body.status === 'unknown');
    check('and says it needs a service logged', created.body.unknownReason === 'never_serviced');

    const noIntervalJob = await request('POST', '/api/vehicle/maintenance', { body: { label: 'Wipers' } });
    check('a job with no interval is allowed', noIntervalJob.status === 201);
    check('and reads as unknown for want of an interval', noIntervalJob.body.unknownReason === 'no_interval');

    const noLabel = await request('POST', '/api/vehicle/maintenance', { body: { intervalMiles: 5000 } });
    check('a job needs a name', noLabel.status === 422, `got ${noLabel.status}`);

    /* ------------------------------------------------------------- updating */

    const patched = await request('PATCH', `/api/vehicle/maintenance/${created.body.id}`, {
      body: { intervalMiles: 10000 },
    });
    check('PATCH updates the interval', patched.status === 200 && patched.body.intervalMiles === 10000);

    // Clearing has to be possible, or a wrong interval can only ever be replaced.
    const cleared = await request('PATCH', `/api/vehicle/maintenance/${created.body.id}`, {
      body: { intervalMiles: null },
    });
    // Asserting the status first: without it, "intervalMiles is gone" also passes when
    // the request was rejected outright and the body is an error.
    check('clearing an interval is accepted', cleared.status === 200, `got ${cleared.status}`);
    check('the interval is gone', cleared.body.intervalMiles === undefined, JSON.stringify(cleared.body.intervalMiles));
    check('and the status follows it back to unknown', cleared.body.unknownReason === 'no_interval');

    const empty = await request('PATCH', `/api/vehicle/maintenance/${created.body.id}`, { body: {} });
    check('an empty patch is refused', empty.status === 422, `got ${empty.status}`);

    const foreign = await request('PATCH', `/api/vehicle/maintenance/${created.body.id}`, {
      body: { label: 'Hijacked' },
      as: 'dana@example.com',
    });
    check("another tenant cannot edit this car's schedule", foreign.status === 404, `got ${foreign.status}`);

    const notAUuid = await request('PATCH', '/api/vehicle/maintenance/not-a-uuid', { body: { label: 'x' } });
    check('a malformed id is a 404, not a database error', notAUuid.status === 404, `got ${notAUuid.status}`);

    /* ------------------------------------------------------------- deleting */

    const linked = await request('POST', '/api/service-records', {
      body: { description: 'Air filter swap', date: '2026-07-01', cost: 30, mileageAtService: 68000, maintenanceItemId: created.body.id },
    });
    check('a service can be linked to a job', linked.status === 201 && linked.body.maintenanceItemId === created.body.id);

    const removed = await request('DELETE', `/api/vehicle/maintenance/${created.body.id}`);
    check('DELETE returns 204', removed.status === 204, `got ${removed.status}`);

    // The work still happened, so the record survives with its link cleared.
    const [survivor] = await db.select().from(t.serviceRecords).where(eq(t.serviceRecords.id, linked.body.id));
    check('the linked service record survives the job being deleted', survivor !== undefined);
    check('with its link cleared rather than cascaded away', survivor?.maintenanceItemId === null);
  } finally {
    goOffline();
    await close();
  }
}
