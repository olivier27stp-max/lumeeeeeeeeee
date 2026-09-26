/**
 * Pièces partagées par le modal « Créer / Modifier le pipeline » et la page
 * détail d'un pipeline — calquées sur GoHighLevel (onglet Pipelines).
 *
 * Deux écrans, une seule définition : une carte « Couleurs » qui divergerait
 * entre le modal et la page détail ferait croire à deux réglages différents.
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { ChevronDown, Filter, PieChart } from 'lucide-react';
import type { ModeCouleur } from '../../../lib/pipelineVentesApi';

const TEINTE_APERCU = 'var(--color-info)';

/** Interrupteur accessible (role="switch"). */
export function Interrupteur({ actif, onChange, libelle, disabled }: {
  actif: boolean;
  onChange: (v: boolean) => void;
  libelle: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={actif}
      aria-label={libelle}
      disabled={disabled}
      onClick={() => onChange(!actif)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary disabled:opacity-50 ${actif ? 'bg-primary' : 'bg-surface-tertiary'}`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${actif ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
      />
    </button>
  );
}

/** Carte « Utiliser la probabilité par opportunité ». */
export function CarteProbabilite({ fr, actif, onChange, disabled }: {
  fr: boolean;
  actif: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-outline bg-surface-card px-4 py-3">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-text-primary">
          {fr ? 'Utiliser la probabilité par opportunité' : 'Use opportunity-level probability'}
        </p>
        <p className="mt-0.5 text-[12px] text-text-tertiary">
          {fr
            ? 'Activé : chaque opportunité utilise sa propre probabilité. Désactivé : la probabilité est celle de l’étape.'
            : 'When enabled, each opportunity uses its own probability. When disabled, probability is based on the stage.'}
        </p>
      </div>
      <Interrupteur
        actif={actif}
        onChange={onChange}
        disabled={disabled}
        libelle={fr ? 'Utiliser la probabilité par opportunité' : 'Use opportunity-level probability'}
      />
    </div>
  );
}

const MODES: { cle: ModeCouleur; fr: string; en: string }[] = [
  { cle: 'none', fr: 'Par défaut (sans couleur)', en: 'Default (no color)' },
  { cle: 'dot', fr: 'Point de couleur', en: 'Colored dot' },
  { cle: 'tint', fr: 'Fond teinté', en: 'Background tint' },
];

/** Carte « Couleurs d'affichage du pipeline » : trois aperçus sélectionnables. */
export function CarteCouleurs({ fr, valeur, onChange, disabled, compact }: {
  fr: boolean;
  valeur: ModeCouleur;
  onChange: (v: ModeCouleur) => void;
  disabled?: boolean;
  /** Dans le modal (étroit) : titre AU-DESSUS des trois aperçus, toujours. */
  compact?: boolean;
}) {
  const idTitre = useId();
  return (
    <div className={`flex flex-col gap-3 rounded-lg border border-outline bg-surface-card px-4 py-3 ${compact ? '' : 'xl:flex-row xl:items-center xl:justify-between'}`}>
      <div className="min-w-0">
        <p id={idTitre} className="text-[13px] font-semibold text-text-primary">
          {fr ? 'Couleurs d’affichage du pipeline' : 'Set pipeline display colors'}
        </p>
        <p className="mt-0.5 text-[12px] text-text-tertiary">
          {fr
            ? 'Comment la couleur des étapes apparaît dans vos vues du pipeline.'
            : 'Choose how stage colors appear across your pipeline views.'}
        </p>
      </div>
      <div role="radiogroup" aria-labelledby={idTitre} className={`grid grid-cols-3 gap-2 ${compact ? '' : 'xl:w-[420px] xl:shrink-0'}`}>
        {MODES.map((m) => {
          const choisi = valeur === m.cle;
          return (
            <button
              key={m.cle}
              type="button"
              role="radio"
              aria-checked={choisi}
              disabled={disabled}
              onClick={() => onChange(m.cle)}
              className={`flex min-w-0 flex-col items-center gap-1 rounded-lg border px-2 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary disabled:opacity-50 ${choisi ? 'border-primary bg-primary/5' : 'border-outline hover:bg-surface-secondary'}`}
            >
              <span
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded px-1.5 py-0.5 text-[11.5px] font-medium text-text-primary"
                style={m.cle === 'tint' ? { background: `color-mix(in srgb, ${TEINTE_APERCU} 16%, transparent)` } : undefined}
              >
                {m.cle === 'dot' && <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: TEINTE_APERCU }} />}
                {fr ? 'Nom d’étape' : 'Stage name'}
              </span>
              <span className={`text-[11px] ${choisi ? 'text-primary' : 'text-text-tertiary'}`}>{fr ? m.fr : m.en}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * « Afficher dans les rapports » : entonnoir (entonnoir + prévisions) et
 * camembert (répartition par étape), indépendants, + chevron qui déplie le
 * détail de l'étape (nom anglais, conseil au vendeur, automatisations).
 */
export function IconesRapports({ fr, nomEtape, entonnoir, camembert, onEntonnoir, onCamembert, deplie, onDeplier, disabled }: {
  fr: boolean;
  nomEtape: string;
  entonnoir: boolean;
  camembert: boolean;
  onEntonnoir: (v: boolean) => void;
  onCamembert: (v: boolean) => void;
  deplie?: boolean;
  onDeplier?: () => void;
  disabled?: boolean;
}) {
  const classe = (actif: boolean) =>
    `rounded-md p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary disabled:opacity-50 ${actif ? 'text-text-primary bg-surface-secondary' : 'text-text-muted opacity-50 hover:opacity-100'}`;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-pressed={entonnoir}
        disabled={disabled}
        onClick={() => onEntonnoir(!entonnoir)}
        aria-label={fr ? `« ${nomEtape} » dans l’entonnoir` : `“${nomEtape}” in funnel chart`}
        title={fr ? 'Entonnoir' : 'Funnel chart'}
        className={classe(entonnoir)}
      >
        <Filter size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-pressed={camembert}
        disabled={disabled}
        onClick={() => onCamembert(!camembert)}
        aria-label={fr ? `« ${nomEtape} » dans le graphique circulaire` : `“${nomEtape}” in pie chart`}
        title={fr ? 'Graphique circulaire' : 'Pie chart'}
        className={classe(camembert)}
      >
        <PieChart size={14} aria-hidden="true" />
      </button>
      {onDeplier && (
        <button
          type="button"
          aria-expanded={!!deplie}
          onClick={onDeplier}
          aria-label={fr ? `Détails de « ${nomEtape} »` : `Details of “${nomEtape}”`}
          className="ml-auto rounded-md p-1.5 text-text-tertiary hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
        >
          <ChevronDown size={14} aria-hidden="true" className={deplie ? 'rotate-180 transition-transform' : 'transition-transform'} />
        </button>
      )}
    </div>
  );
}

/** Les 4 étapes proposées d'office (mission : FR, 20/40/60/80) + Gagné/Perdu verrouillées. */
export function etapesParDefaut() {
  const ouvertes = [
    ['Nouveau lead', 'New lead', 20], ['Contacté', 'Contacted', 40],
    ['Soumission envoyée', 'Proposal sent', 60], ['Fermé', 'Closed', 80],
  ];
  return [
    ...ouvertes.map(([nom_fr, nom_en, p]) => ({
      nom_fr: nom_fr as string, nom_en: nom_en as string, kind: 'open' as const,
      probability: p as number, show_in_reports: true, show_in_pie: true,
    })),
    { nom_fr: 'Gagné', nom_en: 'Won', kind: 'won' as const, probability: 100, show_in_reports: true, show_in_pie: true },
    { nom_fr: 'Perdu', nom_en: 'Lost', kind: 'lost' as const, probability: 0, show_in_reports: true, show_in_pie: true },
  ];
}

/** « 14.29 » → 14.29 ; vide → null ; hors bornes → NaN (refusé à l'envoi). */
export function lireProbabilite(texte: string): number | null {
  const t = texte.replace(',', '.').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * Place un menu déroulant PAR-DESSUS la page, sous son bouton.
 *
 * Les tableaux défilent horizontalement (`overflow-x-auto`) : un menu posé
 * en `absolute` dedans est ROGNÉ par le conteneur — vu en vrai navigateur,
 * seul « Modifier » dépassait. En `fixed`, calé sur le bouton, il échappe au
 * rognage. Il se referme au défilement plutôt que de flotter à côté.
 */
export function usePlacementMenu(ouvert: boolean, bouton: RefObject<HTMLElement | null>, fermer: () => void): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', visibility: 'hidden' });
  // `fermer` est souvent une flèche recréée à chaque rendu : en dépendre
  // relancerait l'effet, qui repositionne, qui rend… — boucle infinie vue en
  // vrai navigateur (« Maximum update depth exceeded »). On lit la dernière
  // version par une référence.
  const fermerRef = useRef(fermer);
  fermerRef.current = fermer;
  useEffect(() => {
    if (!ouvert || !bouton.current) return;
    const r = bouton.current.getBoundingClientRect();
    const bas = window.innerHeight - r.bottom;
    setStyle({
      position: 'fixed',
      right: Math.max(8, window.innerWidth - r.right),
      // Trop près du bas de l'écran : le menu s'ouvre vers le HAUT.
      ...(bas < 300 ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    });
    const surDefilement = () => fermerRef.current();
    window.addEventListener('scroll', surDefilement, true);
    window.addEventListener('resize', surDefilement);
    return () => { window.removeEventListener('scroll', surDefilement, true); window.removeEventListener('resize', surDefilement); };
  }, [ouvert, bouton]);
  return style;
}
