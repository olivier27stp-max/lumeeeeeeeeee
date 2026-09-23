/**
 * Board du pipeline — colonnes par étape, cartes glissables.
 *
 * Reprend la mécanique éprouvée du board D2D (poignée de glissement dédiée pour
 * que le clic ouvre le drawer, corps de colonne droppable pour viser une colonne
 * vide, verrou par deal, retour arrière si l'écriture échoue). `onDeplacer`
 * remonte l'intention au parent, qui décide (popup de job, modal de raison…).
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
  estJobACreer, nomClient, priorite, type Deal, type PipelineStage,
} from '../../lib/pipelineVentesApi';
import {
  LIBELLE_SOURCE, depuis, initiales, rangsOuverts, visuelEtape,
} from '../../lib/pipeline/presentation';
import type { DealSource, MockStage } from '../../lib/pipeline/mockData';

interface Membre { id: string; name: string }

/**
 * `presentation.ts` est typé sur la maquette : `visuelEtape` et `rangsOuverts`
 * ne lisent que `id`, `kind` et `position`, tous identiques entre les deux
 * formes. Cet adaptateur comble les champs camelCase restants pour satisfaire
 * le typage, sans dupliquer la palette ni toucher au module partagé.
 */
function pourVisuel(e: PipelineStage): MockStage {
  return {
    id: e.id,
    nameFr: e.name_fr,
    nameEn: e.name_en,
    guidanceFr: e.guidance_fr,
    guidanceEn: e.guidance_en,
    position: e.position,
    kind: e.kind,
    archivedAt: e.archived_at,
  };
}

/** `deals.source` est du texte libre en base : un canal inconnu s'affiche tel quel. */
function libelleSource(source: string, fr: boolean): string {
  const connu = LIBELLE_SOURCE[source as DealSource];
  if (!connu) return source;
  return fr ? connu.fr : connu.en;
}

const TEINTE_PRIORITE = { urgent: '#B08A8A', moyen: '#B39C77', frais: '#8A9B7D' } as const;
const LIBELLE_PRIORITE = {
  urgent: { fr: 'Urgent', en: 'Urgent' },
  moyen: { fr: 'À relancer', en: 'Needs follow-up' },
  frais: { fr: 'Récent', en: 'Recent' },
} as const;

// ── Carte ──

function CarteDeal({ deal, etapes, membres, onOuvrir }: {
  deal: Deal;
  etapes: PipelineStage[];
  membres: Membre[];
  onOuvrir: (deal: Deal) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: deal.id,
    data: { deal },
  });
  const { language } = useTranslation();
  const fr = language === 'fr';
  const jobACreer = estJobACreer(deal, etapes);
  const prio = priorite(deal, etapes);
  const nomAssigne = deal.assigned_user_id
    ? membres.find((m) => m.id === deal.assigned_user_id)?.name ?? null
    : null;
  const nom = nomClient(deal);

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
          <div className="flex items-center gap-1.5 min-w-0">
            {prio && (
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: TEINTE_PRIORITE[prio.niveau] }}
                aria-label={fr ? LIBELLE_PRIORITE[prio.niveau].fr : LIBELLE_PRIORITE[prio.niveau].en}
              />
            )}
            <p className="text-[13px] font-semibold text-text-primary truncate">{nom}</p>
          </div>

          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span className="text-[10px] text-text-tertiary bg-surface-tertiary px-1.5 py-0.5 rounded">
              {libelleSource(deal.source, fr)}
            </span>
            {jobACreer && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400">
                <Hammer size={10} aria-hidden="true" />
                {fr ? 'Job à créer' : 'Job to create'}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between mt-2 gap-2">
            {nomAssigne ? (
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <span
                  aria-hidden="true"
                  className="grid place-items-center w-5 h-5 rounded-full bg-surface-tertiary text-[9px] font-semibold text-text-secondary shrink-0"
                >
                  {initiales(nomAssigne)}
                </span>
                <span className="text-[11px] text-text-tertiary truncate">{nomAssigne}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                <UserPlus size={11} aria-hidden="true" />
                {fr ? 'Non assigné' : 'Unassigned'}
              </span>
            )}
            <span className="text-[10px] text-text-muted shrink-0">
              {depuis(deal.created_at, new Date().toISOString(), fr)}
            </span>
          </div>

          {deal.lost_reason && (
            <p className="text-[10px] text-text-muted mt-1 truncate">↳ {deal.lost_reason}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Colonne ──

function Colonne({ etape, etapes, rangOuvert, deals, membres, onOuvrir }: {
  etape: PipelineStage;
  /** Toutes les étapes : le badge « Job à créer » se dérive du `kind` de l'étape du deal. */
  etapes: PipelineStage[];
  rangOuvert: number;
  deals: Deal[];
  membres: Membre[];
  onOuvrir: (deal: Deal) => void;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const v = visuelEtape(pourVisuel(etape), rangOuvert);
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
            {fr ? etape.name_fr : etape.name_en}
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
            <CarteDeal key={deal.id} deal={deal} etapes={etapes} membres={membres} onOuvrir={onOuvrir} />
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

export default function PipelineBoard({ deals, etapes, chargement, membres, onOuvrir, onDeplacer }: {
  deals: Deal[];
  etapes: PipelineStage[];
  chargement?: boolean;
  membres?: Membre[];
  onOuvrir: (deal: Deal) => void;
  /** Le parent décide : popup de job vers « Gagné », modal de raison vers « Perdu ». */
  onDeplacer: (dealId: string, versEtapeId: string) => void;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [actif, setActif] = useState<Deal | null>(null);
  const verrous = useRef<Set<string>>(new Set());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const listeMembres = useMemo(() => membres ?? [], [membres]);

  const visibles = useMemo(
    () => [...etapes].filter((e) => e.archived_at === null).sort((a, b) => a.position - b.position),
    [etapes],
  );
  const rangs = useMemo(() => rangsOuverts(etapes.map(pourVisuel)), [etapes]);
  const parEtape = useMemo(() => {
    const g: Record<string, Deal[]> = {};
    for (const e of visibles) g[e.id] = [];
    for (const d of deals) if (g[d.stage_id]) g[d.stage_id].push(d);
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
    const cible = surDeal?.stage_id ?? (visibles.some((e) => e.id === overId) ? overId : deal.stage_id);
    if (cible === deal.stage_id) return;

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
      {chargement && (
        <p className="text-[11px] text-text-muted mb-2" role="status">
          {fr ? 'Chargement…' : 'Loading…'}
        </p>
      )}

      <div className="flex gap-3 overflow-x-auto pb-4">
        {visibles.map((etape) => (
          <Colonne
            key={etape.id}
            etape={etape}
            etapes={etapes}
            rangOuvert={rangs[etape.id] ?? 0}
            deals={parEtape[etape.id] ?? []}
            membres={listeMembres}
            onOuvrir={onOuvrir}
          />
        ))}
      </div>

      <DragOverlay>
        {actif && (
          <div className={cn('rounded-xl border border-outline-strong bg-surface-elevated p-3.5 shadow-lg w-[264px]')}>
            <p className="text-[13px] font-semibold text-text-primary truncate">{nomClient(actif)}</p>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
