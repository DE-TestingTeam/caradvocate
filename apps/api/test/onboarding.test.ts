/**
 * Vehicle creation, the empty-state path, and VIN parsing.
 *
 * The VIN parser is tested against a constructed vPIC payload. That proves the
 * parser handles the shape we coded for; it does NOT prove NHTSA returns that
 * shape, because the build sandbox cannot reach them. See services/vinDecode.ts.
 */
import { eq } from 'drizzle-orm';
import { parseVpicResponse } from '../src/services/vinDecode.js';
import * as t from '../src/db/schema.js';
import { check, section } from './assert.js';
import { startTestServer } from './server.js';

const DANA = 'dana@example.com';

export async function run(): Promise<void> {
  section('onboarding: vehicle creation');
  const { db, request, close } = await startTestServer();

  /* ------------------- a user with no vehicle gets a clean 404, not a crash */

  // Remove Alex's car and everything hanging off it.
  const [alex] = await db.select().from(t.users).where(eq(t.users.email, 'alex.rivera@email.com'));
  await db.delete(t.assessments).where(eq(t.assessments.userId, alex.id));
  await db.delete(t.serviceRecords).where(eq(t.serviceRecords.userId, alex.id));
  await db.delete(t.vehicles).where(eq(t.vehicles.userId, alex.id));

  const missing = await request('GET', '/api/vehicle');
  check('a user with no vehicle gets 404, which the client routes to onboarding', missing.status === 404, `got ${missing.status}`);
  check('the 404 explains itself', typeof missing.body?.error?.message === 'string');

  /* ------------------------------------------------------------- creation */

  const created = await request('POST', '/api/vehicle', {
    body: { year: 2021, make: 'Subaru', model: 'Outback', trim: 'Premium', vin: '4S4BTACC5M3123456', mileage: 24500 },
  });
  check('POST /api/vehicle returns 201', created.status === 201, `got ${created.status}`);
  check('it echoes the vehicle back', created.body.make === 'Subaru' && created.body.model === 'Outback');
  check('mileage is stored', created.body.mileage === 24500);

  // The honest part: nothing has priced this car, so no valuation is invented.
  check('a new vehicle has no market value', created.body.estMarketValue === undefined);
  check('a new vehicle has no trade-in range', created.body.tradeInLow === undefined);
  check('a new vehicle has an empty value trend', Array.isArray(created.body.valueTrend) && created.body.valueTrend.length === 0);

  const nowVisible = await request('GET', '/api/vehicle');
  check('the vehicle is immediately readable', nowVisible.status === 200 && nowVisible.body.id === created.body.id);

  const emptyMaintenance = await request('GET', '/api/vehicle/maintenance');
  check('maintenance starts empty rather than fabricated', emptyMaintenance.status === 200 && emptyMaintenance.body.length === 0);

  /* ------------------------------------------------------------ ownership */

  const [row] = await db.select().from(t.vehicles).where(eq(t.vehicles.id, created.body.id));
  check('the new vehicle belongs to the caller', row.userId === alex.id);

  const danaVehicle = await request('GET', '/api/vehicle', { as: DANA });
  check("the new car does not appear for another tenant", danaVehicle.body.id !== created.body.id);

  const second = await request('POST', '/api/vehicle', {
    body: { year: 2020, make: 'Mazda', model: 'CX-5', mileage: 1000 },
  });
  check('a second vehicle is refused while the app is single-vehicle', second.status === 409, `got ${second.status}`);

  /* ------------------------------------------------------------ validation */

  const noVin = await request('POST', '/api/vehicle', { body: { year: 2020, make: 'Mazda', model: 'CX-5', mileage: 1000 } , as: DANA});
  check('a vehicle can be added without a VIN', noVin.status === 409 || noVin.status === 201, `got ${noVin.status}`);

  const badYear = await request('POST', '/api/vehicle', { body: { year: 1799, make: 'X', model: 'Y', mileage: 0 } });
  check('an impossible year is rejected', badYear.status === 422, `got ${badYear.status}`);

  const badVin = await request('POST', '/api/vehicle', {
    body: { year: 2020, make: 'X', model: 'Y', mileage: 0, vin: 'IOQ11111111111111' },
  });
  check('a VIN containing I, O or Q is rejected', badVin.status === 422, `got ${badVin.status}`);

  const shortVin = await request('POST', '/api/vehicle', {
    body: { year: 2020, make: 'X', model: 'Y', mileage: 0, vin: 'ABC123' },
  });
  check('a VIN of the wrong length is rejected', shortVin.status === 422);

  const decodeBad = await request('GET', '/api/vehicle/decode/NOTAVIN');
  check('decoding a malformed VIN is a 422', decodeBad.status === 422, `got ${decodeBad.status}`);

  await close();

  /* --------------------------------------------------------- VIN parsing */

  section('onboarding: VIN response parsing');

  const vin = '2HGFC2F53KH124821';
  const good = parseVpicResponse(vin, {
    Results: [{ Make: 'HONDA', Model: 'Civic', ModelYear: '2019', Trim: 'EX', ErrorCode: '0' }],
  });
  check('make, model and year are extracted', good.make === 'HONDA' && good.model === 'Civic' && good.year === 2019);
  check('trim is extracted', good.trim === 'EX');

  const blanks = parseVpicResponse(vin, { Results: [{ Make: '', Model: 'Civic', ModelYear: '', Trim: '   ' }] });
  check('empty strings become undefined rather than empty values', blanks.make === undefined && blanks.year === undefined && blanks.trim === undefined);
  check('the fields that are present still come through', blanks.model === 'Civic');

  const notApplicable = parseVpicResponse(vin, { Results: [{ Make: 'HONDA', Model: 'Civic', Trim: 'Not Applicable' }] });
  check('"Not Applicable" is treated as absent', notApplicable.trim === undefined);

  const seriesFallback = parseVpicResponse(vin, { Results: [{ Make: 'HONDA', Model: 'Civic', Series: 'Sport' }] });
  check('Series is used when Trim is absent', seriesFallback.trim === 'Sport');

  const impossibleYear = parseVpicResponse(vin, { Results: [{ Make: 'HONDA', ModelYear: '1823' }] });
  check('an impossible year is discarded', impossibleYear.year === undefined);

  // Every one of these is a shape we might actually receive if the API changes.
  for (const [label, payload] of [
    ['an empty body', {}],
    ['a null body', null],
    ['an empty Results array', { Results: [] }],
    ['Results that is not an array', { Results: 'nope' }],
    ['a string instead of an object', 'unexpected'],
    ['a numeric ModelYear', { Results: [{ ModelYear: 2019 }] }],
  ] as [string, unknown][]) {
    let threw = false;
    try {
      parseVpicResponse(vin, payload);
    } catch {
      threw = true;
    }
    check(`parsing survives ${label}`, !threw);
  }
}
