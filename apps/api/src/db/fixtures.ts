/**
 * Seed data.
 *
 * The brake-pad benchmark and everything on the Alex Rivera account are
 * transcribed from the wireframes and should be treated as fixed. The other
 * eleven benchmarks are PLACEHOLDERS -- plausible shapes so the repair picker
 * scrolls and every selection produces a working assessment. Real parts pricing
 * and OEM labor times still need to be sourced; see the root README.
 */

export interface BenchmarkSeed {
  slug: string;
  name: string;
  parts: { name: string; avgPrice: number }[];
  laborTasks: { name: string; hours: number }[];
  laborRatePerHour: number;
  partsLow: number;
  partsHigh: number;
  fairTotalLow: number;
  fairTotalHigh: number;
  recommendation: { headline: string; badge: string; body: string };
  /** Set when the wireframe dictates a total that does not equal the sum of its parts. */
  partsTotalOverride?: number;
  laborTotalOverride?: number;
}

export const benchmarkSeeds: BenchmarkSeed[] = [
  {
    slug: 'brake-pad-replacement',
    name: 'Brake Pad Replacement',
    parts: [
      { name: 'Front Brake Pads (set)', avgPrice: 45 },
      { name: 'Brake Rotors (x2)', avgPrice: 70 },
      { name: 'Brake Hardware Kit', avgPrice: 12 },
      { name: 'Brake Cleaner', avgPrice: 8 },
      { name: 'Brake Grease', avgPrice: 5 },
    ],
    laborTasks: [
      { name: 'Remove wheels & calipers', hours: 0.4 },
      { name: 'Replace pads & hardware', hours: 0.6 },
      { name: 'Resurface/inspect rotors', hours: 0.3 },
      { name: 'Reassemble & test', hours: 0.2 },
    ],
    laborRatePerHour: 95,
    partsLow: 80,
    partsHigh: 200,
    // NOTE: the wireframes cite $280-$400 in the Quote Evaluation copy but
    // $360-$660 on the Fair Total card. The card wins here because it is the
    // figure the user is shown as the headline estimate.
    fairTotalLow: 360,
    fairTotalHigh: 660,
    laborTotalOverride: 142,
    recommendation: {
      headline: 'Repair is Recommended',
      badge: 'CRITICAL REPAIR',
      body: 'At 68,400 miles with reported grinding, brake pad replacement is recommended. Continued driving risks rotor damage.',
    },
  },
  {
    slug: 'ac-compressor-replacement',
    name: 'AC Compressor Replacement',
    parts: [
      { name: 'AC Compressor', avgPrice: 340 },
      { name: 'Receiver/Drier', avgPrice: 45 },
      { name: 'Expansion Valve', avgPrice: 38 },
      { name: 'O-Ring & Seal Kit', avgPrice: 18 },
      { name: 'Refrigerant (R-1234yf)', avgPrice: 95 },
    ],
    laborTasks: [
      { name: 'Recover refrigerant', hours: 0.5 },
      { name: 'Remove compressor & lines', hours: 1.2 },
      { name: 'Install compressor & drier', hours: 1.1 },
      { name: 'Evacuate, recharge & test', hours: 0.6 },
    ],
    laborRatePerHour: 95,
    partsLow: 420,
    partsHigh: 700,
    fairTotalLow: 860,
    fairTotalHigh: 1240,
    recommendation: {
      headline: 'Repair is Recommended',
      badge: 'CRITICAL REPAIR',
      body: 'AC compressor failure is a known issue on 2018-2020 Civics. With no cold air at idle, replacement is recommended.',
    },
  },
  {
    slug: 'timing-belt-inspection',
    name: 'Timing Belt Inspection',
    parts: [
      { name: 'Timing Belt', avgPrice: 48 },
      { name: 'Belt Tensioner', avgPrice: 62 },
      { name: 'Idler Pulley', avgPrice: 30 },
    ],
    laborTasks: [
      { name: 'Remove accessory belts & covers', hours: 0.5 },
      { name: 'Inspect belt & tensioner', hours: 0.4 },
      { name: 'Reassemble & test', hours: 0.2 },
    ],
    laborRatePerHour: 95,
    partsLow: 95,
    partsHigh: 210,
    fairTotalLow: 200,
    fairTotalHigh: 380,
    recommendation: {
      headline: 'Repair is Recommended',
      badge: 'ROUTINE',
      body: 'At 64,800 miles an inspection is due on the manufacturer schedule. No symptoms reported, so replacement is not yet indicated.',
    },
  },
  {
    slug: 'oil-change-filter',
    name: 'Oil Change & Filter',
    parts: [
      { name: 'Full Synthetic Oil (4.4 qt)', avgPrice: 38 },
      { name: 'Oil Filter', avgPrice: 11 },
      { name: 'Drain Plug Washer', avgPrice: 2 },
    ],
    laborTasks: [
      { name: 'Drain & replace oil', hours: 0.3 },
      { name: 'Replace filter', hours: 0.2 },
      { name: 'Reset service reminder', hours: 0.1 },
    ],
    laborRatePerHour: 95,
    partsLow: 35,
    partsHigh: 75,
    fairTotalLow: 70,
    fairTotalHigh: 140,
    recommendation: {
      headline: 'Repair is Recommended',
      badge: 'ROUTINE',
      body: 'Routine maintenance on the manufacturer interval. Due within the next 1,200 miles.',
    },
  },
  {
    slug: 'transmission-flush',
    name: 'Transmission Flush',
    parts: [
      { name: 'CVT Fluid (5 qt)', avgPrice: 78 },
      { name: 'Transmission Filter', avgPrice: 34 },
      { name: 'Pan Gasket', avgPrice: 16 },
    ],
    laborTasks: [
      { name: 'Drain & drop pan', hours: 0.7 },
      { name: 'Replace filter & gasket', hours: 0.5 },
      { name: 'Refill & road test', hours: 0.4 },
    ],
    laborRatePerHour: 95,
    partsLow: 95,
    partsHigh: 190,
    fairTotalLow: 260,
    fairTotalHigh: 430,
    recommendation: {
      headline: 'Repair is Recommended',
      badge: 'RECOMMENDED',
      body: 'Reported hesitation under load is consistent with degraded fluid at this mileage.',
    },
  },
  {
    slug: 'ac-recharge',
    name: 'AC Recharge',
    parts: [
      { name: 'Refrigerant (R-1234yf)', avgPrice: 95 },
      { name: 'UV Leak Dye', avgPrice: 9 },
    ],
    laborTasks: [
      { name: 'Evacuate system', hours: 0.4 },
      { name: 'Leak test', hours: 0.3 },
      { name: 'Recharge & verify', hours: 0.3 },
    ],
    laborRatePerHour: 95,
    partsLow: 85,
    partsHigh: 170,
    fairTotalLow: 190,
    fairTotalHigh: 330,
    recommendation: {
      headline: 'Repair is Recommended',
      badge: 'RECOMMENDED',
      body: 'Weak cooling with no compressor noise usually indicates low refrigerant rather than component failure.',
    },
  },
  {
    slug: 'battery-replacement',
    name: 'Battery Replacement',
    parts: [
      { name: 'Group 51R AGM Battery', avgPrice: 165 },
      { name: 'Terminal Cleaner & Grease', avgPrice: 7 },
    ],
    laborTasks: [
      { name: 'Remove & replace battery', hours: 0.3 },
      { name: 'Test charging system', hours: 0.2 },
    ],
    laborRatePerHour: 95,
    partsLow: 130,
    partsHigh: 240,
    fairTotalLow: 175,
    fairTotalHigh: 300,
    recommendation: {
      headline: 'Repair is Recommended',
      badge: 'RECOMMENDED',
      body: 'Slow cranking at this battery age indicates end of service life.',
    },
  },
  {
    slug: 'alternator-replacement',
    name: 'Alternator Replacement',
    parts: [
      { name: 'Alternator', avgPrice: 285 },
      { name: 'Serpentine Belt', avgPrice: 32 },
      { name: 'Belt Tensioner', avgPrice: 58 },
    ],
    laborTasks: [
      { name: 'Remove accessory belt', hours: 0.4 },
      { name: 'Replace alternator', hours: 1.3 },
      { name: 'Test output & reassemble', hours: 0.4 },
    ],
    laborRatePerHour: 95,
    partsLow: 300,
    partsHigh: 520,
    fairTotalLow: 560,
    fairTotalHigh: 900,
    recommendation: {
      headline: 'Repair is Recommended',
      badge: 'CRITICAL REPAIR',
      body: 'A charging-system warning with dimming lights indicates alternator failure. Continued driving risks a no-start.',
    },
  },
  {
    slug: 'tire-rotation',
    name: 'Tire Rotation',
    parts: [{ name: 'Wheel Torque Service', avgPrice: 0 }],
    laborTasks: [
      { name: 'Lift & rotate tires', hours: 0.4 },
      { name: 'Torque & set pressures', hours: 0.2 },
    ],
    laborRatePerHour: 95,
    partsLow: 0,
    partsHigh: 20,
    fairTotalLow: 40,
    fairTotalHigh: 90,
    recommendation: {
      headline: 'Repair is Recommended',
      badge: 'ROUTINE',
      body: 'Overdue on the manufacturer interval. Rotating now evens out remaining tread life.',
    },
  },
  {
    slug: 'coolant-flush',
    name: 'Coolant Flush',
    parts: [
      { name: 'Honda Type 2 Coolant (2 gal)', avgPrice: 44 },
      { name: 'Radiator Cap', avgPrice: 14 },
    ],
    laborTasks: [
      { name: 'Drain & flush system', hours: 0.6 },
      { name: 'Refill & bleed air', hours: 0.5 },
    ],
    laborRatePerHour: 95,
    partsLow: 40,
    partsHigh: 95,
    fairTotalLow: 150,
    fairTotalHigh: 260,
    recommendation: {
      headline: 'Repair is Recommended',
      badge: 'ROUTINE',
      body: 'Due on the manufacturer interval. Degraded coolant reduces corrosion protection.',
    },
  },
  {
    slug: 'spark-plug-replacement',
    name: 'Spark Plug Replacement',
    parts: [
      { name: 'Iridium Spark Plugs (x4)', avgPrice: 56 },
      { name: 'Coil Boot Grease', avgPrice: 6 },
    ],
    laborTasks: [
      { name: 'Remove coils & plugs', hours: 0.5 },
      { name: 'Install & torque plugs', hours: 0.4 },
      { name: 'Reassemble & test', hours: 0.2 },
    ],
    laborRatePerHour: 95,
    partsLow: 50,
    partsHigh: 110,
    fairTotalLow: 160,
    fairTotalHigh: 290,
    recommendation: {
      headline: 'Repair is Recommended',
      badge: 'ROUTINE',
      body: 'Due on the manufacturer interval. Worn plugs cause rough idle and reduced economy.',
    },
  },
  {
    slug: 'wheel-alignment',
    name: 'Wheel Alignment',
    parts: [{ name: 'Alignment Hardware (as needed)', avgPrice: 12 }],
    laborTasks: [
      { name: 'Mount & measure', hours: 0.5 },
      { name: 'Adjust camber/toe', hours: 0.6 },
      { name: 'Verify & road test', hours: 0.3 },
    ],
    laborRatePerHour: 95,
    partsLow: 0,
    partsHigh: 40,
    fairTotalLow: 110,
    fairTotalHigh: 220,
    recommendation: {
      headline: 'Repair is Recommended',
      badge: 'RECOMMENDED',
      body: 'Uneven front tread wear indicates the alignment is out of specification.',
    },
  },
];
