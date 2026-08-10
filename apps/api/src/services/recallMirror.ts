/**
 * The local fallback for recalls, read from the bulk-file mirror when api.nhtsa.gov could
 * not be reached. Same shape as services/recalls.ts returns, so recallSync cannot tell
 * which of the two answered.
 *
 * WHY THIS IS A FALLBACK AND NOT THE PRIMARY: the live API normalises model names before
 * answering; the flat file is raw and does not. A 2023 Ariya campaign is filed in the file
 * under the model name "redundant ARIYA", and a handful of models like it would go unmatched
 * here but match fine against the API. The API is therefore asked first and this answers
 * only when it does not -- which measured at 57/60 models exact against the API, with the
 * three misses off by a single campaign rather than empty.
 *
 * A MISS IS NOT AN ALL-CLEAR. Zero rows here is ambiguous in a way zero rows from the API is
 * not: the API answering `Count: 0` is a statement about the car, while zero rows here may
 * only mean this model is spelled differently in the file. So `lookupMirroredRecalls`
 * answers `undefined` rather than `[]`, and the caller keeps reporting the feed as
 * unreached. Showing "no open recalls" on the strength of a name mismatch is the one
 * failure this whole feature exists to prevent.
 *
 * NEITHER IS A FAILURE HERE. Every error collapses to `undefined` too, for the reason
 * services/recalls.ts gives about NHTSA itself: a recall feed being down must not take My Car
 * down with it. This is a fallback on the path that is ALREADY degraded -- it runs only once
 * the live API has failed -- so a throw from it would convert "could not reach NHTSA", which
 * the UI has a considered state for, into a blank section with a Try again button. That is
 * strictly worse than the problem this table exists to solve. The unmigrated database is the
 * case that proved it, hence the warn: silently degrading forever is its own kind of failure.
 */
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { nhtsaRecallCampaigns, nhtsaRecallModels } from '../db/schema.js';
import type { FetchedRecall, RecallLookup } from './recalls.js';
import { normaliseKey } from './modelFeed.js';

/**
 * The model names NHTSA files recalls under for one year and make, from the mirror.
 *
 * THIS IS THE VOCABULARY THE RECALL API ITSELF USES, which is the only reason it is here and
 * not read from a live endpoint. NHTSA publishes a model list at
 * `products/vehicle/models?issueType=r`, and it is a DIFFERENT vocabulary: it offers a 2014
 * F-350 as "F-350 REGULAR CAB", "F-350 SUPERCAB" and "F-350 SUPER CREW", and
 * `recalls/recallsByVehicle` answers 400 for all three. The bulk files call the same truck
 * "F-350 SD" and "F-350 SUPER DUTY", and the recall API answers those with 5 and 1 campaigns.
 * Two NHTSA APIs, two dictionaries; this is the one that matches the door we knock on.
 *
 * Empty when the mirror holds nothing for that year and make -- which, until the import has
 * run, is every car. The caller must not read that as a fact about the name.
 */
export async function listMirroredModelNames(
  db: Database,
  year: number,
  make: string,
): Promise<string[]> {
  try {
    const rows = await db
      .selectDistinct({ model: nhtsaRecallModels.model })
      .from(nhtsaRecallModels)
      .where(
        and(eq(nhtsaRecallModels.year, year), eq(nhtsaRecallModels.make, make.trim().toUpperCase())),
      );
    return rows.map((row) => row.model);
  } catch {
    // Same reasoning as the lookup below: this runs on an already-degraded path.
    return [];
  }
}

/**
 * Recalls for one model from the mirror, or `undefined` when it has nothing for that model
 * -- which means "no answer", never "no recalls". See the header.
 */
export async function lookupMirroredRecalls(
  db: Database,
  lookup: RecallLookup,
): Promise<FetchedRecall[] | undefined> {
  try {
    return await queryMirror(db, lookup);
  } catch (error) {
    // Warned rather than swallowed, like the vendor clients do with an operator's problem:
    // the likeliest cause by far is the migration not having run, which otherwise presents
    // as a mirror that simply never answers.
    console.warn(
      `Recall mirror unavailable (has 0019_nhtsa_recall_mirror been migrated?): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }
}

async function queryMirror(db: Database, lookup: RecallLookup): Promise<FetchedRecall[] | undefined> {
  const key = normaliseKey(lookup);

  const rows = await db
    .select({
      campaignNumber: nhtsaRecallModels.campaignNumber,
      component: nhtsaRecallModels.component,
      parkIt: nhtsaRecallModels.parkIt,
      parkOutside: nhtsaRecallModels.parkOutside,
      reportedOn: nhtsaRecallModels.reportedOn,
      summary: nhtsaRecallCampaigns.summary,
      consequence: nhtsaRecallCampaigns.consequence,
      remedy: nhtsaRecallCampaigns.remedy,
    })
    .from(nhtsaRecallModels)
    // Left join: a campaign whose prose is missing is still a recall worth showing.
    .leftJoin(
      nhtsaRecallCampaigns,
      eq(nhtsaRecallCampaigns.campaignNumber, nhtsaRecallModels.campaignNumber),
    )
    .where(
      and(
        eq(nhtsaRecallModels.year, key.year),
        eq(nhtsaRecallModels.make, key.make),
        eq(nhtsaRecallModels.model, key.model),
      ),
    );

  if (rows.length === 0) return undefined;

  return rows.map((row) => ({
    campaignNumber: row.campaignNumber,
    component: row.component,
    summary: row.summary ?? '',
    consequence: row.consequence ?? '',
    remedy: row.remedy ?? '',
    parkIt: row.parkIt,
    parkOutside: row.parkOutside,
    reportedOn: row.reportedOn ?? undefined,
  }));
}
