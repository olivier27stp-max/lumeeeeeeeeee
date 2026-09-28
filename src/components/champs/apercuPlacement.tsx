/**
 * Mode « aperçu » des VRAIS formulaires (Rafba, 2026-09-28 : « je veux voir sur les
 * vrais modals ») : dans « Créer un champ », Nouveau client / devis / job sont montés
 * pour de vrai, non modifiables. Le hook des custom keys (useChampsCreation) lit ce
 * contexte : il glisse la custom key en cours de création à sa place et ouvre une
 * zone de dépôt à chaque emplacement (sous une rangée, fin de section, dossier).
 */
import { createContext, useContext, type ReactNode } from 'react';
import { GripVertical } from 'lucide-react';
import { useDndContext, useDraggable, useDroppable } from '@dnd-kit/core';
import type { ChampPerso, ObjetChamp } from '../../lib/champs/types';
import { cn } from '../../lib/utils';

export interface ApercuPlacement {
  objet: ObjetChamp;
  /** La custom key en cours (dossier et `config.apres` = sa place actuelle). */
  cible: ChampPerso;
  /** Rendu vivant du champ (libellé, saisie, aide). */
  rendreCible: () => ReactNode;
  fr: boolean;
}

export const ApercuPlacementContext = createContext<ApercuPlacement | null>(null);
/** Présent = on est dans l'aperçu d'un formulaire : rien ne s'enregistre, rien ne navigue. */
export const useApercuPlacement = () => useContext(ApercuPlacementContext);

export const ID_CIBLE = 'cible-apercu';
export const zoneApres = (cle: string) => `apres:${cle}`;
export const zoneSection = (cle: string) => `section:${cle}`;
export const zoneDossier = (id: string) => `dossier:${id}`;

/** Une place où déposer la custom key ; visible seulement pendant qu'on la glisse. */
export function ZoneDepot({ id, fr }: { id: string; fr: boolean }) {
  const { active } = useDndContext();
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} data-zone-depot={id}
      className={cn('pointer-events-auto rounded-lg border-2 border-dashed transition-all',
        active ? 'my-2 flex h-11 items-center justify-center text-[12px] font-medium' : 'h-0 border-0',
        active && (isOver ? 'border-primary bg-primary/10 text-primary' : 'border-outline text-text-tertiary'))}>
      {active && (fr ? 'Déposer ici' : 'Drop here')}
    </div>
  );
}

/** La custom key en cours, attrapable, surlignée. */
export function CibleDeplacable({ children, fr }: { children: ReactNode; fr: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: ID_CIBLE });
  return (
    <div ref={setNodeRef} data-cible-apercu
      className={cn('pointer-events-auto relative rounded-lg bg-primary/5 p-2 pl-7 ring-2 ring-primary/50', isDragging && 'opacity-40')}>
      <button type="button" data-apercu-permis {...attributes} {...listeners}
        aria-label={fr ? 'Glisser le nouveau champ à sa place' : 'Drag the new field into place'}
        className="absolute left-1 top-1/2 -translate-y-1/2 cursor-grab rounded p-0.5 text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
        <GripVertical size={16} aria-hidden />
      </button>
      {/* Aperçu : on voit le champ tel qu'il sera, on ne le remplit pas. */}
      <div className="pointer-events-none">{children}</div>
    </div>
  );
}
