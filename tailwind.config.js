/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: 'var(--mf-surface)',
          alt: 'var(--mf-surface-alt)',
        },
        ink: 'var(--mf-ink)',
        muted: 'var(--mf-muted)',
        accent: 'var(--mf-accent)',
        border: 'var(--mf-border)',
      },
    },
  },
  plugins: [],
};
