/**
 * Aperçu du VRAI formulaire (Nouveau client, devis, job…) dans la création d'une
 * custom key — demande de Rafba (2026-09-28) : « j'ai choisi ligne simple, je
 * devrais voir le vrai preview ». Sections, champs de base (grisés, cadenas), les
 * custom keys déjà placées, et la nouvelle, rendue pour de vrai, qu'on glisse à la
 * place voulue. Même plan que la fenêtre « Placer » (src/lib/champs/placement).
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { GripVertical, Lock } from 'lucide-react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ElementPlan } from '../../lib/champs/placement';
import { cn } from '../../lib/utils';

const faux = 'h-9 rounded-lg border border-outline bg-surface-secondary/50';

function Element({ e, cibleId, cible, fr }: { e: ElementPlan; cibleId: string; cible: ReactNode; fr: boolean }) {
  const mobile = e.type === 'champ';
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: e.id, disabled: !mobile });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  if (e.type === 'entete') {
    return (
      <li ref={setNodeRef} style={style} className="border-t border-outline pb-1 pt-3 text-[13px] font-semibold text-text-primary first:border-t-0 first:pt-0">
        {e.titre}
      </li>
    );
  }
  if (e.type === 'rangee') {
    // Une rangée = une ligne du formulaire : deux champs côte à côte, sinon le 1er et ses compagnons en petit.
    const noms = e.libelle.split(' · ');
    return (
      <li ref={setNodeRef} style={style} className="relative" aria-label={fr ? `${e.libelle} (champ de base)` : `${e.libelle} (base field)`}>
        <div className={cn('grid gap-2', noms.length === 2 && 'grid-cols-2')}>
          {(noms.length === 2 ? noms : [noms[0]]).map((n) => (
            <div key={n} className="min-w-0">
              <p className="mb-1 truncate text-[11px] font-medium text-text-tertiary">{n}</p>
              <div className={faux} />
            </div>
          ))}
        </div>
        {noms.length > 2 && <p className="mt-0.5 truncate text-[10px] text-text-tertiary">+ {noms.slice(1).join(', ')}</p>}
        <Lock size={10} className="absolute right-1 top-0.5 text-text-tertiary/70" aria-hidden />
      </li>
    );
  }
  const estCible = e.champ.id === cibleId;
  return (
    <li ref={setNodeRef} style={style} data-cible={estCible || undefined}
      className={cn('flex items-start gap-1.5 rounded-lg', estCible ? 'bg-primary/5 p-2 ring-2 ring-primary/40' : 'p-0.5')}>
      <button type="button" {...attributes} {...listeners} aria-label={fr ? `Déplacer ${estCible ? 'le nouveau champ' : e.champ.label}` : `Move ${estCible ? 'the new field' : e.champ.label}`}
        className="mt-5 cursor-grab rounded p-0.5 text-text-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
        <GripVertical size={14} aria-hidden />
      </button>
      <div className="min-w-0 flex-1">
        {estCible ? cible : (
          <>
            <p className="mb-1 truncate text-[11px] font-medium text-text-secondary">{e.champ.label}</p>
            <div className={faux} />
          </>
        )}
      </div>
    </li>
  );
}

export default function ApercuFormulaire({ plan, onPlan, cibleId, cible, titre, fr }: {
  plan: ElementPlan[];
  onPlan: (p: ElementPlan[]) => void;
  /** Id du champ rendu pour de vrai (la nouvelle custom key). */
  cibleId: string;
  /** Le champ tel qu'il s'affichera (libellé + saisie). */
  cible: ReactNode;
  /** « Nouveau client », « Nouveau devis »… */
  titre: string;
  fr: boolean;
}) {
  const liste = useRef<HTMLUListElement>(null);
  const idCibleElement = `c:${cibleId}`;
  // Le champ reste visible quand on change de dossier.
  const indexCible = plan.findIndex((e) => e.id === idCibleElement);
  useEffect(() => {
    liste.current?.querySelector('[data-cible]')?.scrollIntoView({ block: 'nearest' });
  }, [indexCible]);

  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const surDrag = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const a = plan.findIndex((x) => x.id === e.active.id);
    const b = plan.findIndex((x) => x.id === e.over!.id);
    if (a >= 0 && b >= 0) onPlan(arrayMove(plan, a, Math.max(1, b)));
  };

  return (
    <div>
      <p className="mb-2 text-[12px] text-text-tertiary">
        {fr ? `Formulaire « ${titre} » — glisse le champ à la place voulue.` : `“${titre}” form — drag the field where you want it.`}
      </p>
      <div className="rounded-lg border border-outline bg-surface p-3">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={surDrag}
          // Défilement automatique seulement tout près du bord : sinon, déposer sur une
          // rangée du haut fait défiler jusqu'en haut pendant qu'on vise.
          autoScroll={{ threshold: { x: 0, y: 0.08 } }}
          accessibility={{ screenReaderInstructions: { draggable: fr
            ? 'Pour déplacer le champ, appuie sur Espace, puis sur les flèches ; Espace pour le déposer, Échap pour annuler.'
            : 'To move the field, press Space, then the arrow keys; Space to drop it, Escape to cancel.' } }}>
          <SortableContext items={plan.map((e) => e.id)} strategy={verticalListSortingStrategy}>
            <ul ref={liste} className="space-y-2.5">
              {plan.map((e) => <Element key={e.id} e={e} cibleId={cibleId} cible={cible} fr={fr} />)}
            </ul>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}
