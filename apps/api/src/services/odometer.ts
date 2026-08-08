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
 * ONLY EVER UPWARDS, AND THAT IS WHY NO DATE IS NEEDED. An odometer is monotonic, so a reading
 * higher than the figure on file is necessarily the later of the two -- which matters because
 * there is no `mileage_updated_at` column yet, so recency cannot be compared directly. The
 * ratchet sidesteps that entirely: it does not need to know when the stored figure was set.
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
 * Raises the car's mileage to `reading` when that is higher than what is on file. Returns the
 * mileage in force afterwards, so a caller that needs the current figure does not have to re-read
 * the row.
 *
 * Takes the vehicle already loaded by the route rather than an id: every call site has it in hand
 * from `requireOwnVehicle`, and a second SELECT to fetch a number we hold would be waste.
 */
export async function noteOdometerReading(
  db: Database,
  vehicle: { id: string; mileage: number },
  reading: number | null | undefined,
): Promise<number> {
  // The field is optional in the form, so most records carry nothing to learn from.
  if (reading == null || !Number.isFinite(reading)) return vehicle.mileage;
  if (reading <= vehicle.mileage) return vehicle.mileage;

  await db.update(vehicles).set({ mileage: reading }).where(eq(vehicles.id, vehicle.id));
  return reading;
}
