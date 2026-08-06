import { defineConfig } from 'drizzle-kit';

/**
 * `drizzle-kit generate` never connects, so the credentials below matter only for studio, push
 * and introspect. Migrations are applied by `npm run db:migrate` (src/db/migrate.ts) rather
 * than drizzle-kit, so they go through the direct connection with the app's TLS handling.
 */
const LOCAL_FALLBACK = 'postgresql://caradvocate:caradvocate@localhost:5432/caradvocate';
const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? LOCAL_FALLBACK;

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url,
    // Hosted Postgres requires TLS; local does not. Matches src/db/connection.ts.
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
  },
  strict: true,
  verbose: true,
});
