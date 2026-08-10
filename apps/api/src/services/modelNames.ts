/**
 * Matching an owner's model name against a vocabulary of NHTSA's own names.
 *
 * Its own module, with no imports, because both feeds that need it are meant to stay free of
 * something the other has: services/recalls.ts and services/complaints.ts hold no database
 * code, and services/recallMirror.ts -- where this used to live -- is nothing but database
 * code. The rule itself is the same for both, and there must only be one of it.
 *
 * THE VOCABULARIES ARE NOT. Recalls match against the bulk-file names in the mirror; complaints
 * match against `products/vehicle/models?issueType=c`. A 2014 F-350 is "F-350 SD" to the recall
 * API and "F-350 SUPER CREW" to the complaints one, and each name draws a blank on the other's
 * endpoint. Two NHTSA APIs, two dictionaries -- see the callers for which door each knocks on.
 */

/**
 * The vocabulary's names for one owner's model, or `[]` when none match.
 *
 * Exact, then whole-word prefix -- "F-350" claims "F-350 SD" but never "F-3500". Prefix only,
 * never substring or fuzzy: a recall shown against the wrong car is worse than one not shown,
 * and "GMT-400" resolving to something plausible is exactly the failure to avoid. It is a
 * platform code, no manufacturer sells one, and the honest answer is that NHTSA has no such
 * model rather than a guess at which C/K truck was meant.
 */
export function matchModelNames(candidates: readonly string[], model: string): string[] {
  const wanted = model.trim().toUpperCase();
  if (!wanted) return [];

  const exact = candidates.filter((name) => name.trim().toUpperCase() === wanted);
  if (exact.length > 0) return exact;

  return candidates.filter((name) => name.trim().toUpperCase().startsWith(`${wanted} `));
}
