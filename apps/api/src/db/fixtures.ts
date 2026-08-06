/**
 * Seed data.
 *
 * `referenceBenchmarks` below is a captured Vehicle Databases response for the reference
 * model, not plausible-looking numbers. Captured 2 August 2026 from
 * `GET /vehicle-repairs/v2/2HGFC2F53KH124821` (2019 Honda Civic LX 4dr Sedan CVT), each
 * figure the union of VDB's independent and dealer channels (services/repairPricing.ts).
 *
 * A snapshot rather than a live call because the seed has to be deterministic and offline
 * -- seeding must not depend on the network, and VDB's allowance is metered. Live pricing
 * for an owner's actual car arrives through services/repairPricingSync.ts.
 *
 * Everything on the Alex Rivera account in seed.ts is transcribed from the wireframes and
 * should be treated as fixed.
 */

/**
 * One repair's real pricing for the reference model. No labor rate or hours: VDB publishes
 * labor as money only (see services/repairPricing.ts). `laborTotal` is the real figure.
 */
export interface ReferenceBenchmark {
  slug: string;
  name: string;
  /** VDB's own title for the job, so a row traces back to its source. */
  sourceTitle: string;
  /** Which VDB channels priced it. Dealer-only for 35 of the 76 titles. */
  channels: ('independent' | 'dealer')[];
  partsTotal: number;
  partsLow: number;
  partsHigh: number;
  laborTotal: number;
  fairTotalLow: number;
  fairTotalHigh: number;
  recommendation: { headline: string; badge: string; body: string };
}

/**
 * The catalog, in picker order. `timing-belt-inspection` is in `unpricedRepairs` below:
 * VDB prices a replacement and no inspection, and one priced off the other would be
 * wrong by roughly tenfold.
 */
export const referenceBenchmarks: ReferenceBenchmark[] = [
  {
    slug: 'brake-pad-replacement',
    name: 'Brake Pad Replacement',
    sourceTitle: 'Brakes - Replace Pads',
    channels: ['independent', 'dealer'],
    partsTotal: 116,
    partsLow: 95,
    partsHigh: 138,
    laborTotal: 215,
    // Supersedes the wireframes' $280-$400 (Quote Evaluation) and $360-$660 (Fair Total).
    fairTotalLow: 271,
    fairTotalHigh: 396,
    recommendation: {
      headline: 'Repair is Recommended',
      badge: 'CRITICAL REPAIR',
      body: 'At 68,400 miles with reported grinding, brake pad replacement is recommended. Continued driving risks rotor damage.',
    },
  },
  {
    slug: 'ac-compressor-replacement',
    name: 'AC Compressor Replacement',
    sourceTitle: 'Air Conditioning - Replace Compressor',
    channels: ['independent', 'dealer'],
    partsTotal: 581,
    partsLow: 516,
    partsHigh: 649,
    laborTotal: 1078,
    fairTotalLow: 1485,
    fairTotalHigh: 1842,
    recommendation: {
      headline: 'Repair is Recommended',
      badge: 'CRITICAL REPAIR',
      body: 'AC compressor failure is a known issue on 2018-2020 Civics. With no cold air at idle, replacement is recommended.',
    },
  },
  {
    slug: 'oil-change-filter',
    name: 'Oil Change & Filter',
    sourceTitle: 'Oil Change',
    channels: ['independent', 'dealer'],
    partsTotal: 56,
    partsLow: 45,
    partsHigh: 67,
    laborTotal: 46,
    fairTotalLow: 82,
    fairTotalHigh: 124,
    recommendation: {
      headline: 'Repair is Recommended',
      badge: 'ROUTINE',
      body: 'Routine maintenance on the manufacturer interval. Due within the next 1,200 miles.',
    },
  },
  {
    slug: 'transmission-flush',
    name: 'Transmission Flush',
    sourceTitle: 'Transmission Fluid - Flush',
    channels: ['independent', 'dealer'],
    partsTotal: 103,
    partsLow: 91,
    partsHigh: 114,
    laborTotal: 126,
    fairTotalLow: 203,
    fairTotalHigh: 254,
    recommendation: {
      headline: 'Repair is Recommended',
      badge: 'RECOMMENDED',
      body: 'Reported hesitation under load is consistent with degraded fluid at this mileage.',
    },
  },
  {
    slug: 'ac-recharge',
    name: 'AC Recharge',
    sourceTitle: 'Air Conditioning - Recharge',
    channels: ['independent', 'dealer'],
    partsTotal: 120,
    partsLow: 101,
    partsHigh: 140,
    laborTotal: 223,
    fairTotalLow: 289,
    fairTotalHigh: 401,
    recommendation: {
      headline: 'Repair is Recommended',
      badge: 'RECOMMENDED',
      body: 'Weak cooling with no compressor noise usually indicates low refrigerant rather than component failure.',
    },
  },
  {
    slug: 'battery-replacement',
    name: 'Battery Replacement',
    sourceTitle: 'Battery - Replace',
    channels: ['independent', 'dealer'],
    partsTotal: 202,
    partsLow: 186,
    partsHigh: 219,
    laborTotal: 109,
    fairTotalLow: 286,
    fairTotalHigh: 338,
    recommendation: {
      headline: 'Repair is Recommended',
      badge: 'RECOMMENDED',
      body: 'Slow cranking at this battery age indicates end of service life.',
    },
  },
  {
    slug: 'alternator-replacement',
    name: 'Alternator Replacement',
    sourceTitle: 'Alternator Replacement',
    // Dealer-only, so there is no independent floor and a shop may come in below
    // fairTotalLow.
    channels: ['dealer'],
    partsTotal: 593,
    partsLow: 563,
    partsHigh: 623,
    laborTotal: 363,
    fairTotalLow: 904,
    fairTotalHigh: 1008,
    recommendation: {
      headline: 'Repair is Recommended',
      badge: 'CRITICAL REPAIR',
      body: 'A charging-system warning with dimming lights indicates alternator failure. Continued driving risks a no-start.',
    },
  },
  {
    slug: 'tire-rotation',
    name: 'Tire Rotation',
    sourceTitle: 'Tire(s) - Rotate',
    channels: ['independent', 'dealer'],
    // Pure labor: VDB prices the parts at zero, so no parts line item is stored.
    partsTotal: 0,
    partsLow: 0,
    partsHigh: 0,
    laborTotal: 58,
    fairTotalLow: 47,
    fairTotalHigh: 68,
    recommendation: {
      headline: 'Repair is Recommended',
      badge: 'ROUTINE',
      body: 'Overdue on the manufacturer interval. Rotating now evens out remaining tread life.',
    },
  },
  {
    slug: 'coolant-flush',
    name: 'Coolant Flush',
    sourceTitle: 'Coolant - Flush',
    channels: ['independent', 'dealer'],
    partsTotal: 77,
    partsLow: 64,
    partsHigh: 89,
    laborTotal: 180,
    fairTotalLow: 216,
    fairTotalHigh: 300,
    recommendation: {
      headline: 'Repair is Recommended',
      badge: 'ROUTINE',
      body: 'Due on the manufacturer interval. Degraded coolant reduces corrosion protection.',
    },
  },
  {
    slug: 'spark-plug-replacement',
    name: 'Spark Plug Replacement',
    sourceTitle: 'Spark Plugs - Replace',
    channels: ['independent', 'dealer'],
    partsTotal: 129,
    partsLow: 114,
    partsHigh: 144,
    laborTotal: 192,
    fairTotalLow: 285,
    fairTotalHigh: 359,
    recommendation: {
      headline: 'Repair is Recommended',
      badge: 'ROUTINE',
      body: 'Due on the manufacturer interval. Worn plugs cause rough idle and reduced economy.',
    },
  },
  {
    slug: 'wheel-alignment',
    name: 'Wheel Alignment',
    sourceTitle: 'Wheels - Alignment',
    channels: ['independent', 'dealer'],
    // Pure labor, as with the rotation above.
    partsTotal: 0,
    partsLow: 0,
    partsHigh: 0,
    laborTotal: 201,
    fairTotalLow: 176,
    fairTotalHigh: 226,
    recommendation: {
      headline: 'Repair is Recommended',
      badge: 'RECOMMENDED',
      body: 'Uneven front tread wear indicates the alignment is out of specification.',
    },
  },
];

/**
 * Catalog entries with no pricing anywhere. They exist as `repairs` rows so the catalog is
 * not silently narrowed and an existing assessment's `repairId` still resolves, but GET
 * /api/repairs omits them -- offering a repair the app cannot price is a dead end.
 */
export const unpricedRepairs: { slug: string; name: string }[] = [
  // VDB prices "Timing Belt - Replace" (~$950 on this car) and no inspection.
  { slug: 'timing-belt-inspection', name: 'Timing Belt Inspection' },
];
