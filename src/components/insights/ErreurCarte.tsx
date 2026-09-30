/**
 * Carte de /insights en erreur : on le DIT, avec un bouton pour réessayer.
 * Un zéro affiché sur une panne ressemble à une période sans activité.
 */
import { useTranslation } from '../../i18n';

export default function ErreurCarte({ onRetry, hauteur = 120 }: { onRetry: () => void; hauteur?: number }) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-2 text-center px-6" style={{ minHeight: hauteur }}>
      <div className="text-[12.5px] text-text-secondary">{fr ? 'Impossible de charger ces chiffres.' : 'Could not load these figures.'}</div>
      <button type="button" onClick={(e) => { e.stopPropagation(); onRetry(); }} className="text-[12.5px] font-semibold text-text-primary border-b border-text-tertiary hover:opacity-70 transition-opacity">{fr ? 'Réessayer' : 'Retry'}</button>
    </div>
  );
}
