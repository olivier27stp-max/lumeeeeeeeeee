import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationGuardProvider } from './contexts/NavigationGuard';
import { LanguageProvider } from './i18n';
import ErrorBoundary from './components/ErrorBoundary';
import { initSentryClient } from './lib/sentry';
import App from './App.tsx';
import './index.css';
import 'leaflet/dist/leaflet.css';

// Sentry: no-op if VITE_SENTRY_DSN not set
initSentryClient();

// Root-level crash screen labels: this boundary sits above LanguageProvider,
// so fall back to the browser language to pick FR/EN (mirrors t.errorBoundary).
const rootIsFr = (navigator.language || '').toLowerCase().startsWith('fr');
const rootErrorLabels = rootIsFr
  ? {
      title: 'Une erreur est survenue',
      description: "Une erreur inattendue s'est produite lors du rendu de cette section.",
      tryAgain: 'Réessayer',
    }
  : {
      title: 'Something went wrong',
      description: 'An unexpected error occurred while rendering this section.',
      tryAgain: 'Try Again',
    };

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Auto-guérison après déploiement : les chunks lazy de l'ancien index.html
// n'existent plus sur le serveur (« Failed to fetch dynamically imported
// module ») — on recharge la page une fois pour reprendre le nouvel index.
// Garde anti-boucle : au plus un reload par 30 s.
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'lume-chunk-reload-at';
  const last = Number(sessionStorage.getItem(KEY) || 0);
  if (Date.now() - last > 30_000) {
    sessionStorage.setItem(KEY, String(Date.now()));
    event.preventDefault();
    window.location.reload();
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary labels={rootErrorLabels}>
      <LanguageProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <NavigationGuardProvider>
              <App />
            </NavigationGuardProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </LanguageProvider>
    </ErrorBoundary>
  </StrictMode>,
);
