import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../../i18n';

interface BackToSettingsProps {
  /** Override destination. Defaults to /settings. */
  to?: string;
}

/**
 * Standardized back-to-settings button.
 * 36×36 rounded square with ArrowLeft icon, placed to the left of a page title.
 * Used across all /settings/* sub-pages for consistent navigation.
 */
export default function BackToSettings({ to = '/settings' }: BackToSettingsProps) {
  const navigate = useNavigate();
  const { language } = useTranslation();
  const label = language === 'fr' ? 'Retour aux paramètres' : 'Back to settings';

  return (
    <button
      type="button"
      onClick={() => navigate(to)}
      className="w-9 h-9 rounded-xl bg-surface-secondary flex items-center justify-center hover:bg-surface-secondary/80 transition-colors shrink-0"
      aria-label={label}
      title={label}
    >
      <ArrowLeft size={16} className="text-text-secondary" />
    </button>
  );
}
