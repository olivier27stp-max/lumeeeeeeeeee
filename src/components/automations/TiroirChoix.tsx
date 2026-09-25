/* ═══════════════════════════════════════════════════════════════
   Le tiroir « Ajouter un déclencheur » / « Actions »

   Celui des captures de GoHighLevel : un panneau qui s'ouvre à droite,
   une recherche en haut, et TOUT ce qui est disponible, groupé par
   famille — pas un menu déroulant à quatre lignes.

     ┌──────────────────────────────────┐
     │ Actions                       ✕  │
     ├──────────────────────────────────┤
     │ 🔍 Rechercher une action         │
     ├──────────────────────────────────┤
     │ COMMUNICATION                    │
     │  ✉  Envoyer un courriel        › │
     │  💬 Envoyer un texto           › │
     │ CLIENT                           │
     │  🏷  Ajouter une étiquette      › │
     └──────────────────────────────────┘

   ── Un seul tiroir pour les deux ───────────────────────────────
   Déclencheurs et actions se choisissent de la même façon : chercher,
   parcourir des familles, cliquer. Deux composants jumeaux auraient
   divergé au premier ajustement.

   ── Ce qui est INDISPONIBLE reste visible ──────────────────────
   Un déclencheur pas encore branché, une action qui ne va pas avec le
   déclencheur choisi : on l'affiche grisé AVEC la raison, au lieu de le
   masquer. Masquer laisse croire que ça n'existe pas ; griser sans dire
   pourquoi est pire encore. C'est le seul point où on s'écarte de GHL,
   dont le menu grise sans jamais expliquer.
   ═══════════════════════════════════════════════════════════════ */

import { useMemo, useState } from 'react';
import { Search, X, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ChoixTiroir {
  cle: string;
  titre: string;
  aide?: string;
  famille: string;
  /** Non sélectionnable — avec la raison, toujours. */
  indisponible?: string;
  icone?: React.ComponentType<{ className?: string }>;
}

interface Props {
  titre: string;
  sousTitre?: string;
  familles: Array<{ cle: string; fr: string; en: string }>;
  choix: ChoixTiroir[];
  fr: boolean;
  onChoisir: (cle: string) => void;
  onFermer: () => void;
}

/** Retire les accents pour que « etiquette » trouve « étiquette ». */
function sansAccent(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export default function TiroirChoix({
  titre, sousTitre, familles, choix, fr, onChoisir, onFermer,
}: Props) {
  const [recherche, setRecherche] = useState('');

  const groupes = useMemo(() => {
    const q = sansAccent(recherche.trim());
    const filtres = q
      ? choix.filter((c) => sansAccent(`${c.titre} ${c.aide ?? ''}`).includes(q))
      : choix;
    return familles
      .map((f) => ({ ...f, items: filtres.filter((c) => c.famille === f.cle) }))
      .filter((g) => g.items.length > 0);
  }, [choix, familles, recherche]);

  const total = groupes.reduce((n, g) => n + g.items.length, 0);

  return (
    <aside
      aria-label={titre}
      className="flex h-full w-[380px] shrink-0 flex-col border-l border-border bg-surface-card"
    >
      {/* ── En-tête ── */}
      <div className="flex items-start gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-text-primary">{titre}</h2>
          {sousTitre && <p className="mt-0.5 text-[11px] text-text-tertiary">{sousTitre}</p>}
        </div>
        <button
          type="button"
          onClick={onFermer}
          aria-label={fr ? 'Fermer' : 'Close'}
          className="shrink-0 rounded-md p-1 text-text-tertiary transition-colors hover:bg-surface-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* ── Recherche ── */}
      <div className="border-b border-border px-4 py-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary"
            aria-hidden="true"
          />
          <input
            type="search"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            aria-label={fr ? `Rechercher dans ${titre}` : `Search ${titre}`}
            placeholder={fr ? 'Rechercher…' : 'Search…'}
            className="w-full rounded-lg border border-border bg-surface-primary py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
      </div>

      {/* ── La liste ── */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {total === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-text-tertiary">
            {fr ? 'Rien ne correspond à cette recherche.' : 'Nothing matches that search.'}
          </p>
        ) : (
          groupes.map((g) => (
            <section key={g.cle} className="mb-4 last:mb-0">
              <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                {fr ? g.fr : g.en}
              </h3>
              <ul className="space-y-0.5">
                {g.items.map((c) => {
                  const Icone = c.icone;
                  return (
                    <li key={c.cle}>
                      <button
                        type="button"
                        disabled={Boolean(c.indisponible)}
                        onClick={() => onChoisir(c.cle)}
                        title={c.indisponible || undefined}
                        className={cn(
                          'group flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                          'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                          c.indisponible
                            ? 'cursor-not-allowed opacity-45'
                            : 'hover:bg-surface-tertiary',
                        )}
                      >
                        {Icone && (
                          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                            <Icone className="h-4 w-4" aria-hidden="true" />
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-text-primary">{c.titre}</span>
                          {/* La RAISON de l'indisponibilité prime sur l'aide :
                              « pourquoi je ne peux pas » vaut mieux que
                              « ce que ça ferait ». */}
                          {(c.indisponible || c.aide) && (
                            <span className="mt-0.5 block text-[11px] leading-snug text-text-tertiary">
                              {c.indisponible || c.aide}
                            </span>
                          )}
                        </span>
                        {!c.indisponible && (
                          <ChevronRight
                            className="mt-1 h-4 w-4 shrink-0 text-text-tertiary transition-colors group-hover:text-text-primary"
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </aside>
  );
}
