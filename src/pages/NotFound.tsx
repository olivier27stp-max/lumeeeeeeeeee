import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../i18n';

export default function NotFound() {
  const { language } = useTranslation();
  const navigate = useNavigate();
  const isFr = language === 'fr';

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 text-6xl font-bold text-text-tertiary">404</div>
      <h1 className="mb-2 text-2xl font-semibold text-text-primary">
        {isFr ? 'Page introuvable' : 'Page not found'}
      </h1>
      <p className="mb-6 max-w-md text-sm text-text-secondary">
        {isFr
          ? 'Le lien que vous avez suivi est peut-être rompu ou la page a été déplacée.'
          : 'The link you followed may be broken, or the page may have been moved.'}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-outline bg-surface px-4 text-sm font-medium text-text-primary hover:bg-surface-secondary"
        >
          {isFr ? 'Retour' : 'Go back'}
        </button>
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover"
        >
          {isFr ? 'Tableau de bord' : 'Dashboard'}
        </button>
      </div>
    </div>
  );
}
