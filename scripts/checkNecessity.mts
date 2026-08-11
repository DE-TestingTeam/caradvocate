/**
 * Runs the necessity bands over hand-built cases and checks each lands where it should.
 *
 *   npx tsx scripts/checkNecessity.mts
 *
 * ASSERTS, unlike scripts/probeAskGuardrails.mts, and the difference is the point: those are
 * prompt rules that only a reader can judge, these are arithmetic. A band is a pure function of
 * the facts handed in (services/necessity.ts), so every case here has one right answer and a
 * change that moves one shows up as a red line rather than as a judgement call.
 *
 * It prints the signals too, because the band is only half of what ships -- the prose step is
 * given these sentences and nothing else, so a case that lands in the right band while saying
 * something an owner would not understand is still broken, and only reading them catches it.
 *
 * NO DATABASE AND NO NETWORK. The cases are invented, including the mileage percentiles, though
 * the shapes are real: the 2019 Civic service-brake group really does hold 25 reports at a median
 * of 11,800 miles across 15 odometer readings.
 */
import { assessNecessity, type NecessityFinding, type NecessityInput } from '../apps/api/src/services/necessity.js';
import { composeBody, necessityVerdict } from '../apps/api/src/services/necessityProse.js';

/** Fixed, so a case that leans on the date reads the same next year. */
const TODAY = new Date('2026-08-10T00:00:00Z');

interface Case {
  name: string;
  /** What the band is testing, in the terms an owner would put it. */
  because: string;
  input: Omit<NecessityInput, 'today'>;
  expect: NecessityFinding['band'];
  expectShortfall?: NecessityFinding['shortfall'];
}

/** The 2019 Civic service-brake group, shaped as model_owner_reports holds it. */
const CIVIC_BRAKES = {
  component: 'SERVICE BRAKES',
  reportCount: 25,
  mileageSampleCount: 15,
  mileageLowMi: 8_000,
  mileageMedianMi: 11_800,
  mileageHighMi: 16_400,
};

const CASES: Case[] = [
  {
    name: 'never asked why',
    because: 'an assessment predating migration 0022 cannot be given an answer it was never given',
    input: {
      repairSlug: 'brake-pad-replacement',
      repairName: 'Brake Pad Replacement',
      mileageAtAssessment: 12_400,
      failureRecord: CIVIC_BRAKES,
      scheduleIsFactory: false,
    },
    expect: 'not_enough',
    expectShortfall: 'never_asked',
  },
  {
    name: 'symptom at the mileage others report it',
    because: 'grinding at 12,400 on a model whose brake reports cluster at 11,800 is corroborated',
    input: {
      repairSlug: 'brake-pad-replacement',
      repairName: 'Brake Pad Replacement',
      mileageAtAssessment: 12_400,
      context: { promptedBy: 'symptom', notes: 'grinding when I brake', duration: 'weeks' },
      failureRecord: CIVIC_BRAKES,
      scheduleIsFactory: false,
    },
    expect: 'holds_up',
  },
  {
    name: 'shop raised it, but the mileage still matches',
    because: 'the failure record is independent of both the owner and the shop, so it stands alone',
    input: {
      repairSlug: 'brake-pad-replacement',
      repairName: 'Brake Pad Replacement',
      mileageAtAssessment: 12_400,
      context: { promptedBy: 'shop_suggested' },
      failureRecord: CIVIC_BRAKES,
      scheduleIsFactory: false,
    },
    expect: 'holds_up',
  },
  {
    name: 'same job 2,000 miles ago',
    because: 'a comeback outranks a match -- pads fitted this recently are a conversation, not a sale',
    input: {
      repairSlug: 'brake-pad-replacement',
      repairName: 'Brake Pad Replacement',
      mileageAtAssessment: 12_400,
      context: { promptedBy: 'symptom', notes: 'grinding again', duration: 'days' },
      failureRecord: CIVIC_BRAKES,
      scheduleIsFactory: false,
      lastSameRepair: { date: '2026-05-02', mileage: 10_400 },
    },
    expect: 'worth_questioning',
  },
  {
    name: 'same job 40,000 miles ago',
    because: 'a repeat outside the window is history, not a red flag, and must not cancel a real match',
    input: {
      repairSlug: 'brake-pad-replacement',
      repairName: 'Brake Pad Replacement',
      mileageAtAssessment: 52_400,
      context: { promptedBy: 'symptom', notes: 'grinding', duration: 'weeks' },
      // The 2011 Pathfinder group, whose range is wide enough for 52,400 to sit inside it.
      // CIVIC_BRAKES tops out at 16,400, which is a different assertion -- see the case below.
      failureRecord: { component: 'SERVICE BRAKES', reportCount: 6, mileageSampleCount: 4, mileageLowMi: 4_000, mileageMedianMi: 26_000, mileageHighMi: 86_000 },
      scheduleIsFactory: false,
      lastSameRepair: { date: '2022-03-14', mileage: 12_400 },
    },
    expect: 'holds_up',
  },
  {
    name: 'coolant proposed 22,000 miles early',
    because: 'the upsell this feature exists to catch: not due, no symptom, factory interval says so',
    input: {
      repairSlug: 'coolant-flush',
      repairName: 'Coolant Flush',
      mileageAtAssessment: 38_000,
      context: { promptedBy: 'routine_service' },
      scheduledJob: {
        label: 'Coolant flush',
        status: 'ok',
        intervalMiles: 30_000,
        milesRemaining: 22_000,
        dueAtMileage: 60_000,
      },
      scheduleIsFactory: true,
    },
    expect: 'worth_questioning',
  },
  {
    name: 'coolant not due, but the owner reported overheating',
    because: 'things break between services; an interval must not talk someone out of a real fault',
    input: {
      repairSlug: 'coolant-flush',
      repairName: 'Coolant Flush',
      mileageAtAssessment: 38_000,
      context: { promptedBy: 'symptom', notes: 'temperature gauge climbing in traffic', duration: 'days' },
      scheduledJob: {
        label: 'Coolant flush',
        status: 'ok',
        intervalMiles: 30_000,
        milesRemaining: 22_000,
        dueAtMileage: 60_000,
      },
      scheduleIsFactory: true,
    },
    expect: 'not_enough',
    expectShortfall: 'nothing_spoke_either_way',
  },
  {
    name: 'oil change due on the factory schedule',
    because: 'the one case a routine visit reaches holds_up on its own',
    input: {
      repairSlug: 'oil-change-filter',
      repairName: 'Oil Change & Filter',
      mileageAtAssessment: 44_800,
      context: { promptedBy: 'routine_service' },
      scheduledJob: {
        label: 'Oil & filter',
        status: 'due_soon',
        intervalMiles: 5_000,
        milesRemaining: 200,
        dueAtMileage: 45_000,
      },
      scheduleIsFactory: true,
    },
    expect: 'holds_up',
  },
  {
    name: 'overdue spark plugs on a seeded schedule',
    because: 'generic intervals must not speak as the manufacturer, however overdue they look',
    input: {
      repairSlug: 'spark-plug-replacement',
      repairName: 'Spark Plug Replacement',
      mileageAtAssessment: 90_000,
      context: { promptedBy: 'shop_suggested' },
      scheduledJob: {
        label: 'Spark plugs',
        status: 'overdue',
        intervalMiles: 30_000,
        milesRemaining: -20_000,
      },
      scheduleIsFactory: false,
    },
    expect: 'not_enough',
    expectShortfall: 'nothing_to_check_against',
  },
  {
    name: 'AC compressor with a real symptom',
    because: 'NHTSA files no AC component, so there is nothing to check it against and we say so',
    input: {
      repairSlug: 'ac-compressor-replacement',
      repairName: 'AC Compressor Replacement',
      mileageAtAssessment: 68_400,
      context: { promptedBy: 'symptom', notes: 'no cold air at idle', duration: 'weeks' },
      scheduleIsFactory: false,
    },
    expect: 'not_enough',
    expectShortfall: 'nothing_to_check_against',
  },
  {
    name: 'brakes with too few odometer readings',
    because: 'a bare complaint count corroborates nothing -- every model has brake reports',
    input: {
      repairSlug: 'brake-pad-replacement',
      repairName: 'Brake Pad Replacement',
      mileageAtAssessment: 12_400,
      context: { promptedBy: 'symptom', notes: 'squealing', duration: 'weeks' },
      failureRecord: { ...CIVIC_BRAKES, mileageSampleCount: 2, mileageLowMi: null, mileageMedianMi: null, mileageHighMi: null },
      scheduleIsFactory: false,
    },
    expect: 'not_enough',
    expectShortfall: 'nothing_spoke_either_way',
  },
  {
    name: 'brakes far below the reported mileage',
    because: 'earlier than the pattern is not a contradiction, but it is not corroboration either',
    input: {
      repairSlug: 'brake-pad-replacement',
      repairName: 'Brake Pad Replacement',
      mileageAtAssessment: 3_100,
      context: { promptedBy: 'shop_suggested' },
      failureRecord: CIVIC_BRAKES,
      scheduleIsFactory: false,
    },
    expect: 'not_enough',
    expectShortfall: 'nothing_spoke_either_way',
  },
  {
    name: 'wheel alignment, deliberately unmapped',
    because: 'STEERING complaints are power-steering failures, not alignment; borrowing them would be false',
    input: {
      repairSlug: 'wheel-alignment',
      repairName: 'Wheel Alignment',
      mileageAtAssessment: 41_000,
      context: { promptedBy: 'symptom', notes: 'pulls left on the motorway', duration: 'months' },
      scheduleIsFactory: false,
    },
    expect: 'not_enough',
    expectShortfall: 'nothing_to_check_against',
  },
  {
    name: 'brakes far ABOVE the reported mileage',
    because: 'a 2019 Civic at 68,400 against reports clustering at 5-14k: the reports are early-life defects, not this car',
    input: {
      repairSlug: 'brake-pad-replacement',
      repairName: 'Brake Pad Replacement',
      mileageAtAssessment: 68_400,
      context: { promptedBy: 'symptom', notes: 'grinding when I brake', duration: 'weeks' },
      failureRecord: { ...CIVIC_BRAKES, mileageLowMi: 5_199, mileageMedianMi: 11_800, mileageHighMi: 14_500 },
      scheduleIsFactory: false,
    },
    expect: 'not_enough',
    expectShortfall: 'nothing_spoke_either_way',
  },
  {
    name: 'an ordinary oil change 4,500 miles on, no factory interval',
    because: 'the false accusation: with no interval there is no baseline, and a normal oil change must not read as a shop selling twice',
    input: {
      repairSlug: 'oil-change-filter',
      repairName: 'Oil Change & Filter',
      mileageAtAssessment: 68_400,
      context: { promptedBy: 'routine_service' },
      scheduleIsFactory: false,
      lastSameRepair: { date: '2026-02-14', mileage: 63_900 },
    },
    expect: 'not_enough',
    expectShortfall: 'nothing_to_check_against',
  },
  {
    name: 'an oil change at a quarter of the factory interval',
    because: 'with a real interval the same repeat IS worth raising -- 1,000 miles into a 7,500-mile cycle',
    input: {
      repairSlug: 'oil-change-filter',
      repairName: 'Oil Change & Filter',
      mileageAtAssessment: 64_900,
      context: { promptedBy: 'shop_suggested' },
      scheduledJob: { label: 'Oil & filter', status: 'ok', intervalMiles: 7_500, milesRemaining: 6_500, dueAtMileage: 71_400 },
      scheduleIsFactory: true,
      lastSameRepair: { date: '2026-02-14', mileage: 63_900 },
    },
    expect: 'worth_questioning',
  },
  {
    name: 'a failure job repeated with no interval anywhere',
    because: 'a second alternator inside 12,000 miles is a comeback whatever the schedule says',
    input: {
      repairSlug: 'alternator-replacement',
      repairName: 'Alternator Replacement',
      mileageAtAssessment: 74_000,
      context: { promptedBy: 'symptom', notes: 'battery light again', duration: 'days' },
      scheduleIsFactory: false,
      lastSameRepair: { date: '2026-03-01', mileage: 70_000 },
    },
    expect: 'worth_questioning',
  },
  {
    name: 'the same repair at the same odometer reading',
    because: '"0 miles ago" is not a sentence; a real Pathfinder produced exactly this',
    input: {
      repairSlug: 'brake-pad-replacement',
      repairName: 'Brake Pad Replacement',
      mileageAtAssessment: 70_000,
      context: { promptedBy: 'shop_suggested' },
      failureRecord: { component: 'SERVICE BRAKES', reportCount: 6, mileageSampleCount: 4, mileageLowMi: 4_000, mileageMedianMi: 26_000, mileageHighMi: 86_000 },
      scheduleIsFactory: false,
      lastSameRepair: { date: '2026-08-06', mileage: 70_000 },
    },
    expect: 'worth_questioning',
  },
  {
    name: 'the supplier never answered',
    because: 'a spent call allowance must not be served as a considered "not enough to say"',
    input: {
      repairSlug: 'coolant-flush',
      repairName: 'Coolant Flush',
      mileageAtAssessment: 100_000,
      context: { promptedBy: 'shop_suggested' },
      scheduleIsFactory: false,
      sourceUnavailable: true,
    },
    expect: 'not_enough',
    expectShortfall: 'source_unavailable',
  },
  {
    name: 'a repair no longer in the catalogue',
    because: 'a retired repairId must degrade, not throw',
    input: {
      repairSlug: null,
      repairName: 'Serpentine Belt Replacement',
      mileageAtAssessment: 71_000,
      context: { promptedBy: 'shop_suggested' },
      scheduleIsFactory: false,
    },
    expect: 'not_enough',
    expectShortfall: 'nothing_to_check_against',
  },
];

const STANCE_MARK = { supports: '+', questions: '?', neutral: ' ' } as const;

let failed = 0;

for (const testCase of CASES) {
  const finding = assessNecessity({ ...testCase.input, today: TODAY });

  const bandOk = finding.band === testCase.expect;
  const shortfallOk =
    testCase.expectShortfall === undefined || finding.shortfall === testCase.expectShortfall;
  const ok = bandOk && shortfallOk;
  if (!ok) failed += 1;

  const shortfall = finding.shortfall ? ` (${finding.shortfall})` : '';
  console.log(`\n${ok ? 'PASS' : 'FAIL'}  ${testCase.name}`);
  console.log(`      ${testCase.because}`);
  console.log(`      band: ${finding.band}${shortfall}`);
  if (!ok) {
    const wantShortfall = testCase.expectShortfall ? ` (${testCase.expectShortfall})` : '';
    console.log(`      EXPECTED: ${testCase.expect}${wantShortfall}`);
  }
  console.log(
    `      checked: failure record ${yesNo(finding.checked.failureRecord)}, factory schedule ${yesNo(finding.checked.factorySchedule)}`,
  );
  for (const signal of finding.signals) {
    console.log(`      ${STANCE_MARK[signal.stance]} ${signal.detail}`);
  }

  // What the owner actually reads when Claude is unconfigured or slow. Printed because it is a
  // shipping answer and not a placeholder -- if it reads badly here, it reads badly in the app.
  const verdict = necessityVerdict(finding.band, finding.shortfall);
  console.log(`      card: ${verdict.headline} [${verdict.badge}]`);
  console.log(`      body: ${composeBody(finding)}`);
}

console.log(`\n${CASES.length - failed}/${CASES.length} cases passed.`);
if (failed > 0) process.exitCode = 1;

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}
