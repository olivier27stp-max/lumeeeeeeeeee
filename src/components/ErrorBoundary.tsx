// @ts-nocheck — React class component requires @types/react which this project omits
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { getTranslations } from '../i18n';

interface Props {
  children: ReactNode;
  labels?: {
    title?: string;
    description?: string;
    tryAgain?: string;
  };
  language?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const t = getTranslations(this.props.language || 'en');
      const title = this.props.labels?.title || t.errorBoundary.title;
      const description =
        this.props.labels?.description || t.errorBoundary.description;
      const tryAgain = this.props.labels?.tryAgain || t.errorBoundary.tryAgain;

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
