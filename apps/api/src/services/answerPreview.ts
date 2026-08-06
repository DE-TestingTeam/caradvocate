/**
 * Decodes the `text` field out of Ask CA's reply while it is still streaming.
 *
 * Its own module because it is pure and because it is the one piece of the streaming path with
 * real edge cases -- structured outputs mean the deltas are a JSON document, and showing the
 * owner `{"text":"Your brake` is worse than showing nothing.
 *
 * Written as a scanner rather than repeatedly `JSON.parse`-ing the partial buffer: chunk
 * boundaries fall anywhere, including inside a `\uXXXX` escape, and parsing a half-written
 * document just throws. It is display only -- parseReply in askClaude.ts still owns the answer.
 */

/** The characters JSON escapes with a single letter. `\uXXXX` is handled separately. */
const JSON_ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

/** `text` is the schema's first property, so its value is the first thing worth showing. */
const OPENER = /"text"\s*:\s*"/;

/** Enough tail to hold an opener split across two chunks. */
const OPENER_MAX = 32;

/**
 * Returns a function that takes the next raw chunk and returns only what is newly decodable.
 * Incomplete escapes are held back until their bytes arrive; everything from the closing quote
 * onwards is dropped, so nothing after `text` -- urgency, cta -- can leak into the preview.
 */
export function createAnswerPreview(): (chunk: string) => string {
  let pending = '';
  let open = false;
  let closed = false;

  return (chunk: string): string => {
    if (closed) return '';
    pending += chunk;

    if (!open) {
      const match = OPENER.exec(pending);
      if (!match) {
        if (pending.length > OPENER_MAX) pending = pending.slice(-OPENER_MAX);
        return '';
      }
      pending = pending.slice(match.index + match[0].length);
      open = true;
    }

    let out = '';
    let i = 0;
    while (i < pending.length) {
      const char = pending[i];

      if (char === '"') {
        closed = true;
        pending = '';
        return out;
      }

      if (char === '\\') {
        const escape = pending[i + 1];
        if (escape === undefined) break; // Wait for the escaped character.
        if (escape === 'u') {
          if (i + 6 > pending.length) break; // Wait for all four hex digits.
          const code = Number.parseInt(pending.slice(i + 2, i + 6), 16);
          if (Number.isNaN(code)) {
            // Not valid JSON. Stop previewing rather than emit rubbish; the validated reply
            // still arrives at the end.
            closed = true;
            pending = '';
            return out;
          }
          out += String.fromCharCode(code);
          i += 6;
          continue;
        }
        out += JSON_ESCAPES[escape] ?? escape;
        i += 2;
        continue;
      }

      out += char;
      i += 1;
    }

    pending = pending.slice(i);
    return out;
  };
}
