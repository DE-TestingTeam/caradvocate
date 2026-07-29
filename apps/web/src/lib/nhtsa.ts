/**
 * Links out to NHTSA.
 *
 * The app mirrors NHTSA's data but does not try to reproduce their whole record.
 * Complaint prose runs to paragraphs per report and hundreds of reports per model,
 * so the section shows the shape of the problem -- which systems, how often, how
 * badly -- and sends anyone who wants the accounts themselves to the source.
 *
 * NHTSA's public vehicle pages are keyed by year/make/model, the same key our
 * mirrored feeds use, so no extra identifier is needed.
 *
 * NOTE: nhtsa.gov blocks non-browser requests, so this URL shape could not be
 * verified automatically. It follows their documented pattern and opens correctly
 * in a browser; if they ever restructure, this is the single place to change.
 */
export interface VehicleKey {
  year: number;
  make: string;
  model: string;
}

const NHTSA_VEHICLE = 'https://www.nhtsa.gov/vehicle';

/**
 * The NHTSA page for one vehicle, listing its recalls, complaints and
 * investigations. Make and model are upper-cased to match their URLs, and encoded
 * because plenty of both contain spaces or slashes ("F-150", "MERCEDES-BENZ").
 */
export function nhtsaVehicleUrl({ year, make, model }: VehicleKey): string {
  const segment = (value: string) => encodeURIComponent(value.trim().toUpperCase());
  return `${NHTSA_VEHICLE}/${year}/${segment(make)}/${segment(model)}`;
}

/**
 * NHTSA's VIN lookup, which is the one place an owner can get a per-car answer.
 *
 * Their site queries the manufacturer behind the scenes, so unlike the public API
 * it does know whether a specific vehicle was repaired. There is no API equivalent
 * -- that data is only sold -- so a link is genuinely the best we can offer.
 */
export function nhtsaVinRecallUrl(vin: string): string {
  return `https://www.nhtsa.gov/recalls?vin=${encodeURIComponent(vin.trim().toUpperCase())}`;
}
