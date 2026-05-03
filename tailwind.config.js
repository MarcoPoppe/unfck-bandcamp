/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Semantic tokens are wired through CSS custom properties so that
        // a single class change on <html> swaps the entire palette. Values
        // for both themes live in src/app/globals.css.
        bg: {
          base: 'rgb(var(--bg-base) / <alpha-value>)',
          surface: 'rgb(var(--bg-surface) / <alpha-value>)',
          elevated: 'rgb(var(--bg-elevated) / <alpha-value>)',
          hover: 'rgb(var(--bg-hover) / <alpha-value>)',
          danger: 'rgb(var(--bg-danger) / <alpha-value>)',
          success: 'rgb(var(--bg-success) / <alpha-value>)',
          warning: 'rgb(var(--bg-warning) / <alpha-value>)',
        },
        fg: {
          primary: 'rgb(var(--fg-primary) / <alpha-value>)',
          secondary: 'rgb(var(--fg-secondary) / <alpha-value>)',
          muted: 'rgb(var(--fg-muted) / <alpha-value>)',
          danger: 'rgb(var(--fg-danger) / <alpha-value>)',
          success: 'rgb(var(--fg-success) / <alpha-value>)',
          warning: 'rgb(var(--fg-warning) / <alpha-value>)',
          'on-accent': 'rgb(var(--fg-on-accent) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          hover: 'rgb(var(--accent-hover) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--border) / <alpha-value>)',
          strong: 'rgb(var(--border-strong) / <alpha-value>)',
          danger: 'rgb(var(--border-danger) / <alpha-value>)',
          success: 'rgb(var(--border-success) / <alpha-value>)',
          warning: 'rgb(var(--border-warning) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
