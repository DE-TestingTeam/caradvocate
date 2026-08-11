/**
 * ZIP code -> two-letter state, for vendors that localise by state rather than by ZIP.
 *
 * WHY THIS EXISTS: onboarding collects a ZIP, because that is what an owner knows and what
 * MarketCheck's predict endpoint takes. Vehicle Databases' market-value endpoint takes a STATE,
 * and the difference is not cosmetic -- measured on one 2018 CTS at 100,000 miles, the same call
 * returns $15,900 dealer retail with no state, $14,787 for NY and $14,151 for IN. Sending nothing
 * is not neutral either: it matched the CA figure exactly, so "no state" is a region, just not
 * the owner's one.
 *
 * RANGES OVER A LOOKUP TABLE. ZIP prefixes were allocated geographically, so states hold
 * contiguous blocks of the first three digits and sixty-odd ranges cover the country -- against a
 * thousand rows for a prefix map, most of them repeating their neighbour.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: guess. A prefix outside every range (unassigned, or a typo)
 * returns undefined, and the caller omits the parameter rather than sending a plausible state --
 * a valuation quietly computed for the wrong half of the country is worse than one computed
 * nationally, because nothing about it looks wrong.
 */

/** Inclusive first-three-digit ranges, in the USPS allocation. */
const RANGES: readonly (readonly [number, number, string])[] = [
  [5, 5, 'NY'],
  [6, 9, 'PR'],
  [10, 27, 'MA'],
  [28, 29, 'RI'],
  [30, 38, 'NH'],
  [39, 49, 'ME'],
  [50, 59, 'VT'],
  [60, 69, 'CT'],
  [70, 89, 'NJ'],
  [100, 149, 'NY'],
  [150, 196, 'PA'],
  [197, 199, 'DE'],
  [200, 205, 'DC'],
  [206, 219, 'MD'],
  [220, 246, 'VA'],
  [247, 268, 'WV'],
  [270, 289, 'NC'],
  [290, 299, 'SC'],
  [300, 319, 'GA'],
  [320, 349, 'FL'],
  [350, 369, 'AL'],
  [370, 385, 'TN'],
  [386, 397, 'MS'],
  [398, 399, 'GA'],
  [400, 427, 'KY'],
  [430, 459, 'OH'],
  [460, 479, 'IN'],
  [480, 499, 'MI'],
  [500, 528, 'IA'],
  [530, 549, 'WI'],
  [550, 567, 'MN'],
  [570, 577, 'SD'],
  [580, 588, 'ND'],
  [590, 599, 'MT'],
  [600, 629, 'IL'],
  [630, 658, 'MO'],
  [660, 679, 'KS'],
  [680, 693, 'NE'],
  [700, 714, 'LA'],
  [716, 729, 'AR'],
  [730, 731, 'OK'],
  [733, 733, 'TX'],
  [734, 749, 'OK'],
  [750, 799, 'TX'],
  [800, 816, 'CO'],
  [820, 831, 'WY'],
  [832, 838, 'ID'],
  [840, 847, 'UT'],
  [850, 865, 'AZ'],
  [870, 884, 'NM'],
  [885, 885, 'TX'],
  [889, 898, 'NV'],
  [900, 961, 'CA'],
  [967, 968, 'HI'],
  [970, 979, 'OR'],
  [980, 994, 'WA'],
  [995, 999, 'AK'],
];

/**
 * The state a ZIP falls in, or undefined for anything unrecognised.
 *
 * Takes the ZIP as stored -- five digits, or a ZIP+4 -- and reads only the first three, which is
 * all that carries the geography.
 */
export function stateForZip(zip: string | null | undefined): string | undefined {
  if (!zip) return undefined;

  const digits = zip.trim().replace(/\D/g, '');
  if (digits.length < 5) return undefined;

  const prefix = Number(digits.slice(0, 3));
  if (!Number.isInteger(prefix)) return undefined;

  return RANGES.find(([low, high]) => prefix >= low && prefix <= high)?.[2];
}
