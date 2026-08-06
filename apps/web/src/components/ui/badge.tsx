import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide transition-colors focus:outline-none',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
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
