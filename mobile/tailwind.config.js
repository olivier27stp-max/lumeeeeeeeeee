/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#208AEF',
          50: '#EBF4FE',
          100: '#D7E9FE',
          200: '#AFD3FD',
          300: '#87BCFB',
          400: '#5FA6FA',
          500: '#208AEF',
          600: '#1A6EBF',
          700: '#13528F',
          800: '#0D3760',
          900: '#061B30',
        },
        ink: {
          DEFAULT: '#0F172A',
          muted: '#64748B',
          subtle: '#94A3B8',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          alt: '#F8FAFC',
          border: '#E2E8F0',
        },
        status: {
          scheduled: '#3B82F6',
          inProgress: '#F59E0B',
          completed: '#10B981',
          cancelled: '#94A3B8',
          late: '#EF4444',
        },
      },
    },
  },
  plugins: [],
};
