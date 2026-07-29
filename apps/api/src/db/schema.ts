/**
 * Postgres schema.
 *
 * OWNERSHIP MODEL -- read this before adding a table.
 *
 * Tables fall into two groups:
 *
 *   1. User-owned aggregate roots carry `userId` directly: vehicles,
 *      serviceRecords, assessments, chatMessages, userFeatures. Every query
 *      against these MUST filter on userId.
 *
 *   2. Children of those roots (vehicleValuePoints, maintenanceItems,
 *      assessmentParts, assessmentLaborTasks) do NOT carry userId. They are
 *      reachable only through their parent, and the parent's userId filter is
 *      what authorises them. Denormalising userId onto children would create a
 *      second source of truth that can disagree with the first.
 *
 *   3. Global reference data has no owner at all: repairs, repairBenchmarks and
 *      their children, and modelKnownIssues. These are the same for every user.
 *      "Known Issues for Your Model" is keyed by year/make/model, not by person.
 *
 * MONEY is stored as integer whole dollars. The product never shows cents.
 * HOURS are numeric(4,2) because labor times are quoted in tenths of an hour.
 */
import { relations, sql } from 'drizzle-orm';
import {
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  date,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/* ------------------------------------------------------------------- enums */

export const severityEnum = pgEnum('severity', ['low', 'medium', 'high']);
export const maintenanceStatusEnum = pgEnum('maintenance_status', ['open_recall', 'overdue', 'upcoming']);
export const quoteVerdictEnum = pgEnum('quote_verdict', ['fair', 'overpriced']);
export const serviceSourceEnum = pgEnum('service_record_source', ['manual', 'repair_cost_checker']);
export const chatRoleEnum = pgEnum('chat_role', ['user', 'assistant']);
export const featureStatusEnum = pgEnum('feature_status', ['Included', 'Active']);
export const planEnum = pgEnum('plan', ['free', 'paid']);

/* ------------------------------------------------------------------- users */

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * The `sub` claim from the Supabase Auth JWT, linking this profile to the
     * identity Supabase owns. Nullable because seeded and dev-stub users have no
     * Supabase identity, and because we never want an auth outage to make
     * existing rows unreadable.
     */
    supabaseUserId: uuid('supabase_user_id'),
    email: text('email').notNull(),
    name: text('name').notNull(),
    phone: text('phone').notNull().default(''),
    /** Displayed as "Member since 2024"; the year is derived from this. */
    memberSince: date('member_since').notNull(),
    plan: planEnum('plan').notNull().default('paid'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    emailUnique: uniqueIndex('users_email_unique').on(table.email),
    // One profile per Supabase identity. Partial so the many null rows do not collide.
    supabaseUserUnique: uniqueIndex('users_supabase_user_id_unique')
      .on(table.supabaseUserId)
      .where(sql`${table.supabaseUserId} is not null`),
  }),
);

/** Subscription line items shown on the Account screen. */
export const userFeatures = pgTable(
  'user_features',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    status: featureStatusEnum('status').notNull(),
    position: integer('position').notNull().default(0),
  },
  (table) => ({
    byUser: index('user_features_user_idx').on(table.userId, table.position),
  }),
);

/* ---------------------------------------------------------------- vehicles */

export const vehicles = pgTable(
  'vehicles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    make: text('make').notNull(),
    model: text('model').notNull(),
    trim: text('trim'),
    // Nullable: onboarding lets an owner skip the VIN, and plenty cannot find it
    // on the spot. Absent is recorded as absent rather than as a sentinel string.
    vin: text('vin'),
    mileage: integer('mileage').notNull(),
    // Nullable: populated by a valuation source, absent for a freshly added car.
    estMarketValue: integer('est_market_value'),
    tradeInLow: integer('trade_in_low'),
    tradeInHigh: integer('trade_in_high'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    byUser: index('vehicles_user_idx').on(table.userId),
    // A VIN is globally unique in reality, but scoping to the user avoids
    // leaking whether another account already registered the same car. Postgres
    // treats NULLs as distinct here, so skipping the VIN never trips the index.
    vinPerUser: uniqueIndex('vehicles_user_vin_unique').on(table.userId, table.vin),
  }),
);

/** Points on the value-trend chart. Ordered by `position`, oldest first. */
export const vehicleValuePoints = pgTable(
  'vehicle_value_points',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    monthLabel: text('month_label').notNull(),
    value: integer('value').notNull(),
    position: integer('position').notNull(),
  },
  (table) => ({
    byVehicle: index('vehicle_value_points_vehicle_idx').on(table.vehicleId, table.position),
  }),
);

export const maintenanceItems = pgTable(
  'maintenance_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    status: maintenanceStatusEnum('status').notNull(),
    position: integer('position').notNull().default(0),
  },
  (table) => ({
    byVehicle: index('maintenance_items_vehicle_idx').on(table.vehicleId, table.position),
  }),
);

/* -------------------------------------------------- global reference data */

/**
 * Known issues are a property of the model, not the owner. Keyed loosely on
 * year/make/model so one row can serve every 2019 Civic on the platform.
 */
export const modelKnownIssues = pgTable(
  'model_known_issues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    year: integer('year').notNull(),
    make: text('make').notNull(),
    model: text('model').notNull(),
    label: text('label').notNull(),
    severity: severityEnum('severity').notNull(),
    position: integer('position').notNull().default(0),
  },
  (table) => ({
    byModel: index('model_known_issues_model_idx').on(table.year, table.make, table.model, table.position),
  }),
);

/** The repair catalog offered in step 1 of a new assessment. */
export const repairs = pgTable(
  'repairs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
  },
  (table) => ({
    slugUnique: uniqueIndex('repairs_slug_unique').on(table.slug),
  }),
);

/**
 * Benchmark pricing per repair -- the reference data the whole product rests on.
 *
 * This is currently seeded by hand. Sourcing real parts pricing and OEM labor
 * times is the outstanding product risk; see the root README.
 */
export const repairBenchmarks = pgTable(
  'repair_benchmarks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repairId: uuid('repair_id')
      .notNull()
      .references(() => repairs.id, { onDelete: 'cascade' }),
    partsTotal: integer('parts_total').notNull(),
    partsLow: integer('parts_low').notNull(),
    partsHigh: integer('parts_high').notNull(),
    laborRatePerHour: integer('labor_rate_per_hour').notNull(),
    laborEstHours: numeric('labor_est_hours', { precision: 4, scale: 2 }).notNull(),
    laborTotal: integer('labor_total').notNull(),
    fairTotalLow: integer('fair_total_low').notNull(),
    fairTotalHigh: integer('fair_total_high').notNull(),
    recommendationHeadline: text('recommendation_headline').notNull(),
    recommendationBadge: text('recommendation_badge').notNull(),
    recommendationBody: text('recommendation_body').notNull(),
  },
  (table) => ({
    repairUnique: uniqueIndex('repair_benchmarks_repair_unique').on(table.repairId),
  }),
);

export const benchmarkParts = pgTable(
  'benchmark_parts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    benchmarkId: uuid('benchmark_id')
      .notNull()
      .references(() => repairBenchmarks.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    avgPrice: integer('avg_price').notNull(),
    position: integer('position').notNull(),
  },
  (table) => ({
    byBenchmark: index('benchmark_parts_benchmark_idx').on(table.benchmarkId, table.position),
  }),
);

export const benchmarkLaborTasks = pgTable(
  'benchmark_labor_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    benchmarkId: uuid('benchmark_id')
      .notNull()
      .references(() => repairBenchmarks.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    hours: numeric('hours', { precision: 4, scale: 2 }).notNull(),
    position: integer('position').notNull(),
  },
  (table) => ({
    byBenchmark: index('benchmark_labor_tasks_benchmark_idx').on(table.benchmarkId, table.position),
  }),
);

/* --------------------------------------------------------- service records */

export const serviceRecords = pgTable(
  'service_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    serviceDate: date('service_date').notNull(),
    cost: integer('cost').notNull(),
    source: serviceSourceEnum('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    byUser: index('service_records_user_date_idx').on(table.userId, table.serviceDate),
  }),
);

/* ------------------------------------------------------------- assessments */

/**
 * An assessment SNAPSHOTS the benchmark it was built from.
 *
 * Benchmark pricing changes as reference data is refreshed, but an assessment
 * the user saved must keep showing the numbers they were shown. So every figure
 * is copied onto the assessment (and its child rows) at creation time rather
 * than joined live from repairBenchmarks.
 */
export const assessments = pgTable(
  'assessments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    /** Kept for traceability; the catalog row may be renamed or retired later. */
    repairId: uuid('repair_id').references(() => repairs.id, { onDelete: 'set null' }),
    repairName: text('repair_name').notNull(),
    mileageAtAssessment: integer('mileage_at_assessment').notNull(),

    recommendationHeadline: text('recommendation_headline').notNull(),
    recommendationBadge: text('recommendation_badge').notNull(),
    recommendationBody: text('recommendation_body').notNull(),

    partsTotal: integer('parts_total').notNull(),
    partsLow: integer('parts_low').notNull(),
    partsHigh: integer('parts_high').notNull(),

    laborRatePerHour: integer('labor_rate_per_hour').notNull(),
    laborEstHours: numeric('labor_est_hours', { precision: 4, scale: 2 }).notNull(),
    laborTotal: integer('labor_total').notNull(),

    fairTotalLow: integer('fair_total_low').notNull(),
    fairTotalHigh: integer('fair_total_high').notNull(),

    /** All five quote columns are null together, or all non-null together. */
    quoteAmount: integer('quote_amount'),
    quoteParts: integer('quote_parts'),
    quoteLabor: integer('quote_labor'),
    quoteVerdict: quoteVerdictEnum('quote_verdict'),
    quoteExplanation: text('quote_explanation'),
    /** Display only -- the PDF is not parsed. */
    quoteFileName: text('quote_file_name'),

    /**
     * Completion is independent of the verdict: the wireframes show an
     * assessment badged ASSESSED that is also marked complete.
     */
    completedAt: date('completed_at'),
    completedCost: integer('completed_cost'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    byUser: index('assessments_user_created_idx').on(table.userId, table.createdAt),
  }),
);

export const assessmentParts = pgTable(
  'assessment_parts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    avgPrice: integer('avg_price').notNull(),
    position: integer('position').notNull(),
  },
  (table) => ({
    byAssessment: index('assessment_parts_assessment_idx').on(table.assessmentId, table.position),
  }),
);

export const assessmentLaborTasks = pgTable(
  'assessment_labor_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    hours: numeric('hours', { precision: 4, scale: 2 }).notNull(),
    position: integer('position').notNull(),
  },
  (table) => ({
    byAssessment: index('assessment_labor_tasks_assessment_idx').on(table.assessmentId, table.position),
  }),
);

/* ------------------------------------------------------------------- chat */

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: chatRoleEnum('role').notNull(),
    text: text('text').notNull(),
    urgencyLevel: severityEnum('urgency_level'),
    urgencyText: text('urgency_text'),
    ctaLabel: text('cta_label'),
    ctaAction: text('cta_action'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    byUser: index('chat_messages_user_created_idx').on(table.userId, table.createdAt),
  }),
);

/* -------------------------------------------------------------- relations */

export const usersRelations = relations(users, ({ many }) => ({
  vehicles: many(vehicles),
  features: many(userFeatures),
  serviceRecords: many(serviceRecords),
  assessments: many(assessments),
  chatMessages: many(chatMessages),
}));

export const vehiclesRelations = relations(vehicles, ({ one, many }) => ({
  owner: one(users, { fields: [vehicles.userId], references: [users.id] }),
  valuePoints: many(vehicleValuePoints),
  maintenanceItems: many(maintenanceItems),
}));

export const assessmentsRelations = relations(assessments, ({ one, many }) => ({
  owner: one(users, { fields: [assessments.userId], references: [users.id] }),
  vehicle: one(vehicles, { fields: [assessments.vehicleId], references: [vehicles.id] }),
  parts: many(assessmentParts),
  laborTasks: many(assessmentLaborTasks),
}));

export const repairBenchmarksRelations = relations(repairBenchmarks, ({ one, many }) => ({
  repair: one(repairs, { fields: [repairBenchmarks.repairId], references: [repairs.id] }),
  parts: many(benchmarkParts),
  laborTasks: many(benchmarkLaborTasks),
}));

// Drizzle's relational query builder needs both sides of every one-to-many
// declared, so each child below names its parent explicitly.

export const repairsRelations = relations(repairs, ({ one }) => ({
  benchmark: one(repairBenchmarks, { fields: [repairs.id], references: [repairBenchmarks.repairId] }),
}));

export const benchmarkPartsRelations = relations(benchmarkParts, ({ one }) => ({
  benchmark: one(repairBenchmarks, { fields: [benchmarkParts.benchmarkId], references: [repairBenchmarks.id] }),
}));

export const benchmarkLaborTasksRelations = relations(benchmarkLaborTasks, ({ one }) => ({
  benchmark: one(repairBenchmarks, { fields: [benchmarkLaborTasks.benchmarkId], references: [repairBenchmarks.id] }),
}));

export const assessmentPartsRelations = relations(assessmentParts, ({ one }) => ({
  assessment: one(assessments, { fields: [assessmentParts.assessmentId], references: [assessments.id] }),
}));

export const assessmentLaborTasksRelations = relations(assessmentLaborTasks, ({ one }) => ({
  assessment: one(assessments, { fields: [assessmentLaborTasks.assessmentId], references: [assessments.id] }),
}));

export const vehicleValuePointsRelations = relations(vehicleValuePoints, ({ one }) => ({
  vehicle: one(vehicles, { fields: [vehicleValuePoints.vehicleId], references: [vehicles.id] }),
}));

export const maintenanceItemsRelations = relations(maintenanceItems, ({ one }) => ({
  vehicle: one(vehicles, { fields: [maintenanceItems.vehicleId], references: [vehicles.id] }),
}));

export const serviceRecordsRelations = relations(serviceRecords, ({ one }) => ({
  owner: one(users, { fields: [serviceRecords.userId], references: [users.id] }),
  vehicle: one(vehicles, { fields: [serviceRecords.vehicleId], references: [vehicles.id] }),
}));

export const userFeaturesRelations = relations(userFeatures, ({ one }) => ({
  owner: one(users, { fields: [userFeatures.userId], references: [users.id] }),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  owner: one(users, { fields: [chatMessages.userId], references: [users.id] }),
}));
