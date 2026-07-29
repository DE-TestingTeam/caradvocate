import { z } from 'zod';

/**
 * Fail fast on bad configuration rather than at the first query.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  /**
   * Leave unset to develop with no database installed: the API falls back to
   * file-backed PGlite (see db/index.ts). Set it to switch to real Postgres.
   */
  DATABASE_URL: z.string().min(1).optional(),
  /** Where the PGlite dev database lives, relative to the repo root. */
  PGLITE_DATA_DIR: z.string().default('.pgdata'),
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

  /**
   * DEV ONLY. When Supabase is not configured, every request is attributed to
   * this user so the app is usable without signing in.
   * See src/auth/resolvers.ts.
   */
  DEV_USER_EMAIL: z.string().email().default('alex.rivera@email.com'),
});

export const env = envSchema.parse(process.env);

export type Env = z.infer<typeof envSchema>;
