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
}

/** Beyond this the box stops growing and scrolls, so the transcript never gets squeezed out. */
const MAX_ROWS = 6;
const LINE_HEIGHT_PX = 20;

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
export function Composer({ value, onChange, onSend, disabled = false }: ComposerProps) {
  const trimmed = value.trim();
  const ref = React.useRef<HTMLTextAreaElement>(null);

  // Measured from the content rather than counted from newlines, so a long wrapped line grows
  // the box too. Reset to `auto` first or scrollHeight only ever ratchets upwards.
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS * LINE_HEIGHT_PX + 18)}px`;
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
          'flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-base',
          'ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        )}
      />
      <Button type="submit" size="icon" disabled={!trimmed || disabled} aria-label="Send message" className="shrink-0">
        <ArrowRight className="h-4 w-4" />
      </Button>
    </form>
  );
}
