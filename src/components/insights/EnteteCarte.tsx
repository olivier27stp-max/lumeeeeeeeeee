/**
 * En-tête commune des cartes de /insights : titre, définition courte (ce que le chiffre compte
 * exactement), variation vs période précédente, filtres NON appliqués par cette carte, et le
 * bouton « Voir le détail » (les lignes qui font le chiffre).
 */
import type { ReactNode } from 'react';
import { useTranslation } from '../../i18n';
import type { CleFiltre } from '../../lib/statsFiltres';

const NOMS: Record<CleFiltre, { fr: string; en: string }> = {
  equipe: { fr: 'équipe', en: 'team' },
  technicien: { fr: 'technicien', en: 'technician' },
  vendeur: { fr: 'vendeur', en: 'sales rep' },
  client: { fr: 'client', en: 'client' },
  service: { fr: 'service', en: 'service' },
};

export function PastilleVariation({ v, titre }: { v: { texte: string; sens: 'hausse' | 'baisse' | 'stable' } | null | undefined; titre?: string }) {
  const { language } = useTranslation();
  if (!v) return null;
  return (
    <span data-variation={v.sens} title={titre ?? (language === 'fr' ? 'par rapport à la période précédente' : 'vs previous period')}
      className="text-[12.5px] font-bold tabular-nums text-text-secondary">
      {v.texte}
    </span>
  );
}

export default function EnteteCarte({ titre, definition, droite, nonAppliques = [], onDetail }: {
  titre: string;
  definition?: string;
  droite?: ReactNode;
  nonAppliques?: CleFiltre[];
  onDetail?: () => void;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1 px-6 pb-3 border-b border-border">
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-text-tertiary leading-none">{titre}</h3>
        {definition && <p className="mt-1.5 text-[11.5px] text-text-tertiary">{definition}</p>}
        {nonAppliques.length > 0 && (
          <p className="mt-1 text-[11px] font-semibold text-text-secondary">
            {fr ? 'Filtre non appliqué ici : ' : 'Filter not applied here: '}{nonAppliques.map((k) => (fr ? NOMS[k].fr : NOMS[k].en)).join(', ')}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3">
        {droite}
        {onDetail && (
          <button type="button" onClick={onDetail}
            className="text-[12.5px] font-semibold text-text-primary border-b border-text-tertiary hover:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-tertiary rounded-sm">
            {fr ? 'Voir le détail' : 'View details'}
          </button>
        )}
      </div>
    </div>
  );
}
