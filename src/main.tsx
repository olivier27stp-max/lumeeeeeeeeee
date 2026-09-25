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
import { installerDetectionVersion } from './lib/nouvelleVersion';

// Sentry: no-op if VITE_SENTRY_DSN not set
initSentryClient();

/*
 * Libellés de l'écran d'erreur racine. Cette barrière est AU-DESSUS de
 * `LanguageProvider`, donc elle ne peut pas utiliser `t()` : on refait
 * ici le même choix de langue qu'elle.
 *
 * On lit le choix enregistré, et à défaut on prend le FRANÇAIS — comme
 * `LanguageContext` depuis #500, qui ignore délibérément
 * `navigator.language`. Cet écran était resté en dehors de cette
 * décision : un client québécois dont le navigateur est en anglais
 * voyait « Something went wrong » alors que toute l'app lui parle
 * français. Observé en prod le 2026-09-25.
 */
let rootIsFr = true;
try {
  rootIsFr = localStorage.getItem('lume-language') !== 'en';
} catch {
  // Stockage indisponible (mode privé) : le français par défaut.
}
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
 * PAS DE GESTIONNAIRE `vite:preloadError` — et c'est délibéré.
 *
 * Vite enveloppe chaque `import()` dans un helper qui émet cet
 * événement quand le PRÉchargement échoue. Piège : si un gestionnaire
 * appelle `preventDefault()`, Vite considère l'erreur comme traitée et
 * laisse la promesse se résoudre à `undefined` au lieu de rejeter.
 *
 * C'est exactement ce qui s'est produit en prod le 2026-09-25 : l'écran
 * affichait « Cannot read properties of undefined (reading 'default') »,
 * en anglais, et `lazyResilient` n'était JAMAIS atteint — son `catch` ne
 * voyait rien, puisque rien n'avait échoué de son point de vue.
 *
 * Pourquoi pas de rechargement ici : un préchargement est une optimisation,
 * pas un besoin. Recharger à sa place consommait le budget anti-boucle de
 * `lazyResilient` (même clé), qui se retrouvait ensuite incapable de
 * recharger pour de vrai et laissait la page sur
 * « Chargement de l'espace… » indéfiniment — observé en prod le
 * 2026-09-25. Le vrai `import()` suivra au moment où la page est
 * demandée ; `lazyResilient` sait alors réessayer puis recharger.
 *
 * SURTOUT PAS `preventDefault()`. Le préchargeur de Vite enveloppe l'import
 * de la page : `return importDeLaPage().catch(gererErreur)`, et gererErreur
 * ne relance l'erreur QUE si l'événement n'a pas été annulé. Annulé, l'import
 * se résout à `undefined` au lieu d'échouer : React lit alors `.default` sur
 * rien (« Cannot read properties of undefined (reading 'default') », écran
 * rouge sur toutes les pages après un déploiement, 2026-09-25) et
 * `lazyResilient` ne voit jamais d'échec, donc ne recharge jamais.
 * On laisse l'erreur remonter : c'est `lazyResilient` qui la traite.
 */
// Une nouvelle version en ligne : le prochain changement de page charge la page à jour.
installerDetectionVersion();

window.addEventListener('vite:preloadError', (event) => {
  console.warn('[chargement] préchargement raté — lazyResilient prendra le relais', event.payload);
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
