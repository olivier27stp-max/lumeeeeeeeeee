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
          // Only split TRULY heavy libs that benefit from lazy loading. Leave
          // React/motion/router/query in the main bundle — splitting them caused
          // `Cannot read properties of undefined (reading 'createContext')` at
          // runtime because the motion chunk loaded before React was defined.
          // 2026-05-12: simplified after prod regression.
          manualChunks: {
            maps: ['mapbox-gl', 'react-leaflet', 'react-leaflet-cluster', 'leaflet', 'leaflet.heat'],
            pdf: ['jspdf', 'html2canvas'],
            charts: ['recharts'],
            xyflow: ['@xyflow/react'],
            calendar: [
              '@fullcalendar/core',
              '@fullcalendar/daygrid',
              '@fullcalendar/interaction',
              '@fullcalendar/timegrid',
              '@fullcalendar/react',
              '@fullcalendar/list',
            ],
            stripe: ['@stripe/react-stripe-js', '@stripe/stripe-js'],
            paypal: ['@paypal/react-paypal-js'],
          },
        },
      },
    },
  };
});
