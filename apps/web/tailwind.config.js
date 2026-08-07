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
         *
         * The restyle takes that second option on purpose: emphasis comes from SIZE and COLOUR
         * before it comes from weight, which is why the `fontSize` scale below carries its own
         * tracking and the greyscale has a dedicated secondary-text step. Two weights doing all
         * the work is the house style being copied here, not a limitation being worked around.
         */
        medium: '600',
      },
      /**
       * A fluid type scale: every step is a `clamp()`, so sizes move continuously with the
       * viewport instead of jumping at breakpoints. Each entry carries its own line-height and
       * tracking, because those are not free parameters -- they belong to the size.
       *
       * Tracking flips sign as the sizes grow. Body copy gets slightly POSITIVE tracking to
       * open it up at small sizes; display sizes get NEGATIVE tracking, because the same
       * spacing that helps 14px look airy makes 40px look loose. Getting this backwards is the
       * single most common way a type scale reads as amateur.
       *
       * Line heights are unitless ratios of the matching percentages: 1.08 display, 1.16
       * heading, 1.4 body.
       */
      fontSize: {
        display: [
          'clamp(2.5rem, 4.14vw - 0.06rem, 3.5rem)',
          { lineHeight: '1.08', letterSpacing: '-0.02em' },
        ],
        h1: [
          'clamp(1.875rem, 1.88vw + 0.38rem, 2.5rem)',
          { lineHeight: '1.08', letterSpacing: '-0.015em' },
        ],
        h2: [
          'clamp(1.5rem, 1.13vw + 0.91rem, 1.875rem)',
          { lineHeight: '1.16', letterSpacing: '-0.01em' },
        ],
        h3: [
          'clamp(1.125rem, 0.56vw + 1.02rem, 1.5rem)',
          { lineHeight: '1.16', letterSpacing: '-0.0075em' },
        ],
        'body-lg': [
          'clamp(1rem, 0.38vw + 0.8rem, 1.125rem)',
          { lineHeight: '1.4', letterSpacing: '0.005em' },
        ],
        body: [
          'clamp(0.875rem, 0.19vw + 0.84rem, 1rem)',
          { lineHeight: '1.4', letterSpacing: '0.005em' },
        ],
        /**
         * Small print: provenance notes, metadata, disclaimers. Sentence case, so it takes
         * only a touch more tracking than body -- small text needs a little opening up, but
         * the heavy tracking that rescues UPPERCASE would shred a lowercase sentence.
         *
         * Uppercase eyebrows are a different job and want `tracking-widest` on top of this.
         */
        label: ['0.75rem', { lineHeight: '1.24', letterSpacing: '0.01em' }],
      },
      letterSpacing: {
        display: '-0.02em',
        tight: '-0.01em',
        body: '0.005em',
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
          muted: 'hsl(var(--grey-muted))',
          text: 'hsl(var(--grey-text))',
          ink: 'hsl(var(--grey-ink))',
        },
        /**
         * The paper tones, by name. `bg-muted` already points at linen and is what most code
         * should use; these exist for the case that genuinely wants alternating section bands
         * and needs to name which band it is on.
         */
        linen: {
          DEFAULT: 'hsl(var(--linen))',
          light: 'hsl(var(--linen-light))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          /** Legible as an icon or text colour, where DEFAULT is not. */
          strong: 'hsl(var(--warning-strong))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
      },
      borderRadius: {
        sm: 'calc(var(--radius) - 4px)' /* 0.5rem  */,
        md: 'calc(var(--radius) - 2px)' /* 0.625rem */,
        lg: 'var(--radius)' /*             0.75rem */,
        xl: 'calc(var(--radius) * 2)' /*   1.5rem  */,
        '2xl': 'calc(var(--radius) * 2.667)' /* 2rem */,
        /**
         * Buttons, and only buttons. A large fixed value rather than `9999px` so it still
         * behaves if something tall ever takes it -- at these heights the result is identical
         * to a true pill, but a 400px-tall element would not turn into a lozenge.
         */
        pill: '1000px',
      },
      /**
       * Soft, and tinted rather than black -- `rgba(16,24,40,...)` is a very dark blue, which
       * is what a real shadow on a warm surface looks like. Pure black reads as dirt.
       *
       * Use these sparingly. Cards are FLAT in this design: separated by a white fill on an
       * off-white page plus a 1px line. Shadow is reserved for things that genuinely float
       * above the page and need to say so -- dialogs, sheets, toasts, dropdowns.
       */
      boxShadow: {
        xs: '0 0.125rem 0.25rem -0.125rem rgba(16, 24, 40, 0.06)',
        sm: '0 4px 8px -2px rgba(16, 24, 40, 0.10), 0 2px 4px -2px rgba(16, 24, 40, 0.06)',
        DEFAULT: '0 4px 8px -2px rgba(16, 24, 40, 0.10), 0 2px 4px -2px rgba(16, 24, 40, 0.06)',
        md: '0 12px 16px -4px rgba(16, 24, 40, 0.08), 0 4px 6px -2px rgba(16, 24, 40, 0.03)',
        lg: '0 1.5rem 3rem -0.75rem rgba(16, 24, 40, 0.08)',
        xl: '0 24px 48px -12px rgba(16, 24, 40, 0.18)',
      },
      /**
       * The house curve becomes the default, so a bare `transition-colors` gets it without
       * every component having to ask. Tailwind bakes `transitionTimingFunction.DEFAULT` into
       * the `transition-*` utilities themselves, which is what makes this a one-line change
       * rather than an audit.
       *
       * The DURATION is deliberately NOT overridden. The house 350ms belongs to things that
       * travel -- a sheet sliding in, a panel expanding -- and Tailwind would apply a DEFAULT
       * here to every hover in the app as well, where a third of a second between the cursor
       * arriving and the colour changing reads as lag. Long motion opts in with `duration-ws`.
       */
      transitionTimingFunction: {
        DEFAULT: 'var(--ease)',
        ws: 'var(--ease)',
      },
      transitionDuration: {
        ws: 'var(--duration)',
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
