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
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        /**
         * The second tier: a real action, but not the one the screen is for. Ink in the border
         * and the text, nothing in the fill, so it reads as part of the same system as
         * `default` without competing with it.
         *
         * This used to be brand green. It is neutral now for the same reason `--primary` is --
         * two tiers of action in two different colours made the page look like it had two
         * houses in it. The tiers are now told apart by fill vs outline, which is the
         * distinction that actually matters.
         *
         * `border` at the same 1px as every other variant -- a thicker border here would make
         * the button a pixel taller than the one beside it.
         */
        secondary: 'border border-foreground bg-transparent text-foreground hover:bg-foreground/5',
        /**
         * The house green, kept for the one CTA on a screen that is genuinely the point of the
         * screen -- starting an assessment, adding a car. Rare on purpose: if two of these ever
         * appear in one viewport, one of them is wrong.
         */
        brand: 'bg-brand text-primary-foreground hover:bg-brand/90',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-foreground underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-11 px-5 py-2',
        sm: 'h-9 px-4',
        lg: 'h-14 px-8 text-base',
        /** Square, so the pill radius resolves to a circle. */
        icon: 'h-11 w-11',
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
