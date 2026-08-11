import { createApp } from './app.js';
import { assertAuthConfigured } from './auth/config.js';
import { askIsConfigured } from './services/askClaude.js';
import { carImagesIsConfigured } from './services/carImages.js';
import { describePrice } from './services/paywall.js';
import { feedHealth } from './services/modelFeed.js';
import { assertSchemaPresent, closeDb, describeTarget, getDb, type Database } from './db/index.js';
import { env } from './env.js';

// Sign-in is required, so an API that cannot verify a token can serve nobody.
try {
  assertAuthConfigured();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

let db: Database;
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

  // Logged every boot, not only when overridden: these are the numbers the prototype's result
  // is denominated in, so a wrong one has to be visible at a glance rather than discovered in
  // the data afterwards. The second line is a note about what CAN be changed, not a warning
  // that something is unset -- the defaults in env.ts are the chosen prices.
  console.log(`Paywall: ${describePrice()} -- nobody is charged, taps are recorded`);
  console.log('  Override PAYWALL_ALL_YOU_CAN_EAT_* / PAYWALL_PER_INCIDENT_* to run a different cohort.');

  // Last, and awaited after the server is already listening: a slow database must delay a line
  // of orientation, never the port opening. See feedHealth for why this is printed at all.
  void reportFeedHealth();
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


/**
 * The outside feeds, on one line each. Failures first, because a feed answering nothing is the
 * only thing here anyone needs to act on -- see feedHealth in services/modelFeed.ts.
 *
 * Swallows its own errors. This is a courtesy line; a database that will not answer it has
 * bigger problems, all of which surface elsewhere, and none of which are worth a crashed boot.
 */
async function reportFeedHealth(): Promise<void> {
  try {
    const feeds = await feedHealth(db);
    if (feeds.length === 0) return;

    const failing = feeds.filter((feed) => feed.failed > 0);
    console.log(
      `Outside feeds: ${feeds.map((f) => `${f.feed} ${f.ok} ok/${f.failed} failed`).join(', ')}`,
    );
    if (failing.length > 0) {
      console.log(
        `  ${failing.map((f) => f.feed).join(' and ')} did not answer for some models. ` +
          'A spent call allowance answers 403 to everything -- check the vendor dashboard.',
      );
    }
  } catch {
    // Deliberately silent; see the header.
  }
}
