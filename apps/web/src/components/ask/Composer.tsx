import * as React from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ComposerProps {
  /**
   * Controlled by the page rather than held here, so a send that fails can put the owner's text
   * back in the box instead of losing it.
   */
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string) => void;
  disabled?: boolean;
  /**
   * Focus the box on mount, caret at the end.
   *
   * For arriving with `value` already filled in -- a question handed over from another screen
   * has to be editable without hunting for where to click. Read once: refocusing whenever this
   * flipped would take the cursor back off the owner mid-sentence.
   */
  autoFocus?: boolean;
}

/** Beyond this the box stops growing and scrolls, so the transcript never gets squeezed out. */
const MAX_ROWS = 6;

/**
 * The measurements the auto-grow depends on, stated rather than inferred.
 *
 * `leading-5` is set explicitly on the textarea so this stays true: the font size changes at
 * `md` (16px on phones to avoid iOS zooming the page on focus, 14px above), and the line height
 * would otherwise change with it, leaving the closed height different on either side of the
 * breakpoint.
 */
const LINE_HEIGHT_PX = 20;
/** py-2 top and bottom, plus the 1px border on each edge. */
const VERTICAL_CHROME_PX = 18;
/** Matches Button size="icon" (h-10), so the box and the send button are the same height. */
const MIN_HEIGHT_PX = 40;
const MAX_HEIGHT_PX = MAX_ROWS * LINE_HEIGHT_PX + VERTICAL_CHROME_PX;

/**
 * NOTE: no wireframe for the multi-line behaviour. A single-line input was fine for "brakes
 * grinding" and wrong for the questions this feature is actually for -- pasting the line items
 * off a quote, or describing when a noise happens. It grows with the text up to six rows and
 * scrolls after that.
 *
 * Enter sends and Shift+Enter breaks the line, which is the convention every chat app has
 * trained people on. The placeholder says so, because the opposite convention exists too and
 * guessing wrong means accidentally sending half a question.
 */
export function Composer({
  value,
  onChange,
  onSend,
  disabled = false,
  autoFocus = false,
}: ComposerProps) {
  const trimmed = value.trim();
  const ref = React.useRef<HTMLTextAreaElement>(null);

  /*
   * Mount only, and the caret goes to the END rather than the start. A prefilled question is
   * usually something to add to ("...and it only happens when cold"), and `focus()` alone leaves
   * the cursor at position 0, where the first keystroke types in front of the question instead
   * of after it.
   *
   * Not React's own `autoFocus` attribute: it fires before the layout effect below has sized the
   * box, so a prefill long enough to wrap scrolls its own first line out of view on arrival.
   */
  React.useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);

  // Measured from the content rather than counted from newlines, so a long wrapped line grows
  // the box too. Reset to `auto` first or scrollHeight only ever ratchets upwards.
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Reset first, or scrollHeight only ever ratchets upwards and the box never shrinks back.
    el.style.height = 'auto';
    const fitted = Math.min(Math.max(el.scrollHeight, MIN_HEIGHT_PX), MAX_HEIGHT_PX);
    el.style.height = `${fitted}px`;
  }, [value]);

  function submit() {
    if (!trimmed || disabled) return;
    // The page clears the box: it owns the value, and on failure it puts this text back.
    onSend(trimmed);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // `isComposing` guards IME input, where Enter commits a candidate rather than a message.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex items-end gap-2 border-t bg-background pt-3"
    >
      <textarea
        ref={ref}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask about a symptom, repair, or a quote… (Shift+Enter for a new line)"
        aria-label="Message"
        autoComplete="off"
        className={cn(
          'flex w-full resize-none rounded-md border border-input bg-background px-3 py-2',
          // Font size drops at md; line height deliberately does not, so the closed height is
          // the same on both sides of the breakpoint and keeps matching the send button.
          'text-base leading-5 md:text-sm',
          'ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      />
      <Button type="submit" size="icon" disabled={!trimmed || disabled} aria-label="Send message" className="shrink-0">
        <ArrowRight className="h-4 w-4" />
      </Button>
    </form>
  );
}
