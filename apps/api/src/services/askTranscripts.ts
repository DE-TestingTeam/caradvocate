/**
 * Writes down Ask CA exchanges so the answers can be reviewed.
 *
 * THE ONE RULE HERE: recording must never cost the owner an answer. Every write goes through
 * `record()`, which swallows its own failures and logs them. The answer has already been
 * streamed by the time this runs -- turning a delivered answer into a 500 because a QA insert
 * hit a constraint would be the worst possible trade, and a dropped transcript is a gap in a
 * review queue, not a broken feature. Nothing in routes/chat.ts awaits this for correctness.
 *
 * See schema.ts (askTranscripts) for why this is not the `chat_messages` table that migration
 * 0010 dropped.
 */
import { count, lt } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { askTranscripts, askTranscriptSources } from '../db/schema.js';
import { env } from '../env.js';
import type { AskReply, AskTiming } from './askClaude.js';

/**
 * How an exchange ended.
 *
 * `canned` is a development run with no API key -- kept so a reviewer can see the row exists
 * and skip it, rather than reading a stock sentence as something the model produced. `abandoned`
 * is the owner closing the tab mid-answer: not a failure, but a rate worth watching, because
 * people leave when answers take too long.
 */
export type AskOutcome = 'answered' | 'canned' | 'declined' | 'timed_out' | 'failed' | 'abandoned';

export interface TranscriptInput {
  userId: string;
  vehicleId: string;
  question: string;
  /** Null only for `abandoned` -- no validated answer ever existed. */
  reply: AskReply | null;
  outcome: AskOutcome;
  /** Prior messages sent up with this question, after truncation. */
  historyMessages: number;
  /** Absent when no call was made (canned replies, and failures short of the model). */
  model?: string;
  timing?: AskTiming;
}

/**
 * Records one exchange. Resolves either way -- see the header. Callers may fire and forget.
 */
export async function record(db: Database, input: TranscriptInput): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(askTranscripts)
        .values({
          userId: input.userId,
          vehicleId: input.vehicleId,
          question: input.question,
          answer: input.reply?.text ?? null,
          outcome: input.outcome,
          // Both halves of the badge or neither: a level with no sentence would render as an
          // empty warning, so the pair is kept together the way the UI reads it.
          urgencyLevel: input.reply?.urgency?.level ?? null,
          urgencyText: input.reply?.urgency?.text ?? null,
          ctaLabel: input.reply?.cta?.label ?? null,
          historyMessages: input.historyMessages,
          model: input.model ?? null,
          latencyMs: input.timing?.ms ?? null,
          inputTokens: input.timing?.inputTokens ?? null,
          outputTokens: input.timing?.outputTokens ?? null,
          cacheReadTokens: input.timing?.cacheReadTokens ?? null,
          cacheWriteTokens: input.timing?.cacheWriteTokens ?? null,
        })
        .returning({ id: askTranscripts.id });

      const sources = input.reply?.sources ?? [];
      if (sources.length > 0) {
        await tx.insert(askTranscriptSources).values(
          sources.map((source, position) => ({
            transcriptId: row.id,
            kind: source.kind,
            label: source.label,
            position,
          })),
        );
      }
    });
  } catch (cause) {
    // Loud enough to notice a systematic failure in the logs, quiet enough that one bad row
    // does not look like an outage. The owner is unaffected either way.
    console.error(
      `Ask CA transcript not recorded (${input.outcome}): ` +
        `${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

/* ------------------------------------------------------------------ retention */

/**
 * The moment before which a transcript is past its retention window.
 *
 * Exported and used by both the counting and the deleting path, so a dry run cannot report one
 * set of rows and the real run delete a different one. Same reason `marketValueDue` is shared
 * between the sweep and the routes.
 */
export function retentionCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - env.ASK_TRANSCRIPT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

/** How many transcripts are currently past the window. Reads nothing back but the count. */
export async function countExpiredTranscripts(db: Database, now: Date = new Date()): Promise<number> {
  const [row] = await db
    .select({ expired: count() })
    .from(askTranscripts)
    .where(lt(askTranscripts.createdAt, retentionCutoff(now)));

  return row?.expired ?? 0;
}

/**
 * Deletes every transcript past the retention window and returns how many went.
 *
 * UNLIKE `record()`, THIS DOES NOT SWALLOW FAILURES. The rule that a QA write must never cost an
 * owner an answer does not apply here: nothing is waiting on this, and a prune that fails
 * silently is a retention policy that quietly is not one. It runs from a cron that should go red.
 *
 * The child rows go with it through `ask_transcript_sources.transcript_id`'s ON DELETE CASCADE,
 * so there is no second statement to forget and no window in which a source row outlives the
 * question it describes.
 *
 * One statement rather than a batched loop: the delete is driven by the `created_at` index, and
 * at this table's rate a day's expiry is a handful of rows. If the log ever grows enough for a
 * single delete to hold a long lock, batch it then -- not on speculation.
 */
export async function pruneExpiredTranscripts(db: Database, now: Date = new Date()): Promise<number> {
  const deleted = await db
    .delete(askTranscripts)
    .where(lt(askTranscripts.createdAt, retentionCutoff(now)))
    .returning({ id: askTranscripts.id });

  return deleted.length;
}
