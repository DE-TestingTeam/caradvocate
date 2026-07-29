/**
 * Seeds reference data and two demo accounts.
 *
 * Idempotent: truncates everything first, so `npm run db:seed` is always safe to
 * re-run. The second account (dana@example.com) exists so the test suite can
 * prove one user cannot reach another user's rows.
 */
import { sql } from 'drizzle-orm';
import { closeDb, describeTarget, getDb, type Database } from './index.js';
import * as t from './schema.js';
import { benchmarkSeeds } from './fixtures.js';

export async function seed(db: Database): Promise<void> {
  await truncateAll(db);
  const repairIdBySlug = await seedReference(db);
  await seedAlexRivera(db, repairIdBySlug);
  await seedSecondUser(db, repairIdBySlug);
}

async function truncateAll(db: Database): Promise<void> {
  // Order does not matter with CASCADE, and RESTART IDENTITY keeps reruns clean.
  await db.execute(sql`
    truncate table
      ${t.chatMessages}, ${t.assessmentLaborTasks}, ${t.assessmentParts}, ${t.assessments},
      ${t.serviceRecords}, ${t.maintenanceItems}, ${t.vehicleValuePoints}, ${t.vehicles},
      ${t.userFeatures}, ${t.users},
      ${t.benchmarkLaborTasks}, ${t.benchmarkParts}, ${t.repairBenchmarks}, ${t.repairs},
      ${t.modelKnownIssues}
    restart identity cascade
  `);
}

/** Global data: repair catalog, benchmark pricing, and per-model known issues. */
async function seedReference(db: Database): Promise<Map<string, string>> {
  const repairIdBySlug = new Map<string, string>();

  for (const [index, seedRow] of benchmarkSeeds.entries()) {
    const [repair] = await db
      .insert(t.repairs)
      .values({ slug: seedRow.slug, name: seedRow.name, position: index })
      .returning({ id: t.repairs.id });

    repairIdBySlug.set(seedRow.slug, repair.id);

    const partsTotal = seedRow.partsTotalOverride ?? sum(seedRow.parts.map((p) => p.avgPrice));
    const estHours = round2(sum(seedRow.laborTasks.map((task) => task.hours)));
    const laborTotal = seedRow.laborTotalOverride ?? Math.round(estHours * seedRow.laborRatePerHour);

    const [benchmark] = await db
      .insert(t.repairBenchmarks)
      .values({
        repairId: repair.id,
        partsTotal,
        partsLow: seedRow.partsLow,
        partsHigh: seedRow.partsHigh,
        laborRatePerHour: seedRow.laborRatePerHour,
        laborEstHours: estHours.toFixed(2),
        laborTotal,
        fairTotalLow: seedRow.fairTotalLow,
        fairTotalHigh: seedRow.fairTotalHigh,
        recommendationHeadline: seedRow.recommendation.headline,
        recommendationBadge: seedRow.recommendation.badge,
        recommendationBody: seedRow.recommendation.body,
      })
      .returning({ id: t.repairBenchmarks.id });

    if (seedRow.parts.length > 0) {
      await db.insert(t.benchmarkParts).values(
        seedRow.parts.map((part, position) => ({
          benchmarkId: benchmark.id,
          name: part.name,
          avgPrice: part.avgPrice,
          position,
        })),
      );
    }

    await db.insert(t.benchmarkLaborTasks).values(
      seedRow.laborTasks.map((task, position) => ({
        benchmarkId: benchmark.id,
        name: task.name,
        hours: task.hours.toFixed(2),
        position,
      })),
    );
  }

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
      plan: 'paid',
    })
    .returning({ id: t.users.id });

  await db.insert(t.userFeatures).values([
    { userId: user.id, name: 'My Car', status: 'Included', position: 0 },
    { userId: user.id, name: 'Ask CA', status: 'Included', position: 1 },
    { userId: user.id, name: 'Repair Cost Checker', status: 'Active', position: 2 },
  ]);

  // NOTE: the wireframes disagree -- My Car shows a 2019 Honda Civic at 68,400 mi,
  // Account shows a 2019 Honda CR-V EX at 48,250 mi. One row serves both screens.
  const [vehicle] = await db
    .insert(t.vehicles)
    .values({
      userId: user.id,
      year: 2019,
      make: 'Honda',
      model: 'Civic',
      vin: '2HGFC2F53KH124821',
      mileage: 68400,
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

  await db.insert(t.maintenanceItems).values([
    { vehicleId: vehicle.id, label: 'Fuel Pump Control Unit', status: 'open_recall', position: 0 },
    { vehicleId: vehicle.id, label: 'Oil Change - Due in 1,200 mi', status: 'upcoming', position: 1 },
    { vehicleId: vehicle.id, label: 'Brake Fluid Flush - Due Sep 2025', status: 'upcoming', position: 2 },
    { vehicleId: vehicle.id, label: 'Tire Rotation - Overdue', status: 'overdue', position: 3 },
  ]);

  await db.insert(t.serviceRecords).values([
    { userId: user.id, vehicleId: vehicle.id, description: 'Battery replacement', serviceDate: '2026-06-14', cost: 175, source: 'repair_cost_checker' },
    { userId: user.id, vehicleId: vehicle.id, description: 'Brake pads & rotors - front', serviceDate: '2026-03-08', cost: 310, source: 'manual' },
    { userId: user.id, vehicleId: vehicle.id, description: 'Oil Change & Filter', serviceDate: '2025-03-22', cost: 62, source: 'manual' },
    { userId: user.id, vehicleId: vehicle.id, description: 'Brake Pads (Front)', serviceDate: '2024-11-02', cost: 285, source: 'manual' },
    { userId: user.id, vehicleId: vehicle.id, description: 'Tire Rotation', serviceDate: '2024-06-19', cost: 40, source: 'manual' },
  ]);

  await seedAssessments(db, user.id, vehicle.id, repairIdBySlug);
  await seedChat(db, user.id);
}

async function seedAssessments(
  db: Database,
  userId: string,
  vehicleId: string,
  repairIdBySlug: Map<string, string>,
): Promise<void> {
  const specs = [
    {
      slug: 'brake-pad-replacement',
      createdAt: new Date('2025-01-15T12:00:00Z'),
      mileage: 68400,
      quote: {
        amount: 320,
        parts: 150,
        labor: 170,
        verdict: 'fair' as const,
        explanation:
          'Your quoted price of $320 is within the expected range of $280-$400 for this repair. Parts and labor are both within normal bounds.',
      },
      completed: undefined,
    },
    {
      slug: 'ac-compressor-replacement',
      createdAt: new Date('2024-11-03T12:00:00Z'),
      mileage: 66100,
      quote: {
        amount: 1680,
        parts: 890,
        labor: 790,
        verdict: 'overpriced' as const,
        explanation:
          'Your quoted price of $1,680 is above the expected range of $860-$1,240 for this repair. Both parts and labor are priced above benchmark.',
      },
      completed: undefined,
    },
    {
      slug: 'timing-belt-inspection',
      createdAt: new Date('2024-09-20T12:00:00Z'),
      mileage: 64800,
      quote: undefined,
      completed: { at: '2024-10-04', cost: 165 },
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

    const [assessment] = await db
      .insert(t.assessments)
      .values({
        userId,
        vehicleId,
        repairId,
        repairName: benchmark.repair.name,
        mileageAtAssessment: spec.mileage,
        recommendationHeadline: benchmark.recommendationHeadline,
        recommendationBadge: benchmark.recommendationBadge,
        recommendationBody: benchmark.recommendationBody,
        partsTotal: benchmark.partsTotal,
        partsLow: benchmark.partsLow,
        partsHigh: benchmark.partsHigh,
        laborRatePerHour: benchmark.laborRatePerHour,
        laborEstHours: benchmark.laborEstHours,
        laborTotal: benchmark.laborTotal,
        fairTotalLow: benchmark.fairTotalLow,
        fairTotalHigh: benchmark.fairTotalHigh,
        quoteAmount: spec.quote?.amount ?? null,
        quoteParts: spec.quote?.parts ?? null,
        quoteLabor: spec.quote?.labor ?? null,
        quoteVerdict: spec.quote?.verdict ?? null,
        quoteExplanation: spec.quote?.explanation ?? null,
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

/** The conversation transcribed from viewport-mobile-1.png. */
async function seedChat(db: Database, userId: string): Promise<void> {
  const base = Date.parse('2026-07-01T10:00:00Z');
  await db.insert(t.chatMessages).values([
    {
      userId,
      role: 'user',
      text: 'My car makes a grinding sound when I brake',
      createdAt: new Date(base),
    },
    {
      userId,
      role: 'assistant',
      text: 'This is commonly caused by worn brake pads grinding against the rotor. It can also indicate rotor damage or a stuck caliper.',
      urgencyLevel: 'high',
      urgencyText: 'Urgency: High - avoid highway driving until inspected',
      createdAt: new Date(base + 1000),
    },
    {
      userId,
      role: 'user',
      text: 'How much should I expect to pay to fix this?',
      createdAt: new Date(base + 2000),
    },
    {
      userId,
      role: 'assistant',
      text: 'To find out how much this repair costs, please start a repair assessment.',
      ctaLabel: 'CHECK REPAIR COSTS',
      ctaAction: 'start_assessment',
      createdAt: new Date(base + 3000),
    },
  ]);
}

/**
 * A second tenant with its own car and assessment. Exists purely so the test
 * suite can assert that Alex cannot see any of it.
 */
async function seedSecondUser(db: Database, repairIdBySlug: Map<string, string>): Promise<void> {
  const [user] = await db
    .insert(t.users)
    .values({
      email: 'dana@example.com',
      name: 'Dana Whitfield',
      phone: '(555) 442-9910',
      memberSince: '2025-06-01',
      plan: 'paid',
    })
    .returning({ id: t.users.id });

  await db.insert(t.userFeatures).values([
    { userId: user.id, name: 'My Car', status: 'Included', position: 0 },
    { userId: user.id, name: 'Ask CA', status: 'Included', position: 1 },
    { userId: user.id, name: 'Repair Cost Checker', status: 'Active', position: 2 },
  ]);

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
    { vehicleId: vehicle.id, label: 'Cabin Air Filter - Due in 800 mi', status: 'upcoming', position: 0 },
  ]);

  await db.insert(t.serviceRecords).values([
    { userId: user.id, vehicleId: vehicle.id, description: 'Dana private oil change', serviceDate: '2026-05-02', cost: 74, source: 'manual' },
  ]);

  await db.insert(t.chatMessages).values([
    { userId: user.id, role: 'user', text: 'Dana private question about a rattle', createdAt: new Date('2026-05-02T09:00:00Z') },
  ]);

  // Dana's own assessment. The isolation tests fetch this id as Alex and expect a 404.
  const repairId = repairIdBySlug.get('brake-pad-replacement');
  if (!repairId) throw new Error('Missing seeded repair brake-pad-replacement');

  const benchmark = await db.query.repairBenchmarks.findFirst({
    where: (row, { eq }) => eq(row.repairId, repairId),
    with: { parts: true, laborTasks: true, repair: true },
  });
  if (!benchmark) throw new Error('Missing benchmark for brake-pad-replacement');

  const [assessment] = await db
    .insert(t.assessments)
    .values({
      userId: user.id,
      vehicleId: vehicle.id,
      repairId,
      repairName: 'Dana private brake job',
      mileageAtAssessment: 31200,
      recommendationHeadline: benchmark.recommendationHeadline,
      recommendationBadge: benchmark.recommendationBadge,
      recommendationBody: benchmark.recommendationBody,
      partsTotal: benchmark.partsTotal,
      partsLow: benchmark.partsLow,
      partsHigh: benchmark.partsHigh,
      laborRatePerHour: benchmark.laborRatePerHour,
      laborEstHours: benchmark.laborEstHours,
      laborTotal: benchmark.laborTotal,
      fairTotalLow: benchmark.fairTotalLow,
      fairTotalHigh: benchmark.fairTotalHigh,
      createdAt: new Date('2026-05-03T09:00:00Z'),
    })
    .returning({ id: t.assessments.id });

  await db.insert(t.assessmentLaborTasks).values(
    [...benchmark.laborTasks]
      .sort((a, b) => a.position - b.position)
      .map((task, position) => ({ assessmentId: assessment.id, name: task.name, hours: task.hours, position })),
  );
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Allow `npm run db:seed` while keeping seed() importable by tests. */
const invokedDirectly = process.argv[1]?.includes('seed');
if (invokedDirectly) {
  console.log(`Seeding ${describeTarget()}`);
  await seed(getDb());
  console.log('Seeded reference data, alex.rivera@email.com, and dana@example.com.');
  await closeDb();
}
