import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Deliberately small. A badge annotates the row it sits on -- "Overdue", "Unknown" -- and it is
 * never the thing being read first, so it should be the smallest legible thing on the row rather
 * than competing with the label beside it.
 *
 * 10px matches the uppercase eyebrows elsewhere in the app. The tracking is `wider` (0.05em),
 * not `widest` (0.1em): heavy tracking on a six-letter uppercase word costs real width, and a
 * badge sitting next to a wrapping title is the one place that width is most expensive.
 * `leading-4` keeps the pill's height off the font's natural line box, so `py-0.5` means what it
 * says.
 *
 * Badges keep a rounded rectangle rather than becoming pills. Pills mean "pressable" in this
 * design -- see the note on Button -- and a badge is a label, not a control.
 */
const badgeVariants = cva(
  'inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase leading-4 tracking-wider transition-colors focus:outline-none',
  {
    variants: {
      variant: {
        /**
         * Ink rather than `bg-primary`. Primary is the brand green, and the default badge's job
         * is to label a verdict ("Get a second opinion") -- green there would read as an
         * all-clear the badge is not making. Colour on a badge is reserved for the `destructive`
         * and `warning` variants, which do mean something by it.
         */
        default: 'border-transparent bg-foreground text-background',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        /**
         * Tinted rather than filled: saturated red repeated down a list of recalls and
         * maintenance items shouts until none of it registers, while a tint plus border still
         * reads as "bad" at a glance.
         *
         * Text stays `foreground` for contrast -- against these tints `text-destructive` is
         * 4.1:1 and `text-warning` 1.9:1, both short of AA at this size, where neutral is ~17:1.
         */
        destructive: 'border-destructive/30 bg-destructive/15 text-foreground',
        /** The middle step, on the same amber token UrgencyCallout uses. */
        warning: 'border-warning/40 bg-warning/20 text-foreground',
        outline: 'border-input text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge };
