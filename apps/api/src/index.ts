import { createApp } from './app.js';
import { assertProductionSafe, authMode } from './auth/config.js';
import { askIsConfigured } from './services/askClaude.js';
import { activeDriver, assertSchemaPresent, closeDb, describeTarget, getDb } from './db/index.js';
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

const server = app.listen(env.PORT, () => {
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

  if (askIsConfigured()) {
    console.log('Ask CA: Claude (answers grounded in the owner\'s own car)');
  } else {
    console.log('Ask CA: canned replies -- no model call');
    console.log('  Set ANTHROPIC_API_KEY to answer with Claude.');
  }
});

/**
 * Close the database before exiting.
 *
 * This is not housekeeping. Node's default handling of SIGTERM exits immediately
 * without running any cleanup, and PGlite is an in-process Postgres: killed
 * mid-write, its data directory is left in a state it cannot reopen, and the
 * database is gone. `kill`, `pkill`, Docker and most process managers all send
 * SIGTERM, so without this the ordinary way of stopping the server is also a way
 * of destroying the dev database. Ctrl-C (SIGINT) is the same story.
 *
 * Real Postgres survives a hard kill; PGlite does not, and PGlite is the default.
 */
let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received, closing the database before exit.`);

  // Stop accepting connections, but do not wait on in-flight ones: a held-open
  // keep-alive socket must not stand between us and a clean database close.
  server.close();

  // Backstop, so a hung close cannot leave the process running forever. Unref'd
  // so it never keeps the process alive on its own.
  const force = setTimeout(() => {
    console.error('Database did not close in time; exiting anyway.');
    process.exit(1);
  }, 5000);
  force.unref();

  try {
    await closeDb();
  } catch (error) {
    console.error(`Error closing the database: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  clearTimeout(force);
  process.exit(0);
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => void shutdown(signal));
}
