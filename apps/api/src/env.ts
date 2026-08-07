import { z } from 'zod';

// Fail fast on bad configuration rather than at the first query.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  /**
   * On Supabase, the pooled "Transaction pooler" string. Optional here so that a missing
   * one surfaces as `getDb()`'s "Refusing to start" message, which names the fix, rather
   * than as a raw schema error at import time.
   */
  DATABASE_URL: z.string().min(1).optional(),
  /** Direct (non-pooled) connection, migrations only. Unset for local Postgres. */
  DIRECT_DATABASE_URL: z.string().optional(),
  /** Escape hatch mirroring libpq's PGSSLMODE, if the automatic choice is wrong. */
  PGSSLMODE: z.enum(['require', 'disable', 'prefer']).optional(),

  /**
   * Supabase Auth. Sign-in is mandatory, so the API refuses to boot with none of these set.
   * SUPABASE_URL is enough on its own -- the JWKS endpoint is derived from it.
   *
   * Optional in the schema because either one satisfies the requirement, so neither can be
   * required on its own. auth/config.ts is where the real check lives.
   */
  SUPABASE_URL: z.string().url().optional(),
  /** Public key, safe to hand to the browser. Served via GET /api/auth/config. */
  SUPABASE_ANON_KEY: z.string().optional(),
  /** Overrides the JWKS URL derived from SUPABASE_URL. */
  SUPABASE_JWKS_URL: z.string().url().optional(),
  /** Legacy shared-secret projects (HS256). Prefer JWKS where available. */
  SUPABASE_JWT_SECRET: z.string().min(16).optional(),

  /** Set and Ask CA answers with Claude; unset falls back to canned replies. */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  /** Set and My Car shows a studio photo of the owner's model; unset, a placeholder. */
  CARIMAGES_API_KEY: z.string().min(1).optional(),
  /**
   * Only needed once a domain allowlist is set on the key. An allowlist is checked
   * against Origin/Referer, which a server-side call does not send, so those calls
   * would fail 403; the secret proves key ownership and skips the check.
   */
  CARIMAGES_API_SECRET: z.string().min(1).optional(),

  /**
   * Real parts and labor pricing for the Repair Cost Checker.
   *
   * NOTHING FALLS BACK. Unset, the only priced model is the one the seed writes reference
   * figures for (a 2019 Civic), and every other car shows its whole catalog with each
   * repair marked unpriced. The reference figures are stored against that model alone and
   * are deliberately not a stand-in -- see services/repairPricingSync.ts.
   *
   * The plan carries a finite monthly call allowance and answers 403 once spent.
   * That degrades pricing rather than breaking it (see services/vehicleDatabases.ts),
   * and is logged, because a spent quota otherwise looks like an unpriced catalog.
   */
  VEHICLEDATABASES_API_KEY: z.string().min(1).optional(),

  /**
   * Labor hours for the Repair Cost Checker, which VEHICLEDATABASES_API_KEY's feed does
   * not publish. Unset, benchmarks carry pricing with no book time, exactly as before --
   * `laborEstHours` stays null and the labor line shows dollars only.
   *
   * The free tier allows 10 calls per DAY and answers 429 once spent, which caps how many
   * models can be primed in a day. That degrades hours rather than pricing (see
   * services/openLaborProject.ts), and is logged.
   *
   * The vendor labels its figures "estimated", not licensed book times. They are display
   * only; the fair-price verdict stays on dollars. See services/laborTimes.ts.
   */
  OPEN_LABOR_PROJECT_API_KEY: z.string().min(1).optional(),

  /**
   * Market value and trade-in range for My Car's valuation card. Unset, a freshly added car
   * stays "not available" forever -- see services/marketValueSync.ts.
   *
   * Priced from real dealer listings via MarketCheck's base-tier prediction endpoint, which
   * requires a VIN, mileage and zip per call. A car missing either is never asked about; see
   * `zip` and `vin` on the vehicles table.
   */
  MARKET_CHECK_API_KEY: z.string().min(1).optional(),

  /**
   * The two prices the fake paywall shows side by side. Nobody is charged -- the tap is
   * recorded as a willingness-to-pay signal and the feature opens either way. See
   * services/paywall.ts.
   *
   * Configuration rather than constants because price is the experiment's independent
   * variable: changeable between cohorts without a deploy, and each recorded tap stores
   * the figures that were on screen at the time.
   *
   * THE DEFAULTS ARE PLACEHOLDERS. Set them deliberately before any real test.
   */
  PAYWALL_ALL_YOU_CAN_EAT_PRICE_CENTS: z.coerce.number().int().positive().default(9900),
  PAYWALL_ALL_YOU_CAN_EAT_INTERVAL: z.enum(['month', 'year']).default('year'),
  /** The subscription half of the per-incident offer -- cheaper, because the parts benchmark is billed separately below. */
  PAYWALL_PER_INCIDENT_PRICE_CENTS: z.coerce.number().int().positive().default(3500),
  PAYWALL_PER_INCIDENT_INTERVAL: z.enum(['month', 'year']).default('year'),
  /** What the per-incident offer charges per parts-benchmark lookup, on top of its subscription. Not metered yet -- see services/paywall.ts. */
  PAYWALL_PER_INCIDENT_FEE_CENTS: z.coerce.number().int().positive().default(5000),
});

/**
 * An empty variable means unset.
 *
 * `FOO=` in a `.env`, or `FOO= npm start`, is how people turn a feature off, and it is what a
 * templated `.env` leaves behind for a key nobody filled in. Without this it reaches a
 * `.min(1).optional()` and fails validation, so the API refuses to boot with "String must
 * contain at least 1 character" -- for a variable the README describes as optional, whose
 * documented behaviour when absent is to fall back gracefully. Dropping the key instead makes
 * the documented behaviour the actual behaviour.
 *
 * Required variables are unaffected: dropping an empty DATABASE_URL still fails, and still says
 * it is missing, which is the right error.
 */
function withoutBlanks(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
}

export const env = envSchema.parse(withoutBlanks(process.env));

export type Env = z.infer<typeof envSchema>;
