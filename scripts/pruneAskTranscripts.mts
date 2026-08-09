/**
 * Deletes Ask CA transcripts past their retention window.
 *
 *   npm run prune:transcripts                 # delete everything past the window
 *   npm run prune:transcripts -- --dry-run    # report what would go, delete nothing
 *
 * WHY: `ask_transcripts` is the most sensitive table in the schema -- it holds what owners typed
 * about their cars, their money and sometimes themselves -- and until this existed it kept all of
 * it forever. "Forever" is not a decision anyone made; it is what you get when nobody sets a
 * window. Ninety days is the window, and it lives in one place,
 * `ASK_TRANSCRIPT_RETENTION_DAYS` in apps/api/src/env.ts, with the reasoning beside it.
 *
 * WHAT IT TOUCHES: `ask_transcripts` and, by cascade, `ask_transcript_sources`. Nothing else --
 * no user, vehicle, service record or assessment row is read or written. This is a QA log being
 * tidied, not user data being pruned, and the distinction is worth keeping sharp: deleting an
 * account already takes its transcripts with it through a separate cascade.
 *
 * THE RULE LIVES IN THE SERVICE, NOT HERE. `retentionCutoff` and `pruneExpiredTranscripts` are in
 * services/askTranscripts.ts, so the dry run and the real run cannot disagree about which rows are
 * expired -- the failure mode where a report says "3 rows" and the delete takes 300.
 *
 * IT IS SAFE TO RUN TWICE. The second run finds nothing to do and says so.
 */
import { closeDb, describeTarget, getDb } from '../apps/api/src/db/index.js';
import { env } from '../apps/api/src/env.js';
import {
  countExpiredTranscripts,
  pruneExpiredTranscripts,
  retentionCutoff,
} from '../apps/api/src/services/askTranscripts.js';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  const db = getDb();
  const now = new Date();
  const cutoff = retentionCutoff(now);

  console.log(`Database: ${describeTarget()}`);
  console.log(
    `Retention: ${env.ASK_TRANSCRIPT_RETENTION_DAYS} days ` +
      `-- deleting transcripts created before ${cutoff.toISOString()}`,
  );

  // Counted first even on a real run, so the log records the size of what went rather than only
  // the fact that something did. A prune that suddenly removes thousands is worth seeing.
  const expired = await countExpiredTranscripts(db, now);

  if (expired === 0) {
    console.log('Nothing past the window. No rows deleted.');
    return;
  }

  if (dryRun) {
    console.log(`${expired} transcript(s) would be deleted, with their source rows. Nothing written.`);
    return;
  }

  const deleted = await pruneExpiredTranscripts(db, now);
  console.log(`${deleted} transcript(s) deleted, with their source rows by cascade.`);
  console.log('No user, vehicle, service record or assessment row was touched.');
}

try {
  await main();
} catch (error) {
  // Deliberately loud and non-zero: unlike the write path, which must never cost an owner an
  // answer, a retention job that fails quietly is a policy that silently is not being applied.
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  await closeDb();
  process.exit(1);
}

await closeDb();
