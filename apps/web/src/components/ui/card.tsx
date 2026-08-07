import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Flat on purpose. The separation from the page comes from the fill -- a pure white card on the
 * off-white page background -- plus a 1px line, and nothing else.
 *
 * The shadow that used to be here was doing the same job twice. A shadow says "this floats
 * above the page", which is true of a dialog and false of a card that is simply part of the
 * page; once the background stopped being pure white, the fill alone carried the separation and
 * the shadow was left only adding grey haze under every edge. Shadow is now reserved for things
 * that genuinely float: dialogs, sheets, toasts, dropdowns.
 */
const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('rounded-lg border bg-card text-card-foreground', className)} {...props} />
  ),
);
Card.displayName = 'Card';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('p-4 pt-0 sm:p-6 sm:pt-0', className)} {...props} />,
);
CardContent.displayName = 'CardContent';

export { Card, CardContent };
