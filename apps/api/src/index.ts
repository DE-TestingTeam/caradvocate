import { createApp } from './app.js';
import { assertProductionSafe, authMode } from './auth/config.js';
import { askIsConfigured } from './services/askClaude.js';
import { carImagesIsConfigured } from './services/carImages.js';
import { describePrice } from './services/paywall.js';
import { assertSchemaPresent, closeDb, describeTarget, getDb } from './db/index.js';
import { env } from './env.js';

// Fails fast rather than serving one user's data to every caller.
assertProductionSafe();

let db;
try {
  db = getDb();
} catch (error) {
  // Overwhelmingly a missing DATABASE_URL, which has a one-line fix.
  console.error(`Refusing to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

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

  if (carImagesIsConfigured()) {
    console.log('Vehicle photo: CarImages (signed URLs minted server-side)');
  } else {
    console.log('Vehicle photo: static placeholder -- no CarImages call');
    console.log('  Set CARIMAGES_API_KEY to show a photo of the model.');
  }

  // Logged every boot rather than only when it is unset: this is the number the
  // prototype's whole result is denominated in, and shipping the placeholder by
  // accident would invalidate the test rather than break anything visibly.
  console.log(`Paywall: ${describePrice()} -- nobody is charged, taps are recorded`);
  console.log('  Set PAYWALL_PRICE_CENTS and PAYWALL_INTERVAL to price the test.');
});

/**
 * Close the pool before exiting.
 *
 * Node's default handling of SIGTERM exits immediately without running any cleanup,
 * which leaves the pool's connections to be reaped by the server rather than
 * returned. On a pooled Supabase project those slots are a limited resource, and a
 * restart loop that abandons them can exhaust the project's connection limit.
 * `kill`, `pkill`, Docker and most process managers all send SIGTERM; Ctrl-C
 * (SIGINT) is the same story.
 *
 * This used to matter far more: the dev database ran inside this process, so a
 * SIGTERM mid-write could corrupt it beyond recovery. That is gone with the PGlite
 * fallback, and what remains is ordinary good behaviour toward the pooler.
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
