/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '1rem' },
    extend: {
      fontFamily: {
        /**
         * Averta is the brand face; the rest of the stack only covers the moment before it
         * loads and the case where it fails. `font-sans` is Tailwind's default for everything,
         * so setting it here is what applies Averta app-wide -- no `font-averta` on components.
         */
        sans: [
          'Averta',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      fontWeight: {
        /**
         * AVERTA HAS NO 500. The family steps 400 (Regular) straight to 600 (Semibold), and CSS
         * resolves a missing 500 downwards before upwards -- so left alone, every `font-medium`
         * in the app would render at body weight and quietly lose the emphasis it was asking
         * for. Pointing the utility at 600 keeps those places distinct from body text.
         *
         * The cost: `font-medium` and `font-semibold` now render identically. That is a real
         * redundancy in the scale rather than a trick -- if the restyle wants a step between
         * body and semibold, it has to come from size, colour or spacing, because the typeface
         * does not have one.
         */
        medium: '600',
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        /**
         * The palette by its own name, for the rare case that needs the brand colour rather
         * than a role -- a logo lockup, an illustration. Prefer the semantic names: `bg-primary`
         * says why, `bg-brand` only says what.
         */
        brand: 'hsl(var(--brand))',
        grey: {
          surface: 'hsl(var(--grey-surface))',
          line: 'hsl(var(--grey-line))',
          text: 'hsl(var(--grey-text))',
          ink: 'hsl(var(--grey-ink))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          /** Legible as an icon or text colour, where DEFAULT is not. */
          strong: 'hsl(var(--warning-strong))',
          foreground: 'hsl(var(--warning-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
