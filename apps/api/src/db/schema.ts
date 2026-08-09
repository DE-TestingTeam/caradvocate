/**
 * Postgres schema.
 *
 * OWNERSHIP MODEL -- read this before adding a table:
 *
 *   1. User-owned aggregate roots carry `userId` (vehicles, serviceRecords,
 *      assessments, paywallIntents, askTranscripts). Every query the APP serves against
 *      these MUST filter on userId. askTranscripts is the one table the app never reads
 *      back at all -- it exists to be reviewed offline, and that review is deliberately
 *      cross-user, so it is the single exception to the filter rule.
 *   2. Their children (vehicleValuePoints, maintenanceItems, vehicleRecallStatus,
 *      assessmentParts, assessmentLaborTasks, askTranscriptSources) do NOT. They are
 *      reachable only through the parent, whose userId filter authorises them;
 *      denormalising it onto children would create a second source of truth.
 *   3. Global reference data has no owner: repairs, repairBenchmarks and their
 *      children, modelKnownIssues, modelRecalls, modelOwnerReports. All keyed by
 *      year/make/model, not by person.
 *
 * MONEY is integer whole dollars -- the product never shows cents. HOURS are
 * numeric(4,2) because labor times are quoted in tenths of an hour.
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
export const planEnum = pgEnum('plan', ['free', 'paid']);
/**
 * Which of the two paid offers an owner chose. Null while free. Two models are tested at
 * once -- see services/paywall.ts -- so this is what a paid account bought, not a global
 * setting.
 */
export const pricingModelEnum = pgEnum('pricing_model', ['all_you_can_eat', 'per_incident']);

/* ------------------------------------------------------------------- users */

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * The `sub` claim from the Supabase Auth JWT. Nullable because seeded and dev-stub
     * users have no Supabase identity.
     */
    supabaseUserId: uuid('supabase_user_id'),
    email: text('email').notNull(),
    name: text('name').notNull(),
    phone: text('phone').notNull().default(''),
    /** Displayed as "Member since 2024"; the year is derived from this. */
    memberSince: date('member_since').notNull(),
    /**
     * Free until the owner taps through the paywall. v1 charges nobody, so this
     * records the tap rather than that money changed hands. See services/paywall.ts.
     */
    plan: planEnum('plan').notNull().default('free'),
    /** Set once, at unlock, alongside `plan`. Null while free. See recordUnlock. */
    pricingModel: pricingModelEnum('pricing_model'),
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

/*
 * There is no user_features table, on purpose. The Account screen's feature list is a fixed
 * catalog (see services/featureCatalog.ts): what's free never varies per owner, and the paid
 * rows all move together with `users.plan`, so storing them would just be `plan` duplicated
 * ten ways with a manual step to keep both in sync.
 */

/**
 * Every tap on the paywall's unlock button -- the prototype's actual output. Nobody is
 * charged in v1, so the tap is the only evidence of willingness to pay, and it is
 * evidence for the number that was on screen: `priceCents` and `interval` are copied
 * in so a mid-test price change leaves earlier rows meaning what they meant.
 *
 * Append-only, and a second tap by the same owner is a second row -- re-deciding at a
 * new price is itself a finding. Cascades with the user, so a deleted account takes its
 * intent history with it; export before honouring a deletion request.
 */
export const paywallIntents = pgTable(
  'paywall_intents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Which offer this tap was for -- the two are tested side by side. */
    pricingModel: pricingModelEnum('pricing_model').notNull(),
    /** Whole cents, as shown. */
    priceCents: integer('price_cents').notNull(),
    /** 'month' or 'year'. Plain text so a new cadence needs no migration. */
    interval: text('interval').notNull(),
    /**
     * Where they tapped from: 'repair_cost_checker' (the gate on the page) or 'account'
     * (the unlock button). Kept because conversion by entry point is a question the PoC
     * will want to ask -- arriving from an Ask CA answer is a warmer signal than the nav.
     */
    source: text('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    byUser: index('paywall_intents_user_idx').on(table.userId, table.createdAt),
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
    // Nullable: onboarding lets an owner skip the VIN.
    vin: text('vin'),
    mileage: integer('mileage').notNull(),
    /**
     * The date the reading in `mileage` was TAKEN -- not the date the row was written.
     *
     * Without this the app could not tell a reading typed this week from one typed two years
     * ago, and three things downstream read `mileage` as though it were current: the
     * maintenance due calculation (a stale figure says a job is fine when it is overdue), the
     * price sent to MarketCheck, and My Car's masthead. "Is this stale?" was simply not a
     * question the schema could answer.
     *
     * "Taken", not "written", is the whole point and it is why services/odometer.ts stamps the
     * SERVICE DATE here rather than `now()`. Logging a 2019 service at 90,000 miles raises the
     * car's mileage -- the ratchet is right, the car has covered at least that -- but what we
     * hold is a six-year-old reading, and recording today's date would claim a freshness we do
     * not have. That would suppress exactly the prompt this column exists to raise.
     *
     * Nullable only so the column could be added; migration 0021 backfills every existing row
     * from `created_at`, which is the honest answer for rows written before this existed --
     * their mileage came from onboarding. Treat null as "unknown, therefore stale".
     */
    mileageUpdatedAt: timestamp('mileage_updated_at', { withTimezone: true }),
    /**
     * Nullable: MarketCheck prices regionally, and onboarding lets an owner skip it just like
     * the VIN. No zip, no valuation call -- see services/marketValueSync.ts.
     */
    zip: text('zip'),
    // Nullable: populated by a valuation source, absent for a freshly added car.
    estMarketValue: integer('est_market_value'),
    tradeInLow: integer('trade_in_low'),
    tradeInHigh: integer('trade_in_high'),
    /**
     * When this car's value was last fetched, or null for never. Unlike the schedule marker
     * below, this is NOT "once ever" -- a price goes stale and mileage climbs, so
     * services/marketValueSync.ts revisits it on a monthly cadence. Set on a successful call
     * only, so an outage is retried next visit rather than remembered as a verdict.
     */
    marketValueCheckedAt: timestamp('market_value_checked_at', { withTimezone: true }),
    /**
     * When the manufacturer's service schedule was fetched for THIS car, or null for never.
     * Set on a conclusive answer only -- real intervals, or the vendor saying it has none --
     * so a timeout is retried rather than remembered as a verdict.
     *
     * A column rather than something inferred from `maintenance_items`, because the seed also
     * writes intervals and the rows cannot say which of them came from the manufacturer. See
     * services/maintenanceScheduleSync.ts.
     */
    maintenanceScheduleCheckedAt: timestamp('maintenance_schedule_checked_at', {
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    byUser: index('vehicles_user_idx').on(table.userId),
    // Scoped to the user, though a VIN is globally unique, so the index cannot leak
    // whether another account registered the same car. Postgres treats NULLs as
    // distinct, so skipping the VIN never trips it.
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
 * Deliberately no stored status: whether something is due is arithmetic on the
 * interval, the last service and today's odometer, so it is computed on read (see
 * services/maintenanceDue.ts). Nothing would keep a stored value true.
 *
 * Intervals are owner-supplied. The manufacturer's official schedule is licensed data;
 * buying it fills in these same two columns and nothing else changes.
 */
export const maintenanceItems = pgTable(
  'maintenance_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    /** Either, both, or neither. With both, whichever falls first wins. */
    intervalMiles: integer('interval_miles'),
    intervalMonths: integer('interval_months'),
    position: integer('position').notNull().default(0),
  },
  (table) => ({
    byVehicle: index('maintenance_items_vehicle_idx').on(table.vehicleId, table.position),
  }),
);

/**
 * What the owner says about a recall on *their* car. NHTSA's feed is per-model, so it
 * can say a campaign affects this model but never whether this car was repaired.
 *
 * Keyed by NHTSA's campaign number rather than a `model_recalls.id`, because those rows
 * are mirrored data a resync can replace. A missing row means "unknown", distinct from
 * the owner having told us it is outstanding.
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
 * Safety recalls, mirrored from NHTSA. Model-scoped like known issues, so a sync costs
 * one upstream request per model rather than one per user. `campaignNumber` is NHTSA's
 * own identifier, so a re-sync updates rows in place instead of duplicating them.
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
 * A local mirror of NHTSA's ENTIRE recall catalog, loaded from their bulk flat files by
 * scripts/importNhtsaRecalls.mts. Distinct from `modelRecalls` above, and not a
 * replacement for it: `modelRecalls` stays the per-model working set the app reads, and
 * this is the source it falls back to when api.nhtsa.gov cannot be reached.
 *
 * WHY IT EXISTS: the live API is the only thing standing between an owner and "could not
 * reach the NHTSA recall database". It is also entirely avoidable -- NHTSA publishes the
 * same data as a file, refreshed daily. A mirror turns a per-page-load dependency on a
 * third party into a question about whether last night's job ran.
 *
 * WHY TWO TABLES: one campaign covers many models, and its summary/consequence/remedy run
 * to paragraphs. Denormalised, the catalog is 268MB, because the same prose is repeated for
 * every model it names -- 169,240 model rows share 26,482 campaigns, so about sixfold on
 * average. Split this way it is 28MB.
 *
 * WHOLLY DERIVED. Nothing here is user data and nothing else references it, so the import
 * replaces both tables outright. That also makes it the one place in this schema where a
 * delete-everything write is correct -- see the guards in the importer, which refuse to
 * replace a good mirror with a short download.
 */
export const nhtsaRecallCampaigns = pgTable('nhtsa_recall_campaigns', {
  /** NHTSA's own campaign identifier, e.g. `20V314000`. One row per campaign. */
  campaignNumber: text('campaign_number').primaryKey(),
  summary: text('summary').notNull(),
  consequence: text('consequence').notNull(),
  remedy: text('remedy').notNull(),
});

/**
 * Which models each campaign covers. NHTSA files one row per year/make/model/campaign,
 * which is exactly the key the app already syncs on.
 */
export const nhtsaRecallModels = pgTable(
  'nhtsa_recall_models',
  {
    year: integer('year').notNull(),
    make: text('make').notNull(),
    model: text('model').notNull(),
    campaignNumber: text('campaign_number').notNull(),
    component: text('component').notNull(),
    parkIt: boolean('park_it').notNull().default(false),
    parkOutside: boolean('park_outside').notNull().default(false),
    /** Null when the file carried an unparseable date; the recall still stands. */
    reportedOn: date('reported_on'),
  },
  (table) => ({
    // The lookup the fallback makes. Covering, so answering a model costs one index scan.
    byModel: index('nhtsa_recall_models_model_idx').on(table.year, table.make, table.model),
    campaignPerModel: uniqueIndex('nhtsa_recall_models_campaign_unique').on(
      table.year,
      table.make,
      table.model,
      table.campaignNumber,
    ),
  }),
);

/**
 * Owner complaints filed with NHTSA, aggregated at sync time by component -- one row is
 * one component for one model.
 *
 * These are *unverified owner reports*, not findings; recalls are the official
 * counterpart. Every count is kept rather than collapsed into a severity, because "12
 * owners reported this, 2 involved a crash" says more than a badge.
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
     * Mileage at failure, from NHTSA's bulk complaint file. The JSON API omits mileage,
     * so these are filled by a separate ingest (scripts/ingestComplaintMileage.mts) and
     * stay null until it has run for this model.
     *
     * Counted separately from `reportCount` because only about two thirds of complaints
     * report an odometer reading. Low and high are the 25th and 75th percentiles, not
     * the extremes.
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
 * A few representative complaints behind each component group. The counts say how often
 * a system is reported; these say what owners actually describe, which is worth more to
 * someone deciding whether to see a mechanic. NHTSA returns the prose alongside the
 * counts. An ordered short list read with its parent, never queried on its own.
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
 * When each model was last checked against each upstream NHTSA feed. Separate from the
 * mirrored rows because "nothing found" and "never checked" are different facts: a row
 * with `succeededAt` and no matching rows is a genuine all-clear, no row at all means
 * nobody has looked. One table serves every feed -- see services/modelFeed.ts.
 */
export const modelFeedSyncs = pgTable(
  'model_feed_syncs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * 'recalls' | 'complaints' | 'repair_pricing'. Text rather than an enum so adding a feed
     * needs no migration. The freshness window is per feed; see services/modelFeed.ts.
     */
    feed: text('feed').notNull(),
    year: integer('year').notNull(),
    make: text('make').notNull(),
    model: text('model').notNull(),
    /** Last attempt of any kind. Drives the retry cooldown after a failure. */
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Last attempt that actually reached the vendor -- NHTSA for recalls and complaints,
     * Vehicle Databases for pricing. Null means never. Separate from `checkedAt` so a failed
     * refresh cannot retract data we already earned, and so the retry backoff can tell a
     * vendor that blipped from one that has never answered.
     */
    succeededAt: timestamp('succeeded_at', { withTimezone: true }),
    /**
     * How the last successful check ended, when that needs saying: `model_not_listed` means
     * the vendor answered but files nothing under this model name. Null is an ordinary
     * answer, including a genuine empty one, and is what every pre-existing row holds.
     *
     * It rides on `succeededAt` deliberately. An unlisted name IS an answer -- it will not
     * start existing next week -- so it earns the full freshness window rather than the retry
     * ladder. What it must never do is read as an all-clear, which is why the distinction is
     * stored rather than inferred from an empty list. See shared RecallCheckStatus.
     */
    outcome: text('outcome'),
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
 * Benchmark pricing per repair AND per model -- the data the whole product rests on.
 *
 * `year`/`make`/`model` are part of the key, not decoration: an alternator for a Civic
 * and one for an F-150 are different jobs at different prices, so "is my quote fair" is
 * unanswerable without knowing whose car it is. Filled per model from Vehicle Databases
 * (services/repairPricingSync.ts). A car with no row here is shown no pricing -- another
 * model's figures are never substituted, however clearly they are labelled.
 *
 * Labor rate and hours are both nullable, for different reasons now. `laborEstHours` is
 * filled from Open Labor Project where it knows the job (services/laborTimes.ts), and null
 * where it does not. `laborRatePerHour` stays null everywhere: neither vendor publishes a
 * shop rate, and VDB's labor dollars do not divide back into book time at any credible
 * rate, so a quotient of the two must not be stored as one (see services/repairPricing.ts).
 */
export const repairBenchmarks = pgTable(
  'repair_benchmarks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repairId: uuid('repair_id')
      .notNull()
      .references(() => repairs.id, { onDelete: 'cascade' }),
    /** The model these figures price. Uppercase, per services/modelFeed.ts. */
    year: integer('year').notNull(),
    make: text('make').notNull(),
    model: text('model').notNull(),
    partsTotal: integer('parts_total').notNull(),
    partsLow: integer('parts_low').notNull(),
    partsHigh: integer('parts_high').notNull(),
    /** Null unless a source published a shop rate. None does. See the header. */
    laborRatePerHour: integer('labor_rate_per_hour'),
    /** Null where the hours vendor does not know the job. See the header. */
    laborEstHours: numeric('labor_est_hours', { precision: 4, scale: 2 }),
    laborTotal: integer('labor_total').notNull(),
    fairTotalLow: integer('fair_total_low').notNull(),
    fairTotalHigh: integer('fair_total_high').notNull(),
    recommendationHeadline: text('recommendation_headline').notNull(),
    recommendationBadge: text('recommendation_badge').notNull(),
    recommendationBody: text('recommendation_body').notNull(),
    /**
     * Where the figures came from, e.g. "Vehicle Databases (independent + dealer)".
     * Stored per row so a benchmark can say whether it is sourced or a stand-in.
     */
    source: text('source').notNull(),
  },
  (table) => ({
    repairPerModel: uniqueIndex('repair_benchmarks_repair_model_unique').on(
      table.repairId,
      table.year,
      table.make,
      table.model,
    ),
    byModel: index('repair_benchmarks_model_idx').on(table.year, table.make, table.model),
  }),
);

/**
 * Parts line items for a benchmark. Usually exactly one row -- VDB gives an aggregate
 * parts figure per repair and no itemisation.
 */
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
    /** Null when the source priced the task without publishing its duration. */
    hours: numeric('hours', { precision: 4, scale: 2 }),
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
     * Odometer reading when the work was done. Nullable because older records have none
     * and someone logging an old receipt may not know -- but without it no interval can
     * be measured, which is why the form asks for it.
     */
    mileageAtService: integer('mileage_at_service'),
    /**
     * The upkeep job this satisfies, when it satisfies one. Set explicitly rather than
     * matched on the description: guessing that "oil and filter" means the oil-change
     * item is wrong just often enough to matter.
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
 * An assessment SNAPSHOTS the benchmark it was built from. Benchmark pricing changes as
 * reference data is refreshed, but a saved assessment must keep showing the numbers the
 * user was shown, so every figure is copied onto it and its children at creation time
 * rather than joined live from repairBenchmarks.
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

    /** Nullable for the same reason as on repairBenchmarks: usually unpublished. */
    laborRatePerHour: integer('labor_rate_per_hour'),
    laborEstHours: numeric('labor_est_hours', { precision: 4, scale: 2 }),
    laborTotal: integer('labor_total').notNull(),

    fairTotalLow: integer('fair_total_low').notNull(),
    fairTotalHigh: integer('fair_total_high').notNull(),

    /**
     * Which model's pricing this was judged against, e.g. "2019 HONDA CIVIC", and where
     * it came from. Snapshotted so an assessment built on the reference fallback rather
     * than the owner's own car can say so after the fact.
     */
    benchmarkSource: text('benchmark_source').notNull().default('unknown'),

    /** All five quote columns are null together, or all non-null together. */
    quoteAmount: integer('quote_amount'),
    quoteParts: integer('quote_parts'),
    quoteLabor: integer('quote_labor'),
    quoteVerdict: quoteVerdictEnum('quote_verdict'),
    quoteExplanation: text('quote_explanation'),
    /** Display only -- the PDF is not parsed. */
    quoteFileName: text('quote_file_name'),

    /**
     * Independent of the verdict: the wireframes show an assessment badged ASSESSED
     * that is also marked complete.
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
    /** Null when the source priced the task without publishing its duration. */
    hours: numeric('hours', { precision: 4, scale: 2 }),
    position: integer('position').notNull(),
  },
  (table) => ({
    byAssessment: index('assessment_labor_tasks_assessment_idx').on(table.assessmentId, table.position),
  }),
);

/* ---------------------------------------------------------------- ask ca qa */

/**
 * Every Ask CA exchange, kept so the answers can be reviewed. One row is one question and
 * the answer that went back to the owner.
 *
 * THIS IS NOT CONVERSATION HISTORY, and the distinction is the only reason it is safe to add
 * after `chat_messages` was dropped in migration 0010. That table WAS the history the screen
 * rendered, kept alive by a delete-on-exit that a closed tab or a crash skipped -- so every
 * miss resurfaced as turns the owner thought they had left behind. Nothing reads these rows
 * back: there is no GET, no mapper turns one into a `ChatMessage`, and the live turns still
 * live in the client and still arrive with the next question (routes/chat.ts). The worst a
 * stale row here can do is sit in a review queue.
 *
 * Append-only. A re-asked question is a second row, because what changed between two attempts
 * is the interesting part. Failures are recorded too -- an answer that never came is the most
 * important thing QA can see, and `outcome` is what makes that queryable.
 *
 * PERSONAL DATA. Owners describe their cars, their money and sometimes themselves. Rows
 * cascade with the user so a deleted account takes its transcripts with it, and they want a
 * retention window rather than living forever -- see services/askTranscripts.ts.
 */
export const askTranscripts = pgTable(
  'ask_transcripts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The car the question was grounded against. Every Ask CA request has one. */
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    question: text('question').notNull(),
    /**
     * The answer as the owner saw it -- the validated reply on success, and the actual
     * sentence shown on a failure or a refusal, not a code. Reviewing what was displayed is
     * the point.
     *
     * Null only when the exchange was abandoned: the owner closed the tab before any
     * validated answer existed, so there is nothing to have shown them.
     */
    answer: text('answer'),
    /**
     * How the exchange ended: 'answered', 'canned' (no API key -- a dev run, not a finding),
     * 'declined' (safety filter), 'timed_out', 'failed', 'abandoned'. Text rather than an enum
     * so a newly distinguished failure mode needs no migration, matching `model_feed_syncs.feed`.
     */
    outcome: text('outcome').notNull(),
    /** The urgency badge on the answer, when it carried one. Null together. */
    urgencyLevel: severityEnum('urgency_level'),
    urgencyText: text('urgency_text'),
    /**
     * The label of the "start an assessment" button, when the answer offered one. Kept because
     * an answer that pushes toward the paid flow is one worth reading closely.
     */
    ctaLabel: text('cta_label'),
    /**
     * How many prior messages went up with this question. A bad answer on turn one and a bad
     * answer on turn nine are different bugs, and the count is the cheapest way to tell them
     * apart after the fact.
     */
    historyMessages: integer('history_messages').notNull(),
    /** Which model answered, e.g. 'claude-sonnet-5'. Null for a canned reply. */
    model: text('model'),
    /**
     * What the call cost and how long it took. Null where no call happened -- canned replies,
     * and failures that never reached the model. Previously console.log only, which meant a
     * slow answer could not be found again after the fact.
     */
    latencyMs: integer('latency_ms'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cacheReadTokens: integer('cache_read_tokens'),
    cacheWriteTokens: integer('cache_write_tokens'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Newest first is how a review queue is read.
    byCreated: index('ask_transcripts_created_idx').on(table.createdAt),
    // "Every answer that failed last week", the query QA actually runs.
    byOutcome: index('ask_transcripts_outcome_idx').on(table.outcome, table.createdAt),
    byUser: index('ask_transcripts_user_idx').on(table.userId, table.createdAt),
  }),
);

/**
 * The "Based on" lines shown under one answer -- which blocks of the facts the model said it
 * leaned on.
 *
 * Recorded because it is the difference between an answer that was right and one that was
 * right by luck: a confident reply citing nothing, or citing recalls when the question was
 * about upkeep, is visible here and nowhere else.
 */
export const askTranscriptSources = pgTable(
  'ask_transcript_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transcriptId: uuid('transcript_id')
      .notNull()
      .references(() => askTranscripts.id, { onDelete: 'cascade' }),
    /** A `ChatSourceKind`: 'vehicle' | 'recalls' | 'owner_reports' | 'upkeep' | 'service_history'. */
    kind: text('kind').notNull(),
    /** The line as displayed, e.g. "125 owner reports for this model". */
    label: text('label').notNull(),
    position: integer('position').notNull(),
  },
  (table) => ({
    byTranscript: index('ask_transcript_sources_transcript_idx').on(table.transcriptId, table.position),
  }),
);

/* -------------------------------------------------------------- relations */

export const usersRelations = relations(users, ({ many }) => ({
  vehicles: many(vehicles),
  serviceRecords: many(serviceRecords),
  assessments: many(assessments),
  askTranscripts: many(askTranscripts),
}));

export const askTranscriptsRelations = relations(askTranscripts, ({ one, many }) => ({
  owner: one(users, { fields: [askTranscripts.userId], references: [users.id] }),
  vehicle: one(vehicles, { fields: [askTranscripts.vehicleId], references: [vehicles.id] }),
  sources: many(askTranscriptSources),
}));

export const askTranscriptSourcesRelations = relations(askTranscriptSources, ({ one }) => ({
  transcript: one(askTranscripts, {
    fields: [askTranscriptSources.transcriptId],
    references: [askTranscripts.id],
  }),
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

