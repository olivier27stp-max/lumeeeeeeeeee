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
          manualChunks: (id: string) => {
            if (id.includes('node_modules')) {
              if (id.includes('mapbox-gl') || id.includes('react-leaflet') || id.includes('leaflet')) return 'maps';
              if (id.includes('fullcalendar')) return 'calendar';
              if (id.includes('recharts')) return 'charts';
              if (id.includes('@xyflow')) return 'xyflow';
              if (id.includes('jspdf') || id.includes('html2canvas')) return 'pdf';
              if (id.includes('@stripe') || id.includes('stripe-js')) return 'stripe';
              if (id.includes('@paypal')) return 'paypal';
              if (id.includes('framer-motion') || id.includes('motion/')) return 'motion';
              if (id.includes('react-router')) return 'router';
              if (id.includes('@tanstack/react-query')) return 'query';
              if (id.includes('react') || id.includes('react-dom')) return 'react';
              return 'vendor';
            }
          },
        },
      },
    },
  };
});
