/** @type {import('tailwindcss').Config} */
// Palette mirrors the Lume web app (src/index.css): near-black primary,
// coral accent (used sparingly), light neutral surfaces, Inter-like type.
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  // Le thème sombre est piloté par une CLASSE (`dark`) et non par l'apparence
  // du téléphone : c'est ce que react-native-css-interop exige pour permuter les
  // variables de src/global.css, et ça laisse le choix à l'utilisateur.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Primary = l'encre en clair, sa contrepartie claire en sombre : les
        // jetons vivent dans src/global.css (:root / .dark:root).
        brand: {
          DEFAULT: 'rgb(var(--c-action) / <alpha-value>)',
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
          DEFAULT: 'rgb(var(--c-ink) / <alpha-value>)',
          muted: 'rgb(var(--c-ink-muted) / <alpha-value>)',
          subtle: 'rgb(var(--c-ink-subtle) / <alpha-value>)',
        },
        surface: {
          DEFAULT: 'rgb(var(--c-surface) / <alpha-value>)', // cartes
          alt: 'rgb(var(--c-surface-alt) / <alpha-value>)', // fond d'app
          sunken: 'rgb(var(--c-surface-sunken) / <alpha-value>)',
          border: 'rgb(var(--c-surface-border) / <alpha-value>)',
          borderStrong: 'rgb(var(--c-surface-border-strong) / <alpha-value>)',
        },
        // Texte posé SUR la couleur d'action (blanc en clair, presque noir en
        // sombre). Remplace les `text-white` des boutons pleins : en sombre, un
        // bouton devient clair, donc son texte doit foncer.
        onAction: 'rgb(var(--c-on-action) / <alpha-value>)',
        // Fonds teintés des états. La TEINTE ne change pas d'un thème à
        // l'autre ; son fond, oui.
        tint: {
          danger: 'rgb(var(--c-danger-bg) / <alpha-value>)',
          success: 'rgb(var(--c-success-bg) / <alpha-value>)',
          warning: 'rgb(var(--c-warning-bg) / <alpha-value>)',
          info: 'rgb(var(--c-info-bg) / <alpha-value>)',
        },
        // Entity identity — one solid color per CRM section, copied from the
        // web (src/index.css @theme --color-entity-*). See src/lib/entityColors.ts.
        entity: {
          request: '#D97706', // amber
          quote: '#9F1239', // bordeaux
          job: '#15803D', // green
          invoice: '#1E3A8A', // navy
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
