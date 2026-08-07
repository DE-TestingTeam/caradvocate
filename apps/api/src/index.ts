import { createApp } from './app.js';
import { assertAuthConfigured } from './auth/config.js';
import { askIsConfigured } from './services/askClaude.js';
import { carImagesIsConfigured } from './services/carImages.js';
import { describePrice } from './services/paywall.js';
import { assertSchemaPresent, closeDb, describeTarget, getDb } from './db/index.js';
import { env } from './env.js';

// Sign-in is required, so an API that cannot verify a token can serve nobody.
try {
  assertAuthConfigured();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

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

  console.log('Auth: Supabase (bearer token required on every request)');

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

  // Logged every boot, not only when unset: this is the number the prototype's result is
  // denominated in, and shipping the placeholder by accident would invalidate the test
  // rather than break anything visibly.
  console.log(`Paywall: ${describePrice()} -- nobody is charged, taps are recorded`);
  console.log('  Set the PAYWALL_ALL_YOU_CAN_EAT_* and PAYWALL_PER_INCIDENT_* vars to price the test.');
});

/**
 * Close the pool before exiting. Node's default SIGTERM handling exits immediately without
 * cleanup, leaving the pool's connections to be reaped rather than returned -- and on a pooled
 * Supabase project those slots are limited, so a restart loop that abandons them can exhaust
 * the project's connection limit.
 */
let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received, closing the database before exit.`);

  // Stop accepting connections without waiting on in-flight ones: a held-open keep-alive
  // socket must not stand between us and a clean database close.
  server.close();

  // Backstop, so a hung close cannot leave the process running forever. Unref'd so it never
  // keeps the process alive on its own.
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
