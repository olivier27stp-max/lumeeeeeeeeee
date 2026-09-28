/**
 * Filtre « Étiquettes » — panneau de filtres de la pipeline et liste Clients
 * (étape 3 du plan étiquettes + champs, 2026-09-28).
 *
 * Les étiquettes proposées sont celles du catalogue (Réglages → Étiquettes),
 * avec leur couleur. On coche celles qu'il faut AVOIR (toutes / au moins
 * une) et, dans la pipeline, celles qu'il ne faut PAS avoir.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { Check, Tag, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { couleurDe, type Etiquette } from '../../lib/etiquettesApi';
import { nbFiltresEtiquettes, type FiltreEtiquettes, type ModeEtiquettes } from '../../lib/etiquettesFiltre';
import { useEtiquettes } from './SelecteurEtiquettes';

function basculer(liste: string[], nom: string): string[] {
  return liste.some((x) => x.toLowerCase() === nom.toLowerCase())
    ? liste.filter((x) => x.toLowerCase() !== nom.toLowerCase())
    : [...liste, nom];
}

/** Une rangée de pastilles à cocher (boutons à bascule, lisibles au clavier). */
function ChoixEtiquettes({ legende, valeurs, etiquettes, onChange, fr }: {
  legende: string;
  valeurs: string[];
  etiquettes: Etiquette[];
  onChange: (v: string[]) => void;
  fr: boolean;
}) {
  const pris = new Set(valeurs.map((v) => v.toLowerCase()));
  // Une étiquette choisie (vue enregistrée) qui n'existe plus au catalogue reste visible pour être décochée.
  const noms = [...etiquettes.map((e) => e.nom), ...valeurs.filter((v) => !etiquettes.some((e) => e.nom.toLowerCase() === v.toLowerCase()))];
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-[11px] text-text-tertiary">{legende}</legend>
      <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
        {noms.length === 0 && (
          <span className="text-[11.5px] text-text-muted">{fr ? 'Aucune étiquette pour l’instant.' : 'No tags yet.'}</span>
        )}
        {noms.map((nom) => {
          const actif = pris.has(nom.toLowerCase());
          return (
            <button
              key={nom}
              type="button"
              aria-pressed={actif}
              onClick={() => onChange(basculer(valeurs, nom))}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary',
                actif ? 'border-outline-strong bg-surface-card font-semibold text-text-primary' : 'border-outline text-text-secondary hover:bg-surface-card',
              )}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: couleurDe(etiquettes, nom) }} aria-hidden="true" />
              {nom}
              {actif && <Check size={11} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Le filtre complet, à poser dans un panneau. `avecExclusion` ajoute la
 * rangée « N'a pas » (la pipeline filtre en mémoire ; la liste Clients,
 * filtrée en base, ne l'offre pas).
 */
export function PanneauFiltreEtiquettes({ valeur, onChange, fr, avecExclusion = true }: {
  valeur: FiltreEtiquettes;
  onChange: (f: FiltreEtiquettes) => void;
  fr: boolean;
  avecExclusion?: boolean;
}) {
  const idMode = useId();
  const { etiquettes, isLoading } = useEtiquettes();
  return (
    <div className="flex min-w-[240px] max-w-[420px] flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-text-secondary">{fr ? 'Étiquettes du client' : 'Client tags'}</span>
        <label htmlFor={idMode} className="sr-only">{fr ? 'Mode du filtre d’étiquettes' : 'Tag filter mode'}</label>
        <select
          id={idMode}
          value={valeur.mode}
          onChange={(e) => onChange({ ...valeur, mode: e.target.value as ModeEtiquettes })}
          className="ml-auto rounded-md border border-outline-strong bg-surface-card px-1.5 py-0.5 text-[11.5px] text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
        >
          <option value="une">{fr ? 'a au moins une' : 'has any'}</option>
          <option value="toutes">{fr ? 'a toutes' : 'has all'}</option>
        </select>
      </div>
      {isLoading ? (
        <span className="text-[11.5px] text-text-muted">{fr ? 'Chargement…' : 'Loading…'}</span>
      ) : (
        <>
          <ChoixEtiquettes legende={fr ? 'A l’étiquette' : 'Has tag'} valeurs={valeur.avec} etiquettes={etiquettes}
            onChange={(avec) => onChange({ ...valeur, avec })} fr={fr} />
          {avecExclusion && (
            <ChoixEtiquettes legende={fr ? 'N’a pas l’étiquette' : 'Doesn’t have tag'} valeurs={valeur.sans} etiquettes={etiquettes}
              onChange={(sans) => onChange({ ...valeur, sans })} fr={fr} />
          )}
        </>
      )}
    </div>
  );
}

/**
 * Pastille de barre d'outils (liste Clients) : « Étiquettes | VIP, Été »,
 * qui ouvre le panneau. Même allure que `FilterPill`.
 */
export function BoutonFiltreEtiquettes({ valeur, onChange, fr }: {
  valeur: FiltreEtiquettes;
  onChange: (f: FiltreEtiquettes) => void;
  fr: boolean;
}) {
  const [ouvert, setOuvert] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const idPanneau = useId();
  useEffect(() => {
    if (!ouvert) return;
    const fermer = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOuvert(false); };
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape') setOuvert(false); };
    document.addEventListener('mousedown', fermer);
    document.addEventListener('keydown', echap);
    return () => { document.removeEventListener('mousedown', fermer); document.removeEventListener('keydown', echap); };
  }, [ouvert]);
  const actif = nbFiltresEtiquettes(valeur) > 0;
  const resume = valeur.avec.length === 0
    ? (fr ? 'Toutes' : 'All')
    : valeur.avec.length <= 2 ? valeur.avec.join(valeur.mode === 'toutes' ? ' + ' : ', ') : `${valeur.avec.length}`;
  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-expanded={ouvert}
        aria-controls={idPanneau}
        className={cn('inline-flex h-9 items-center whitespace-nowrap border border-outline bg-surface-secondary px-3.5 text-[13px] transition-colors hover:bg-surface-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          actif ? 'rounded-l-lg border-r-0 pr-2' : 'rounded-lg')}
      >
        <Tag size={13} aria-hidden="true" className="mr-1.5 text-text-tertiary" />
        <span className="font-medium text-text-secondary">{fr ? 'Étiquettes' : 'Tags'}</span>
        <span aria-hidden="true" className="mx-2.5 h-4 w-px bg-outline" />
        <span className="max-w-[180px] truncate font-medium text-text-primary">{resume}</span>
      </button>
      {actif && (
        <button
          type="button"
          onClick={() => { onChange({ ...valeur, avec: [], sans: [] }); setOuvert(false); }}
          aria-label={fr ? 'Retirer le filtre d’étiquettes' : 'Clear tag filter'}
          className="inline-flex h-9 items-center rounded-r-lg border border-l-0 border-outline bg-surface-secondary pl-1 pr-2.5 text-text-tertiary transition-colors hover:bg-surface-tertiary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
      {ouvert && (
        <div id={idPanneau} className="absolute left-0 top-full z-50 mt-1 rounded-md border border-outline bg-surface-card p-3 shadow-lg">
          <PanneauFiltreEtiquettes valeur={valeur} onChange={onChange} fr={fr} avecExclusion={false} />
        </div>
      )}
    </div>
  );
}
