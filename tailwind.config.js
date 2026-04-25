/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          base: '#0a0a0b',
          surface: '#15151a',
          elevated: '#1d1d24',
          hover: '#26262f',
        },
        fg: {
          primary: '#f5f5f7',
          secondary: '#a8a8b3',
          muted: '#6b6b76',
        },
        accent: {
          DEFAULT: '#7c5cff',
          hover: '#9277ff',
        },
        border: {
          DEFAULT: '#2a2a32',
          strong: '#3a3a44',
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
