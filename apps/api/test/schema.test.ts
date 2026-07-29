/** Schema-level guarantees that must hold regardless of route code. */
import { eq, sql } from 'drizzle-orm';
import * as t from '../src/db/schema.js';
import { createTestDb } from './harness.js';
import { check, section } from './assert.js';

export async function run(): Promise<void> {
  section('schema');
  const { db, close } = await createTestDb();

  const users = await db.select().from(t.users);
  check('seeds exactly two users', users.length === 2, `got ${users.length}`);

  const alex = users.find((u) => u.email === 'alex.rivera@email.com');
  const dana = users.find((u) => u.email === 'dana@example.com');
  check('both demo users exist', Boolean(alex && dana));

  const repairs = await db.select().from(t.repairs);
  check('repair catalog seeded', repairs.length === 12, `got ${repairs.length}`);

  const benchmarks = await db.select().from(t.repairBenchmarks);
  check('every repair has a benchmark', benchmarks.length === repairs.length);

  // The brake-pad figures are the ones transcribed from the wireframes.
  const brakeRepair = repairs.find((r) => r.slug === 'brake-pad-replacement')!;
  const brake = benchmarks.find((b) => b.repairId === brakeRepair.id)!;
  check('brake pad parts total is $140', brake.partsTotal === 140, `got ${brake.partsTotal}`);
  check('brake pad parts range is $80-$200', brake.partsLow === 80 && brake.partsHigh === 200);
  check('brake pad labor total is $142', brake.laborTotal === 142, `got ${brake.laborTotal}`);
  check('brake pad est hours is 1.50', Number(brake.laborEstHours) === 1.5, `got ${brake.laborEstHours}`);
  check('brake pad fair total is $360-$660', brake.fairTotalLow === 360 && brake.fairTotalHigh === 660);

  const brakeParts = await db.select().from(t.benchmarkParts).where(eq(t.benchmarkParts.benchmarkId, brake.id));
  check('brake pad has 5 benchmark parts', brakeParts.length === 5, `got ${brakeParts.length}`);

  // Known issues are model-scoped, not user-scoped -- assert there is no userId path.
  const issues = await db.select().from(t.modelKnownIssues);
  check('known issues are keyed by model, not user', issues.length === 3 && issues.every((i) => i.model === 'Civic'));

  /* -------- enum + constraint enforcement -------- */

  let rejectedBadEnum = false;
  try {
    await db.execute(sql`insert into maintenance_items (vehicle_id, label, status)
      values ((select id from vehicles limit 1), 'bogus', 'not_a_status')`);
  } catch {
    rejectedBadEnum = true;
  }
  check('maintenance_status enum rejects unknown values', rejectedBadEnum);

  let rejectedOrphan = false;
  try {
    await db.execute(sql`insert into service_records (user_id, vehicle_id, description, service_date, cost, source)
      values ('00000000-0000-0000-0000-000000000000', (select id from vehicles limit 1), 'x', '2026-01-01', 1, 'manual')`);
  } catch {
    rejectedOrphan = true;
  }
  check('service_records rejects a non-existent user', rejectedOrphan);

  let rejectedDuplicateVin = false;
  try {
    const vin = (await db.select().from(t.vehicles).where(eq(t.vehicles.userId, alex!.id)))[0].vin;
    await db.insert(t.vehicles).values({
      userId: alex!.id,
      year: 2019,
      make: 'Honda',
      model: 'Civic',
      vin,
      mileage: 1,
      estMarketValue: 1,
      tradeInLow: 1,
      tradeInHigh: 1,
    });
  } catch {
    rejectedDuplicateVin = true;
  }
  check('the same VIN cannot be registered twice by one user', rejectedDuplicateVin);

  /* -------- cascade behaviour -------- */

  const danaVehicles = await db.select().from(t.vehicles).where(eq(t.vehicles.userId, dana!.id));
  await db.delete(t.users).where(eq(t.users.id, dana!.id));

  const orphanPoints = await db
    .select()
    .from(t.vehicleValuePoints)
    .where(eq(t.vehicleValuePoints.vehicleId, danaVehicles[0].id));
  check('deleting a user cascades to their vehicle value points', orphanPoints.length === 0);

  const remainingAssessments = await db.select().from(t.assessments);
  check(
    'deleting a user cascades to their assessments but leaves the other tenant intact',
    remainingAssessments.length === 3 && remainingAssessments.every((a) => a.userId === alex!.id),
    `got ${remainingAssessments.length}`,
  );

  const survivingRepairs = await db.select().from(t.repairs);
  check('global reference data survives user deletion', survivingRepairs.length === 12);

  await close();
}
