import * as React from 'react';
import { cn } from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        /**
         * `h-11` to match the standard Button, so a field and the button beside it line up
         * without either being nudged. `bg-card` rather than `bg-background`: inputs are white
         * on the off-white page for the same reason cards are -- the fill is what says
         * "something goes here", and on an identical background nothing would.
         *
         * Placeholders use `grey-muted`, not `muted-foreground`. Secondary text and placeholder
         * text are different things: one is content, the other is an absence of it, and giving
         * them the same colour makes an empty field look filled in.
         */
        'flex h-11 w-full rounded-lg border border-input bg-card px-3.5 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-grey-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export { Input };
