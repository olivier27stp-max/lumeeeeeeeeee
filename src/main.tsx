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
