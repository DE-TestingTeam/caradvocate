/**
 * Keeps `vehicles.mileage` current from the odometer readings an owner is already typing in.
 *
 * WHY THIS EXISTS: `vehicles.mileage` was written in exactly two places -- onboarding and the
 * Account edit dialog -- and nothing ever asked again. For most owners it therefore sat frozen at
 * whatever they typed the day they signed up, while three things downstream quietly assumed it was
 * current:
 *
 *   - services/maintenanceDue.ts computes "due in N miles" from it, so a stale figure tells
 *     someone a job is fine when it is overdue. That is the one that can cost an engine.
 *   - services/marketValueSync.ts sends it to MarketCheck, so the car is priced as a
 *     lower-mileage car every month and the estimate drifts high.
 *   - My Car's masthead prints it.
 *
 * Meanwhile `service_records.mileageAtService` already collects real readings, dated, from the
 * owner's own hand -- and they were being used for the maintenance calculation but never fed back
 * to the car itself. This closes that gap. It is not a substitute for asking the owner directly
 * (a car that is not serviced is not read either); it is the free half of the problem.
 *
 * ONLY EVER UPWARDS. An odometer is monotonic, so a reading higher than the figure on file is
 * necessarily the later of the two. The ratchet therefore needs no date comparison to decide
 * whether to fire -- which is what let it work before `mileage_updated_at` existed, and is still
 * why it does not consult that column to make its decision.
 *
 * It also makes back-dated entry safe. Logging a 2019 service at 90,000 miles on a car whose
 * stored figure reads 85,000 lifts it to 90,000 -- correctly, because the car has demonstrably
 * covered at least 90,000 miles whatever onboarding said.
 *
 * THE COST: a mistyped reading (121000 entered as 1210000) now moves the car's mileage, not just
 * one history row. The ratchet will not walk it back when the record is corrected, because it
 * cannot tell a correction from an older reading. The owner fixes it in Account, which is where
 * that number has always been editable. Worth knowing rather than worth blocking: the same typo
 * already skewed the maintenance calculation before this existed.
 */
import { eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { vehicles } from '../db/schema.js';

/**
 * Raises the car's mileage to `reading` when that is higher than what is on file, and records
 * WHEN that reading was taken. Returns the mileage in force afterwards, so a caller that needs
 * the current figure does not have to re-read the row.
 *
 * Takes the vehicle already loaded by the route rather than an id: every call site has it in hand
 * from `requireOwnVehicle`, and a second SELECT to fetch a number we hold would be waste.
 *
 * `takenOn` is the date of the service the reading came from -- 'YYYY-MM-DD', as the column
 * stores it -- and NOT the moment this runs. The distinction is the point of the whole column.
 * Logging a 2019 receipt at 90,000 miles correctly raises the mileage, because the car has
 * demonstrably covered that; but what we now hold is a six-year-old reading, and stamping today
 * would tell the rest of the app the odometer was checked this morning. That would suppress the
 * confirmation prompt in exactly the case that most needs it.
 */
export async function noteOdometerReading(
  db: Database,
  vehicle: { id: string; mileage: number },
  reading: number | null | undefined,
  takenOn: string,
): Promise<number> {
  // The field is optional in the form, so most records carry nothing to learn from.
  if (reading == null || !Number.isFinite(reading)) return vehicle.mileage;
  if (reading <= vehicle.mileage) return vehicle.mileage;

  await db
    .update(vehicles)
    .set({ mileage: reading, mileageUpdatedAt: readingDate(takenOn) })
    .where(eq(vehicles.id, vehicle.id));
  return reading;
}

/**
 * The service date as a timestamp, never in the future.
 *
 * A future date is clamped to now rather than rejected: the record itself is already saved by
 * the time this runs, and refusing the mileage update over a typo in the date would drop a real
 * odometer reading on the floor. Clamping keeps the reading and declines only the claim that we
 * will have checked it next March. An unparseable date falls back to now for the same reason --
 * the reading is worth more than the timestamp is.
 */
function readingDate(takenOn: string): Date {
  const now = new Date();
  const parsed = new Date(takenOn);
  if (Number.isNaN(parsed.getTime())) return now;
  return parsed > now ? now : parsed;
}
