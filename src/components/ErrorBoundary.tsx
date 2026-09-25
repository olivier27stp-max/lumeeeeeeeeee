// @ts-nocheck — React class component requires @types/react which this project omits
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { captureClientException } from '../lib/sentry';

interface Props {
  children: ReactNode;
  labels?: {
    title?: string;
    description?: string;
    tryAgain?: string;
  };
}

interface State {
  hasError: boolean;
  error: Error | null;
  /** L'URL au moment de l'erreur — pour réarmer quand on navigue ailleurs. */
  url?: string | null;
}

/**
 * La langue choisie, ou le français à défaut (#500 : la langue du
 * navigateur est délibérément ignorée). Une classe React ne peut pas
 * consommer le contexte i18n, et cette barrière sert aussi au-dessus de
 * `LanguageProvider`.
 */
function lireLangueEnregistree(): string {
  try {
    return localStorage.getItem('lume-language') || 'fr';
  } catch {
    return 'fr';
  }
}

class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, url: null };

  static getDerivedStateFromError(error: Error): State {
    // L'URL sert de repère : on réarme dès qu'elle change (voir
    // componentDidUpdate).
    return { hasError: true, error, url: window.location.href };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, info.componentStack);
    // React intercepte les erreurs de rendu : elles ne remontent PAS au
    // handler global de Sentry. Sans cet appel, un écran blanc chez un client
    // ne laisse aucune trace ailleurs que dans SA console. No-op sans DSN ;
    // l'org courante est déjà attachée au scope par CompanyContext.
    captureClientException(error, { componentStack: info.componentStack });
  }

  /**
   * Réarmer quand on CHANGE de page.
   *
   * Sans ça, une erreur restait affichée pour toujours : cette barrière
   * enveloppe toutes les routes, et rien ne remettait `hasError` à false.
   * Naviguer ailleurs montrait encore l'écran rouge de la page précédente
   * — c'est le « bloqué » signalé le 2026-09-25 sur Automatisations.
   *
   * On compare l'URL à celle du moment de l'erreur : dès qu'elle change,
   * on laisse la nouvelle page se rendre.
   */
  componentDidUpdate() {
    if (this.state.hasError && this.state.url && window.location.href !== this.state.url) {
      this.setState({ hasError: false, error: null, url: null });
    }
  }

  /**
   * « Réessayer » ne suffisait pas sur un chunk manquant.
   *
   * Remettre `hasError` à false relance le MÊME import, que le navigateur
   * a mis en cache en échec : il redemande le fichier disparu et échoue
   * encore. Pour cette erreur-là, seul un rechargement reprend le nouvel
   * index.html — donc les nouveaux noms de fichiers.
   */
  handleReset = () => {
    const message = this.state.error?.message ?? '';
    if (/dynamically imported module|Importing a module script failed|Failed to fetch/i.test(message)) {
      window.location.reload();
      return;
    }
    this.setState({ hasError: false, error: null, url: null });
  };

  render() {
    if (this.state.hasError) {
      /*
       * Repli quand aucun `labels` n'est fourni — le cas des barrières de
       * section, qui n'en passent pas. Il était en ANGLAIS en dur : un
       * client québécois lisait « Something went wrong » au milieu d'une
       * app entièrement en français. Observé en prod le 2026-09-25.
       *
       * Le français est la langue par défaut de Lume (#500) : le repli
       * doit l'être aussi. Cette classe ne peut pas appeler `t()` — elle
       * sert aussi au-dessus de `LanguageProvider` — d'où la lecture
       * directe du choix enregistré.
       */
      const enAnglais = lireLangueEnregistree() === 'en';
      const title = this.props.labels?.title
        || (enAnglais ? 'Something went wrong' : 'Une erreur est survenue');
      const description =
        this.props.labels?.description
        || (enAnglais
          ? 'An unexpected error occurred while rendering this section.'
          : 'Une erreur inattendue s’est produite lors du rendu de cette section.');
      const tryAgain = this.props.labels?.tryAgain
        || (enAnglais ? 'Try Again' : 'Réessayer');

      return (
        <div className="flex items-center justify-center py-20 px-6">
          <div className="bg-surface border border-outline rounded-xl p-8 max-w-md w-full text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-warning-light flex items-center justify-center">
              <AlertTriangle size={24} className="text-warning" />
            </div>
            <h2 className="text-[15px] font-bold text-text-primary">{title}</h2>
            <p className="text-[13px] text-text-secondary">{description}</p>
            {this.state.error && (
              <p className="text-[11px] text-text-tertiary bg-surface-secondary rounded-lg px-3 py-2 break-all">
                {this.state.error.message}
              </p>
            )}
            <button
              onClick={this.handleReset}
              className="glass-button-primary mt-2"
            >
              {tryAgain}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
