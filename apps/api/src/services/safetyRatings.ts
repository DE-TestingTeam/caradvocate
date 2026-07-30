/**
 * NHTSA NCAP crash-test ratings from the free Safety Ratings API.
 *
 * Verified against the live service:
 *
 *   curl 'https://api.nhtsa.gov/SafetyRatings/modelyear/2019/make/honda/model/civic'
 *   curl 'https://api.nhtsa.gov/SafetyRatings/VehicleId/14009'
 *
 * ======================= THIS FEED NAMES MODELS DIFFERENTLY ==================
 * Unlike the recalls and complaints feeds on the same host, NCAP embeds the body
 * style in the model name. A 2019 Ford lists as `F-150 SUPER CREW`, `F-150
 * SUPERCAB`, `F-250 CREW CAB` and so on -- so an exact lookup for the `F-150` that
 * a VIN decode gives us returns `Count: 0` and the car looks untested.
 *
 * Hence the two-step widening below: exact match first, and only when that finds
 * nothing, list the make's tested models and keep those that begin with ours. That
 * ordering matters -- `CIVIC` matches exactly and must not be widened into a scan.
 *
 * NHTSA's labels are also not clean: the live feed contains `F-150 SUPER CREW
 * DiESEL`, with a lowercase i. Matching is therefore case-insensitive throughout.
 * ============================================================================
 *
 * Ratings come back as *strings*, and `"Not Rated"` is a routine value rather than
 * an error -- most pre-2011 vehicles carry it on every field. It maps to absent, so
 * an untested car can never be presented as a zero-star one.
 *
 * Defensive in the same way as recalls.ts: a timeout, a non-200 or an unexpected
 * shape yields no ratings rather than throwing.
 */
import type { AssistFitment } from '@caradvocate/shared';

const NCAP_BASE = 'https://api.nhtsa.gov/SafetyRatings';
const TIMEOUT_MS = 8000;

/**
 * Caps on the widened path, which is the only one that can fan out.
 *
 * Sized against the live feed rather than guessed: a 2019 F-150 widens to 10 tested
 * variants and a Transit to 9, so a cap of 12 -- the first number tried here -- was
 * close enough to clip a legitimate truck. These exist to stop a pathologically short
 * model name (`F` alone matches 12) becoming a scan of NHTSA's catalogue, not to
 * trim real models, so they sit well above the worst real case.
 *
 * Truncation is logged rather than silent, because a quietly clipped list reads as
 * "these are all the variants" when it is not.
 */
const MAX_WIDENED_MODELS = 12;
const MAX_VARIANTS = 24;

/** One tested variant, already normalised for storage. */
export interface FetchedSafetyRating {
  ncapVehicleId: number;
  description: string;
  overallRating?: number;
  frontCrashRating?: number;
  sideCrashRating?: number;
  rolloverRating?: number;
  rolloverPossibility?: number;
  forwardCollisionWarning?: AssistFitment;
  laneDepartureWarning?: AssistFitment;
  electronicStabilityControl?: AssistFitment;
}

export interface SafetyRatingLookup {
  year: number;
  make: string;
  model: string;
}

/**
 * Crash-test ratings for one model's variants.
 *
 * `undefined` means NHTSA could not be reached; an empty array means it answered and
 * has tested nothing matching. The caller must keep those apart -- see
 * services/safetyRatingSync.ts.
 */
export async function fetchSafetyRatings(
  lookup: SafetyRatingLookup,
): Promise<FetchedSafetyRating[] | undefined> {
  const variants = await findVariants(lookup);
  if (variants === undefined) return undefined;
  if (variants.length === 0) return [];

  if (variants.length > MAX_VARIANTS) {
    console.warn(
      `NCAP: ${lookup.year} ${lookup.make} ${lookup.model} matched ${variants.length} tested variants; keeping ${MAX_VARIANTS}.`,
    );
  }

  const details = await Promise.all(
    variants.slice(0, MAX_VARIANTS).map((variant) => fetchVariantDetail(variant)),
  );

  // A variant whose detail request failed is dropped rather than failing the whole
  // model: four ratings out of five beats none, and the sync still records success.
  return details.filter((row): row is FetchedSafetyRating => row !== undefined);
}

/** A variant identified by the listing step, before its ratings are fetched. */
interface VariantRef {
  ncapVehicleId: number;
  description: string;
}

/**
 * The tested variants of one model, widening the model name only if it has to.
 *
 * Returns `undefined` when NHTSA could not be reached, which the caller records as
 * "never checked" rather than as an answer.
 *
 * Both request steps can force that, and the second one matters as much as the first:
 * if the exact lookup legitimately finds nothing and the *widening* request then
 * fails, an empty result here would be stored as a successful check and cached for a
 * week. An F-150 would sit there reading "not crash-tested" -- a transient network
 * failure promoted to a fact about the car -- which is the one outcome the whole
 * `synced` flag exists to prevent.
 */
async function findVariants(lookup: SafetyRatingLookup): Promise<VariantRef[] | undefined> {
  const exact = await requestJson(
    `${NCAP_BASE}/modelyear/${lookup.year}/make/${encodeURIComponent(lookup.make)}/model/${encodeURIComponent(lookup.model)}`,
  );
  if (exact === undefined) return undefined;

  const direct = readVariants(exact);
  if (direct.length > 0) return direct;

  // Nothing under this exact name. Either the model genuinely was not tested, or
  // NCAP files it under a body-style-qualified name -- see the header.
  const names = await widenedModelNames(lookup);
  if (names === undefined) return undefined;
  if (names.length === 0) return [];

  const listings = await Promise.all(
    names.map((name) =>
      requestJson(
        `${NCAP_BASE}/modelyear/${lookup.year}/make/${encodeURIComponent(lookup.make)}/model/${encodeURIComponent(name)}`,
      ),
    ),
  );

  const found = new Map<number, VariantRef>();
  for (const listing of listings) {
    if (listing === undefined) continue;
    for (const variant of readVariants(listing)) found.set(variant.ncapVehicleId, variant);
  }

  // Sorted so that if the cap does bite, which variants survive is predictable
  // rather than a function of the order NHTSA happened to list them in.
  return [...found.values()].sort((a, b) => a.ncapVehicleId - b.ncapVehicleId);
}

/**
 * NCAP model names for this make and year that begin with the model we hold.
 *
 * Prefix rather than substring: "F-150 SUPER CREW" is an F-150, but matching
 * anywhere in the string would let "MUSTANG GT350R" answer a query for "GT".
 *
 * `undefined` means the request failed, kept distinct from "no name matched" so the
 * caller does not cache a failure as an answer.
 */
async function widenedModelNames(lookup: SafetyRatingLookup): Promise<string[] | undefined> {
  const body = await requestJson(
    `${NCAP_BASE}/modelyear/${lookup.year}/make/${encodeURIComponent(lookup.make)}`,
  );
  if (body === undefined) return undefined;

  const wanted = lookup.model.trim().toUpperCase();
  if (!wanted) return [];

  const names = resultRows(body)
    .map((row) => readString(row, 'Model'))
    .filter((name): name is string => Boolean(name))
    // Case-insensitive because NHTSA's own labels are inconsistently cased.
    .filter((name) => name.toUpperCase().startsWith(wanted));

  // Sorted for the same reason as the variant cap: predictable truncation.
  const unique = [...new Set(names)].sort();
  if (unique.length > MAX_WIDENED_MODELS) {
    console.warn(
      `NCAP: "${lookup.model}" prefix-matched ${unique.length} NHTSA model names for ${lookup.year} ${lookup.make}; keeping ${MAX_WIDENED_MODELS}.`,
    );
  }

  return unique.slice(0, MAX_WIDENED_MODELS);
}

/** The ratings for one variant. `undefined` on any failure. */
async function fetchVariantDetail(variant: VariantRef): Promise<FetchedSafetyRating | undefined> {
  const body = await requestJson(`${NCAP_BASE}/VehicleId/${variant.ncapVehicleId}`);
  if (body === undefined) return undefined;
  return parseVariantDetail(variant, body);
}

/**
 * Exported for testing. The listing endpoints return
 * `{ Count, Results: [ { VehicleId, VehicleDescription } ] }`.
 *
 * A variant with no id is dropped: `ncapVehicleId` is what makes a row unique per
 * model, so without it a re-sync would duplicate the variant forever.
 */
export function readVariants(body: unknown): VariantRef[] {
  const variants: VariantRef[] = [];
  const seen = new Set<number>();

  for (const row of resultRows(body)) {
    const ncapVehicleId = readInteger(row, 'VehicleId');
    // The make-level listing returns VehicleId 0 as a placeholder, so zero is not a
    // usable identity here.
    if (ncapVehicleId === undefined || ncapVehicleId <= 0) continue;
    if (seen.has(ncapVehicleId)) continue;
    seen.add(ncapVehicleId);

    variants.push({
      ncapVehicleId,
      description: readString(row, 'VehicleDescription') ?? `NHTSA vehicle ${ncapVehicleId}`,
    });
  }

  return variants;
}

/**
 * Exported for testing. The detail endpoint returns one row of ~40 fields, of which
 * these are the ones an owner can act on.
 */
export function parseVariantDetail(variant: VariantRef, body: unknown): FetchedSafetyRating | undefined {
  const [row] = resultRows(body);
  // An unknown VehicleId yields `Results: []` rather than an error.
  if (!row) return undefined;

  const rollover = readStars(row, 'RolloverRating');

  return {
    ncapVehicleId: variant.ncapVehicleId,
    // NHTSA's detail row carries its own description; prefer it, since the listing's
    // can differ in casing.
    description: readString(row, 'VehicleDescription') ?? variant.description,
    overallRating: readStars(row, 'OverallRating'),
    frontCrashRating: readStars(row, 'OverallFrontCrashRating'),
    sideCrashRating: readStars(row, 'OverallSideCrashRating'),
    rolloverRating: rollover,
    // Gated on the rating: NHTSA sends 0.0 when the test was not run, and a bare 0
    // would read as "cannot roll over" -- the opposite of "we do not know".
    rolloverPossibility: rollover === undefined ? undefined : readPossibility(row),
    forwardCollisionWarning: readFitment(row, 'NHTSAForwardCollisionWarning'),
    laneDepartureWarning: readFitment(row, 'NHTSALaneDepartureWarning'),
    electronicStabilityControl: readFitment(row, 'NHTSAElectronicStabilityControl'),
  };
}

async function requestJson(url: string): Promise<unknown | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return undefined;
    return (await response.json()) as unknown;
  } catch {
    // Offline, blocked, slow, or malformed JSON. All the same to the caller.
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function resultRows(body: unknown): Record<string, unknown>[] {
  if (!body || typeof body !== 'object') return [];
  // Note the capital R here, where the recalls and complaints feeds use `results`.
  const results = (body as Record<string, unknown>).Results;
  if (!Array.isArray(results)) return [];
  return results.filter(
    (row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row),
  );
}

function readString(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed || undefined;
}

function readInteger(row: Record<string, unknown>, key: string): number | undefined {
  const raw = row[key];
  const value = typeof raw === 'number' ? raw : Number(readString(row, key));
  if (!Number.isInteger(value)) return undefined;
  return value;
}

/**
 * A star rating, 1-5. NHTSA sends these as strings, and `"Not Rated"` -- along with
 * anything else outside 1-5 -- means the test was not run, which is absent rather
 * than zero.
 */
function readStars(row: Record<string, unknown>, key: string): number | undefined {
  const value = readInteger(row, key);
  if (value === undefined || value < 1 || value > 5) return undefined;
  return value;
}

/** Rollover chance as a fraction, 0-1 exclusive of 0. Junk and 0.0 both mean unknown. */
function readPossibility(row: Record<string, unknown>): number | undefined {
  const raw = row.RolloverPossibility;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 1) return undefined;
  return value;
}

/**
 * NHTSA records driver-assist fitment as "Standard", "Optional" or "No".
 *
 * "No" is kept as a value rather than dropped: "this model never offered lane-keep"
 * is a finding, and collapsing it into absent would make it indistinguishable from
 * the older vehicles where NHTSA recorded nothing at all.
 */
function readFitment(row: Record<string, unknown>, key: string): AssistFitment | undefined {
  const value = readString(row, key)?.toLowerCase();
  if (value === 'standard') return 'standard';
  if (value === 'optional') return 'optional';
  if (value === 'no') return 'no';
  return undefined;
}
