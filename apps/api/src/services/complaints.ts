/**
 * Owner complaints from NHTSA's free complaints API.
 *
 * DATES DIFFER FROM THE RECALLS FEED on the same host: this one is MM/DD/YYYY, recalls are
 * DD/MM/YYYY. Confirmed by scanning both -- recall dates reach 28 in the first segment,
 * complaint dates never exceed 12 there while reaching 31 in the second. Reusing the recall
 * parser would mangle every date it could not detect as impossible.
 *
 * What arrives is one record per complaint; what the UI needs is which systems get reported
 * and how often, so this aggregates by component -- which also keeps a 344KB response for a
 * popular model out of the hot path.
 */
const NHTSA_COMPLAINTS = 'https://api.nhtsa.gov/complaints/complaintsByVehicle';
const TIMEOUT_MS = 10000;

/** NHTSA's bucket for complaints it could not categorise. It tells an owner nothing. */
const NON_COMPONENT = 'UNKNOWN OR OTHER';

/**
 * NHTSA's component taxonomy shifted over the years, so the same fuel problem is tagged three
 * ways and one complaint often carries all three -- 62 of 63 fuel complaints on a 2019 Civic
 * carry both "FUEL SYSTEM" and "GASOLINE". Without this the section shows three near-identical
 * rows for one issue. Only clusters confirmed to co-occur on the live feed are merged.
 */
const CANONICAL_COMPONENT = new Map([
  ['GASOLINE', 'FUEL SYSTEM'],
  ['FUEL/PROPULSION SYSTEM', 'FUEL SYSTEM'],
]);

/**
 * Reduces one component label to the form the aggregates are keyed on. `undefined` for NHTSA's
 * uncategorised bucket.
 *
 * Shared with the bulk-file ingest, whose COMPDESC is finer-grained and uses both separators
 * *within* one name ("LATCHES/LOCKS/LINKAGES:HOOD:LATCH", "SERVICE BRAKES, HYDRAULIC") where
 * the JSON API uses a comma between components. So the colon and comma tails are dropped here
 * and the API path splits on commas before calling this. Verified on a 2011 Pathfinder:
 * reducing the bulk file this way reproduces the API's groups and counts exactly.
 */
export function canonicalComponent(raw: string): string | undefined {
  const head = raw.split(':')[0]?.split(',')[0]?.trim().toUpperCase();
  if (!head || head === NON_COMPONENT) return undefined;
  return CANONICAL_COMPONENT.get(head) ?? head;
}

/** How many owner descriptions to keep per component. */
const QUOTES_PER_COMPONENT = 3;

/** Below this a "description" is a fragment, not an account worth showing. */
const MIN_USEFUL_LENGTH = 40;

/** One owner's account, in their own words. */
export interface OwnerQuote {
  text: string;
  /** ISO yyyy-mm-dd, when NHTSA recorded a usable incident date. */
  incidentOn?: string;
}

/** One component of one model, with the counts and a few accounts behind it. */
export interface ComponentReports {
  component: string;
  reportCount: number;
  crashCount: number;
  fireCount: number;
  injuryCount: number;
  deathCount: number;
  /** ISO yyyy-mm-dd of the most recent incident in this group, when known. */
  latestIncidentOn?: string;
  /** Representative descriptions, most consequential first. */
  quotes: OwnerQuote[];
}

/** A candidate description, kept until the group picks its best few. */
interface QuoteCandidate extends OwnerQuote {
  harmed: boolean;
}

export interface ComplaintLookup {
  year: number;
  make: string;
  model: string;
}

/**
 * Complaint counts per component. `undefined` means NHTSA could not be reached,
 * which the caller must not confuse with "this model has no complaints".
 */
export async function fetchComponentReports(
  lookup: ComplaintLookup,
): Promise<ComponentReports[] | undefined> {
  const body = await requestComplaints(lookup);
  if (body === undefined) return undefined;
  return aggregateComplaints(body);
}

async function requestComplaints(lookup: ComplaintLookup): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const url = new URL(NHTSA_COMPLAINTS);
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
 * Exported for testing. A complaint contributes once to each distinct system it names, because
 * a report about brakes *and* the engine concerns both. Canonicalising before dedupe is what
 * stops a triple-tagged fuel complaint counting three times.
 */
export function aggregateComplaints(body: unknown): ComponentReports[] {
  const groups = new Map<string, ComponentReports>();
  const candidates = new Map<string, QuoteCandidate[]>();

  for (const row of resultRows(body)) {
    const crash = readBoolean(row, 'crash');
    const fire = readBoolean(row, 'fire');
    const injuries = readCount(row, 'numberOfInjuries');
    const deaths = readCount(row, 'numberOfDeaths');
    const incident = readIncidentDate(row);
    const summary = readSummary(row);

    for (const component of componentsOf(row)) {
      const group = groups.get(component) ?? {
        component,
        reportCount: 0,
        crashCount: 0,
        fireCount: 0,
        injuryCount: 0,
        deathCount: 0,
        quotes: [],
      };

      group.reportCount += 1;
      if (crash) group.crashCount += 1;
      if (fire) group.fireCount += 1;
      group.injuryCount += injuries;
      group.deathCount += deaths;
      if (incident && (!group.latestIncidentOn || incident > group.latestIncidentOn)) {
        group.latestIncidentOn = incident;
      }

      groups.set(component, group);

      if (summary) {
        const forComponent = candidates.get(component) ?? [];
        forComponent.push({
          text: summary,
          incidentOn: incident,
          harmed: crash || fire || injuries > 0 || deaths > 0,
        });
        candidates.set(component, forComponent);
      }
    }
  }

  for (const [component, group] of groups) {
    group.quotes = pickQuotes(candidates.get(component) ?? []);
  }

  // Most-reported first; the UI shows the top few and the order decides which.
  return [...groups.values()].sort(
    (a, b) => b.reportCount - a.reportCount || a.component.localeCompare(b.component),
  );
}

/**
 * The few accounts most worth reading. One where someone crashed or was hurt leads, because it
 * is the one that changes a decision; recency breaks the tie, since a 2013 report may describe
 * a fault long since fixed by a service bulletin. Duplicate text is dropped -- owners
 * sometimes file twice.
 */
function pickQuotes(candidates: QuoteCandidate[]): OwnerQuote[] {
  const seen = new Set<string>();
  const unique = candidates.filter((candidate) => {
    const key = candidate.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique
    .sort(
      (a, b) =>
        Number(b.harmed) - Number(a.harmed) || (b.incidentOn ?? '').localeCompare(a.incidentOn ?? ''),
    )
    .slice(0, QUOTES_PER_COMPONENT)
    .map(({ text, incidentOn }) => (incidentOn ? { text, incidentOn } : { text }));
}

/**
 * The owner's description, if it says anything. NHTSA pads prose with double spaces, and a
 * handful of complaints carry a stub like "SEE SUMMARY" -- too short to inform, so dropped.
 */
function readSummary(row: Record<string, unknown>): string | undefined {
  const value = row.summary;
  if (typeof value !== 'string') return undefined;

  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length < MIN_USEFUL_LENGTH) return undefined;
  return text;
}

/**
 * The distinct systems one complaint concerns, canonicalised and deduplicated.
 * NHTSA's uncategorised bucket is dropped: it cannot tell an owner anything.
 */
function componentsOf(row: Record<string, unknown>): string[] {
  const raw = row.components;
  if (typeof raw !== 'string') return [];

  // Comma is a separator here, unlike in the bulk file where it can be part of one name --
  // hence the split before canonicalising rather than inside it.
  const canonical = raw
    .split(',')
    .map((part) => canonicalComponent(part))
    .filter((part): part is string => Boolean(part));

  return [...new Set(canonical)];
}

function resultRows(body: unknown): Record<string, unknown>[] {
  if (!body || typeof body !== 'object') return [];
  const results = (body as Record<string, unknown>).results;
  if (!Array.isArray(results)) return [];
  return results.filter(
    (row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row),
  );
}

function readBoolean(row: Record<string, unknown>, key: string): boolean {
  const value = row[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return /^(true|yes)$/i.test(value.trim());
  return false;
}

/** Counts arrive as numbers, occasionally as numeric strings. Junk counts as zero. */
function readCount(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

/** MM/DD/YYYY -> ISO yyyy-mm-dd. See the header: this feed is month-first. */
function readIncidentDate(row: Record<string, unknown>): string | undefined {
  const raw = row.dateOfIncident;
  if (typeof raw !== 'string') return undefined;

  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
  if (!match) return undefined;

  const [, month, day, year] = match;
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

  // Rejects impossible dates such as 02/31 by requiring a clean round trip.
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return undefined;

  return iso;
}
