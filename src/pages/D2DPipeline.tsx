import { useState, useEffect, useMemo, useRef } from 'react';
import { cn, formatCurrency } from '../lib/utils';
import { GripVertical, X, Filter, ChevronDown, User, UserCheck, Phone, Mail, RefreshCw, Target, Clock, FileText, Award, Ban, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors, closestCorners, useDroppable,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  D2D_STAGES, D2D_STAGE_CONFIG, DB_TO_D2D_STAGE, D2D_TO_DB_STAGE,
  D2D_STATUSES, D2D_STATUS_CONFIG,
  type D2DStage, type D2DStatus,
} from '../lib/d2d-pipeline-stages';
import { supabase } from '../lib/supabase';
import { useTranslation } from '../i18n';

// ── Types ──

interface PipelineDeal {
  id: string;
  stage: string;
  d2dStage: D2DStage;
  title: string;
  value: number;
  leadName: string;
  repId: string | null;
  repName: string | null;
  createdById: string | null;
  createdByName: string | null;
  leadEmail: string | null;
  leadPhone: string | null;
  d2dStatus: D2DStatus | null;
  lostReason: string | null;
  quoteId: string | null;
  jobId: string | null;
  updatedAt: string;
}

interface Rep {
  user_id: string;
  full_name: string;
  role: string;
  avatar_url: string | null;
}

// ── API helpers ──

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  // Office actif — le serveur scope dessus si l'utilisateur en est membre.
  let activeOrg = '';
  try { activeOrg = localStorage.getItem('lume-active-org') || ''; } catch {}
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-org-id': activeOrg };
}

async function fetchPipeline(repFilter?: string, fr = false): Promise<PipelineDeal[]> {
  const headers = await getAuthHeaders();
  const params = repFilter && repFilter !== 'all' ? `?rep_id=${repFilter}` : '';
  const res = await fetch(`/api/field-sales/pipeline${params}`, { headers });
  if (!res.ok) throw new Error('Failed to load pipeline');
  const data = await res.json();
  return (data || []).map((d: any) => ({
    id: d.id,
    stage: d.stage,
    d2dStage: DB_TO_D2D_STAGE[d.stage] || 'new_lead',
    title: d.title || '',
    value: Number(d.value || 0),
    leadName: d.lead_name || d.title || (fr ? 'Sans nom' : 'Unnamed'),
    repId: d.rep_id || null,
    repName: d.rep_name || null,
    createdById: d.created_by_id || null,
    createdByName: d.created_by_name || null,
    leadEmail: d.lead_email || null,
    leadPhone: d.lead_phone || null,
    d2dStatus: d.d2d_status || null,
    lostReason: d.lost_reason || null,
    quoteId: d.quote_id || null,
    jobId: d.job_id || null,
    updatedAt: d.updated_at || d.created_at,
  }));
}

async function fetchReps(): Promise<Rep[]> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/field-sales/pipeline/reps', { headers });
  if (!res.ok) return [];
  return res.json();
}

async function updateDeal(id: string, updates: Record<string, any>): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/field-sales/pipeline/${id}`, {
    method: 'PUT', headers, body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || 'Failed to update');
  }
}

// ── Deal Card ──

function DealCard({ deal, onStatusChange, onSelect }: {
  deal: PipelineDeal;
  onStatusChange: (id: string, status: D2DStatus) => void;
  onSelect: (deal: PipelineDeal) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: deal.id, data: { deal } });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  const { language } = useTranslation();
  const fr = language === 'fr';
  const statusConfig = deal.d2dStatus ? D2D_STATUS_CONFIG[deal.d2dStatus] : null;

  const timeAgo = useMemo(() => {
    const diff = Date.now() - new Date(deal.updatedAt).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}j`;
  }, [deal.updatedAt]);

  return (
    <div ref={setNodeRef} style={style} {...attributes}
      onClick={() => onSelect(deal)}
      className="group rounded-xl border border-outline bg-surface-card p-3.5 transition-all hover:bg-surface-elevated hover:border-outline-strong cursor-pointer">
      <div className="flex items-start gap-2">
        <button {...listeners} onClick={e => e.stopPropagation()} className="mt-0.5 cursor-grab text-text-muted hover:text-text-secondary active:cursor-grabbing">
          <GripVertical size={14} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-text-primary truncate">{deal.leadName}</p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {deal.repName && (
              <span className="text-[10px] text-text-tertiary bg-surface-tertiary px-1.5 py-0.5 rounded">{deal.repName}</span>
            )}
            {statusConfig && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ color: statusConfig.color, background: statusConfig.color + '15' }}>
                {fr ? statusConfig.labelFr : statusConfig.label}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-[12px] font-bold text-text-secondary tabular-nums">
              {deal.value > 0 ? formatCurrency(deal.value * 100, 'CAD') : '—'}
            </span>
            <span className="text-[10px] text-text-muted">{timeAgo}</span>
          </div>
          {deal.lostReason && deal.d2dStage === 'closed_lost' && (
            <p className="text-[10px] text-red-400/60 mt-1 truncate">↳ {deal.lostReason}</p>
          )}
        </div>
      </div>
      {/* Quick status change */}
      <div className="flex gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
        {D2D_STATUSES.map((s) => (
          <button key={s} onClick={(e) => { e.stopPropagation(); onStatusChange(deal.id, s); }}
            className={cn('px-1.5 py-0.5 rounded text-[8px] font-medium transition-all',
              deal.d2dStatus === s ? 'ring-1 ring-outline-strong' : 'opacity-50 hover:opacity-100')}
            style={{ color: D2D_STATUS_CONFIG[s].color, background: D2D_STATUS_CONFIG[s].color + '15' }}
            title={fr ? D2D_STATUS_CONFIG[s].labelFr : D2D_STATUS_CONFIG[s].label}>
            {(fr ? D2D_STATUS_CONFIG[s].labelFr : D2D_STATUS_CONFIG[s].label).slice(0, 3)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Pipeline-only column identity ──
// D2D_STAGE_CONFIG colors are shared with the Vente Map, so the muted kanban
// palette lives here: soft tint + border + empty-state per stage.
const STAGE_VISUALS: Record<D2DStage, {
  soft: string;
  emptyIcon: LucideIcon;
  emptyHintFr: string;
  emptyHint: string;
}> = {
  new_lead:    { soft: '#8A9B7D', emptyIcon: Target,   emptyHintFr: 'Les nouveaux leads apparaîtront ici.',   emptyHint: 'New leads will appear here.' },
  must_recall: { soft: '#B39C77', emptyIcon: Clock,    emptyHintFr: 'Les leads à rappeler apparaîtront ici.', emptyHint: 'Leads to recall will appear here.' },
  quote_sent:  { soft: '#7E8CA0', emptyIcon: FileText, emptyHintFr: 'Les devis envoyés apparaîtront ici.',    emptyHint: 'Sent quotes will appear here.' },
  closed_won:  { soft: '#6FA287', emptyIcon: Award,    emptyHintFr: 'Les deals gagnés apparaîtront ici.',     emptyHint: 'Won deals will appear here.' },
  closed_lost: { soft: '#B08A8A', emptyIcon: Ban,      emptyHintFr: 'Les deals perdus apparaîtront ici.',     emptyHint: 'Lost deals will appear here.' },
};

// ── Stage Column ──

function StageColumn({ stage, deals, onStatusChange, onSelect }: {
  stage: D2DStage; deals: PipelineDeal[];
  onStatusChange: (id: string, status: D2DStatus) => void;
  onSelect: (deal: PipelineDeal) => void;
}) {
  const config = D2D_STAGE_CONFIG[stage];
  const visuals = STAGE_VISUALS[stage];
  const EmptyIcon = visuals.emptyIcon;
  const { language } = useTranslation();
  const fr = language === 'fr';
  const totalValue = deals.reduce((sum, d) => sum + d.value, 0);
  // Column body is droppable so cards can land in an empty column (id = stage slug, never a deal uuid)
  const { setNodeRef: setDropRef } = useDroppable({ id: stage });

  return (
    <div className="flex flex-col w-[280px] shrink-0">
      <div
        className="px-4 py-3 rounded-t-xl border border-b-0"
        style={{ borderColor: visuals.soft + '40', background: visuals.soft + '08' }}
      >
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ background: visuals.soft }} />
          <span className="text-[12.5px] font-semibold text-text-primary tracking-tight truncate">{fr ? config.labelFr : config.label}</span>
          <span className="text-[11px] font-medium text-text-muted tabular-nums">{deals.length}</span>
        </div>
        {deals.length > 0 && (
          <p className="text-[11px] font-medium text-text-muted tabular-nums mt-0.5 pl-4">{formatCurrency(totalValue * 100, 'CAD')}</p>
        )}
      </div>
      <SortableContext items={deals.map(d => d.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setDropRef}
          className="pipeline-scroll flex-1 space-y-2.5 p-3 rounded-b-xl border border-t-0 min-h-[120px] overflow-y-auto max-h-[calc(100vh-14rem)]"
          style={{ borderColor: visuals.soft + '40', background: visuals.soft + '08' }}
        >
          {deals.map((deal) => (
            <DealCard key={deal.id} deal={deal} onStatusChange={onStatusChange} onSelect={onSelect} />
          ))}
          {deals.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center py-10 px-4">
              <EmptyIcon size={34} strokeWidth={1.25} className="text-text-tertiary" />
              <p className="text-[12px] font-semibold text-text-secondary mt-3">{fr ? 'Aucun deal' : 'No deals'}</p>
              <p className="text-[11px] text-text-muted mt-1 leading-relaxed">{fr ? visuals.emptyHintFr : visuals.emptyHint}</p>
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

// ── Detail Panel ──

function DealDetailPanel({ deal, reps, fr, onClose, onReassign }: {
  deal: PipelineDeal; reps: Rep[]; fr: boolean;
  onClose: () => void;
  onReassign: (dealId: string, repId: string) => void;
}) {
  const stageConfig = D2D_STAGE_CONFIG[deal.d2dStage];
  const statusConfig = deal.d2dStatus ? D2D_STATUS_CONFIG[deal.d2dStatus] : null;

  return (
    <motion.div
      initial={{ x: 360, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 360, opacity: 0 }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      className="w-[360px] shrink-0 border-l border-outline bg-surface-card overflow-y-auto"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-outline">
        <h2 className="text-[14px] font-bold text-text-primary truncate">{deal.leadName}</h2>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-tertiary text-text-muted hover:text-text-primary transition-colors">
          <X size={16} />
        </button>
      </div>

      <div className="px-5 py-4 space-y-5">
        {/* Stage + Status */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold px-2 py-1 rounded-md" style={{ color: stageConfig.color, background: stageConfig.color + '15' }}>
            {fr ? stageConfig.labelFr : stageConfig.label}
          </span>
          {statusConfig && (
            <span className="text-[11px] font-medium px-2 py-1 rounded-md" style={{ color: statusConfig.color, background: statusConfig.color + '15' }}>
              {fr ? statusConfig.labelFr : statusConfig.label}
            </span>
          )}
        </div>

        {/* Value */}
        {deal.value > 0 && (
          <div>
            <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1">{fr ? 'Valeur' : 'Value'}</p>
            <p className="text-[18px] font-bold text-text-primary tabular-nums">{formatCurrency(deal.value * 100, 'CAD')}</p>
          </div>
        )}

        {/* Contact info */}
        {(deal.leadEmail || deal.leadPhone) && (
          <div className="space-y-2">
            <p className="text-[10px] text-text-muted uppercase tracking-wider">Contact</p>
            {deal.leadEmail && (
              <div className="flex items-center gap-2 text-[12px] text-text-secondary">
                <Mail size={12} className="text-text-muted" /> {deal.leadEmail}
              </div>
            )}
            {deal.leadPhone && (
              <div className="flex items-center gap-2 text-[12px] text-text-secondary">
                <Phone size={12} className="text-text-muted" /> {deal.leadPhone}
              </div>
            )}
          </div>
        )}

        {/* Created by */}
        <div>
          <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1.5">{fr ? 'Créé par' : 'Created by'}</p>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-surface-tertiary flex items-center justify-center">
              <User size={11} className="text-text-muted" />
            </div>
            <span className="text-[12px] text-text-secondary font-medium">{deal.createdByName || (fr ? 'Inconnu' : 'Unknown')}</span>
          </div>
        </div>

        {/* Assigned to + Reassign */}
        <div>
          <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1.5">{fr ? 'Attribué à' : 'Assigned to'}</p>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-surface-tertiary flex items-center justify-center">
              <UserCheck size={11} className="text-text-muted" />
            </div>
            <span className="text-[12px] text-text-secondary font-medium flex-1">{deal.repName || (fr ? 'Non assigné' : 'Unassigned')}</span>
          </div>

          {/* Reassign dropdown */}
          <div className="mt-2">
            <p className="text-[10px] text-text-muted mb-1">{fr ? 'Réassigner à' : 'Reassign to'}</p>
            <select
              value={deal.repId || ''}
              onChange={(e) => { if (e.target.value) onReassign(deal.id, e.target.value); }}
              className="w-full px-3 py-2 rounded-lg border border-outline bg-surface-tertiary text-[12px] text-text-primary font-medium outline-none cursor-pointer"
            >
              <option value="" disabled>{fr ? 'Choisir un rep...' : 'Select rep...'}</option>
              {reps.map(r => (
                <option key={r.user_id} value={r.user_id}>
                  {r.full_name} ({r.role})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Lost reason */}
        {deal.lostReason && deal.d2dStage === 'closed_lost' && (
          <div>
            <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1">{fr ? 'Raison de perte' : 'Lost reason'}</p>
            <p className="text-[12px] text-red-400/70">{deal.lostReason}</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Main Pipeline ──

export default function D2DPipeline() {
  const [deals, setDeals] = useState<PipelineDeal[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [repFilter, setRepFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [activeDeal, setActiveDeal] = useState<PipelineDeal | null>(null);
  const [selectedDeal, setSelectedDeal] = useState<PipelineDeal | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const { language } = useTranslation();
  const fr = language === 'fr';

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    async function load() {
      try {
        setLoadError(false);
        const [dealsData, repsData] = await Promise.all([fetchPipeline(repFilter, fr), fetchReps()]);
        setDeals(dealsData);
        setReps(repsData);
      } catch (err: any) {
        console.error('[D2DPipeline] Load failed:', err.message);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [repFilter, reloadTick]);

  // Keep selected deal in sync with deals state
  useEffect(() => {
    if (selectedDeal) {
      const updated = deals.find(d => d.id === selectedDeal.id);
      if (updated) setSelectedDeal(updated);
      else setSelectedDeal(null);
    }
  }, [deals]);

  const dealsByStage = useMemo(() => {
    const groups: Record<D2DStage, PipelineDeal[]> = {
      new_lead: [], must_recall: [], quote_sent: [], closed_won: [], closed_lost: [],
    };
    for (const deal of deals) {
      if (groups[deal.d2dStage]) groups[deal.d2dStage].push(deal);
    }
    return groups;
  }, [deals]);

  function handleDragStart(event: DragStartEvent) {
    setActiveDeal(deals.find(d => d.id === event.active.id) || null);
  }

  const dragLocksRef = useRef<Set<string>>(new Set());
  async function handleDragEnd(event: DragEndEvent) {
    setActiveDeal(null);
    const { active, over } = event;
    if (!over) return;
    const dealId = active.id as string;
    // Per-deal lock: ignore drag end if a previous mutation is still in flight for this deal
    if (dragLocksRef.current.has(dealId)) return;
    const deal = deals.find(d => d.id === dealId);
    if (!deal) return;
    const overId = String(over.id);
    const overDeal = deals.find(d => d.id === overId);
    // Drop target: a card, or the column body itself (empty columns have no cards)
    const targetStage: D2DStage = overDeal?.d2dStage
      || (D2D_STAGES.includes(overId as D2DStage) ? (overId as D2DStage) : deal.d2dStage);
    if (targetStage === deal.d2dStage) return;
    const targetConfig = D2D_STAGE_CONFIG[targetStage];
    if (!targetConfig.manualEntry) {
      const reason = targetConfig.blockReason
        ? (fr ? targetConfig.blockReason.fr : targetConfig.blockReason.en)
        : (fr ? 'Impossible de déplacer ici' : 'Cannot move here');
      toast.error(reason);
      return;
    }
    const prevStage = deal.d2dStage;
    const prevDbStage = deal.stage;
    dragLocksRef.current.add(dealId);
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, d2dStage: targetStage, stage: D2D_TO_DB_STAGE[targetStage] } : d));
    try {
      await updateDeal(dealId, { stage: D2D_TO_DB_STAGE[targetStage] });
    } catch (err: any) {
      toast.error(err.message);
      setDeals(prev => prev.map(d => d.id === dealId ? { ...d, d2dStage: prevStage, stage: prevDbStage } : d));
    } finally {
      dragLocksRef.current.delete(dealId);
    }
  }

  async function handleStatusChange(dealId: string, status: D2DStatus) {
    const prevStatus = deals.find(d => d.id === dealId)?.d2dStatus ?? null;
    if (prevStatus === status) return;
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, d2dStatus: status } : d));
    try {
      await updateDeal(dealId, { d2d_status: status });
    } catch (err: any) {
      toast.error(err.message);
      setDeals(prev => prev.map(d => d.id === dealId ? { ...d, d2dStatus: prevStatus } : d));
    }
  }

  async function handleReassign(dealId: string, newRepId: string) {
    const prevDeal = deals.find(d => d.id === dealId);
    if (!prevDeal || prevDeal.repId === newRepId) return;
    const rep = reps.find(r => r.user_id === newRepId);
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, repId: newRepId, repName: rep?.full_name || null } : d));
    try {
      await updateDeal(dealId, { rep_id: newRepId });
      toast.success(fr ? 'Lead réassigné' : 'Lead reassigned');
    } catch (err: any) {
      toast.error(err.message);
      setDeals(prev => prev.map(d => d.id === dealId ? { ...d, repId: prevDeal.repId, repName: prevDeal.repName } : d));
    }
  }

  const activeRepName = repFilter !== 'all' ? reps.find(r => r.user_id === repFilter)?.full_name : null;

  if (loading) {
    return (
      <div className="h-[calc(100vh-3rem)] flex items-center justify-center bg-surface">
        <div className="text-text-muted text-sm">{fr ? 'Chargement du pipeline...' : 'Loading pipeline...'}</div>
      </div>
    );
  }

  // Load failure must never masquerade as an empty pipeline
  if (loadError) {
    return (
      <div className="h-[calc(100vh-3rem)] flex flex-col items-center justify-center gap-3 bg-surface">
        <p className="text-[13px] font-semibold text-text-primary">{fr ? 'Impossible de charger le pipeline' : 'Failed to load the pipeline'}</p>
        <p className="text-[12px] text-text-muted">{fr ? 'Vérifie ta connexion, puis réessaie.' : 'Check your connection, then try again.'}</p>
        <button
          onClick={() => { setLoading(true); setReloadTick(t => t + 1); }}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-outline bg-surface-tertiary text-[12px] font-medium text-text-secondary hover:text-text-primary hover:border-outline-strong transition-all"
        >
          <RefreshCw size={13} />
          {fr ? 'Réessayer' : 'Retry'}
        </button>
      </div>
    );
  }

  const totalDeals = deals.length;
  const totalValue = deals.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="h-[calc(100vh-3rem)] flex flex-col bg-surface">
      {/* Scoped scrollbar styling — this page only, no shared CSS touched */}
      <style>{`
        .pipeline-scroll { scrollbar-width: thin; scrollbar-color: var(--color-outline) transparent; }
        .pipeline-scroll::-webkit-scrollbar { height: 8px; width: 6px; }
        .pipeline-scroll::-webkit-scrollbar-track { background: transparent; }
        .pipeline-scroll::-webkit-scrollbar-thumb { background: var(--color-outline); border-radius: 999px; }
        .pipeline-scroll::-webkit-scrollbar-thumb:hover { background: var(--color-outline-strong); }
      `}</style>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-outline">
        <div>
          <h1 className="text-[18px] font-bold text-text-primary">Pipeline</h1>
          <p className="text-[12px] text-text-muted mt-0.5">
            {totalDeals} {totalDeals !== 1 ? 'deals' : 'deal'} · {formatCurrency(totalValue * 100, 'CAD')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Filter button */}
          <div className="relative">
            <button
              onClick={() => setFilterOpen(!filterOpen)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[12px] font-medium transition-all',
                activeRepName
                  ? 'border-blue-500/30 bg-blue-500/10 text-blue-400'
                  : 'border-outline bg-surface-tertiary text-text-secondary hover:text-text-primary hover:border-outline-strong'
              )}
            >
              <Filter size={13} />
              {activeRepName || (fr ? 'Filtrer' : 'Filter')}
              <ChevronDown size={11} className={cn('transition-transform', filterOpen && 'rotate-180')} />
            </button>

            <AnimatePresence>
              {filterOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="absolute right-0 top-10 w-56 bg-surface-elevated border border-outline rounded-xl shadow-2xl py-1.5 z-50"
                >
                  <button onClick={() => { setRepFilter('all'); setFilterOpen(false); setLoading(true); }}
                    className={cn('w-full text-left px-3.5 py-2 text-[12px] transition-colors',
                      repFilter === 'all' ? 'text-text-primary font-semibold bg-surface-tertiary' : 'text-text-secondary hover:text-text-primary hover:bg-surface-tertiary')}>
                    {fr ? 'Tous les reps' : 'All Reps'}
                  </button>
                  <div className="border-t border-outline-subtle my-1" />
                  {reps.map(r => (
                    <button key={r.user_id} onClick={() => { setRepFilter(r.user_id); setFilterOpen(false); setLoading(true); }}
                      className={cn('w-full text-left px-3.5 py-2 text-[12px] transition-colors flex items-center justify-between',
                        repFilter === r.user_id ? 'text-text-primary font-semibold bg-surface-tertiary' : 'text-text-secondary hover:text-text-primary hover:bg-surface-tertiary')}>
                      <span>{r.full_name}</span>
                      <span className="text-[10px] text-text-muted capitalize">{r.role}</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Body: Kanban + Detail panel */}
      <div className="flex-1 flex overflow-hidden">
        {/* Kanban board */}
        <div className="pipeline-scroll flex-1 overflow-x-auto p-5">
          <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="flex gap-5 min-w-max">
              {D2D_STAGES.map((stage) => (
                <StageColumn key={stage} stage={stage} deals={dealsByStage[stage]} onStatusChange={handleStatusChange} onSelect={setSelectedDeal} />
              ))}
            </div>
            <DragOverlay>
              {activeDeal && (
                <div className="w-[250px] rounded-xl border border-outline-strong bg-surface-elevated p-3.5 shadow-2xl rotate-2">
                  <p className="text-[13px] font-semibold text-text-primary">{activeDeal.leadName}</p>
                  <p className="text-[11px] text-text-muted mt-1">{formatCurrency(activeDeal.value * 100, 'CAD')}</p>
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </div>

        {/* Detail panel (slide-in from right) */}
        <AnimatePresence>
          {selectedDeal && (
            <DealDetailPanel
              deal={selectedDeal}
              reps={reps}
              fr={fr}
              onClose={() => setSelectedDeal(null)}
              onReassign={handleReassign}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
