/**
 * Board du pipeline — colonnes par étape, cartes glissables.
 *
 * Reprend la mécanique éprouvée du board D2D (poignée de glissement dédiée pour
 * que le clic ouvre le drawer, corps de colonne droppable pour viser une colonne
 * vide, verrou par deal, retour arrière si l'écriture échoue). Ici tout est en
 * mock : `onDeplacer` remonte l'intention au parent, qui décide.
 */
import { useMemo, useRef, useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, closestCorners, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Hammer, UserPlus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import {
  MOCK_NOW, isJobACreer, type MockDeal, type MockStage,
} from '../../lib/pipeline/mockData';
import {
  LIBELLE_SOURCE, depuis, initiales, rangsOuverts, visuelEtape,
} from '../../lib/pipeline/presentation';

// ── Carte ──

function CarteDeal({ deal, etapes, onOuvrir }: {
  deal: MockDeal;
  etapes: MockStage[];
  onOuvrir: (deal: MockDeal) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: deal.id,
    data: { deal },
  });
  const { language } = useTranslation();
  const fr = language === 'fr';
  const jobACreer = isJobACreer(deal, etapes);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      role="button"
      tabIndex={0}
      onClick={() => onOuvrir(deal)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOuvrir(deal);
        }
      }}
      className="group rounded-xl border border-outline bg-surface-card p-3.5 transition-all hover:bg-surface-elevated hover:border-outline-strong cursor-pointer"
    >
      <div className="flex items-start gap-2">
        <button
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          aria-label={fr ? 'Déplacer la carte' : 'Move card'}
          className="mt-0.5 cursor-grab text-text-muted hover:text-text-secondary active:cursor-grabbing"
        >
          <GripVertical size={14} />
        </button>

        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-text-primary truncate">{deal.clientName}</p>

          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span className="text-[10px] text-text-tertiary bg-surface-tertiary px-1.5 py-0.5 rounded">
              {fr ? LIBELLE_SOURCE[deal.source].fr : LIBELLE_SOURCE[deal.source].en}
            </span>
            {jobACreer && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400">
                <Hammer size={10} aria-hidden="true" />
                {fr ? 'Job à créer' : 'Job to create'}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between mt-2 gap-2">
            {deal.assignedName ? (
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <span
                  aria-hidden="true"
                  className="grid place-items-center w-5 h-5 rounded-full bg-surface-tertiary text-[9px] font-semibold text-text-secondary shrink-0"
                >
                  {initiales(deal.assignedName)}
                </span>
                <span className="text-[11px] text-text-tertiary truncate">{deal.assignedName}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                <UserPlus size={11} aria-hidden="true" />
                {fr ? 'Non assigné' : 'Unassigned'}
              </span>
            )}
            <span className="text-[10px] text-text-muted shrink-0">{depuis(deal.createdAt, MOCK_NOW, fr)}</span>
          </div>

          {deal.lostReason && (
            <p className="text-[10px] text-text-muted mt-1 truncate">↳ {deal.lostReason}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Colonne ──

function Colonne({ etape, etapes, rangOuvert, deals, onOuvrir }: {
  etape: MockStage;
  /** Toutes les étapes : le badge « Job à créer » se dérive du `kind` de l'étape du deal. */
  etapes: MockStage[];
  rangOuvert: number;
  deals: MockDeal[];
  onOuvrir: (deal: MockDeal) => void;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const v = visuelEtape(etape, rangOuvert);
  const IconeVide = v.icone;
  // Le corps est droppable pour qu'une carte puisse atterrir dans une colonne
  // vide. L'id est l'id d'étape, jamais un id de deal.
  const { setNodeRef } = useDroppable({ id: etape.id });

  return (
    <div className="flex flex-col w-[280px] shrink-0">
      <div
        className="px-4 py-3 rounded-t-xl border border-b-0"
        style={{ borderColor: `${v.teinte}40`, background: `${v.teinte}08` }}
      >
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: v.teinte }} aria-hidden="true" />
          <span className="text-[12.5px] font-semibold text-text-primary tracking-tight truncate">
            {fr ? etape.nameFr : etape.nameEn}
          </span>
          <span className="text-[11px] font-medium text-text-muted tabular-nums">{deals.length}</span>
        </div>
      </div>

      <SortableContext items={deals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className="pipeline-scroll flex-1 space-y-2.5 p-3 rounded-b-xl border border-t-0 min-h-[120px] overflow-y-auto max-h-[calc(100vh-17rem)]"
          style={{ borderColor: `${v.teinte}40`, background: `${v.teinte}08` }}
        >
          {deals.map((deal) => (
            <CarteDeal key={deal.id} deal={deal} etapes={etapes} onOuvrir={onOuvrir} />
          ))}
          {deals.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center py-10 px-4">
              <IconeVide size={34} strokeWidth={1.25} className="text-text-tertiary" aria-hidden="true" />
              <p className="text-[12px] font-semibold text-text-secondary mt-3">
                {fr ? 'Aucun deal' : 'No deals'}
              </p>
              <p className="text-[11px] text-text-muted mt-1 leading-relaxed">{fr ? v.videFr : v.videEn}</p>
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

// ── Board ──

export default function PipelineBoard({ deals, etapes, onOuvrir, onDeplacer }: {
  deals: MockDeal[];
  etapes: MockStage[];
  onOuvrir: (deal: MockDeal) => void;
  /** Le parent décide : popup de job vers « Gagné », modal de raison vers « Perdu ». */
  onDeplacer: (dealId: string, versEtapeId: string) => void;
}) {
  const [actif, setActif] = useState<MockDeal | null>(null);
  const verrous = useRef<Set<string>>(new Set());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const visibles = useMemo(
    () => [...etapes].filter((e) => e.archivedAt === null).sort((a, b) => a.position - b.position),
    [etapes],
  );
  const rangs = useMemo(() => rangsOuverts(etapes), [etapes]);
  const parEtape = useMemo(() => {
    const g: Record<string, MockDeal[]> = {};
    for (const e of visibles) g[e.id] = [];
    for (const d of deals) if (g[d.stageId]) g[d.stageId].push(d);
    return g;
  }, [deals, visibles]);

  function onDragEnd(event: DragEndEvent) {
    setActif(null);
    const { active, over } = event;
    if (!over) return;
    const dealId = String(active.id);
    if (verrous.current.has(dealId)) return;
    const deal = deals.find((d) => d.id === dealId);
    if (!deal) return;

    const overId = String(over.id);
    const surDeal = deals.find((d) => d.id === overId);
    const cible = surDeal?.stageId ?? (visibles.some((e) => e.id === overId) ? overId : deal.stageId);
    if (cible === deal.stageId) return;

    verrous.current.add(dealId);
    try {
      onDeplacer(dealId, cible);
    } finally {
      verrous.current.delete(dealId);
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(e: DragStartEvent) => setActif(deals.find((d) => d.id === e.active.id) ?? null)}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActif(null)}
    >
      <div className="flex gap-3 overflow-x-auto pb-4">
        {visibles.map((etape) => (
          <Colonne
            key={etape.id}
            etape={etape}
            etapes={etapes}
            rangOuvert={rangs[etape.id] ?? 0}
            deals={parEtape[etape.id] ?? []}
            onOuvrir={onOuvrir}
          />
        ))}
      </div>

      <DragOverlay>
        {actif && (
          <div className={cn('rounded-xl border border-outline-strong bg-surface-elevated p-3.5 shadow-lg w-[264px]')}>
            <p className="text-[13px] font-semibold text-text-primary truncate">{actif.clientName}</p>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
