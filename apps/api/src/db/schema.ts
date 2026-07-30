/**
 * Postgres schema.
 *
 * OWNERSHIP MODEL -- read this before adding a table.
 *
 * Tables fall into two groups:
 *
 *   1. User-owned aggregate roots carry `userId` directly: vehicles,
 *      serviceRecords, assessments, userFeatures. Every query
 *      against these MUST filter on userId.
 *
 *   2. Children of those roots (vehicleValuePoints, maintenanceItems,
 *      vehicleRecallStatus, assessmentParts, assessmentLaborTasks) do NOT carry
 *      userId. They are
 *      reachable only through their parent, and the parent's userId filter is
 *      what authorises them. Denormalising userId onto children would create a
 *      second source of truth that can disagree with the first.
 *
 *   3. Global reference data has no owner at all: repairs, repairBenchmarks and
 *      their children, modelKnownIssues, modelRecalls and modelOwnerReports. These
 *      are the same for every user. Known issues, safety recalls and owner
 *      complaints are keyed by year/make/model, not by person.
 *
 * MONEY is stored as integer whole dollars. The product never shows cents.
 * HOURS are numeric(4,2) because labor times are quoted in tenths of an hour.
 */
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
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
// No maintenance-status enum: the status is computed on read, never stored.
// See maintenanceItems below and services/maintenanceDue.ts.
export const quoteVerdictEnum = pgEnum('quote_verdict', ['fair', 'overpriced']);
export const serviceSourceEnum = pgEnum('service_record_source', ['manual', 'repair_cost_checker']);
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

/**
 * A recurring upkeep job on one car -- oil, tyres, brake fluid.
 *
 * There is deliberately no stored status. Whether something is due is arithmetic on
 * the interval, the last time it was done, and today's odometer, so it is computed
 * on read (see services/maintenanceDue.ts). A stored status is a value nothing keeps
 * true: the previous version of this table held one, and the seed had to bake the
 * answer into the label ("Oil Change - Due in 1,200 mi") because nothing computed it.
 *
 * Intervals are owner-supplied. The manufacturer's official schedule is licensed
 * data; when that is bought it fills in these same two columns and nothing else
 * changes.
 */
export const maintenanceItems = pgTable(
  'maintenance_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    /**
     * How often the job is due. Either, both, or neither: with neither we say so
     * rather than guessing, and with both whichever falls first wins.
     */
    intervalMiles: integer('interval_miles'),
    intervalMonths: integer('interval_months'),
    position: integer('position').notNull().default(0),
  },
  (table) => ({
    byVehicle: index('maintenance_items_vehicle_idx').on(table.vehicleId, table.position),
  }),
);

/**
 * What the owner says about a recall on *their* car.
 *
 * NHTSA's feed is keyed by year/make/model, so it can say a campaign affects this
 * model but never whether this particular car was repaired -- only the manufacturer
 * knows that, and only for a fee. The owner knows too, so this records what they
 * tell us rather than leaving every recall permanently ambiguous.
 *
 * Keyed by NHTSA's campaign number rather than a `model_recalls.id`, because those
 * rows are mirrored data that a resync can replace. The campaign number is the
 * stable identity and survives.
 *
 * A missing row means "unknown", which is the honest default -- distinct from the
 * owner having told us it is outstanding.
 */
export const vehicleRecallStatus = pgTable(
  'vehicle_recall_status',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    campaignNumber: text('campaign_number').notNull(),
    /** True when the owner says the work has been done. */
    repaired: boolean('repaired').notNull(),
    notedAt: timestamp('noted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    perVehicle: uniqueIndex('vehicle_recall_status_unique').on(table.vehicleId, table.campaignNumber),
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

/**
 * Safety recalls, mirrored from NHTSA.
 *
 * Like known issues these belong to the model rather than the owner: every 2019
 * Civic shares the same campaigns, so one row serves all of them and a sync costs
 * one upstream request per model rather than one per user.
 *
 * `campaignNumber` is NHTSA's own identifier and is what makes a campaign unique
 * within a model, so a re-sync updates rows in place instead of duplicating them.
 */
export const modelRecalls = pgTable(
  'model_recalls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    year: integer('year').notNull(),
    make: text('make').notNull(),
    model: text('model').notNull(),
    campaignNumber: text('campaign_number').notNull(),
    component: text('component').notNull(),
    summary: text('summary').notNull(),
    consequence: text('consequence').notNull(),
    remedy: text('remedy').notNull(),
    /** NHTSA's "stop driving" and "park away from structures" advisories. */
    parkIt: boolean('park_it').notNull().default(false),
    parkOutside: boolean('park_outside').notNull().default(false),
    /** Null when NHTSA reported an unparseable date; the recall still stands. */
    reportedOn: date('reported_on'),
  },
  (table) => ({
    byModel: index('model_recalls_model_idx').on(table.year, table.make, table.model),
    campaignPerModel: uniqueIndex('model_recalls_campaign_unique').on(
      table.year,
      table.make,
      table.model,
      table.campaignNumber,
    ),
  }),
);

/**
 * Owner complaints filed with NHTSA, aggregated by the component they concern.
 *
 * The raw feed is one row per complaint; what the UI needs is "how often does this
 * system get reported", so aggregation happens at sync time and one row here is one
 * component for one model.
 *
 * These are *unverified owner reports*, not findings. Recalls are the official
 * counterpart. Every count is kept rather than collapsed into a severity, because
 * "12 owners reported this, 2 involved a crash" is the honest version and a lone
 * severity badge is not.
 */
export const modelOwnerReports = pgTable(
  'model_owner_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    year: integer('year').notNull(),
    make: text('make').notNull(),
    model: text('model').notNull(),
    /** NHTSA component label, canonicalised. e.g. "SERVICE BRAKES". */
    component: text('component').notNull(),
    reportCount: integer('report_count').notNull(),
    crashCount: integer('crash_count').notNull().default(0),
    fireCount: integer('fire_count').notNull().default(0),
    injuryCount: integer('injury_count').notNull().default(0),
    deathCount: integer('death_count').notNull().default(0),
    /** Most recent incident date across the complaints in this group. */
    latestIncidentOn: date('latest_incident_on'),
    /**
     * Mileage at failure, from NHTSA's bulk complaint file.
     *
     * The JSON API omits mileage entirely, so these are filled in by a separate
     * ingest (scripts/ingestComplaintMileage.mts) and stay null until it has run for
     * this model. That is why they are nullable and counted separately from
     * `reportCount`: only about two thirds of complaints report an odometer reading,
     * and a range built from three of them should not masquerade as one built from
     * thirty.
     *
     * Low and high are the 25th and 75th percentiles, not the extremes -- a single
     * complaint at 600 miles should not widen the range the owner is shown.
     */
    mileageSampleCount: integer('mileage_sample_count'),
    mileageLowMi: integer('mileage_low_mi'),
    mileageMedianMi: integer('mileage_median_mi'),
    mileageHighMi: integer('mileage_high_mi'),
  },
  (table) => ({
    byModel: index('model_owner_reports_model_idx').on(table.year, table.make, table.model),
    componentPerModel: uniqueIndex('model_owner_reports_component_unique').on(
      table.year,
      table.make,
      table.model,
      table.component,
    ),
  }),
);

/**
 * A few representative complaints behind each component group.
 *
 * The counts say how often a system is reported; these say what owners actually
 * describe -- "rear sub frame has significant rust, snapped while driving" is worth
 * more to someone deciding whether to see a mechanic than "6 reports" is. NHTSA
 * returns this prose in the same response the counts come from.
 *
 * A child of the aggregate rather than a column on it, matching how
 * vehicleValuePoints hangs off a vehicle: an ordered short list read with its
 * parent and never queried on its own.
 */
export const modelOwnerReportQuotes = pgTable(
  'model_owner_report_quotes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => modelOwnerReports.id, { onDelete: 'cascade' }),
    /** The owner's own words, as filed. Cased for display at render time. */
    text: text('text').notNull(),
    /** When it happened, when NHTSA recorded a usable date. */
    incidentOn: date('incident_on'),
    position: integer('position').notNull().default(0),
  },
  (table) => ({
    byReport: index('model_owner_report_quotes_report_idx').on(table.reportId, table.position),
  }),
);

/**
 * NHTSA NCAP crash-test ratings, one row per tested variant of a model.
 *
 * The grain is the variant, not the model, because NHTSA tests body styles and
 * drivetrains separately -- a 2019 F-150 has five cab configurations with different
 * rollover results. Averaging them would produce a rating for a truck nobody drives.
 *
 * `year`/`make`/`model` hold *our* lookup key rather than NHTSA's label, so a
 * vehicle whose model is "F-150" finds its rows. NHTSA's own variant name lives in
 * `description`, and `ncapVehicleId` is its stable identity for the variant -- the
 * same role `campaignNumber` plays for recalls.
 *
 * Every star rating is nullable because NHTSA publishes "Not Rated" for tests it
 * never ran. A null here means untested; it must never render as zero stars.
 */
export const modelSafetyRatings = pgTable(
  'model_safety_ratings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    year: integer('year').notNull(),
    make: text('make').notNull(),
    model: text('model').notNull(),
    /** NHTSA's VehicleId for this tested variant. Stable, and unique per model. */
    ncapVehicleId: integer('ncap_vehicle_id').notNull(),
    /** NHTSA's label, e.g. "2019 Ford F-150 Super Crew PU/CC 4x4". */
    description: text('description').notNull(),
    overallRating: integer('overall_rating'),
    frontCrashRating: integer('front_crash_rating'),
    sideCrashRating: integer('side_crash_rating'),
    rolloverRating: integer('rollover_rating'),
    /**
     * Modelled rollover chance, 0-1. Null when the test was not run: NHTSA sends
     * 0.0 in that case, which would otherwise read as "cannot roll over".
     */
    rolloverPossibility: numeric('rollover_possibility', { precision: 4, scale: 3 }),
    /** 'standard' | 'optional' | 'no'. Null when NHTSA recorded nothing. */
    forwardCollisionWarning: text('forward_collision_warning'),
    laneDepartureWarning: text('lane_departure_warning'),
    electronicStabilityControl: text('electronic_stability_control'),
  },
  (table) => ({
    byModel: index('model_safety_ratings_model_idx').on(table.year, table.make, table.model),
    variantPerModel: uniqueIndex('model_safety_ratings_variant_unique').on(
      table.year,
      table.make,
      table.model,
      table.ncapVehicleId,
    ),
  }),
);

/**
 * When each model was last checked against each upstream NHTSA feed.
 *
 * Kept separate from the mirrored rows because "nothing found" and "never checked"
 * are different facts, and the UI must not report the first while meaning the
 * second. A row with `succeededAt` and no matching rows is a genuine all-clear; no
 * row at all means nobody has looked yet.
 *
 * One table serves every feed -- see services/modelFeed.ts -- because the freshness
 * policy is a property of mirroring an upstream source, not of recalls specifically.
 */
export const modelFeedSyncs = pgTable(
  'model_feed_syncs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 'recalls' | 'complaints'. Text rather than an enum so adding a feed needs no migration. */
    feed: text('feed').notNull(),
    year: integer('year').notNull(),
    make: text('make').notNull(),
    model: text('model').notNull(),
    /** Last attempt of any kind. Drives the retry cooldown after a failure. */
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Last attempt that actually reached NHTSA. Null means never. Kept separate
     * from `checkedAt` so a failed refresh cannot retract data we already earned --
     * what we hold stays trustworthy until a later check replaces it.
     */
    succeededAt: timestamp('succeeded_at', { withTimezone: true }),
  },
  (table) => ({
    byFeedAndModel: uniqueIndex('model_feed_syncs_feed_model_unique').on(
      table.feed,
      table.year,
      table.make,
      table.model,
    ),
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
    /**
     * Odometer reading when the work was done. Nullable because records created
     * before this existed have none, and because someone logging an old receipt may
     * genuinely not know -- but without it no interval can be measured, which is why
     * the form asks for it.
     */
    mileageAtService: integer('mileage_at_service'),
    /**
     * The upkeep job this satisfies, when it satisfies one. Set explicitly rather
     * than matched on the description, because guessing that "oil and filter" means
     * the oil-change item is the kind of inference that is wrong just often enough
     * to tell someone their brakes are fine when they are not.
     *
     * Nulled rather than cascaded when the item goes: the work still happened.
     */
    maintenanceItemId: uuid('maintenance_item_id').references(() => maintenanceItems.id, {
      onDelete: 'set null',
    }),
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

/*
 * There is no chat table, on purpose. An Ask CA conversation clears when the owner
 * leaves the screen, so it is never written down -- see routes/chat.ts for why storing
 * it and deleting on exit is the less reliable way to get that behaviour.
 */

/* -------------------------------------------------------------- relations */

export const usersRelations = relations(users, ({ many }) => ({
  vehicles: many(vehicles),
  features: many(userFeatures),
  serviceRecords: many(serviceRecords),
  assessments: many(assessments),
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

