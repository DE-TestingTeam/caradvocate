/**
 * Keeps an Ask CA conversation alive while the owner moves around the app.
 *
 * The server still stores nothing -- that decision stands and the reasoning is in
 * routes/chat.ts. This is the browser holding its own transcript, which is a different thing:
 * leaving the screen to check a recall on My Car and coming back to an empty chat was losing
 * work the owner had done, and it made follow-up questions impossible.
 *
 * `sessionStorage`, not `localStorage`, and the distinction is the point. It is scoped to this
 * one tab and the browser drops it when the tab closes, so the conversation survives navigation
 * and a refresh but never outlives the visit. On a shared computer, closing the tab is still the
 * thing that clears it.
 *
 * Keyed by vehicle, so signing out and signing in as someone else cannot surface the previous
 * owner's conversation: a different account means a different vehicle id means a different key,
 * and a key that does not match is ignored.
 */
import type { ChatMessage } from '@caradvocate/shared';

const PREFIX = 'caradvocate.ask.';

/**
 * Conversations are short, but nothing stops someone talking all afternoon, and sessionStorage
 * is a small shared budget that other writes have to fit into. Keeping the newest messages is
 * the right end to keep: a follow-up refers to what was just said.
 */
const MAX_STORED = 100;

function keyFor(vehicleId: string): string {
  return `${PREFIX}${vehicleId}`;
}

/**
 * Reads the transcript back, or nothing at all.
 *
 * Anything unreadable is discarded rather than repaired. This is a convenience cache, so a
 * stale shape from an older build should cost the owner an empty chat, never a crash on a
 * screen they were trying to use.
 */
export function loadTranscript(vehicleId: string): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(keyFor(vehicleId));
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isChatMessage);
  } catch {
    // Private browsing can make sessionStorage throw on read, and malformed JSON throws too.
    return [];
  }
}

export function saveTranscript(vehicleId: string, messages: ChatMessage[]): void {
  try {
    if (messages.length === 0) {
      sessionStorage.removeItem(keyFor(vehicleId));
      return;
    }
    sessionStorage.setItem(keyFor(vehicleId), JSON.stringify(messages.slice(-MAX_STORED)));
  } catch {
    // Storage disabled or full. The conversation still works for as long as the screen is open;
    // it just will not survive leaving it, which is where this started.
  }
}

/** Drops every stored conversation. For sign-out, where none of it should follow the next user. */
export function clearAllTranscripts(): void {
  try {
    const keys = Object.keys(sessionStorage).filter((key) => key.startsWith(PREFIX));
    for (const key of keys) sessionStorage.removeItem(key);
  } catch {
    // Nothing to do -- if storage is unavailable there is nothing stored to clear.
  }
}

/** Narrow enough that a bad row is dropped, loose enough to tolerate fields added later. */
function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    typeof row.text === 'string' &&
    (row.role === 'user' || row.role === 'assistant')
  );
}
