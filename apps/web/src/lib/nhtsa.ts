/**
 * Links out to NHTSA. The app shows the shape of a problem -- which systems, how often, how
 * badly -- and sends anyone who wants the individual accounts to the source.
 *
 * nhtsa.gov blocks non-browser requests, so these URL shapes could not be verified
 * automatically. They follow the documented pattern and open correctly in a browser; if
 * NHTSA restructures, this is the single place to change.
 */
export interface VehicleKey {
  year: number;
  make: string;
  model: string;
}

const NHTSA_VEHICLE = 'https://www.nhtsa.gov/vehicle';

/**
 * The NHTSA page for one vehicle -- recalls, complaints and investigations. Make and model
 * are upper-cased to match their URLs, and encoded because plenty contain spaces or slashes.
 */
export function nhtsaVehicleUrl({ year, make, model }: VehicleKey): string {
  const segment = (value: string) => encodeURIComponent(value.trim().toUpperCase());
  return `${NHTSA_VEHICLE}/${year}/${segment(make)}/${segment(model)}`;
}

/**
 * NHTSA's VIN lookup -- the one place an owner can get a per-car answer. Their site queries
 * the manufacturer behind the scenes, and there is no API equivalent, so a link is the best
 * we can offer.
 */
export function nhtsaVinRecallUrl(vin: string): string {
  return `https://www.nhtsa.gov/recalls?vin=${encodeURIComponent(vin.trim().toUpperCase())}`;
}
