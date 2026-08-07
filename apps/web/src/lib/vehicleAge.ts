/**
 * NHTSA's own recall/complaint catalog and the model name our VIN decode returns can
 * disagree for a vehicle old enough to predate consistent model naming -- a chassis code
 * like "GMT-400" instead of the marketing name "C/K1500" is a real example that came back
 * with zero recalls for a car that has some, under the name NHTSA's own catalog uses.
 *
 * Age is a blunt stand-in for "old enough that this kind of mismatch turns up", not a
 * precise detector -- there is no cheap way to know a given model string is wrong before
 * asking, only that older records are where it tends to happen. Cheap and right often
 * enough to be worth a caveat rather than a confident all-clear or a confident empty list.
 */
const OLD_VEHICLE_AGE_YEARS = 20;

export function isOldVehicle(year: number): boolean {
  return new Date().getFullYear() - year >= OLD_VEHICLE_AGE_YEARS;
}
