import * as React from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * An "i" that explains the thing it sits beside, revealed on demand.
 *
 * Hover shows it to a pointer, focus shows it to a keyboard, and it is a real button so a tap
 * works on a touch screen -- where hover never fires at all, and an icon that only responds to
 * a mouse would be dead weight on the device most owners are holding. Hand-rolled rather than a
 * Radix tooltip for the same reason: Radix's tooltip deliberately never opens on touch.
 *
 * The panel is positioned rather than in flow, so opening it never pushes the layout around --
 * and it resets its own typography (normal case, normal tracking), because it gets mounted
 * inside uppercase eyebrow labels whose styles would otherwise leak in.
 */
export function InfoPopover({
  label,
  align = 'start',
  children,
}: {
  /** What the button is about, for screen readers -- e.g. "About the estimated value". */
  label: string;
  /** Which edge of the button the panel hangs from. `end` for anything near the right edge. */
  align?: 'start' | 'end';
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <span
      className="relative inline-flex shrink-0"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="flex h-6 w-6 items-center justify-center rounded-pill text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Info className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">{label}</span>
      </button>

      {open && (
        <div
          className={cn(
            'absolute top-7 z-10 w-64 max-w-[calc(100vw-2rem)] rounded-md border bg-background p-3 text-left text-sm font-normal normal-case tracking-normal text-muted-foreground shadow-md',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          {children}
        </div>
      )}
    </span>
  );
}
