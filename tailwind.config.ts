import type { Config } from 'tailwindcss';

// Modern billiard hall: deep charcoal + felt green, brass/amber single accent.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        felt: {
          DEFAULT: '#0d3b2e', // deep felt green
          dark: '#08251c',
          light: '#155c46',
        },
        charcoal: {
          DEFAULT: '#14181a',
          card: '#1b2023',
          line: '#2a3034',
        },
        brass: {
          DEFAULT: '#d9a441', // single confident accent
          light: '#f0c46a',
          dim: '#3a2c12',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        body: ['var(--font-body)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        brass: '0 0 24px rgba(217, 164, 65, 0.20)',
        felt: 'inset 0 0 80px rgba(0, 0, 0, 0.45)',
      },
    },
  },
  plugins: [],
};

export default config;
