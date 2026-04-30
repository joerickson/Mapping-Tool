import animatePlugin from 'tailwindcss-animate'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  // Phase A theme switch is driven by [data-theme="dark"] on <html>, which is
  // set by an inline bootstrap script in index.html before React mounts.
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    // Override Tailwind's defaults for radius — the design system caps at
    // 12px (rounded-xl) and we don't want rounded-2xl/3xl available.
    borderRadius: {
      none: '0',
      sm: '4px',
      DEFAULT: '6px',
      md: '6px',
      lg: '8px',
      xl: '12px',
      full: '9999px', // only for avatars + status dots
    },
    extend: {
      colors: {
        // Surfaces. Tailwind utility names: bg-surface, bg-surface-subtle, …
        surface: {
          DEFAULT: 'var(--color-bg)',
          subtle: 'var(--color-bg-subtle)',
          muted: 'var(--color-bg-muted)',
          elevated: 'var(--color-bg-elevated)',
        },

        // Text. text-fg, text-fg-muted, text-fg-subtle
        fg: {
          DEFAULT: 'var(--color-fg)',
          muted: 'var(--color-fg-muted)',
          subtle: 'var(--color-fg-subtle)',
        },

        // Borders. border-border, border-border-strong, border-border-focus
        border: {
          DEFAULT: 'var(--color-border)',
          strong: 'var(--color-border-strong)',
          focus: 'var(--color-border-focus)',
        },

        // Accent. bg-accent, bg-accent-hover, text-accent-fg, bg-accent-subtle
        accent: {
          DEFAULT: 'var(--color-accent)',
          hover: 'var(--color-accent-hover)',
          fg: 'var(--color-accent-fg)',
          subtle: 'var(--color-accent-subtle)',
        },

        // Semantic — paired with -subtle background for badges/banners.
        success: {
          DEFAULT: 'var(--color-success)',
          subtle: 'var(--color-success-subtle)',
        },
        warning: {
          DEFAULT: 'var(--color-warning)',
          subtle: 'var(--color-warning-subtle)',
        },
        danger: {
          DEFAULT: 'var(--color-danger)',
          subtle: 'var(--color-danger-subtle)',
        },

        // Legacy palette kept for now — Phases B–E will migrate consumers
        // off these. Once the last hard-coded `bg-rbm-blue` is gone, drop
        // this block.
        rbm: {
          blue: '#1a56db',
          navy: '#1e3a5f',
          green: '#0e9f6e',
          red: '#f05252',
          yellow: '#faca15',
          purple: '#7e3af2',
          orange: '#ff5a1f',
          teal: '#0694a2',
          pink: '#e74694',
          gray: '#6b7280',
        },
      },

      fontFamily: {
        sans: [
          'Geist',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif',
        ],
        mono: [
          '"Geist Mono"',
          '"JetBrains Mono"',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },

      ringColor: {
        DEFAULT: 'var(--color-ring)',
      },

      // Phase E — page-route transition. AppShell re-keys <main> on
      // pathname change so this animation replays. Tailwind's motion-safe:
      // variant pairs with prefers-reduced-motion to skip the animation
      // when the user has requested less motion.
      keyframes: {
        'page-fade-in': {
          '0%': { opacity: '0', transform: 'translateY(2px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'page-fade-in': 'page-fade-in 150ms ease-out',
      },
    },
  },
  plugins: [
    // Tiny plugin: expose `font-tabular` utility that turns on tabular figures.
    function ({ addUtilities }) {
      addUtilities({
        '.font-tabular': {
          fontFeatureSettings: '"tnum"',
          fontVariantNumeric: 'tabular-nums',
        },
      })
    },
    // Adds animate-in / animate-out + fade / zoom / slide utilities used by
    // Radix-backed components (Dialog, DropdownMenu, Toast).
    animatePlugin,
  ],
}
