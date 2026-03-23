import React, { type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from '../i18n';

interface Props {
  children: ReactNode;
  language: 'en' | 'fr';
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: string | null;
}

// React.Component generics are unresolved because @types/react is not installed
// (React 19 ships JS-only; types require @types/react@19). Cast to restore typing.
const TypedComponent: new (props: Props) => React.Component<Props, State> = React.Component as any;

class AgentErrorBoundary extends TypedComponent {
  declare state: State;
  declare props: Readonly<Props> & Readonly<{ children?: ReactNode }>;
  declare setState: (state: Partial<State>) => void;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[AgentErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      const fr = this.props.language === 'fr';
      return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center px-4">
          <div className="w-12 h-12 rounded-xl bg-surface-secondary flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={20} className="text-text-tertiary" />
          </div>
          <h2 className="text-lg font-bold text-text-primary mb-2">
            {t.agent.mrLumeEncounteredAnError}
          </h2>
          <p className="text-sm text-text-tertiary mb-4 max-w-md">
            {fr
              ? 'Une erreur inattendue est survenue. Veuillez réessayer.'
              : 'An unexpected error occurred. Please try again.'}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              this.props.onReset?.();
            }}
            className="px-4 py-2 rounded-lg bg-text-primary text-surface text-sm font-medium hover:opacity-90 transition-opacity"
          >
            {t.agent.tryAgain}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default AgentErrorBoundary;
