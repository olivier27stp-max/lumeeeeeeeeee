import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationGuardProvider } from './contexts/NavigationGuard';
import { LanguageProvider } from './i18n';
import ErrorBoundary from './components/ErrorBoundary';
import { ConfirmDialogHost } from './components/ui/ConfirmDialog';
import { initSentryClient } from './lib/sentry';
import './lib/apiOrgHeader'; // bureau sélectionné → x-org-id sur tous les appels /api (multi-bureaux)
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

/*
 * ÉCHEC DE PRÉCHARGEMENT (`vite:preloadError`).
 *
 * Vite précharge les fichiers des pages dès l'ouverture. Après un
 * déploiement, un onglet resté ouvert demande des noms qui n'existent
 * plus, et cet événement part AVANT tout clic.
 *
 * On se contente de NEUTRALISER l'événement, sans recharger.
 *
 * Pourquoi pas de rechargement ici : un préchargement est une optimisation,
 * pas un besoin. Recharger à sa place consommait le budget anti-boucle de
 * `lazyResilient` (même clé), qui se retrouvait ensuite incapable de
 * recharger pour de vrai et laissait la page sur
 * « Chargement de l'espace… » indéfiniment — observé en prod le
 * 2026-09-25. Le vrai `import()` suivra au moment où la page est
 * demandée ; `lazyResilient` sait alors réessayer puis recharger.
 *
 * `preventDefault()` évite l'erreur non capturée dans la console.
 */
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
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
        {/* Fenêtre de confirmation applicative (remplace confirm() natif) — montée une seule fois */}
        <ConfirmDialogHost />
      </LanguageProvider>
    </ErrorBoundary>
  </StrictMode>,
);
