/** @type {import('tailwindcss').Config} */
// Palette mirrors the Lume web app (src/index.css): near-black primary,
// coral accent (used sparingly), light neutral surfaces, Inter-like type.
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Primary = near-black (web --color-primary #171717)
        brand: {
          DEFAULT: '#171717',
          50: '#F5F5F5',
          100: '#E5E5E5',
          200: '#D4D4D4',
          300: '#A3A3A3',
          400: '#525252',
          500: '#171717',
          600: '#0A0A0A',
          700: '#000000',
          800: '#000000',
          900: '#000000',
        },
        // Coral accent (web --color-accent #ff6b6b) — for sparing CTAs/highlights
        accent: {
          DEFAULT: '#FF6B6B',
          hover: '#EE5A5A',
        },
        ink: {
          DEFAULT: '#171717', // text-primary
          muted: '#525252', // text-secondary
          subtle: '#A3A3A3', // text-tertiary
        },
        surface: {
          DEFAULT: '#FFFFFF', // cards
          alt: '#FAFAFA', // app background
          sunken: '#F5F5F5',
          border: '#E5E5E5',
        },
        // Job/D2D status colors (web semantic tokens)
        status: {
          scheduled: '#2563EB', // info blue
          inProgress: '#D97706', // amber
          completed: '#059669', // green
          cancelled: '#A3A3A3', // neutral
          late: '#DC2626', // red
        },
      },
      borderRadius: {
        lg: '12px',
        xl: '16px',
        '2xl': '20px',
        '3xl': '24px',
      },
    },
  },
  plugins: [],
};
