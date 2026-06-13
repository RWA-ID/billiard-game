import type { Config } from 'tailwindcss';

// Modern billiard hall: near-black green-tinted ink, deep felt, a single
// confident sage-green accent, brass only as a metallic detail (the 8-ball).
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#08120e', // page background
          soft: '#0d1411',
          card: '#0a1610', // raised cards / panels
          line: '#1d2a23', // hairline borders
        },
        felt: {
          DEFAULT: '#0d3b2e',
          dark: '#08251c',
          light: '#1c6b4f',
          rail: '#15110a',
        },
        sage: {
          DEFAULT: '#8bc394', // primary CTA
          bright: '#6fd089', // headline highlight / online dot
          deep: '#3f6b4a',
          dim: '#16241b',
        },
        brass: {
          DEFAULT: '#d9a441',
          light: '#f0c46a',
          dim: '#3a2c12',
        },
        cream: '#f4efe4', // serif headline ink
      },
      fontFamily: {
        serif: ['var(--font-serif)', 'Libre Caslon Display', 'Georgia', 'serif'],
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        body: ['var(--font-body)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      // The codebase styles weight via numeric utilities (font-500 … font-700);
      // register the scale so they emit real font-weight rules.
      fontWeight: {
        '400': '400',
        '500': '500',
        '600': '600',
        '700': '700',
      },
      boxShadow: {
        sage: '0 0 30px rgba(139, 195, 148, 0.25)',
        brass: '0 0 30px rgba(217, 164, 65, 0.22)',
        card: '0 18px 50px -20px rgba(0, 0, 0, 0.7)',
        felt: 'inset 0 0 120px rgba(0, 0, 0, 0.55)',
        table: '0 30px 80px -24px rgba(0, 0, 0, 0.85), 0 10px 32px rgba(0, 0, 0, 0.5)',
      },
      keyframes: {
        floaty: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        glow: {
          '0%, 100%': { opacity: '0.85' },
          '50%': { opacity: '1' },
        },
      },
      animation: {
        floaty: 'floaty 6s ease-in-out infinite',
        glow: 'glow 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
