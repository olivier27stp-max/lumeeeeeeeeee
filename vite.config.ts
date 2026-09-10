import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const apiTarget = `http://localhost:${env.API_PORT || '3001'}`;
  return {
    plugins: [react(), tailwindcss()],
    define: {
      // GEMINI_API_KEY proxied through backend — never expose API keys in frontend bundle
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      allowedHosts: ['.ngrok-free.dev', '.ngrok.io', 'localhost'],
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          // Only split TRULY heavy libs that benefit from lazy loading.
          //
          // Audit bloc 3 (2026-09-10), C3 : en forme objet, un chunk manuel
          // reçoit AUSSI les dépendances de ses modules qui ne sont assignées à
          // aucun autre chunk. `charts` (recharts) embarquait donc React et
          // `pdf` (jspdf) le helper CommonJS : l'entrée devait les importer, et
          // le navigateur téléchargeait 281 ko gzip de PDF + graphiques sur
          // l'écran de connexion (modulepreload). `vendor`, déclaré EN PREMIER,
          // réclame React et ses satellites : les chunks lourds ne contiennent
          // plus que leur librairie et ne sont chargés qu'avec la page qui les
          // utilise.
          //
          // Historique (2026-05-12) : isoler `motion` SANS isoler React avait
          // créé un cycle entrée ↔ motion (« reading 'createContext' »). Ici
          // `vendor` n'importe rien de l'app : pas de cycle possible.
          manualChunks(id) {
            // Forme fonction : chaque module est assigné seul, sans entraîner
            // ses dépendances (la forme objet hissait React dans `charts`).
            const lib = (...noms: string[]) => noms.some((n) => id.includes(`/node_modules/${n}/`));
            // Un fichier CSS importé par l'entrée (leaflet.css dans main.tsx)
            // ne doit pas faire naître un chunk JS `maps` préchargé partout.
            if (/\.(css|scss|less)(\?|$)/.test(id)) return undefined;
            // Petits utilitaires partagés entre l'entrée et les chunks lourds
            // (clsx est importé par recharts ET par cn()) : Rollup les fusionne
            // sinon dans le chunk lourd, et l'entrée le précharge pour rien.
            if (lib('clsx', 'tailwind-merge', 'tslib', 'lodash', 'date-fns')) return 'vendor';
            // Helpers virtuels de Vite/Rollup (préchargement, polyfill,
            // CommonJS) : partagés par tout le monde → dans `vendor`, sinon
            // Rollup les range dans le premier chunk lourd qui les utilise et
            // l'entrée doit importer ce chunk (c'était le cas de pdf/charts).
            if (id.includes('commonjsHelpers') || id.includes('vite/preload-helper') || id.includes('vite/modulepreload-polyfill')) return 'vendor';
            if (lib('react', 'react-dom', 'scheduler')) return 'vendor';
            if (lib('mapbox-gl', 'react-leaflet', 'react-leaflet-cluster', 'leaflet', 'leaflet.heat')) return 'maps';
            if (lib('jspdf', 'html2canvas')) return 'pdf';
            if (lib('recharts') || id.includes('/node_modules/d3-') || lib('victory-vendor')) return 'charts';
            if (id.includes('/node_modules/@fullcalendar/')) return 'calendar';
            if (id.includes('/node_modules/@stripe/')) return 'stripe';
            if (id.includes('/node_modules/@paypal/')) return 'paypal';
            return undefined;
          },
        },
      },
    },
  };
});
