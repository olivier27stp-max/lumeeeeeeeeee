import React, { type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
  language: 'en' | 'fr';
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: string | null;
}

class AgentErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

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
            {fr ? 'Mr Lume a rencontré une erreur' : 'Mr Lume encountered an error'}
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
            className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            {fr ? 'Réessayer' : 'Try again'}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default AgentErrorBoundary;
