/**
 * Seeds reference data and two demo accounts. Truncates everything first, so
 * `npm run db:seed` is repeatable. The second account (dana@example.com) is a second
 * tenant, and the one that starts behind the paywall.
 *
 * Repeatable is not the same as safe: this ran once against a database holding a real
 * signed-up account and deleted it along with the owner's car and recall answers. Hence
 * assertNoRealAccounts below.
 */
import { isNotNull, sql } from 'drizzle-orm';
import { closeDb, describeTarget, getDb, type Database } from './index.js';
import * as t from './schema.js';
import { writeReferencePricing } from './referencePricing.js';
import { SNAPSHOT_MODEL } from '../services/repairPricingSync.js';
import { evaluateQuote } from '../services/quoteEvaluation.js';
import { loadNecessityFinding, type NecessityTarget } from '../services/necessity.js';
import { composeBody, necessityVerdict } from '../services/necessityProse.js';

export async function seed(db: Database): Promise<void> {
  await assertNoRealAccounts(db);
  await truncateAll(db);
  const repairIdBySlug = await seedReference(db);
  await seedAlexRivera(db, repairIdBySlug);
  await seedSecondUser(db, repairIdBySlug);
}

/**
 * Refuses to run when the database holds accounts somebody actually signed up for -- ones
 * linked to a Supabase identity. Seeded demo users have `supabaseUserId` null, so they are
 * not protected. SEED_WIPE_REAL_ACCOUNTS=1 is the deliberate override, so the answer to
 * this guard is never "comment it out".
 */
async function assertNoRealAccounts(db: Database): Promise<void> {
  if (process.env.SEED_WIPE_REAL_ACCOUNTS === '1') {
    console.warn('SEED_WIPE_REAL_ACCOUNTS=1 -- deleting real accounts as instructed.');
    return;
  }

  const real = await db
    .select({ email: t.users.email })
    .from(t.users)
    .where(isNotNull(t.users.supabaseUserId));

  if (real.length === 0) return;

  const who = real.map((row) => `  - ${row.email}`).join('\n');
  throw new Error(
    `Refusing to seed ${describeTarget()}: it holds ${real.length} real signed-up account(s).\n\n` +
      `${who}\n\n` +
      'Seeding truncates users, which would delete these accounts and every car, recall\n' +
      'answer and service record belonging to them. Point DATABASE_URL at a scratch\n' +
      'database, or set SEED_WIPE_REAL_ACCOUNTS=1 if deleting them is genuinely intended.',
  );
}

async function truncateAll(db: Database): Promise<void> {
  // Order does not matter with CASCADE, and RESTART IDENTITY keeps reruns clean.
  await db.execute(sql`
    truncate table
      ${t.assessmentLaborTasks}, ${t.assessmentParts}, ${t.assessments},
      ${t.serviceRecords}, ${t.maintenanceItems}, ${t.vehicleValuePoints}, ${t.vehicles},
      ${t.askTranscriptSources}, ${t.askTranscripts},
      ${t.users},
      ${t.benchmarkLaborTasks}, ${t.benchmarkParts}, ${t.repairBenchmarks}, ${t.repairs},
      ${t.modelKnownIssues}
    restart identity cascade
  `);
}

/**
 * Global data: repair catalog, the snapshot model's pricing, and known issues.
 *
 * The benchmarks are real Vehicle Databases figures for a 2019 Civic, captured offline
 * (db/fixtures.ts). They apply to that model and no other; nothing falls back to them.
 * Alex's demo car is a 2019 Civic, so they are his own car's pricing. Every other model is
 * priced on demand by services/repairPricingSync.ts and shows nothing until it has been.
 */
async function seedReference(db: Database): Promise<Map<string, string>> {
  // Shared with `db:pricing`, which refreshes these same rows on a database holding real
  // accounts. One code path so the two cannot drift.
  const { repairIdBySlug } = await writeReferencePricing(db, SNAPSHOT_MODEL);

  await db.insert(t.modelKnownIssues).values([
    { year: 2019, make: 'Honda', model: 'Civic', label: 'Transmission hesitation under load', severity: 'medium', position: 0 },
    { year: 2019, make: 'Honda', model: 'Civic', label: 'AC compressor failure (2018-2020)', severity: 'high', position: 1 },
    { year: 2019, make: 'Honda', model: 'Civic', label: 'Infotainment screen flickering', severity: 'low', position: 2 },
  ]);

  return repairIdBySlug;
}

/** The account the wireframes depict. */
async function seedAlexRivera(db: Database, repairIdBySlug: Map<string, string>): Promise<void> {
  const [user] = await db
    .insert(t.users)
    .values({
      email: 'alex.rivera@email.com',
      name: 'Alex Rivera',
      phone: '(555) 018-2245',
      memberSince: '2024-01-01',
      // Past the paywall, because the wireframes depict the Repair Cost Checker in use. Sign in
      // as Dana below to see the paywall itself.
      plan: 'paid',
      pricingModel: 'all_you_can_eat',
    })
    .returning({ id: t.users.id });

  // The wireframes disagree: My Car shows a 2019 Honda Civic at 68,400 mi, Account shows a 2019
  // Honda CR-V EX at 48,250 mi. One row serves both screens.
  const [vehicle] = await db
    .insert(t.vehicles)
    .values({
      userId: user.id,
      year: 2019,
      make: 'Honda',
      model: 'Civic',
      vin: '2HGFC2F53KH124821',
      mileage: 68400,
      // Stamped, or the demo car greets every viewer with a "confirm your mileage" prompt --
      // null reads as stale by design. See mileageIsStale in @caradvocate/shared.
      mileageUpdatedAt: new Date(),
      estMarketValue: 14200,
      tradeInLow: 12100,
      tradeInHigh: 14600,
    })
    .returning({ id: t.vehicles.id });

  await db.insert(t.vehicleValuePoints).values(
    [
      ['Feb', 13250],
      ['Mar', 13400],
      ['Apr', 13620],
      ['May', 13810],
      ['Jun', 14020],
      ['Jul', 14200],
    ].map(([monthLabel, value], position) => ({
      vehicleId: vehicle.id,
      monthLabel: monthLabel as string,
      value: value as number,
      position,
    })),
  );

  /*
   * Intervals, not statuses -- the status is computed on read. These rows deliberately
   * produce one of every outcome against the 68,400-mile odometer:
   *
   *   oil          due_soon  -- 500 miles short of its 5,000-mile interval
   *   tyres        overdue   -- 6,000-mile interval, last done 10,400 miles ago
   *   cabin filter ok        -- 15,000-mile interval, plenty left
   *   brake fluid  unknown   -- no interval set
   *   coolant      unknown   -- has an interval but has never been done
   */
  const [oil, tyres, brakeFluid, cabinFilter] = await db
    .insert(t.maintenanceItems)
    .values([
      { vehicleId: vehicle.id, label: 'Oil & filter', intervalMiles: 5000, intervalMonths: 12, position: 0 },
      { vehicleId: vehicle.id, label: 'Tyre rotation', intervalMiles: 6000, position: 1 },
      { vehicleId: vehicle.id, label: 'Brake fluid flush', position: 2 },
      { vehicleId: vehicle.id, label: 'Cabin air filter', intervalMiles: 15000, position: 3 },
      { vehicleId: vehicle.id, label: 'Coolant flush', intervalMiles: 30000, position: 4 },
    ])
    .returning();

  await db.insert(t.serviceRecords).values([
    { userId: user.id, vehicleId: vehicle.id, description: 'Battery replacement', serviceDate: '2026-06-14', cost: 175, source: 'repair_cost_checker', mileageAtService: 68000 },
    { userId: user.id, vehicleId: vehicle.id, description: 'Brake pads & rotors - front', serviceDate: '2026-03-08', cost: 310, source: 'manual', mileageAtService: 66200 },
    // Linked, so they drive the due calculation above.
    { userId: user.id, vehicleId: vehicle.id, description: 'Oil Change & Filter', serviceDate: '2026-02-14', cost: 62, source: 'manual', mileageAtService: 63900, maintenanceItemId: oil.id },
    { userId: user.id, vehicleId: vehicle.id, description: 'Cabin air filter', serviceDate: '2025-08-30', cost: 35, source: 'manual', mileageAtService: 60000, maintenanceItemId: cabinFilter.id },
    { userId: user.id, vehicleId: vehicle.id, description: 'Brake Pads (Front)', serviceDate: '2024-11-02', cost: 285, source: 'manual', mileageAtService: 59500 },
    { userId: user.id, vehicleId: vehicle.id, description: 'Tire Rotation', serviceDate: '2024-06-19', cost: 40, source: 'manual', mileageAtService: 58000, maintenanceItemId: tyres.id },
  ]);

  // Referenced so the unused-binding check does not flag a deliberately unlinked job.
  void brakeFluid;

  await seedAssessments(
    db,
    user.id,
    // The necessity check needs the car, not just its id: the model keys the failure record and
    // `maintenanceScheduleCheckedAt` decides whether the intervals above may speak as the
    // manufacturer's. They are the seed's own generic figures, so it stays null and they do not.
    { id: vehicle.id, year: 2019, make: 'Honda', model: 'Civic', mileage: 68400, maintenanceScheduleCheckedAt: null },
    repairIdBySlug,
  );
}

async function seedAssessments(
  db: Database,
  userId: string,
  vehicle: NecessityTarget['vehicle'],
  repairIdBySlug: Map<string, string>,
): Promise<void> {
  /*
   * Quote figures are the amount only; the verdict, the parts/labor split and the
   * explanation come from the real evaluateQuote below, so the demo account cannot drift
   * from the benchmark.
   *
   * $1,680 for the compressor is deliberately kept: it was overpriced against the old
   * invented range and is *fair* against the real one ($1,485-$1,842).
   */
  /*
   * `context` is why each repair came up, and it is the input the necessity check turns on. The
   * wordings are the ones the old hand-typed fixture bodies described -- "with reported
   * grinding", "with no cold air at idle" -- moved from the answer, where they were invented, to
   * the question, where they are something an owner actually told us.
   */
  const specs: {
    slug: string;
    createdAt: Date;
    mileage: number;
    quoteAmount: number | undefined;
    completed: { at: string; cost: number } | undefined;
    context: NecessityTarget['context'];
  }[] = [
    {
      slug: 'brake-pad-replacement',
      createdAt: new Date('2025-01-15T12:00:00Z'),
      mileage: 68400,
      quoteAmount: 320,
      completed: undefined,
      context: { promptedBy: 'symptom', notes: 'Grinding noise when braking', duration: 'weeks' },
    },
    {
      slug: 'ac-compressor-replacement',
      createdAt: new Date('2024-11-03T12:00:00Z'),
      mileage: 66100,
      quoteAmount: 1680,
      completed: undefined,
      context: { promptedBy: 'symptom', notes: 'No cold air at idle', duration: 'days' },
    },
    {
      // Was timing-belt-inspection, which carries no pricing. Repointed so the demo
      // account still has one completed assessment.
      slug: 'coolant-flush',
      createdAt: new Date('2024-09-20T12:00:00Z'),
      mileage: 64800,
      quoteAmount: undefined,
      completed: { at: '2024-10-04', cost: 165 },
      context: { promptedBy: 'routine_service' },
    },
  ];

  for (const spec of specs) {
    const repairId = repairIdBySlug.get(spec.slug);
    if (!repairId) throw new Error(`Missing seeded repair ${spec.slug}`);

    const benchmark = await db.query.repairBenchmarks.findFirst({
      where: (row, { eq }) => eq(row.repairId, repairId),
      with: { parts: true, laborTasks: true, repair: true },
    });
    if (!benchmark) throw new Error(`Missing benchmark for ${spec.slug}`);

    // The same call the API makes, so the demo data cannot disagree with the product.
    const quote =
      spec.quoteAmount === undefined
        ? undefined
        : evaluateQuote(spec.quoteAmount, {
            partsTotal: benchmark.partsTotal,
            laborTotal: benchmark.laborTotal,
            fairTotalLow: benchmark.fairTotalLow,
            fairTotalHigh: benchmark.fairTotalHigh,
          });

    // The same code the API runs, against the rows the seed has already written.
    const necessity = await seededNecessity(db, {
      vehicle,
      repairSlug: spec.slug,
      repairName: benchmark.repair.name,
      mileageAtAssessment: spec.mileage,
      context: spec.context,
    });

    const [assessment] = await db
      .insert(t.assessments)
      .values({
        userId,
        vehicleId: vehicle.id,
        repairId,
        repairName: benchmark.repair.name,
        mileageAtAssessment: spec.mileage,
        promptedBy: spec.context?.promptedBy ?? null,
        symptomNotes: spec.context?.notes ?? null,
        symptomDuration: spec.context?.duration ?? null,
        ...necessity,
        partsTotal: benchmark.partsTotal,
        partsLow: benchmark.partsLow,
        partsHigh: benchmark.partsHigh,
        laborRatePerHour: benchmark.laborRatePerHour,
        laborEstHours: benchmark.laborEstHours,
        laborTotal: benchmark.laborTotal,
        fairTotalLow: benchmark.fairTotalLow,
        fairTotalHigh: benchmark.fairTotalHigh,
        benchmarkSource: benchmark.source,
        quoteAmount: quote?.amount ?? null,
        quoteParts: quote?.parts ?? null,
        quoteLabor: quote?.labor ?? null,
        quoteVerdict: quote?.verdict ?? null,
        quoteExplanation: quote?.explanation ?? null,
        completedAt: spec.completed?.at ?? null,
        completedCost: spec.completed?.cost ?? null,
        createdAt: spec.createdAt,
      })
      .returning({ id: t.assessments.id });

    const parts = [...benchmark.parts].sort((a, b) => a.position - b.position);
    if (parts.length > 0) {
      await db.insert(t.assessmentParts).values(
        parts.map((part, position) => ({
          assessmentId: assessment.id,
          name: part.name,
          avgPrice: part.avgPrice,
          position,
        })),
      );
    }

    const tasks = [...benchmark.laborTasks].sort((a, b) => a.position - b.position);
    await db.insert(t.assessmentLaborTasks).values(
      tasks.map((task, position) => ({
        assessmentId: assessment.id,
        name: task.name,
        hours: task.hours,
        position,
      })),
    );
  }
}

/** A second tenant, and the account that starts behind the paywall. None of it is Alex's. */
async function seedSecondUser(db: Database, repairIdBySlug: Map<string, string>): Promise<void> {
  const [user] = await db
    .insert(t.users)
    .values({
      email: 'dana@example.com',
      name: 'Dana Whitfield',
      phone: '(555) 442-9910',
      memberSince: '2025-06-01',
      // Still behind the paywall, so there is an account that shows it without anyone editing the
      // database. Sign in as dana@example.com to develop against it.
      plan: 'free',
    })
    .returning({ id: t.users.id });

  const [vehicle] = await db
    .insert(t.vehicles)
    .values({
      userId: user.id,
      year: 2021,
      make: 'Toyota',
      model: 'RAV4',
      trim: 'XLE',
      vin: 'JTMWFREV8HD094412',
      mileage: 31200,
      estMarketValue: 24900,
      tradeInLow: 22400,
      tradeInHigh: 25600,
    })
    .returning({ id: t.vehicles.id });

  await db.insert(t.vehicleValuePoints).values(
    [
      ['Feb', 25900],
      ['Mar', 25600],
      ['Apr', 25400],
      ['May', 25200],
      ['Jun', 25000],
      ['Jul', 24900],
    ].map(([monthLabel, value], position) => ({
      vehicleId: vehicle.id,
      monthLabel: monthLabel as string,
      value: value as number,
      position,
    })),
  );

  await db.insert(t.maintenanceItems).values([
    { vehicleId: vehicle.id, label: 'Cabin air filter', intervalMiles: 15000, position: 0 },
  ]);

  await db.insert(t.serviceRecords).values([
    { userId: user.id, vehicleId: vehicle.id, description: 'Dana private oil change', serviceDate: '2026-05-02', cost: 74, source: 'manual', mileageAtService: 21000 },
  ]);

  // Dana's own assessment. The isolation tests fetch this id as Alex and expect a 404.
  const repairId = repairIdBySlug.get('brake-pad-replacement');
  if (!repairId) throw new Error('Missing seeded repair brake-pad-replacement');

  const benchmark = await db.query.repairBenchmarks.findFirst({
    where: (row, { eq }) => eq(row.repairId, repairId),
    with: { parts: true, laborTasks: true, repair: true },
  });
  if (!benchmark) throw new Error('Missing benchmark for brake-pad-replacement');

  const necessity = await seededNecessity(db, {
    vehicle: {
      id: vehicle.id,
      year: 2021,
      make: 'Toyota',
      model: 'RAV4',
      mileage: 31200,
      maintenanceScheduleCheckedAt: null,
    },
    repairSlug: 'brake-pad-replacement',
    // Deliberately not the catalogue name, so the history match cannot accidentally fire on it.
    repairName: 'Dana private brake job',
    mileageAtAssessment: 31200,
    context: { promptedBy: 'shop_suggested' },
  });

  const [assessment] = await db
    .insert(t.assessments)
    .values({
      userId: user.id,
      vehicleId: vehicle.id,
      repairId,
      repairName: 'Dana private brake job',
      mileageAtAssessment: 31200,
      promptedBy: 'shop_suggested',
      ...necessity,
      partsTotal: benchmark.partsTotal,
      partsLow: benchmark.partsLow,
      partsHigh: benchmark.partsHigh,
      laborRatePerHour: benchmark.laborRatePerHour,
      laborEstHours: benchmark.laborEstHours,
      laborTotal: benchmark.laborTotal,
      fairTotalLow: benchmark.fairTotalLow,
      fairTotalHigh: benchmark.fairTotalHigh,
      benchmarkSource: benchmark.source,
      createdAt: new Date('2026-05-03T09:00:00Z'),
    })
    .returning({ id: t.assessments.id });

  await db.insert(t.assessmentLaborTasks).values(
    [...benchmark.laborTasks]
      .sort((a, b) => a.position - b.position)
      .map((task, position) => ({ assessmentId: assessment.id, name: task.name, hours: task.hours, position })),
  );
}

/**
 * The necessity verdict for one seeded assessment, worked out by the real code against the real
 * seeded rows -- the same principle as `evaluateQuote` above: the demo account must not disagree
 * with the product.
 *
 * NO MODEL CALL. Seeding is offline and deterministic (db/fixtures.ts), so this composes the body
 * from the signals rather than asking Claude to rewrite it. The composed body is the answer
 * anyway; the rewrite only phrases it (services/necessityProse.ts).
 *
 * EXPECT `not_enough` ON EVERY SEEDED CAR, and do not "fix" it by typing a verdict in. Neither
 * demo car has a factory schedule (the seed's intervals are generic, and
 * `maintenance_schedule_checked_at` stays null, which is what tells them apart), and
 * `model_owner_reports` is filled by an NHTSA sync that seeding does not run. So there is
 * genuinely nothing to check these repairs against, and the old fixture text that read
 * "At 68,400 miles with reported grinding..." was a hand-typed answer to a question the app
 * could not yet answer. Run the recall/complaint syncs against a demo car to see a real verdict.
 */
async function seededNecessity(db: Database, target: NecessityTarget) {
  const finding = await loadNecessityFinding(db, target);
  const { headline, badge } = necessityVerdict(finding.band);

  return {
    necessityBand: finding.band,
    necessityShortfall: finding.shortfall ?? null,
    necessitySignals: finding.signals,
    recommendationHeadline: headline,
    recommendationBadge: badge,
    recommendationBody: composeBody(finding),
  };
}

/** Allow `npm run db:seed` while keeping seed() importable by tests. */
const invokedDirectly = process.argv[1]?.includes('seed');
if (invokedDirectly) {
  console.log(`Seeding ${describeTarget()}`);
  try {
    await seed(getDb());
    console.log('Seeded reference data, alex.rivera@email.com, and dana@example.com.');
  } catch (error) {
    // Printed rather than thrown: a refusal to delete real accounts is an expected outcome
    // with instructions to read, and a stack trace buries them.
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    await closeDb();
    process.exit(1);
  }
  await closeDb();
}
