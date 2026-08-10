import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Buttons are pills, and they are the only pills in the app.
 *
 * That exclusivity is doing real work: with cards, inputs and badges all on the 0.75rem corner,
 * a fully round edge becomes a shape that means "this is pressable" on its own, before colour
 * or label. It is why `ghost` and `link` can afford to carry almost no styling.
 *
 * They are also taller than the shadcn defaults -- 44px rather than 40px for the standard size.
 * 44px is the iOS touch-target minimum, so the same button that looks generous with a mouse is
 * the one that is actually hittable with a thumb, and there is no separate mobile size to keep
 * in sync.
 */
/**
 * There are exactly TWO button appearances in this app: solid and outlined.
 *
 * That is the whole system, and it is deliberately smaller than what was here before. A solid
 * black `default` sitting next to a solid green `brand` gave the page two competing primary
 * actions in two different colours, and `secondary` (dark border) next to `outline` (grey
 * border) gave it two outlined buttons that differed only by a shade nobody could name. Four
 * treatments, two real jobs.
 *
 * Now: solid means "this is the action", outlined means "this is also an action, but not the
 * one". Everything else -- ghost, link -- is for actions that should not look like buttons at
 * all. `destructive` is the one exception, and it earns it by meaning something the other
 * variants cannot say.
 *
 * Solid is ink -- `bg-foreground`, the same near-black as body text -- not the brand green. Green
 * stays with identity: the logo, the focus ring, the active nav row, the selected plan. Keeping the
 * house colour off the buttons means a green thing on the page says "this is us / this is where you
 * are" and never has to also say "press me". What says pressable is the pill radius, which nothing
 * else in the app uses.
 */
const OUTLINED =
  'border border-border bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground';

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: 'bg-foreground text-background hover:bg-foreground/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        /**
         * The same treatment, under both of the names the codebase already uses for it. Sharing
         * one string rather than writing it twice is what stops the two from drifting back
         * apart -- there is no longer a way for a screen using `outline` to look different from
         * one using `secondary`.
         */
        outline: OUTLINED,
        secondary: OUTLINED,
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        /**
         * An action that lives inside a sentence or under a list -- "Add an upkeep job", "Show
         * all". Underlined at rest rather than on hover, because in running text an action that
         * only reveals itself on hover is invisible on a touchscreen.
         *
         * Always pair with `size="inline"`. On its own this variant still inherits the standard
         * button box, which would give a text link a 44px height and 20px of side padding.
         */
        link: 'text-foreground underline underline-offset-4 hover:text-muted-foreground',
      },
      size: {
        /**
         * There is ONE size for a labelled button: `default`, 44px. Every solid button in the
         * app is that height, so "this is the action" is said by the fill alone and never by
         * scale -- a hero-sized CTA on one page and a standard one on the next read as two
         * different components when they are the same button.
         *
         * 44px because that is the iOS touch-target minimum, so the same button that looks
         * right with a mouse is the one that is actually hittable with a thumb.
         *
         * `sm` is for a button riding a section header rather than a page ("Log a service",
         * "Add an upkeep job") -- always outlined, never the page's primary action. The `lg`
         * step (48px) was deleted with nothing but the Repairs CTA on it; a size used once is
         * a size that drifts.
         */
        sm: 'h-9 px-4',
        default: 'h-11 px-5 py-2',
        /** Square, so the pill radius resolves to a circle. */
        icon: 'h-11 w-11',
        /**
         * No box at all: no height, no padding, no min-width. For `variant="link"`, so a text
         * action sits on the baseline of the copy around it instead of carrying a button's
         * geometry into a paragraph.
         */
        inline: 'h-auto p-0 font-medium',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';

export { Button };
