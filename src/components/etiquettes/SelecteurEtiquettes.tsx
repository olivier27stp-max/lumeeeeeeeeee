/**
 * Étiquettes des clients — la pastille et le sélecteur COMMUNS (étape 2 du
 * plan étiquettes + champs, 2026-09-28) : fiche client, fiche du deal,
 * actions en lot, automatisations. Une seule façon de poser une étiquette.
 *
 * · suggère les étiquettes existantes pendant qu'on tape ;
 * · montre leur couleur (Réglages → Étiquettes) ;
 * · « Créer » n'est offert qu'à qui a « Réglages » (décision D3) — sinon on
 *   finit avec « VIP », « vip » et « V.I.P. ».
 */
import { useId, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { hasPermission } from '../../lib/permissions';
import { usePermissions } from '../../hooks/usePermissions';
import { captureClientException } from '../../lib/sentry';
import { listerEtiquettes, creerEtiquette, couleurDe, type Etiquette } from '../../lib/etiquettesApi';

/** Défaut hors composant : `data = []` dans le rendu recréerait un tableau à chaque passe. */
const AUCUNE: Etiquette[] = [];

export function useEtiquettes() {
  const q = useQuery({ queryKey: ['etiquettes'], queryFn: listerEtiquettes, staleTime: 60_000 });
  return { ...q, etiquettes: q.data ?? AUCUNE };
}

export function usePeutGererEtiquettes(): boolean {
  const { permissions, role } = usePermissions();
  return hasPermission(permissions, 'settings.update', role ?? undefined);
}

/** Texte lisible sur une couleur de fond donnée (noir ou blanc). */
function encre(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#111827' : '#ffffff';
}

export function PastilleEtiquette({ nom, couleur, onRetirer, fr, petite }: {
  nom: string; couleur: string; onRetirer?: () => void; fr: boolean; petite?: boolean;
}) {
  return (
    <span
      className={cn('inline-flex max-w-full items-center gap-1 rounded-full font-medium',
        petite ? 'px-1.5 py-px text-[10.5px]' : 'px-2 py-0.5 text-[11.5px]')}
      style={{ backgroundColor: couleur, color: encre(couleur) }}
    >
      <span className="truncate">{nom}</span>
      {onRetirer && (
        <button type="button" onClick={onRetirer} aria-label={fr ? `Retirer l’étiquette ${nom}` : `Remove tag ${nom}`}
          className="rounded-full opacity-80 hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
          <X size={11} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

export default function SelecteurEtiquettes({ valeurs, onAjouter, onRetirer, fr, lectureSeule }: {
  valeurs: string[];
  onAjouter: (tag: string) => Promise<void> | void;
  onRetirer: (tag: string) => Promise<void> | void;
  fr: boolean;
  lectureSeule?: boolean;
}) {
  const id = useId();
  const qc = useQueryClient();
  const { etiquettes } = useEtiquettes();
  const peutCreer = usePeutGererEtiquettes();
  const [ouvert, setOuvert] = useState(false);
  const [saisie, setSaisie] = useState('');
  const [actif, setActif] = useState(0);
  const champ = useRef<HTMLInputElement>(null);

  const texte = saisie.trim();
  const suggestions = useMemo(() => {
    const pris = new Set(valeurs.map((v) => v.toLowerCase()));
    const q = texte.toLowerCase();
    return etiquettes
      .filter((e) => !pris.has(e.nom.toLowerCase()) && (!q || e.nom.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [etiquettes, valeurs, texte]);
  const existe = etiquettes.some((e) => e.nom.toLowerCase() === texte.toLowerCase());
  const dejaPosee = valeurs.some((v) => v.toLowerCase() === texte.toLowerCase());
  const offrirCreation = !!texte && !existe && !dejaPosee && peutCreer;
  const options = [...suggestions.map((e) => e.nom), ...(offrirCreation ? [`__creer__`] : [])];

  const choisir = async (nom: string) => {
    try {
      if (nom === '__creer__') {
        const cree = await creerEtiquette(texte);
        await qc.invalidateQueries({ queryKey: ['etiquettes'] });
        await onAjouter(cree.nom);
      } else {
        await onAjouter(nom);
      }
      setSaisie(''); setActif(0);
      champ.current?.focus();
    } catch (err) {
      console.error('[etiquettes] ajout impossible', err);
      captureClientException(err, { contexte: 'SelecteurEtiquettes.choisir' });
      toast.error(err instanceof Error && err.message ? err.message : (fr ? 'Impossible d’ajouter l’étiquette.' : 'Could not add the tag.'));
    }
  };

  const retirer = async (nom: string) => {
    try {
      await onRetirer(nom);
    } catch (err) {
      console.error('[etiquettes] retrait impossible', err);
      captureClientException(err, { contexte: 'SelecteurEtiquettes.retirer' });
      toast.error(fr ? 'Impossible de retirer l’étiquette.' : 'Could not remove the tag.');
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {valeurs.map((v) => (
        <PastilleEtiquette key={v} nom={v} couleur={couleurDe(etiquettes, v)} fr={fr}
          onRetirer={lectureSeule ? undefined : () => void retirer(v)} />
      ))}
      {!lectureSeule && !ouvert && (
        <button type="button" onClick={() => { setOuvert(true); setTimeout(() => champ.current?.focus(), 0); }}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-outline px-2 py-0.5 text-[11.5px] text-text-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          <Plus size={11} aria-hidden="true" /> {fr ? 'Étiquette' : 'Tag'}
        </button>
      )}
      {!lectureSeule && ouvert && (
        <div className="relative">
          <input
            ref={champ}
            id={`${id}-saisie`}
            role="combobox"
            aria-expanded={options.length > 0}
            aria-controls={`${id}-liste`}
            aria-autocomplete="list"
            aria-activedescendant={options[actif] ? `${id}-o${actif}` : undefined}
            aria-label={fr ? 'Ajouter une étiquette' : 'Add a tag'}
            value={saisie}
            maxLength={60}
            placeholder={fr ? 'Chercher une étiquette…' : 'Search tags…'}
            onChange={(e) => { setSaisie(e.target.value); setActif(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActif((a) => Math.min(a + 1, options.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActif((a) => Math.max(a - 1, 0)); }
              else if (e.key === 'Enter') { e.preventDefault(); if (options[actif]) void choisir(options[actif]); }
              else if (e.key === 'Escape') { setOuvert(false); setSaisie(''); }
            }}
            onBlur={() => setTimeout(() => { setOuvert(false); setSaisie(''); }, 150)}
            className="h-7 w-44 rounded-full border border-outline bg-surface-card px-2.5 text-[12px] text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          />
          {(options.length > 0 || (texte && !existe && !dejaPosee && !peutCreer)) && (
            <ul id={`${id}-liste`} role="listbox" aria-label={fr ? 'Étiquettes' : 'Tags'}
              className="absolute left-0 top-8 z-30 w-60 overflow-hidden rounded-xl border border-outline bg-surface-card py-1 shadow-lg">
              {options.map((o, i) => (
                <li key={o} id={`${id}-o${i}`} role="option" aria-selected={i === actif} tabIndex={-1}
                  onMouseDown={(e) => { e.preventDefault(); void choisir(o); }}
                  onMouseEnter={() => setActif(i)}
                  className={cn('flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[12.5px] text-text-primary', i === actif && 'bg-surface-secondary')}>
                  {o === '__creer__' ? (
                    <><Plus size={12} aria-hidden="true" /> {fr ? `Créer « ${texte} »` : `Create “${texte}”`}</>
                  ) : (
                    <><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: couleurDe(etiquettes, o) }} aria-hidden="true" />{o}</>
                  )}
                </li>
              ))}
              {texte && !existe && !dejaPosee && !peutCreer && (
                <li role="option" aria-selected={false} aria-disabled="true" className="px-3 py-1.5 text-[11.5px] text-text-tertiary">
                  {fr ? 'Seuls les administrateurs créent de nouvelles étiquettes (Réglages → Étiquettes).' : 'Only admins create new tags (Settings → Tags).'}
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
