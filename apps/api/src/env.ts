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
  /**
   * TEMPORARY. Until real sessions land, every request is attributed to this
   * user. See src/middleware/currentUser.ts.
   */
  DEV_USER_EMAIL: z.string().email().default('alex.rivera@email.com'),
});

export const env = envSchema.parse(process.env);

export type Env = z.infer<typeof envSchema>;
