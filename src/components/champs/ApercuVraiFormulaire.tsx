/**
 * Le VRAI formulaire (Nouveau client, Nouveau devis, Nouvelle job) dans « Créer un
 * champ » — Rafba, 2026-09-28 : « je veux voir sur les vrais modals ». Monté pour de
 * vrai, réduit à la largeur de l'aperçu, et intouchable (aucune saisie, aucun envoi,
 * Échap neutralisé) ; seule la custom key en cours s'attrape, et on la dépose dans
 * une des zones que le formulaire ouvre à chaque emplacement (apercuPlacement).
 */
import { Suspense, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, rectIntersection,
  useSensor, useSensors, type CollisionDetection, type DragEndEvent,
} from '@dnd-kit/core';
import { rangeesFormulaire } from '../../lib/champs/standard';
import type { ChampPerso, DossierChamp, ObjetChamp } from '../../lib/champs/types';
import { lazyResilient } from '../../lib/lazyResilient';
import { ApercuPlacementContext } from './apercuPlacement';

// Import différé : ces formulaires utilisent eux-mêmes les custom keys (pas de cycle).
const NewClient = lazyResilient(() => import('../../pages/NewClient'));
const QuoteNew = lazyResilient(() => import('../../pages/QuoteNew'));
const NewJobModal = lazyResilient(() => import('../NewJobModal'));

/** Objets dont le vrai formulaire sait s'afficher en aperçu. */
export const OBJETS_VRAI_FORMULAIRE: ObjetChamp[] = ['client', 'quote', 'job'];

// Largeur « écran » de chaque formulaire, réduite ensuite à celle de l'aperçu.
const LARGEUR: Partial<Record<ObjetChamp, number>> = { client: 900, quote: 1180, job: 980 };
// La fenêtre de job remplit son hôte (absolute inset-0) : il lui faut une hauteur.
const HAUTEUR_FIXE: Partial<Record<ObjetChamp, number>> = { job: 3200 };

export interface PlaceFormulaire { folder_id: string | null; apres: string | null }

/** Zone de dépôt → place (dossier + rangée suivie). */
export function placeDepuisZone(objet: ObjetChamp, zone: string, dossiers: DossierChamp[]): PlaceFormulaire | null {
  const [sorte, cle] = [zone.slice(0, zone.indexOf(':')), zone.slice(zone.indexOf(':') + 1)];
  const dossierSection = (section: string) => dossiers.find((d) => d.object_type === objet && d.cle_systeme === section)?.id ?? null;
  if (sorte === 'apres') {
    const r = rangeesFormulaire(objet).find((x) => x.cles[0] === cle);
    const d = r ? dossierSection(r.section) : null;
    return d ? { folder_id: d, apres: cle } : null;
  }
  if (sorte === 'section') { const d = dossierSection(cle); return d ? { folder_id: d, apres: null } : null; }
  if (sorte === 'dossier') return cle ? { folder_id: cle, apres: null } : null;
  return null;
}

// Le pointeur d'abord (zones fines) ; sinon la zone la plus recouverte.
const collision: CollisionDetection = (args) => {
  const sous = pointerWithin(args);
  return sous.length ? sous : rectIntersection(args);
};

export default function ApercuVraiFormulaire({ objet, cible, rendreCible, dossiers, fr, onPlace }: {
  objet: ObjetChamp;
  cible: ChampPerso;
  rendreCible: () => ReactNode;
  dossiers: DossierChamp[];
  fr: boolean;
  onPlace: (p: PlaceFormulaire) => void;
}) {
  const cadre = useRef<HTMLDivElement>(null);
  const interieur = useRef<HTMLDivElement>(null);
  const [echelle, setEchelle] = useState(0.6);
  const [hauteur, setHauteur] = useState(600);
  const largeur = LARGEUR[objet] ?? 900;

  useLayoutEffect(() => {
    const mesurer = () => {
      const w = cadre.current?.clientWidth ?? 0;
      if (w) setEchelle(Math.min(1, w / largeur));
      const h = HAUTEUR_FIXE[objet] ?? interieur.current?.scrollHeight ?? 0;
      if (h) setHauteur(h);
    };
    mesurer();
    const ro = new ResizeObserver(mesurer);
    if (cadre.current) ro.observe(cadre.current);
    if (interieur.current) ro.observe(interieur.current);
    return () => ro.disconnect();
  }, [objet, largeur]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor));
  const [glisse, setGlisse] = useState(false);
  const surFin = (e: DragEndEvent) => {
    setGlisse(false);
    const zone = e.over?.id ? String(e.over.id) : null;
    const place = zone ? placeDepuisZone(objet, zone, dossiers) : null;
    if (place) onPlace(place);
  };

  const formulaire = objet === 'client' ? <NewClient />
    : objet === 'quote' ? <QuoteNew />
      : <NewJobModal isOpen onClose={() => {}} onSave={() => Promise.reject(new Error('Aperçu : rien ne s’enregistre.'))} />;

  return (
    <ApercuPlacementContext.Provider value={{ objet, cible, rendreCible, fr }}>
      <DndContext sensors={sensors} collisionDetection={collision} autoScroll={{ threshold: { x: 0, y: 0.08 } }}
        onDragStart={() => setGlisse(true)} onDragCancel={() => setGlisse(false)} onDragEnd={surFin}
        accessibility={{ screenReaderInstructions: { draggable: fr
          ? 'Pour déplacer le champ, appuie sur Espace, puis sur les flèches ; Espace pour le déposer, Échap pour annuler.'
          : 'To move the field, press Space, then the arrow keys; Space to drop it, Escape to cancel.' } }}>
        <div ref={cadre} className="w-full overflow-hidden rounded-lg border border-outline bg-surface" style={{ height: hauteur * echelle }}>
          {/* Intouchable : clics, saisie et envoi coupés ; seules la poignée et les zones réagissent. */}
          <div ref={interieur}
            className="pointer-events-none origin-top-left select-none"
            style={{ width: largeur, transform: `scale(${echelle})`, ...(HAUTEUR_FIXE[objet] ? { height: HAUTEUR_FIXE[objet] } : {}) }}
            onSubmitCapture={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onFocusCapture={(e) => {
              const el = e.target as HTMLElement;
              if (!el.closest('[data-apercu-permis]')) el.blur();
            }}>
            <Suspense fallback={<div className="flex h-40 items-center justify-center text-text-tertiary"><Loader2 className="animate-spin" size={20} aria-hidden /></div>}>
              {formulaire}
            </Suspense>
          </div>
        </div>
        {createPortal(
          <DragOverlay dropAnimation={null}>
            {glisse ? (
              <div className="w-64 rounded-lg bg-surface p-2 shadow-xl ring-2 ring-primary/60">
                <p className="truncate text-[12px] font-semibold text-text-primary">{cible.label || (fr ? 'Nouveau champ' : 'New field')}</p>
                <p className="text-[11px] text-text-tertiary">{fr ? 'Dépose-le dans une zone « Déposer ici »' : 'Drop it on a “Drop here” zone'}</p>
              </div>
            ) : null}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
    </ApercuPlacementContext.Provider>
  );
}
