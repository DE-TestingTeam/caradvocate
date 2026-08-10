/**
 * Owner complaints from NHTSA's free complaints API.
 *
 * DATES DIFFER FROM THE RECALLS FEED on the same host: this one is MM/DD/YYYY, recalls are
 * DD/MM/YYYY. Confirmed by scanning both -- recall dates reach 28 in the first segment,
 * complaint dates never exceed 12 there while reaching 31 in the second. Reusing the recall
 * parser would mangle every date it could not detect as impossible.
 *
 * THREE OUTCOMES, NOT TWO, for the same reason services/recalls.ts has them: a model name this
 * API does not recognise answers HTTP 400 with the success-shaped body
 * `{"count":0,"message":"Results returned successfully","results":[]}`. Reading that body
 * without its status code is how a 2014 "F-350" -- which is what a VIN decode gives -- looked
 * like a truck nobody had ever complained about. It has 98 complaints; NHTSA files them by cab
 * as "F-350 SUPER CREW" and friends. A recognised model with nothing against it answers 200
 * and `count: 0`, and that one IS a real all-clear.
 *
 * Recovering the 400 needs NHTSA's own vocabulary of complaint model names, which is a
 * DIFFERENT list from the recall one -- see services/modelNames.ts. It is a plain endpoint
 * rather than a mirrored bulk file, so unlike recalls this file can resolve the name itself
 * and stays free of the database.
 *
 * What arrives is one record per complaint; what the UI needs is which systems get reported
 * and how often, so this aggregates by component -- which also keeps a 344KB response for a
 * popular model out of the hot path.
 */
import { fetchJson } from '../lib/fetchJson.js';
import { matchModelNames } from './modelNames.js';

const NHTSA_COMPLAINTS = 'https://api.nhtsa.gov/complaints/complaintsByVehicle';

/**
 * NHTSA's list of the model names it files complaints under. `issueType=c` matters: the same
 * endpoint with `issueType=r` returns the RECALL vocabulary, which is a different set of names
 * for the same trucks and draws a blank on this feed. See services/modelNames.ts.
 */
const NHTSA_COMPLAINT_MODELS = 'https://api.nhtsa.gov/products/vehicle/models';

/**
 * Ten seconds was too tight and produced a false "could not be loaded" on a real car. NHTSA
 * served a single 2014 F-350 cab variant in 6.8 to 8.4 seconds on an ordinary afternoon --
 * these are ~97KB bodies, not the few hundred bytes the recall feed returns -- so a normally
 * slow day sat right on the limit. The whole resolution path is still bounded, since the calls
 * that can multiply run concurrently; see `fetchForNames`.
 */
const TIMEOUT_MS = 20000;

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
 * Three outcomes, matching services/recalls.ts. `model_not_listed` is NHTSA answering about the
 * NAME rather than about the car: it must not reach an owner as "no complaints", and it must
 * not be retried as though it were an outage.
 */
export type ComplaintFetch =
  | { outcome: 'ok'; reports: ComponentReports[] }
  | { outcome: 'model_not_listed' }
  | { outcome: 'unavailable' };

/**
 * Complaint counts per component for one model.
 *
 * Asks under the name on the car, and if NHTSA does not recognise it, under whatever names
 * they file this year and make by. A 200 settles it either way -- including an empty one,
 * which is a real all-clear.
 *
 * The 400 is left standing when nothing resolves. That is the honest answer for a "GMT-400":
 * a platform code no manufacturer sells, which no amount of matching should invent a model for.
 */
export async function fetchComponentReports(lookup: ComplaintLookup): Promise<ComplaintFetch> {
  const direct = await requestComplaints(lookup);
  if (direct.outcome !== 'unknown_model') return finish(direct);

  const vocabulary = await fetchComplaintModelNames(lookup);
  // Nothing to try, either because the name is genuinely not NHTSA's or because the model list
  // could not be fetched. Both leave the 400 exactly as informative as it already was.
  if (vocabulary === undefined) return { outcome: 'model_not_listed' };

  const names = matchModelNames(vocabulary, lookup.model);
  if (names.length === 0) return { outcome: 'model_not_listed' };

  return fetchForNames(lookup, names);
}

/** One response, aggregated. Shared by the direct ask and the single-name case. */
function finish(fetched: ComplaintRequest): ComplaintFetch {
  if (fetched.outcome === 'unavailable') return { outcome: 'unavailable' };
  if (fetched.outcome === 'unknown_model') return { outcome: 'model_not_listed' };
  return { outcome: 'ok', reports: aggregate(fetched.rows) };
}

/**
 * The same lookup asked under several names, unioned by `odiNumber` BEFORE aggregation.
 *
 * The order matters and cost a bug in the recall version of this to see: NHTSA's finer names
 * are cab and body variants that overlap heavily -- all three 2014 F-350 cab names return the
 * identical 98 complaints -- so aggregating each name and summing would report every component
 * three times over. Deduplicating the raw records first means each complaint is counted once no
 * matter how many names it came back under.
 *
 * CONCURRENTLY, unlike the recall version, because the bodies here are three orders of
 * magnitude larger -- ~97KB per cab variant against a few hundred bytes per recall list. Asked
 * one after another this resolved in 33 seconds on a slow afternoon, three of those spent
 * downloading the same 98 complaints twice over, and every second of it was on the page load
 * of whoever happened to trigger the refresh. Concurrent, the wall clock is the slowest single
 * name rather than the sum of all of them.
 *
 * `unavailable` only if every name failed to answer, as in services/recalls.ts.
 */
async function fetchForNames(
  lookup: ComplaintLookup,
  names: readonly string[],
): Promise<ComplaintFetch> {
  const attempts = await Promise.all(
    names.map((name) => requestComplaints({ ...lookup, model: name })),
  );

  const rows = new Map<string, Record<string, unknown>>();
  let answered = false;

  for (const attempt of attempts) {
    if (attempt.outcome === 'unavailable') continue;
    answered = true;
    // A name that 400s within a resolved set is simply a variant this car is not.
    if (attempt.outcome !== 'ok') continue;

    for (const row of attempt.rows) {
      const id = readComplaintId(row);
      // No id is no way to tell two records apart. Keyed on the record itself so it survives
      // rather than collapsing every such complaint into one.
      rows.set(id ?? JSON.stringify(row), row);
    }
  }

  if (!answered) return { outcome: 'unavailable' };
  return { outcome: 'ok', reports: aggregate([...rows.values()]) };
}

/** One response, before aggregation. `unknown_model` is the 400; see the header. */
type ComplaintRequest =
  | { outcome: 'ok'; rows: Record<string, unknown>[] }
  | { outcome: 'unknown_model' }
  | { outcome: 'unavailable' };

/**
 * The raw complaint records for one name.
 *
 * Its own fetch rather than lib/fetchJson, which collapses every failure into `undefined` --
 * the 400 is the whole point here and has to survive.
 */
async function requestComplaints(lookup: ComplaintLookup): Promise<ComplaintRequest> {
  const url = new URL(NHTSA_COMPLAINTS);
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

    return { outcome: 'ok', rows: resultRows(await response.json()) };
  } catch {
    // Offline, blocked, slow, or malformed JSON. All the same to the caller.
    return { outcome: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The model names NHTSA files complaints under for one year and make, or `undefined` when the
 * list could not be fetched. An empty array is an answer -- a make with nothing on file that
 * year -- and resolves to `model_not_listed` rather than to an all-clear.
 */
async function fetchComplaintModelNames(
  lookup: ComplaintLookup,
): Promise<string[] | undefined> {
  const url = new URL(NHTSA_COMPLAINT_MODELS);
  url.searchParams.set('modelYear', String(lookup.year));
  url.searchParams.set('make', lookup.make);
  url.searchParams.set('issueType', 'c');

  const body = await fetchJson(url, TIMEOUT_MS);
  if (body === undefined) return undefined;

  return resultRows(body)
    .map((row) => (typeof row.model === 'string' ? row.model.trim() : ''))
    .filter((model) => model !== '');
}

/** NHTSA's per-complaint identifier, which is what makes two records the same one. */
function readComplaintId(row: Record<string, unknown>): string | undefined {
  const value = row.odiNumber;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

/**
 * Exported for testing. A complaint contributes once to each distinct system it names, because
 * a report about brakes *and* the engine concerns both. Canonicalising before dedupe is what
 * stops a triple-tagged fuel complaint counting three times.
 */
export function aggregateComplaints(body: unknown): ComponentReports[] {
  return aggregate(resultRows(body));
}

/** The same, over records already pulled out of one or more responses. */
function aggregate(rows: readonly Record<string, unknown>[]): ComponentReports[] {
  const groups = new Map<string, ComponentReports>();
  const candidates = new Map<string, QuoteCandidate[]>();

  for (const row of rows) {
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
