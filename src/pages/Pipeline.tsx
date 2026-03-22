import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle, CalendarPlus, Kanban, LayoutGrid, List, Plus, Search, Trash2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import {
  AvailabilitySlot,
  createScheduleEventAtSlot,
  createDealWithJob,
  deleteLeadAndOptionalClient,
  getAvailableSlots,
  listPipelineDeals,
  listScheduleEventsForJob,
  PIPELINE_STAGES,
  PipelineDeal,
  PipelineScheduleEvent,
  PipelineStageName,
  serverDeleteDeal,
  updatePipelineDeal,
  stageToDbSlug,
} from '../lib/pipelineApi';
import { createLeadQuick, fetchLeadsScoped, updateLeadStatus, type LeadStatus } from '../lib/leadsApi';
import { useJobModalController } from '../contexts/JobModalController';
import { getActiveJobByLeadId, updateJob } from '../lib/jobsApi';
import { mapLeadToJobDraft } from '../lib/mapLeadToJobDraft';
import { cn, formatCurrency, formatDate } from '../lib/utils';
import { PageHeader, EmptyState } from '../components/ui';
import StatusBadge from '../components/ui/StatusBadge';
import { useTranslation } from '../i18n';
import type { TranslationKeys } from '../i18n';
import { useEscapeKey } from '../hooks/useEscapeKey';

type KanbanColumnProps = {
  stage: PipelineStageName;
  deals: PipelineDeal[];
  total: number;
  onCardClick: (deal: PipelineDeal) => void;
  onDeleteDeal: (deal: PipelineDeal) => void;
  t: TranslationKeys;
};

const KanbanColumn: React.FC<KanbanColumnProps> = ({ stage, deals, total, onCardClick, onDeleteDeal, t }) => {
  const { setNodeRef, isOver } = useDroppable({ id: stage });

  return (
    <section className="w-[320px] flex-shrink-0 section-card p-3">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-[13px] font-bold text-text-primary">{stage}</h3>
          <p className="text-xs text-text-tertiary">{formatCurrency(total)} • {deals.length} {t.pipeline.deals}</p>
        </div>
      </header>

      <div
        ref={setNodeRef}
        className={`max-h-[66vh] min-h-[140px] space-y-2 overflow-y-auto rounded-xl border border-dashed p-2 ${isOver ? 'border-primary/40 bg-primary/5' : 'border-outline-subtle'}`}
      >
        {deals.length === 0 && (
          <div className="grid h-20 place-items-center rounded-md text-xs text-text-tertiary">{t.pipeline.dropDealsHere}</div>
        )}
        {deals.map((deal) => (
          <DealCard key={deal.id} deal={deal} onClick={() => onCardClick(deal)} onDelete={() => onDeleteDeal(deal)} t={t} />
        ))}
      </div>
    </section>
  );
};

const DealCard: React.FC<{ deal: PipelineDeal; onClick: () => void; onDelete: () => void; t: TranslationKeys }> = ({ deal, onClick, onDelete, t }) => {
  const { setNodeRef, listeners, attributes, transform, isDragging } = useDraggable({ id: deal.id });
  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.6 : 1,
  };

  const leadName = `${deal.lead?.first_name || ''} ${deal.lead?.last_name || ''}`.trim() || t.pipeline.unknownLead;
  const canDelete = stageToSlug(deal.stage) === 'lost';

  // Hot/Cold lead indicator from tags
  const tags = deal.lead?.tags || [];
  const isHot = tags.some((tag) => /hot|chaud|urgent/i.test(tag));
  const isCold = tags.some((tag) => /cold|froid/i.test(tag));

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className="cursor-grab rounded-xl border border-outline bg-surface p-3 shadow-xs transition hover:border-primary/30 hover:shadow-sm active:cursor-grabbing"
    >
      {/* Header: lead name + hot/cold + delete */}
      <div className="flex items-center justify-between gap-1 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {isHot && <span className="shrink-0 w-2 h-2 rounded-full bg-red-500" title="Hot lead" />}
          {isCold && <span className="shrink-0 w-2 h-2 rounded-full bg-neutral-400" title="Cold lead" />}
          <p className="text-xs font-semibold text-text-primary truncate">{leadName}</p>
        </div>
        {canDelete && (
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); onDelete(); }}
            className="rounded p-1 text-text-tertiary hover:text-danger hover:bg-danger-light shrink-0"
            aria-label={t.common.delete}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {/* Service / line item title */}
      <h4 className="text-[13px] font-bold text-text-primary leading-snug">{deal.title}</h4>

      {/* Contact — compact */}
      <p className="text-[11px] text-text-tertiary mt-1 truncate">
        {deal.lead?.phone || deal.lead?.email || ''}
      </p>

      {/* Price + status */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[14px] font-bold text-text-primary tabular-nums">{formatCurrency(deal.value)}</span>
        <span className="badge-neutral text-[10px]">{deal.job?.status || t.pipeline.noStatus}</span>
      </div>
    </article>
  );
};

// Use stageToDbSlug from pipelineApi (single source of truth)
const stageToSlug = stageToDbSlug;

export default function Pipeline() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { openJobModal } = useJobModalController();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const [deals, setDeals] = useState<PipelineDeal[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [view, setView] = useState<'kanban' | 'list'>('kanban');

  const [createOpen, setCreateOpen] = useState(false);
  const [createLeadId, setCreateLeadId] = useState('');
  const [createTitle, setCreateTitle] = useState('');
  const [createValue, setCreateValue] = useState('0');
  const [createStage, setCreateStage] = useState<PipelineStageName>(PIPELINE_STAGES[0]);
  const [createNotes, setCreateNotes] = useState('');
  const [leadSearch, setLeadSearch] = useState('');
  const [quickLeadName, setQuickLeadName] = useState('');
  const [quickLeadEmail, setQuickLeadEmail] = useState('');
  const [quickLeadPhone, setQuickLeadPhone] = useState('');

  const [selected, setSelected] = useState<PipelineDeal | null>(null);
  const [drawerEvents, setDrawerEvents] = useState<PipelineScheduleEvent[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editValue, setEditValue] = useState('0');
  const [editStage, setEditStage] = useState<PipelineStageName>(PIPELINE_STAGES[0]);
  const [editNotes, setEditNotes] = useState('');
  const [dealToDelete, setDealToDelete] = useState<PipelineDeal | null>(null);
  const [isDeletingDeal, setIsDeletingDeal] = useState(false);
  const [isDeleteLeadOpen, setIsDeleteLeadOpen] = useState(false);
  const [alsoDeleteLinkedClient, setAlsoDeleteLinkedClient] = useState(false);
  const [isDeletingLead, setIsDeletingLead] = useState(false);
  const [isSlotPickerOpen, setIsSlotPickerOpen] = useState(false);
  const [slotLoading, setSlotLoading] = useState(false);
  const [slotSaving, setSlotSaving] = useState(false);
  const [availableSlots, setAvailableSlots] = useState<AvailabilitySlot[]>([]);
  const jobModalShownForLead = useRef<Set<string>>(new Set());

  // Escape key closes drawers/modals
  useEscapeKey(() => {
    if (dealToDelete) { setDealToDelete(null); return; }
    if (isDeleteLeadOpen) { setIsDeleteLeadOpen(false); return; }
    if (isSlotPickerOpen) { setIsSlotPickerOpen(false); return; }
    if (selected) { setSelected(null); return; }
    if (createOpen) { setCreateOpen(false); return; }
  }, !!(selected || createOpen || dealToDelete || isDeleteLeadOpen || isSlotPickerOpen));

  // Listen for command palette create event
  useEffect(() => {
    const handler = () => setCreateOpen(true);
    window.addEventListener('crm:open-new-deal', handler);
    return () => window.removeEventListener('crm:open-new-deal', handler);
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [dealsData, leadsData] = await Promise.all([
        listPipelineDeals(),
        fetchLeadsScoped({ sort: 'recent' }),
      ]);
      setDeals(dealsData);
      setLeads(leadsData);
      if (!createLeadId && leadsData[0]?.id) setCreateLeadId(leadsData[0].id);
    } catch (e: any) {
      setError(e?.message || t.pipeline.failedLoadPipeline);
      toast.error(e?.message || t.pipeline.failedLoadPipeline);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // Custom window events (from leads page, command palette, etc.)
  useEffect(() => {
    const handler = () => {
      void load();
    };
    window.addEventListener('crm:lead-created', handler as EventListener);
    window.addEventListener('crm:lead-deleted', handler as EventListener);
    return () => {
      window.removeEventListener('crm:lead-created', handler as EventListener);
      window.removeEventListener('crm:lead-deleted', handler as EventListener);
    };
  }, []);

  // Supabase Realtime: auto-refresh when pipeline_deals, leads, or clients change
  useEffect(() => {
    const channel = supabase
      .channel('pipeline-live-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pipeline_deals' }, () => {
        void load();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'leads', filter: 'deleted_at=neq.null' }, () => {
        void load();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'clients', filter: 'deleted_at=neq.null' }, () => {
        void load();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const leadId = searchParams.get('leadId');
    if (!leadId || deals.length === 0) return;
    const deal = deals.find((row) => row.lead_id === leadId);
    if (!deal) return;
    void handleOpenDeal(deal);
  }, [searchParams, deals]);

  async function maybeOpenJobModalForClosedDeal(deal: PipelineDeal) {
    if (stageToSlug(deal.stage) !== 'closed' || !deal.lead_id) return;
    if (jobModalShownForLead.current.has(deal.lead_id)) return;

    try {
      const existingJob = await getActiveJobByLeadId(deal.lead_id);
      if (existingJob) {
        jobModalShownForLead.current.add(deal.lead_id);
        toast.info(t.pipeline.existingJobFound);
        navigate(`/jobs/${existingJob.id}`);
        return;
      }
    } catch (error: any) {
      toast.error(error?.message || t.pipeline.couldNotCheckJobs);
      return;
    }

    openJobModal({
      sourceContext: { type: 'pipeline', leadId: deal.lead_id },
      initialValues: mapLeadToJobDraft(deal),
      onCreated: () => {
        jobModalShownForLead.current.add(deal.lead_id as string);
      },
      onCancel: () => {
        jobModalShownForLead.current.add(deal.lead_id as string);
        toast.info(t.pipeline.jobCreationSkipped);
      },
    });
  }

  const filteredDeals = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return deals;

    return deals.filter((deal) => {
      const leadName = `${deal.lead?.first_name || ''} ${deal.lead?.last_name || ''}`.toLowerCase();
      const haystack = [deal.title, leadName, deal.lead?.email || '', deal.lead?.phone || '', deal.job?.title || '']
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [deals, query]);

  const grouped = useMemo(() => {
    const map = Object.fromEntries(PIPELINE_STAGES.map((s) => [s, []])) as Record<PipelineStageName, PipelineDeal[]>;
    for (const deal of filteredDeals) {
      const stage = PIPELINE_STAGES.includes(deal.stage as PipelineStageName)
        ? (deal.stage as PipelineStageName)
        : PIPELINE_STAGES[0];
      map[stage].push(deal);
    }
    return map;
  }, [filteredDeals]);

  const totals = useMemo(() => {
    const byStage = Object.fromEntries(
      PIPELINE_STAGES.map((s) => [s, grouped[s].reduce((acc, d) => acc + Number(d.value || 0), 0)])
    ) as Record<PipelineStageName, number>;

    const overall = filteredDeals.reduce((acc, d) => acc + Number(d.value || 0), 0);
    return { byStage, overall };
  }, [grouped, filteredDeals]);

  async function handleCreateDeal() {
    if (!createLeadId || !createTitle.trim()) {
      toast.error(t.pipeline.leadAndDealRequired);
      return;
    }

    setSaving(true);
    try {
      const created = await createDealWithJob({
        lead_id: createLeadId,
        title: createTitle.trim(),
        value: Number(createValue || 0),
        stage: createStage,
        notes: createNotes.trim() || null,
      });
      toast.success(t.pipeline.dealCreated);
      setCreateOpen(false);
      setCreateTitle('');
      setCreateValue('0');
      setCreateNotes('');
      await load();
      if (stageToSlug(created.stage) === 'closed') {
        await maybeOpenJobModalForClosedDeal(created);
      }
    } catch (e: any) {
      toast.error(e?.message || t.pipeline.failedCreateDeal);
    } finally {
      setSaving(false);
    }
  }

  async function handleQuickAddLead() {
    if (!quickLeadName.trim()) {
      toast.error(t.pipeline.leadAndDealRequired);
      return;
    }

    setSaving(true);
    try {
      await createLeadQuick({
        full_name: quickLeadName.trim(),
        email: quickLeadEmail.trim() || null,
        phone: quickLeadPhone.trim() || null,
      });
      await load();
      setQuickLeadName('');
      setQuickLeadEmail('');
      setQuickLeadPhone('');
      setCreateOpen(false);
      toast.success(t.pipeline.leadAndDealAdded);
    } catch (e: any) {
      toast.error(e?.message || t.pipeline.failedAddLead);
    } finally {
      setSaving(false);
    }
  }

  async function handleOpenDeal(deal: PipelineDeal) {
    setSelected(deal);
    setEditTitle(deal.title);
    setEditValue(String(deal.value));
    setEditStage((PIPELINE_STAGES.includes(deal.stage as PipelineStageName) ? deal.stage : PIPELINE_STAGES[0]) as PipelineStageName);
    setEditNotes(deal.notes || '');

    setDrawerLoading(true);
    try {
      if (!deal.job_id) {
        setDrawerEvents([]);
      } else {
        const events = await listScheduleEventsForJob(deal.job_id);
        setDrawerEvents(events);
      }
    } catch (e: any) {
      toast.error(e?.message || t.pipeline.failedLoadSlots);
      setDrawerEvents([]);
    } finally {
      setDrawerLoading(false);
    }
  }

  async function handleSaveDeal() {
    if (!selected) return;
    setSaving(true);
    try {
      const updated = await updatePipelineDeal(selected.id, {
        title: editTitle.trim(),
        value: Number(editValue || 0),
        stage: editStage,
        notes: editNotes.trim() || null,
      });

      setDeals((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));

      if (updated.job_id && updated.job?.title !== updated.title) {
        try {
          await updateJob(updated.job_id, { title: updated.title });
        } catch (jobErr: any) {
          toast.error(jobErr?.message || 'Failed to sync job title');
        }
      }

      setSelected(updated);
      toast.success(t.pipeline.dealUpdated);

      await maybeOpenJobModalForClosedDeal(updated);
    } catch (e: any) {
      toast.error(e?.message || t.pipeline.failedSaveDeal);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddEventFromDeal() {
    if (!selected) return;
    if (!selected.job_id) {
      toast.error(t.pipeline.dealHasNoJob);
      return;
    }

    setSlotLoading(true);
    setIsSlotPickerOpen(true);
    try {
      const slots = await getAvailableSlots({
        teamId: selected.job?.team_id || null,
        days: 14,
        slotMinutes: 30,
      });
      setAvailableSlots(slots);
    } catch (e: any) {
      setIsSlotPickerOpen(false);
      toast.error(e?.message || t.pipeline.failedLoadSlots);
    } finally {
      setSlotLoading(false);
    }
  }

  async function handleSelectSlot(slot: AvailabilitySlot) {
    if (!selected?.job_id || slotSaving) return;
    setSlotSaving(true);
    try {
      await createScheduleEventAtSlot({
        jobId: selected.job_id,
        startAt: slot.slot_start,
        endAt: slot.slot_end,
        teamId: slot.team_id || selected.job?.team_id || null,
      });
      const events = await listScheduleEventsForJob(selected.job_id);
      setDrawerEvents(events);
      setIsSlotPickerOpen(false);
      setAvailableSlots([]);
      toast.success(t.pipeline.scheduleEventAdded);
    } catch (error: any) {
      toast.error(error?.message || t.pipeline.failedCreateEvent);
    } finally {
      setSlotSaving(false);
    }
  }

  async function handleDeleteLeadWithOptionalClient() {
    if (!selected?.lead_id || isDeletingLead) return;
    setIsDeletingLead(true);
    try {
      const result = await deleteLeadAndOptionalClient({
        leadId: selected.lead_id,
        alsoDeleteClient: alsoDeleteLinkedClient,
      });
      setIsDeleteLeadOpen(false);
      setAlsoDeleteLinkedClient(false);
      setSelected(null);
      await load();
      toast.success(
        `Lead deleted. Deals: ${result.deals}${result.client_deleted > 0 ? ', linked client deleted' : ''}.`
      );
    } catch (error: any) {
      toast.error(error?.message || t.pipeline.failedDeleteLead);
    } finally {
      setIsDeletingLead(false);
    }
  }

  const slotsByDay = useMemo(() => {
    const grouped = new Map<string, AvailabilitySlot[]>();
    for (const slot of availableSlots) {
      const key = new Date(slot.slot_start).toLocaleDateString();
      const bucket = grouped.get(key) || [];
      bucket.push(slot);
      grouped.set(key, bucket);
    }
    return Array.from(grouped.entries());
  }, [availableSlots]);

  async function onDragEnd(event: any) {
    const { active, over } = event;
    if (!over) return;

    const dealId = String(active.id);
    const newStage = String(over.id) as PipelineStageName;
    if (!PIPELINE_STAGES.includes(newStage)) return;
    const previous = deals;
    setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, stage: newStage } : d)));

    try {
      const updated = await updatePipelineDeal(dealId, { stage: newStage });

      // Sync lead status with pipeline stage
      const deal = deals.find((d) => d.id === dealId);
      if (deal?.lead_id) {
        const stageToStatus: Record<string, LeadStatus> = {
          new: 'new',
          follow_up_1: 'follow_up_1',
          follow_up_2: 'follow_up_2',
          follow_up_3: 'follow_up_3',
          closed: 'closed',
          lost: 'lost',
        };
        const dbStatus = stageToStatus[stageToSlug(newStage)];
        if (dbStatus) {
          updateLeadStatus(deal.lead_id, dbStatus).catch(() => {});
        }
      }

      toast.success(t.pipeline.dealMoved);
      await maybeOpenJobModalForClosedDeal(updated);
    } catch (e: any) {
      setDeals(previous);
      toast.error(e?.message || (t.pipeline.failedSaveDeal || 'Failed to move deal'));
    }
  }

  async function handleConfirmDeleteDeal() {
    if (!dealToDelete || isDeletingDeal) return;
    setIsDeletingDeal(true);
    try {
      // Use server-side deletion (service_role) to bypass RLS issues
      await serverDeleteDeal(dealToDelete.id, Boolean(dealToDelete.lead_id));

      setDeals((prev) => prev.filter((deal) => deal.id !== dealToDelete.id));
      if (selected?.id === dealToDelete.id) setSelected(null);
      setDealToDelete(null);
      toast.success(t.pipeline.dealDeleted);
      await load();
    } catch (error: any) {
      toast.error(error?.message || t.pipeline.failedDeleteDeal);
    } finally {
      setIsDeletingDeal(false);
    }
  }

  const filteredLeads = useMemo(() => {
    const q = leadSearch.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((lead) => `${lead.first_name || ''} ${lead.last_name || ''}`.toLowerCase().includes(q));
  }, [leads, leadSearch]);

  return (
    <div className="space-y-5">
      <PageHeader title={t.pipeline.title} subtitle={`${formatCurrency(totals.overall)} • ${filteredDeals.length} ${t.pipeline.deals}`} icon={Kanban} iconColor="purple">
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`${t.common.search} pipeline...`}
            className="glass-input w-56"
          />
          <button type="button" onClick={() => setView('kanban')} className={cn('glass-button', view === 'kanban' && '!bg-primary !text-white !border-primary')}>
            <LayoutGrid size={14} />
          </button>
          <button type="button" onClick={() => setView('list')} className={cn('glass-button', view === 'list' && '!bg-primary !text-white !border-primary')}>
            <List size={14} />
          </button>
          <button type="button" onClick={() => setCreateOpen(true)} className="glass-button-primary inline-flex items-center gap-1.5">
            <Plus size={14} /> {t.pipeline.deal}
          </button>
        </div>
      </PageHeader>

      {error && <div className="rounded-md bg-danger-light border border-danger/20 px-4 py-2.5 text-[13px] text-danger">{error}</div>}

      {loading ? (
        <div className="h-48 rounded-xl bg-surface-secondary" />
      ) : view === 'kanban' ? (
        <DndContext sensors={sensors} onDragEnd={(e) => void onDragEnd(e)}>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {PIPELINE_STAGES.map((stage) => (
              <KanbanColumn
                key={stage}
                stage={stage}
                deals={grouped[stage]}
                total={totals.byStage[stage]}
                onCardClick={(deal) => void handleOpenDeal(deal)}
                onDeleteDeal={(deal) => setDealToDelete(deal)}
                t={t}
              />
            ))}
          </div>
        </DndContext>
      ) : (
        <div className="section-card overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{t.common.title}</th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{t.pipeline.lead}</th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{t.pipeline.stage}</th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{t.common.value}</th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{t.pipeline.job}</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{t.common.actions}</th>
              </tr>
            </thead>
            <tbody>
              {filteredDeals.map((deal) => (
                <tr key={deal.id} className="table-row-hover">
                  <td className="px-4 py-3 font-medium text-text-primary">{deal.title}</td>
                  <td className="px-4 py-3 text-text-secondary">{`${deal.lead?.first_name || ''} ${deal.lead?.last_name || ''}`.trim()}</td>
                  <td className="px-4 py-3"><StatusBadge status={deal.stage} /></td>
                  <td className="px-4 py-3 text-text-primary tabular-nums">{formatCurrency(deal.value)}</td>
                  <td className="px-4 py-3">
                    {deal.job_id ? (
                      <button type="button" className="text-primary hover:underline" onClick={() => navigate(`/jobs/${deal.job_id}`)}>
                        {deal.job?.title || deal.job_id.slice(0, 8)}
                      </button>
                    ) : (
                      <span className="text-text-tertiary">{t.pipeline.noJobLinked}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {stageToSlug(deal.stage) === 'lost' ? (
                      <button
                        type="button"
                        className="inline-flex rounded p-1 text-text-tertiary hover:text-danger hover:bg-danger-light"
                        onClick={() => setDealToDelete(deal)}
                        aria-label={t.common.delete}
                      >
                        <Trash2 size={14} />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <div className="modal-overlay">
          <div className="modal-content max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 space-y-4">
            <h2 className="text-[15px] font-bold text-text-primary">{t.pipeline.newDeal}</h2>

            {/* Lead select + search */}
            <div className="space-y-2">
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.pipeline.lead}</label>
              <input
                value={leadSearch}
                onChange={(e) => setLeadSearch(e.target.value)}
                placeholder={t.pipeline.typeLeadName}
                className="glass-input w-full text-text-primary placeholder:text-text-tertiary mb-1"
              />
              <select value={createLeadId} onChange={(e) => setCreateLeadId(e.target.value)} className="glass-input w-full">
                {filteredLeads.map((lead) => (
                  <option key={lead.id} value={lead.id}>
                    {lead.first_name} {lead.last_name}
                  </option>
                ))}
              </select>
            </div>

            {/* Essential: Title + Value */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.pipeline.dealTitle}</label>
                <input
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                  className="glass-input w-full text-text-primary placeholder:text-text-tertiary"
                  placeholder={t.pipeline.dealTitlePlaceholder}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.common.value}</label>
                <input
                  value={createValue}
                  onChange={(e) => setCreateValue(e.target.value)}
                  type="number"
                  min="0"
                  className="glass-input w-full"
                  placeholder="0"
                />
              </div>
            </div>

            {/* Quick add lead — collapsed toggle */}
            <details className="rounded-xl border border-outline-subtle">
              <summary className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-text-secondary cursor-pointer hover:bg-surface-secondary transition-colors rounded-xl">
                {t.pipeline.quickAddLead}
              </summary>
              <div className="p-3 pt-0 space-y-2">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <input value={quickLeadName} onChange={(e) => setQuickLeadName(e.target.value)} placeholder={t.pipeline.fullName} className="glass-input w-full text-text-primary placeholder:text-text-tertiary" />
                  <input value={quickLeadEmail} onChange={(e) => setQuickLeadEmail(e.target.value)} placeholder={t.pipeline.emailOptional} className="glass-input w-full text-text-primary placeholder:text-text-tertiary" />
                  <input value={quickLeadPhone} onChange={(e) => setQuickLeadPhone(e.target.value)} placeholder={t.pipeline.phoneOptional} className="glass-input w-full text-text-primary placeholder:text-text-tertiary" />
                </div>
                <div className="flex justify-end">
                  <button type="button" className="glass-button text-[12px]" disabled={saving} onClick={() => void handleQuickAddLead()}>
                    {saving ? t.common.saving : t.pipeline.addLead}
                  </button>
                </div>
              </div>
            </details>

            {/* More options — collapsed */}
            <details className="rounded-xl border border-outline-subtle">
              <summary className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-text-secondary cursor-pointer hover:bg-surface-secondary transition-colors rounded-xl">
                {t.common.moreOptions || 'More options'}
              </summary>
              <div className="p-3 pt-0 grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.pipeline.stage}</label>
                  <select value={createStage} onChange={(e) => setCreateStage(e.target.value as PipelineStageName)} className="glass-input w-full">
                    {PIPELINE_STAGES.map((stage) => (
                      <option key={stage} value={stage}>{stage}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.common.notes}</label>
                  <input value={createNotes} onChange={(e) => setCreateNotes(e.target.value)} className="glass-input w-full text-text-primary placeholder:text-text-tertiary" placeholder={t.pipeline.optionalNote} />
                </div>
              </div>
            </details>

            <div className="flex justify-end gap-2">
              <button type="button" className="glass-button" onClick={() => setCreateOpen(false)}>{t.common.cancel}</button>
              <button type="button" className="glass-button-primary" disabled={saving} onClick={() => void handleCreateDeal()}>
                {saving ? t.common.saving : t.common.create}
              </button>
            </div>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-[130] flex justify-end bg-black/30 backdrop-blur-[2px]" onClick={() => setSelected(null)}>
          <div className="h-full w-full max-w-xl overflow-y-auto border-l border-outline bg-surface p-5" onClick={(e) => e.stopPropagation()}>
            <div className="space-y-5">
              <header className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-bold text-text-primary">{t.pipeline.dealDetails}</h2>
                  <p className="text-[13px] text-text-secondary">{selected.id}</p>
                </div>
                <button type="button" onClick={() => setSelected(null)} className="glass-button text-text-primary">{t.common.close}</button>
              </header>

              <section className="space-y-3 section-card p-4">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{t.pipeline.deal}</h3>
                <div className="space-y-2">
                  <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.common.title}</label>
                  <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="glass-input w-full" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.pipeline.stage}</label>
                    <select value={editStage} onChange={(e) => setEditStage(e.target.value as PipelineStageName)} className="glass-input w-full">
                      {PIPELINE_STAGES.map((stage) => (
                        <option key={stage} value={stage}>{stage}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.common.value}</label>
                    <input value={editValue} type="number" min="0" onChange={(e) => setEditValue(e.target.value)} className="glass-input w-full" />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.common.notes}</label>
                  <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} className="glass-input min-h-[96px] w-full text-text-primary placeholder:text-text-tertiary" placeholder={t.pipeline.internalNotes} />
                </div>
              </section>

              <section className="space-y-3 section-card p-4">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{t.pipeline.lead}</h3>
                <p className="text-[13px] text-text-primary">{selected.lead ? `${selected.lead.first_name} ${selected.lead.last_name}` : t.pipeline.unknownLead}</p>
                <p className="text-[13px] text-text-secondary">{selected.lead?.email || t.common.noEmail}</p>
                <p className="text-[13px] text-text-secondary">{selected.lead?.phone || t.common.noPhone}</p>
                <div className="flex gap-2">
                  {selected.lead_id && (
                    <button type="button" className="glass-button text-text-primary" onClick={() => navigate('/leads')}>
                      {t.pipeline.openLead}
                    </button>
                  )}
                  <button
                    type="button"
                    className="glass-button text-danger hover:bg-danger-light"
                    onClick={() => setIsDeleteLeadOpen(true)}
                    disabled={!selected.lead_id}
                  >
                    {t.pipeline.deleteLead}
                  </button>
                </div>
              </section>

              <section className="space-y-3 section-card p-4">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{t.pipeline.job}</h3>
                <p className="text-[13px] text-text-primary">{selected.job?.title || t.pipeline.untitledJob}</p>
                <p className="text-[13px] text-text-secondary">{`${t.common.status}:`} {selected.job?.status || t.pipeline.na}</p>
                {selected.job_id ? (
                  <button type="button" className="glass-button text-text-primary" onClick={() => navigate(`/jobs/${selected.job_id}`)}>
                    {t.pipeline.openJob}
                  </button>
                ) : (
                  <span className="text-sm text-text-tertiary">{t.pipeline.noJobLinked}</span>
                )}
              </section>

              <section className="space-y-3 section-card p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{t.pipeline.schedule}</h3>
                  <button type="button" onClick={() => void handleAddEventFromDeal()} className="glass-button-primary inline-flex items-center gap-2" disabled={saving}>
                    <CalendarPlus size={14} /> {t.pipeline.addEvent}
                  </button>
                </div>
                {drawerLoading ? (
                  <div className="h-20 rounded bg-surface-secondary" />
                ) : drawerEvents.length === 0 ? (
                  <p className="text-[13px] text-text-secondary">{t.pipeline.noEventsYet}</p>
                ) : (
                  <div className="space-y-2">
                    {drawerEvents.map((event) => (
                      <div key={event.id} className="rounded-xl border border-outline-subtle p-2">
                        <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
                          {formatDate(event.start_time)} - {formatDate(event.end_time)}
                        </p>
                        <p className="text-xs text-text-secondary">{event.status || 'scheduled'}</p>
                        {event.notes && <p className="text-xs text-text-secondary">{event.notes}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <div className="flex justify-end gap-3">
                <button type="button" className="glass-button text-text-primary" onClick={() => setSelected(null)}>{t.common.cancel}</button>
                <button type="button" className="glass-button-primary" disabled={saving} onClick={() => void handleSaveDeal()}>
                  {saving ? t.common.saving : t.common.save}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {dealToDelete ? (
          <motion.div
            className="fixed inset-0 z-[140] bg-black/50 backdrop-blur-sm p-4 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="modal-content w-full max-w-md"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xl font-semibold tracking-tight">{t.pipeline.deleteThisDeal}</h3>
                <button
                  className="rounded-lg p-1 hover:bg-surface-secondary"
                  onClick={() => !isDeletingDeal && setDealToDelete(null)}
                  aria-label="Close delete dialog"
                >
                  <X size={16} />
                </button>
              </div>
              <p className="mt-3 text-[13px] text-text-secondary">
                {t.pipeline.deleteDealMsg}
              </p>
              <p className="mt-2 inline-flex items-center gap-2 rounded-lg bg-warning-light px-3 py-2 text-xs text-warning">
                <AlertTriangle size={14} />
                {t.pipeline.ownerAdminOnly}
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button className="glass-button text-text-primary" onClick={() => setDealToDelete(null)} disabled={isDeletingDeal}>
                  {t.common.cancel}
                </button>
                <button
                  className="glass-button-primary bg-danger hover:bg-danger/90"
                  onClick={() => void handleConfirmDeleteDeal()}
                  disabled={isDeletingDeal}
                >
                  {isDeletingDeal ? t.common.deleting : t.common.delete}
                </button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {isDeleteLeadOpen && selected ? (
          <motion.div
            className="fixed inset-0 z-[145] bg-black/50 backdrop-blur-sm p-4 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div className="modal-content w-full max-w-md" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}>
              <h3 className="text-lg font-semibold">{t.pipeline.deleteThisLead}</h3>
              <p className="mt-2 text-[13px] text-text-secondary">{t.pipeline.deleteLeadMsg}</p>
              <label className="mt-3 flex items-center gap-2 rounded-xl border border-outline-subtle bg-surface px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={alsoDeleteLinkedClient}
                  onChange={(e) => setAlsoDeleteLinkedClient(e.target.checked)}
                />
                {t.pipeline.alsoDeleteClient}
              </label>
              <div className="mt-5 flex justify-end gap-2">
                <button className="glass-button" onClick={() => setIsDeleteLeadOpen(false)} disabled={isDeletingLead}>
                  {t.common.cancel}
                </button>
                <button
                  className="glass-button-primary bg-danger hover:bg-danger/90"
                  onClick={() => void handleDeleteLeadWithOptionalClient()}
                  disabled={isDeletingLead}
                >
                  {isDeletingLead ? t.common.deleting : t.common.delete}
                </button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {isSlotPickerOpen && selected ? (
          <motion.div
            className="fixed inset-0 z-[146] bg-black/50 backdrop-blur-sm p-4 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div className="modal-content w-full max-w-2xl" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">{t.pipeline.availableSlots}</h3>
                <button onClick={() => setIsSlotPickerOpen(false)} disabled={slotSaving}>
                  <X size={16} />
                </button>
              </div>
              {slotLoading ? (
                <div className="mt-4 h-24 rounded-lg bg-surface-secondary" />
              ) : availableSlots.length === 0 ? (
                <div className="mt-4 rounded-lg border border-warning/20 bg-warning-light px-3 py-3 text-sm text-warning">
                  {t.pipeline.noAvailability}
                  <div className="mt-2">
                    <button className="glass-button" onClick={() => navigate('/schedule')}>
                      {t.pipeline.openSchedule}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto">
                  {slotsByDay.map(([day, slots]) => (
                    <div key={day}>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">{day}</p>
                      <div className="flex flex-wrap gap-2">
                        {slots.map((slot) => (
                          <button
                            key={slot.slot_start}
                            className="glass-button"
                            onClick={() => void handleSelectSlot(slot)}
                            disabled={slotSaving}
                          >
                            {new Date(slot.slot_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
