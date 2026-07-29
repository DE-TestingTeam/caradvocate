import { createApp } from './app.js';
import { assertProductionSafe, authMode } from './auth/config.js';
import { activeDriver, assertSchemaPresent, describeTarget, getDb } from './db/index.js';
import { env } from './env.js';

// Fails fast rather than serving one user's data to every caller.
assertProductionSafe();

const db = getDb();

// A database with no tables would otherwise start cleanly and fail on the first
// request with an error that points nowhere useful.
try {
  await assertSchemaPresent(db);
} catch (error) {
  console.error(`Refusing to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const app = createApp(db);

app.listen(env.PORT, () => {
  console.log(`CarAdvocate API listening on http://localhost:${env.PORT}`);
  console.log(`Database: ${describeTarget()}`);

  if (activeDriver() === 'pglite') {
    console.log('  (no DATABASE_URL set, so using the local PGlite dev database)');
  }

  if (authMode() === 'supabase') {
    console.log('Auth: Supabase (bearer token required on every request)');
  } else {
    console.log(`Auth: DEV MODE -- every request acts as ${env.DEV_USER_EMAIL}`);
    console.log('  Set SUPABASE_URL and SUPABASE_ANON_KEY to require real sign-in.');
  }
});
