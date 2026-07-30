import { z } from 'zod';

/**
 * Fail fast on bad configuration rather than at the first query.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  /**
   * Required to run the API or the migration and seed scripts. On Supabase this is
   * the pooled "Transaction pooler" string; see DIRECT_DATABASE_URL below.
   *
   * Optional here rather than required because the test suites import this module
   * while supplying their own in-memory database, and must not be able to reach a
   * real one. `getDb()` is where the requirement is enforced.
   */
  DATABASE_URL: z.string().min(1).optional(),
  /**
   * Direct (non-pooled) connection, used only for migrations. On Supabase this
   * is the "Direct connection" string; leave unset for local Postgres, where it
   * is the same as DATABASE_URL.
   */
  DIRECT_DATABASE_URL: z.string().optional(),
  /** Escape hatch mirroring libpq's PGSSLMODE, if the automatic choice is wrong. */
  PGSSLMODE: z.enum(['require', 'disable', 'prefer']).optional(),
  /* ------------------------------------------------------ Supabase Auth ----
   * Set these to require real sign-in. With none of them set, the API falls
   * back to the dev stub below so local development needs no configuration.
   *
   * SUPABASE_URL is enough on its own: the JWKS endpoint is derived from it.
   * SUPABASE_JWT_SECRET covers older projects that sign with a shared secret.
   */
  SUPABASE_URL: z.string().url().optional(),
  /** Public key, safe to hand to the browser. Served via GET /api/auth/config. */
  SUPABASE_ANON_KEY: z.string().optional(),
  /** Overrides the JWKS URL derived from SUPABASE_URL, if you need to. */
  SUPABASE_JWKS_URL: z.string().url().optional(),
  /** Legacy shared-secret projects (HS256). Prefer JWKS where available. */
  SUPABASE_JWT_SECRET: z.string().min(16).optional(),

  /* -------------------------------------------------------------- Ask CA ----
   * Set this and Ask CA answers with Claude, grounded in the owner's own car.
   * With it unset, Ask CA falls back to canned replies -- the same
   * configuration-decides-the-mode shape as the auth dev bypass above, so a
   * fresh clone still runs with nothing to configure.
   */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  /* ----------------------------------------------------------- CarImages ----
   * The studio photo of the owner's model on My Car. The key alone turns it
   * on; with it unset, My Car shows a placeholder -- the same
   * configuration-decides-the-mode shape as Ask CA above. Both values stay on
   * this side either way, so the browser only ever sees an expiring signed URL.
   */
  CARIMAGES_API_KEY: z.string().min(1).optional(),
  /**
   * Optional, and only needed once a domain allowlist is set on the key in the
   * CarImages dashboard. An allowlist is checked against Origin/Referer, which
   * a server-side call does not send, so those calls would start failing 403;
   * the secret proves key ownership and skips the check. Set it if you lock the
   * key down. See services/carImages.ts.
   */
  CARIMAGES_API_SECRET: z.string().min(1).optional(),

  /**
   * DEV ONLY. When Supabase is not configured, every request is attributed to
   * this user so the app is usable without signing in.
   * See src/auth/resolvers.ts.
   */
  DEV_USER_EMAIL: z.string().email().default('alex.rivera@email.com'),
});

export const env = envSchema.parse(process.env);

export type Env = z.infer<typeof envSchema>;
