/**
 * Safety recalls from NHTSA's free recalls API. Two details of it are easy to get wrong:
 * `ReportReceivedDate` is DD/MM/YYYY, so "28/05/2020" is 28 May; and the park-outside flag is
 * spelled `parkOutSide`, with a capital S.
 *
 * An unknown make/model returns `Count: 0` rather than an error, so a genuine all-clear and an
 * unrecognised model are indistinguishable here -- both mean "nothing to show".
 *
 * Defensive throughout: a timeout, a non-200 or an unexpected shape yields no recalls rather
 * than throwing, because a recall feed being down must not take My Car down with it.
 */
const NHTSA_RECALLS = 'https://api.nhtsa.gov/recalls/recallsByVehicle';
const TIMEOUT_MS = 8000;

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
 * Recalls for one model, or `undefined` when NHTSA could not be reached. The sync record is
 * what tracks whether a check actually succeeded.
 */
export async function fetchRecalls(lookup: RecallLookup): Promise<FetchedRecall[] | undefined> {
  const body = await requestRecalls(lookup);
  if (body === undefined) return undefined;
  return parseRecallsResponse(body);
}

async function requestRecalls(lookup: RecallLookup): Promise<unknown | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const url = new URL(NHTSA_RECALLS);
  url.searchParams.set('make', lookup.make);
  url.searchParams.set('model', lookup.model);
  url.searchParams.set('modelYear', String(lookup.year));

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
