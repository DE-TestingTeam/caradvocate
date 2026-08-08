/**
 * Safety recalls from NHTSA's free recalls API. Two details of it are easy to get wrong:
 * `ReportReceivedDate` is DD/MM/YYYY, so "28/05/2020" is 28 May; and the park-outside flag is
 * spelled `parkOutSide`, with a capital S.
 *
 * THREE OUTCOMES, NOT TWO. A model NHTSA does not recognise answers HTTP 400 -- with a body
 * that reads `{"Count":0,"Message":"Results returned successfully"}`, which is a success shape
 * carrying a failure. Collapsing that into "could not reach NHTSA" was wrong twice over: it
 * told owners a federal database was down when it had replied in under a second, and it put
 * the model on a retry ladder re-asking a question already answered. A recognised model with
 * nothing against it answers 200 and `Count: 0`, and that one IS an all-clear.
 *
 * The 400 is recoverable more often than not, because it usually means NHTSA files the car
 * under a finer name than the owner's -- a 2014 "F-350" is "F-350 SD" to them. Resolving that
 * needs their vocabulary, which lives in the mirror, so it is the caller's job: this file
 * stays free of the database. See services/recallSync.ts.
 *
 * Defensive otherwise: a timeout, any other non-200 or an unexpected shape yields
 * `unavailable` rather than throwing, because a recall feed being down must not take My Car
 * down with it.
 */

const NHTSA_RECALLS = 'https://api.nhtsa.gov/recalls/recallsByVehicle';
const TIMEOUT_MS = 8000;

/**
 * `unknown_model` is NHTSA's answer about the NAME, never about the car. It must not reach an
 * owner as an all-clear, and it must not be retried as though it were an outage.
 */
export type RecallFetch =
  | { outcome: 'ok'; recalls: FetchedRecall[] }
  | { outcome: 'unknown_model' }
  | { outcome: 'unavailable' };

/** One campaign, already normalised for storage. */
export interface FetchedRecall {
  campaignNumber: string;
  component: string;
  summary: string;
  consequence: string;
  remedy: string;
  parkIt: boolean;
  parkOutside: boolean;
  /** ISO yyyy-mm-dd, or undefined when NHTSA sent something unparseable. */
  reportedOn?: string;
}

export interface RecallLookup {
  year: number;
  make: string;
  model: string;
}

/**
 * Recalls for one model, under the name given.
 *
 * Its own fetch rather than lib/fetchJson, which collapses every failure into `undefined` --
 * the 400 is the whole point here and has to survive.
 */
export async function fetchRecalls(lookup: RecallLookup): Promise<RecallFetch> {
  const url = new URL(NHTSA_RECALLS);
  url.searchParams.set('make', lookup.make);
  url.searchParams.set('model', lookup.model);
  url.searchParams.set('modelYear', String(lookup.year));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    // NHTSA's shape for "no such model", regardless of the success-looking body.
    if (response.status === 400) return { outcome: 'unknown_model' };
    if (!response.ok) return { outcome: 'unavailable' };

    return { outcome: 'ok', recalls: parseRecallsResponse(await response.json()) };
  } catch {
    // Offline, blocked, slow, or malformed JSON. All the same to the caller.
    return { outcome: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The same lookup asked under several names, UNIONED.
 *
 * Unioned rather than first-wins because NHTSA's finer names are body and cab variants --
 * "F-350 SD" and "F-350 SUPER DUTY" are one truck to an owner -- and nothing on file says
 * which one is in the driveway. The union over-reports for some owners; picking one would hide
 * a live safety recall from the rest. The list already says these are recalls for the year,
 * make and model, and points at the VIN lookup that narrows it.
 *
 * `unavailable` only if every name failed to answer. One name answering is enough to know the
 * feed is up, and a name that 400s within a resolved set is simply a variant this car is not.
 */
export async function fetchRecallsForNames(
  lookup: RecallLookup,
  names: readonly string[],
): Promise<RecallFetch> {
  const recalls = new Map<string, FetchedRecall>();
  let answered = false;

  for (const name of names) {
    const attempt = await fetchRecalls({ ...lookup, model: name });
    if (attempt.outcome === 'unavailable') continue;
    answered = true;
    if (attempt.outcome === 'ok') {
      // Keyed by campaign: the variants share most of their recalls.
      for (const recall of attempt.recalls) recalls.set(recall.campaignNumber, recall);
    }
  }

  if (!answered) return { outcome: 'unavailable' };
  return { outcome: 'ok', recalls: [...recalls.values()] };
}

/**
 * Exported for testing. NHTSA returns `{ Count, results: [ { ... } ] }`. A campaign with no
 * identifier is dropped -- `campaignNumber` is what makes a row unique per model, so without
 * it a re-sync would duplicate the recall forever.
 */
export function parseRecallsResponse(body: unknown): FetchedRecall[] {
  const rows = resultRows(body);

  const seen = new Set<string>();
  const recalls: FetchedRecall[] = [];

  for (const row of rows) {
    const campaignNumber = readString(row, 'NHTSACampaignNumber');
    if (!campaignNumber) continue;
    // NHTSA occasionally lists the same campaign twice for one model.
    if (seen.has(campaignNumber)) continue;
    seen.add(campaignNumber);

    recalls.push({
      campaignNumber,
      component: readString(row, 'Component') ?? 'Unspecified',
      summary: readString(row, 'Summary') ?? '',
      consequence: readString(row, 'Consequence') ?? '',
      remedy: readString(row, 'Remedy') ?? '',
      parkIt: readBoolean(row, 'parkIt'),
      // Capital S. Misreading this downgrades the severity of NHTSA's most urgent recalls.
      parkOutside: readBoolean(row, 'parkOutSide'),
      reportedOn: readReportDate(row),
    });
  }

  return recalls;
}

function resultRows(body: unknown): Record<string, unknown>[] {
  if (!body || typeof body !== 'object') return [];
  const results = (body as Record<string, unknown>).results;
  if (!Array.isArray(results)) return [];
  return results.filter(
    (row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row),
  );
}

function readString(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  if (typeof value !== 'string') return undefined;
  // NHTSA pads sentences with double spaces; collapse them so the UI can wrap.
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed || undefined;
}

function readBoolean(row: Record<string, unknown>, key: string): boolean {
  const value = row[key];
  if (typeof value === 'boolean') return value;
  // Tolerate the string forms some NHTSA endpoints use for the same flags.
  if (typeof value === 'string') return /^(true|yes)$/i.test(value.trim());
  return false;
}

/** DD/MM/YYYY -> ISO yyyy-mm-dd. Anything else is treated as no date at all. */
function readReportDate(row: Record<string, unknown>): string | undefined {
  const raw = readString(row, 'ReportReceivedDate');
  if (!raw) return undefined;

  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (!match) return undefined;

  const [, day, month, year] = match;
  const monthIndex = Number(month);
  const dayNumber = Number(day);
  if (monthIndex < 1 || monthIndex > 12 || dayNumber < 1 || dayNumber > 31) return undefined;

  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  // A round trip rejects the impossible dates the range check lets through, e.g. 31 February.
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return undefined;

  return iso;
}
