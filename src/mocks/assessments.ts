import type { Assessment } from '@/types';

/**
 * NOTE: the wireframes are internally inconsistent on the brake-pad numbers --
 * the Quote Evaluation copy cites an expected range of $280-$400 while the Fair
 * Total Estimate card reads $360-$660. Both are transcribed verbatim rather than
 * reconciled, because we do not know which one the real pricing model produces.
 *
 * NOTE: viewport-mobile-2.png shows Brake Pad Replacement in its no-quote state
 * and viewport-mobile-3.png shows it with a $320 quote. A single record cannot be
 * both, so the seeded brake-pad assessment carries the quote and Timing Belt
 * Inspection exercises the no-quote layout.
 */

const brakePadBenchmark = {
  parts: {
    items: [
      { name: 'Front Brake Pads (set)', avgPrice: 45 },
      { name: 'Brake Rotors (x2)', avgPrice: 70 },
      { name: 'Brake Hardware Kit', avgPrice: 12 },
      { name: 'Brake Cleaner', avgPrice: 8 },
      { name: 'Brake Grease', avgPrice: 5 },
    ],
    total: 140,
    low: 80,
    high: 200,
  },
  labor: {
    ratePerHour: 95,
    estHours: 1.5,
    tasks: [
      { name: 'Remove wheels & calipers', hours: 0.4 },
      { name: 'Replace pads & hardware', hours: 0.6 },
      { name: 'Resurface/inspect rotors', hours: 0.3 },
      { name: 'Reassemble & test', hours: 0.2 },
    ],
    total: 142,
  },
  fairTotalLow: 360,
  fairTotalHigh: 660,
};

export const assessments: Assessment[] = [
  {
    id: 'asm_brake_pad',
    repairName: 'Brake Pad Replacement',
    vehicleId: 'veh_1',
    mileageAtAssessment: 68400,
    createdAt: '2025-01-15',
    recommendation: {
      headline: 'Repair is Recommended',
      badge: 'CRITICAL REPAIR',
      body: 'At 68,400 miles with reported grinding, brake pad replacement is recommended. Continued driving risks rotor damage.',
    },
    ...brakePadBenchmark,
    quote: {
      amount: 320,
      parts: 150,
      labor: 170,
      verdict: 'fair',
      explanation:
        'Your quoted price of $320 is within the expected range of $280-$400 for this repair. Parts and labor are both within normal bounds.',
    },
  },
  {
    id: 'asm_ac_compressor',
    repairName: 'AC Compressor Replacement',
    vehicleId: 'veh_1',
    mileageAtAssessment: 66100,
    createdAt: '2024-11-03',
    recommendation: {
      headline: 'Repair is Recommended',
      badge: 'CRITICAL REPAIR',
      body: 'AC compressor failure is a known issue on 2018-2020 Civics. With no cold air at idle, replacement is recommended.',
    },
    parts: {
      items: [
        { name: 'AC Compressor', avgPrice: 340 },
        { name: 'Receiver/Drier', avgPrice: 45 },
        { name: 'Expansion Valve', avgPrice: 38 },
        { name: 'O-Ring & Seal Kit', avgPrice: 18 },
        { name: 'Refrigerant (R-1234yf)', avgPrice: 95 },
      ],
      total: 536,
      low: 420,
      high: 700,
    },
    labor: {
      ratePerHour: 95,
      estHours: 3.4,
      tasks: [
        { name: 'Recover refrigerant', hours: 0.5 },
        { name: 'Remove compressor & lines', hours: 1.2 },
        { name: 'Install compressor & drier', hours: 1.1 },
        { name: 'Evacuate, recharge & test', hours: 0.6 },
      ],
      total: 323,
    },
    fairTotalLow: 860,
    fairTotalHigh: 1240,
    quote: {
      amount: 1680,
      parts: 890,
      labor: 790,
      verdict: 'overpriced',
      explanation:
        'Your quoted price of $1,680 is above the expected range of $860-$1,240 for this repair. Both parts and labor are priced above benchmark.',
    },
  },
  {
    id: 'asm_timing_belt',
    repairName: 'Timing Belt Inspection',
    vehicleId: 'veh_1',
    mileageAtAssessment: 64800,
    createdAt: '2024-09-20',
    recommendation: {
      headline: 'Repair is Recommended',
      badge: 'ROUTINE',
      body: 'At 64,800 miles an inspection is due on the manufacturer schedule. No symptoms reported, so replacement is not yet indicated.',
    },
    parts: {
      items: [
        { name: 'Timing Belt', avgPrice: 48 },
        { name: 'Belt Tensioner', avgPrice: 62 },
        { name: 'Idler Pulley', avgPrice: 30 },
      ],
      total: 140,
      low: 95,
      high: 210,
    },
    labor: {
      ratePerHour: 95,
      estHours: 1.1,
      tasks: [
        { name: 'Remove accessory belts & covers', hours: 0.5 },
        { name: 'Inspect belt & tensioner', hours: 0.4 },
        { name: 'Reassemble & test', hours: 0.2 },
      ],
      total: 105,
    },
    fairTotalLow: 200,
    fairTotalHigh: 380,
    completedAt: '2024-10-04',
    completedCost: 165,
  },
];
