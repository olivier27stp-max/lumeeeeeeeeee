/* ═══════════════════════════════════════════════════════════════
   VisiteGuidee — trois bulles qui montrent une page, une seule fois.

   Pourquoi ce composant existe : la page « Modèles de courriel » offre cinq
   courriels, une identité à remplir et un éditeur avec deux onglets. Rien de
   tout ça ne se devine, et la carte Setup ne s'affiche PAS sur /settings
   (elle y recouvrait les boutons « Enregistrer » — audit QA du 2026-09-09).
   Une entreprise arrivait donc sur la page sans savoir quoi regarder.

   Les règles qu'il s'impose :

   - UNE SEULE FOIS, par personne et par visite. La clé vit dans
     localStorage ; une visite déjà vue ne revient jamais, même après un
     rechargement. Une visite qu'on ne peut pas faire taire est pire que pas
     de visite.
   - « Passer » à chaque étape, pas seulement à la première. Quelqu'un qui
     comprend à l'étape 2 doit pouvoir sortir là.
   - Échap ferme, et le focus revient où il était. Une bulle qui piège le
     clavier bloque quelqu'un qui n'utilise pas la souris.
   - Elle ne montre QUE ce qui existe : une étape dont la cible est absente
     de la page est sautée, jamais affichée dans le vide.
   - Rien ne bouge si `prefers-reduced-motion` est demandé.

   Ce composant ne connaît aucune page en particulier : il reçoit des étapes
   et des sélecteurs. C'est ce qui lui permet de servir ailleurs sans être
   copié — une visite dupliquée diverge au premier correctif.
   ═══════════════════════════════════════════════════════════════ */

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface EtapeVisite {
  /** Ce qu'on encadre. Une étape dont la cible est absente est sautée. */
  cible: string;
  titre: string;
  texte: string;
  /** Où poser la bulle. `auto` choisit selon la place disponible. */
  position?: 'haut' | 'bas' | 'auto';
}

interface Props {
  /** Identifiant de la visite : la clé du « déjà vu ». */
  cle: string;
  etapes: EtapeVisite[];
  /** Ne démarre que quand la page a fini de charger ses données. */
  actif?: boolean;
  passerLabel?: string;
  suivantLabel?: string;
  terminerLabel?: string;
}

/** `true` si cette visite a déjà été vue. Le stockage peut être bloqué. */
function dejaVue(cle: string): boolean {
  try {
    return localStorage.getItem(`lume-visite-${cle}`) === 'vue';
  } catch {
    // Mode privé, cookies bloqués : on ne montre pas la visite plutôt que de
    // la remontrer à chaque chargement.
    return true;
  }
}

function marquerVue(cle: string): void {
  try {
    localStorage.setItem(`lume-visite-${cle}`, 'vue');
  } catch {
    // Sans stockage, la visite se ferme quand même pour cette session.
  }
}

/** Le rectangle d'une cible, ou `null` si elle n'est pas sur la page. */
function rectangleDe(selecteur: string): DOMRect | null {
  const el = document.querySelector(selecteur);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  // Une cible de taille nulle est présente mais invisible (onglet caché,
  // `display:none`) : l'encadrer poserait une bulle sur du vide.
  return r.width > 0 && r.height > 0 ? r : null;
}

export default function VisiteGuidee({
  cle,
  etapes,
  actif = true,
  passerLabel = 'Passer',
  suivantLabel = 'Suivant',
  terminerLabel = 'Terminé',
}: Props) {
  const [index, setIndex] = useState(0);
  const [ouverte, setOuverte] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const titreId = useId();
  const texteId = useId();
  const focusAvant = useRef<Element | null>(null);
  const boiteRef = useRef<HTMLDivElement>(null);

  /* Les étapes dont la cible est VRAIMENT sur la page. Recalculé à
     l'ouverture seulement : une page qui bouge sous la visite la ferait
     sauter d'un élément à l'autre. */
  const [etapesVisibles, setEtapesVisibles] = useState<EtapeVisite[]>([]);

  useEffect(() => {
    if (!actif || dejaVue(cle)) return;
    /* Un délai avant de mesurer : la page vient de recevoir ses données, et
       les cartes ne sont pas encore posées. Mesurer trop tôt donne des
       rectangles qui ne correspondent à rien. */
    const t = setTimeout(() => {
      const presentes = etapes.filter((e) => rectangleDe(e.cible) !== null);
      if (presentes.length === 0) return;
      focusAvant.current = document.activeElement;
      setEtapesVisibles(presentes);
      setIndex(0);
      setOuverte(true);
    }, 450);
    return () => clearTimeout(t);
    // `etapes` est un littéral côté appelant : on ne le met pas en dépendance
    // pour éviter de relancer la visite à chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actif, cle]);

  const fermer = useCallback(() => {
    marquerVue(cle);
    setOuverte(false);
    // Le focus revient là où il était : sans ça, quelqu'un au clavier se
    // retrouve au début du document.
    if (focusAvant.current instanceof HTMLElement) focusAvant.current.focus();
  }, [cle]);

  const etape = etapesVisibles[index];

  // La position de la bulle suit la cible, et la suit encore au défilement.
  useLayoutEffect(() => {
    if (!ouverte || !etape) return;
    const maj = () => setRect(rectangleDe(etape.cible));
    maj();
    const cible = document.querySelector(etape.cible);
    cible?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    window.addEventListener('scroll', maj, true);
    window.addEventListener('resize', maj);
    return () => {
      window.removeEventListener('scroll', maj, true);
      window.removeEventListener('resize', maj);
    };
  }, [ouverte, etape]);

  // Échap ferme ; le focus part sur la bulle à chaque étape.
  useEffect(() => {
    if (!ouverte) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') fermer(); };
    document.addEventListener('keydown', onKey);
    boiteRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [ouverte, index, fermer]);

  if (!ouverte || !etape || !rect) return null;

  const dernière = index === etapesVisibles.length - 1;
  const marge = 10;
  const enBas = etape.position === 'bas'
    || (etape.position !== 'haut' && rect.top < window.innerHeight / 2);
  const haut = enBas ? rect.bottom + marge : undefined;
  const bas = enBas ? undefined : window.innerHeight - rect.top + marge;

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="visite"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-[80]"
      >
        {/* Le voile, percé sur la cible. Un clic à côté ferme la visite :
            c'est le geste que tout le monde essaie en premier. */}
        <button
          type="button"
          onClick={fermer}
          aria-label={passerLabel}
          className="absolute inset-0 h-full w-full cursor-default bg-black/45 focus-visible:outline-none"
          style={{
            /* Le trou : une ombre portée immense sur un cadre transparent
               découpe le voile sans deuxième élément à repositionner. */
            clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 ${rect.top - 6}px,
              ${rect.left - 6}px ${rect.top - 6}px,
              ${rect.left - 6}px ${rect.bottom + 6}px,
              ${rect.right + 6}px ${rect.bottom + 6}px,
              ${rect.right + 6}px ${rect.top - 6}px,
              0 ${rect.top - 6}px)`,
          }}
        />

        {/* Le cadre autour de la cible. Décoratif : il ne reçoit aucun clic. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute rounded-xl ring-2 ring-primary ring-offset-2 ring-offset-transparent"
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
        />

        <motion.div
          ref={boiteRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titreId}
          aria-describedby={texteId}
          initial={{ opacity: 0, y: enBas ? -6 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="absolute w-[min(320px,calc(100vw-32px))] rounded-xl border border-outline/60 bg-surface p-4 shadow-lg focus:outline-none"
          style={{
            top: haut,
            bottom: bas,
            left: Math.min(Math.max(16, rect.left), Math.max(16, window.innerWidth - 336)),
          }}
        >
          <div className="mb-1.5 flex items-start justify-between gap-3">
            <p id={titreId} className="text-[14px] font-semibold text-text-primary">{etape.titre}</p>
            <button
              type="button"
              onClick={fermer}
              aria-label={passerLabel}
              className="-m-1 rounded p-1 text-text-tertiary hover:text-text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <p id={texteId} className="text-[13px] leading-relaxed text-text-secondary">{etape.texte}</p>

          <div className="mt-3.5 flex items-center justify-between gap-3">
            <span className="text-[11.5px] tabular-nums text-text-tertiary">
              {index + 1} / {etapesVisibles.length}
            </span>
            <div className="flex items-center gap-2">
              {/* « Passer » à CHAQUE étape : quelqu'un qui comprend à la
                  deuxième doit pouvoir sortir là, pas seulement au début. */}
              {!dernière && (
                <button
                  type="button"
                  onClick={fermer}
                  className="rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-text-tertiary hover:text-text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  {passerLabel}
                </button>
              )}
              <button
                type="button"
                onClick={() => (dernière ? fermer() : setIndex((i) => i + 1))}
                className={cn(
                  'rounded-lg bg-primary px-3.5 py-1.5 text-[12.5px] font-semibold text-white',
                  'hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2',
                )}
              >
                {dernière ? terminerLabel : suivantLabel}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
