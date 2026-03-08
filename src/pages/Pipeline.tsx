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
  softDeletePipelineDeal,
  updatePipelineDeal,
} from '../lib/pipelineApi';
import { createLeadQuick, deleteLeadScoped, fetchLeadsScoped } from '../lib/leadsApi';
import { useJobModalController } from '../contexts/JobModalController';
import { getActiveJobByLeadId } from '../lib/jobsApi';
import { mapLeadToJobDraft } from '../lib/mapLeadToJobDraft';
import { cn, formatCurrency, formatDate } from '../lib/utils';
import { PageHeader, EmptyState } from '../components/ui';
import StatusBadge from '../components/ui/StatusBadge';

type KanbanColumnProps = {
  stage: PipelineStageName;
  deals: PipelineDeal[];
  total: number;
  onCardClick: (deal: PipelineDeal) => void;
  onDeleteDeal: (deal: PipelineDeal) => void;
};

const KanbanColumn: React.FC<KanbanColumnProps> = ({ stage, deals, total, onCardClick, onDeleteDeal }) => {
  const { setNodeRef, isOver } = useDroppable({ id: stage });

  return (
    <section className="w-[320px] flex-shrink-0 section-card p-3">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-[13px] font-bold text-text-primary">{stage}</h3>
          <p className="text-xs text-text-tertiary">{formatCurrency(total)} • {deals.length} deals</p>
        </div>
      </header>

      <div
        ref={setNodeRef}
        className={`max-h-[66vh] min-h-[140px] space-y-2 overflow-y-auto rounded-xl border-[1.5px] border-dashed p-2 ${isOver ? 'border-primary/40 bg-primary/5' : 'border-outline-subtle'}`}
      >
        {deals.length === 0 && (
          <div className="grid h-20 place-items-center rounded-md text-xs text-text-tertiary">Drop deals here</div>
        )}
        {deals.map((deal) => (
          <DealCard key={deal.id} deal={deal} onClick={() => onCardClick(deal)} onDelete={() => onDeleteDeal(deal)} />
        ))}
      </div>
    </section>
  );
};

const DealCard: React.FC<{ deal: PipelineDeal; onClick: () => void; onDelete: () => void }> = ({ deal, onClick, onDelete }) => {
  const { setNodeRef, listeners, attributes, transform, isDragging } = useDraggable({ id: deal.id });
  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.6 : 1,
  };

  const leadName = `${deal.lead?.first_name || ''} ${deal.lead?.last_name || ''}`.trim() || 'Unknown lead';
  const canDelete = stageToSlug(deal.stage) === 'lost';

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className="cursor-grab rounded-xl border-[1.5px] border-outline bg-surface p-3 shadow-xs transition hover:border-primary/30 hover:shadow-sm active:cursor-grabbing"
    >
      <div className="mb-1 flex justify-end">
        {canDelete ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            className="rounded p-1 text-text-tertiary hover:text-danger hover:bg-danger-light"
            aria-label="Delete deal"
          >
            <Trash2 size={14} />
          </button>
        ) : null}
      </div>
      <h4 className="text-[13px] font-bold text-text-primary">{deal.title}</h4>
      <p className="mt-1 text-xs font-semibold text-text-primary">{leadName}</p>
      <p className="text-xs text-text-tertiary">{deal.lead?.phone || 'No phone'}</p>
      <p className="text-xs text-text-tertiary">{deal.lead?.email || 'No email'}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[13px] font-bold text-text-primary tabular-nums">{formatCurrency(deal.value)}</span>
        <div className="flex items-center gap-1">
          <span className="badge-info text-[10px]">{deal.stage}</span>
          <span className="badge-neutral text-[10px]">{deal.job?.status || 'no status'}</span>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-text-tertiary">{formatDate(deal.created_at)}</p>
    </article>
  );
};

function stageToSlug(stage: string): string {
  return String(stage || '').trim().toLowerCase().replace(/\s+/g, '_');
}

export default function Pipeline() {
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
  const [createStage, setCreateStage] = useState<PipelineStageName>('Qualified');
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
  const [editStage, setEditStage] = useState<PipelineStageName>('Qualified');
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
      setError(e?.message || 'Failed to load pipeline.');
      toast.error(e?.message || 'Failed to load pipeline.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

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
        toast.info('Existing job found for this lead. Opening it.');
        navigate(`/jobs/${existingJob.id}`);
        return;
      }
    } catch (error: any) {
      toast.error(error?.message || 'Could not check existing jobs for this lead.');
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
        toast.info('Job creation skipped - you can create it from Jobs.');
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
    const map: Record<PipelineStageName, PipelineDeal[]> = {
      Qualified: [],
      Contact: [],
      'Quote Sent': [],
      Closed: [],
      Lost: [],
    };
    for (const deal of filteredDeals) {
      const stage = PIPELINE_STAGES.includes(deal.stage as PipelineStageName)
        ? (deal.stage as PipelineStageName)
        : 'Qualified';
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
      toast.error('Lead and deal title are required.');
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
      toast.success('Deal created.');
      setCreateOpen(false);
      setCreateTitle('');
      setCreateValue('0');
      setCreateNotes('');
      await load();
      if (stageToSlug(created.stage) === 'closed') {
        await maybeOpenJobModalForClosedDeal(created);
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to create deal.');
    } finally {
      setSaving(false);
    }
  }

  async function handleQuickAddLead() {
    if (!quickLeadName.trim()) {
      toast.error('Lead full name is required.');
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
      toast.success('Lead + deal Qualified added.');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to add lead.');
    } finally {
      setSaving(false);
    }
  }

  async function handleOpenDeal(deal: PipelineDeal) {
    setSelected(deal);
    setEditTitle(deal.title);
    setEditValue(String(deal.value));
    setEditStage((PIPELINE_STAGES.includes(deal.stage as PipelineStageName) ? deal.stage : 'Qualified') as PipelineStageName);
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
      toast.error(e?.message || 'Failed to load schedule events.');
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
        const { error: jobError } = await supabase
          .from('jobs')
          .update({ title: updated.title, updated_at: new Date().toISOString() })
          .eq('id', updated.job_id);
        if (jobError) toast.error(jobError.message);
      }

      setSelected(updated);
      toast.success('Deal updated.');

      await maybeOpenJobModalForClosedDeal(updated);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save deal.');
    } finally {
      setSaving(false);
    }
  }

  async function handleAddEventFromDeal() {
    if (!selected) return;
    if (!selected.job_id) {
      toast.error('Deal has no linked job yet.');
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
      toast.error(e?.message || 'Failed to load available slots.');
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
      toast.success('Schedule event added.');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to create event.');
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
      toast.error(error?.message || 'Failed to delete lead.');
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
      toast.success('Deal moved.');

      await maybeOpenJobModalForClosedDeal(updated);
    } catch (e: any) {
      setDeals(previous);
      toast.error(e?.message || 'Failed to move deal.');
    }
  }

  async function handleConfirmDeleteDeal() {
    if (!dealToDelete || isDeletingDeal) return;
    setIsDeletingDeal(true);
    try {
      if (dealToDelete.lead_id) {
        try {
          await deleteLeadScoped(dealToDelete.lead_id);
        } catch (error: any) {
          const message = String(error?.message || '').toLowerCase();
          if (message.includes('lead not found') || message.includes('(404)')) {
            await softDeletePipelineDeal(dealToDelete.id);
          } else {
            throw error;
          }
        }
      } else {
        await softDeletePipelineDeal(dealToDelete.id);
      }

      setDeals((prev) => prev.filter((deal) => deal.id !== dealToDelete.id));
      if (selected?.id === dealToDelete.id) setSelected(null);
      setDealToDelete(null);
      toast.success('Deal deleted.');
      await load();
    } catch (error: any) {
      toast.error(error?.message || 'Failed to delete deal.');
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
      <PageHeader title="Deals" subtitle={`${formatCurrency(totals.overall)} • ${filteredDeals.length} deals`} icon={Kanban} iconColor="purple">
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pipeline..."
            className="glass-input w-56"
          />
          <button type="button" onClick={() => setView('kanban')} className={cn('glass-button', view === 'kanban' && '!bg-primary !text-white !border-primary')}>
            <LayoutGrid size={14} />
          </button>
          <button type="button" onClick={() => setView('list')} className={cn('glass-button', view === 'list' && '!bg-primary !text-white !border-primary')}>
            <List size={14} />
          </button>
          <button type="button" onClick={() => setCreateOpen(true)} className="glass-button-primary inline-flex items-center gap-1.5">
            <Plus size={14} /> Deal
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
              />
            ))}
          </div>
        </DndContext>
      ) : (
        <div className="section-card overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Title</th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Lead</th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Stage</th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Value</th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Job</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Actions</th>
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
                      <span className="text-text-tertiary">No job linked</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {stageToSlug(deal.stage) === 'lost' ? (
                      <button
                        type="button"
                        className="inline-flex rounded p-1 text-text-tertiary hover:text-danger hover:bg-danger-light"
                        onClick={() => setDealToDelete(deal)}
                        aria-label="Delete deal"
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
          <div className="modal-content max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 space-y-4">
            <h2 className="text-[15px] font-bold text-text-primary">New Deal</h2>

            <div className="space-y-2">
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Search lead</label>
              <input
                value={leadSearch}
                onChange={(e) => setLeadSearch(e.target.value)}
                placeholder="Type a lead name"
                className="glass-input w-full text-text-primary placeholder:text-text-tertiary"
              />
            </div>

            <div className="rounded-xl border-[1.5px] border-outline-subtle p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">Quick add lead (auto Qualified deal)</p>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <input
                  value={quickLeadName}
                  onChange={(e) => setQuickLeadName(e.target.value)}
                  placeholder="Full name"
                  className="glass-input w-full text-text-primary placeholder:text-text-tertiary"
                />
                <input
                  value={quickLeadEmail}
                  onChange={(e) => setQuickLeadEmail(e.target.value)}
                  placeholder="Email (optional)"
                  className="glass-input w-full text-text-primary placeholder:text-text-tertiary"
                />
                <input
                  value={quickLeadPhone}
                  onChange={(e) => setQuickLeadPhone(e.target.value)}
                  placeholder="Phone (optional)"
                  className="glass-input w-full text-text-primary placeholder:text-text-tertiary"
                />
              </div>
              <div className="mt-2 flex justify-end">
                <button type="button" className="glass-button" disabled={saving} onClick={() => void handleQuickAddLead()}>
                  {saving ? 'Adding...' : 'Add lead'}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Lead</label>
              <select value={createLeadId} onChange={(e) => setCreateLeadId(e.target.value)} className="glass-input w-full">
                {filteredLeads.map((lead) => (
                  <option key={lead.id} value={lead.id}>
                    {lead.first_name} {lead.last_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Deal title</label>
                <input
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                  className="glass-input w-full text-text-primary placeholder:text-text-tertiary"
                  placeholder="e.g. Spring maintenance package"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Value</label>
                <input
                  value={createValue}
                  onChange={(e) => setCreateValue(e.target.value)}
                  type="number"
                  min="0"
                  className="glass-input w-full"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Stage</label>
                <select value={createStage} onChange={(e) => setCreateStage(e.target.value as PipelineStageName)} className="glass-input w-full">
                  {PIPELINE_STAGES.map((stage) => (
                    <option key={stage} value={stage}>{stage}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Notes</label>
                <input
                  value={createNotes}
                  onChange={(e) => setCreateNotes(e.target.value)}
                  className="glass-input w-full text-text-primary placeholder:text-text-tertiary"
                  placeholder="Optional note"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" className="glass-button" onClick={() => setCreateOpen(false)}>Cancel</button>
              <button type="button" className="glass-button-primary" disabled={saving} onClick={() => void handleCreateDeal()}>
                {saving ? 'Creating...' : 'Create'}
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
                  <h2 className="text-xl font-bold text-text-primary">Deal details</h2>
                  <p className="text-[13px] text-text-secondary">{selected.id}</p>
                </div>
                <button type="button" onClick={() => setSelected(null)} className="glass-button text-text-primary">Close</button>
              </header>

              <section className="space-y-3 section-card p-4">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Deal</h3>
                <div className="space-y-2">
                  <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Title</label>
                  <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="glass-input w-full" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Stage</label>
                    <select value={editStage} onChange={(e) => setEditStage(e.target.value as PipelineStageName)} className="glass-input w-full">
                      {PIPELINE_STAGES.map((stage) => (
                        <option key={stage} value={stage}>{stage}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Value</label>
                    <input value={editValue} type="number" min="0" onChange={(e) => setEditValue(e.target.value)} className="glass-input w-full" />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Notes</label>
                  <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} className="glass-input min-h-[96px] w-full text-text-primary placeholder:text-text-tertiary" placeholder="Internal notes" />
                </div>
              </section>

              <section className="space-y-3 section-card p-4">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Lead</h3>
                <p className="text-[13px] text-text-primary">{selected.lead ? `${selected.lead.first_name} ${selected.lead.last_name}` : 'Unknown lead'}</p>
                <p className="text-[13px] text-text-secondary">{selected.lead?.email || 'No email'}</p>
                <p className="text-[13px] text-text-secondary">{selected.lead?.phone || 'No phone'}</p>
                <div className="flex gap-2">
                  {selected.lead_id && (
                    <button type="button" className="glass-button text-text-primary" onClick={() => navigate('/leads')}>
                      Open lead
                    </button>
                  )}
                  <button
                    type="button"
                    className="glass-button text-danger hover:bg-danger-light"
                    onClick={() => setIsDeleteLeadOpen(true)}
                    disabled={!selected.lead_id}
                  >
                    Delete lead
                  </button>
                </div>
              </section>

              <section className="space-y-3 section-card p-4">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Job</h3>
                <p className="text-[13px] text-text-primary">{selected.job?.title || 'Untitled job'}</p>
                <p className="text-[13px] text-text-secondary">Status: {selected.job?.status || 'N/A'}</p>
                {selected.job_id ? (
                  <button type="button" className="glass-button text-text-primary" onClick={() => navigate(`/jobs/${selected.job_id}`)}>
                    Open job
                  </button>
                ) : (
                  <span className="text-sm text-text-tertiary">No job linked</span>
                )}
              </section>

              <section className="space-y-3 section-card p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Schedule</h3>
                  <button type="button" onClick={() => void handleAddEventFromDeal()} className="glass-button-primary inline-flex items-center gap-2" disabled={saving}>
                    <CalendarPlus size={14} /> Add event
                  </button>
                </div>
                {drawerLoading ? (
                  <div className="h-20 rounded bg-surface-secondary" />
                ) : drawerEvents.length === 0 ? (
                  <p className="text-[13px] text-text-secondary">No events yet.</p>
                ) : (
                  <div className="space-y-2">
                    {drawerEvents.map((event) => (
                      <div key={event.id} className="rounded-xl border-[1.5px] border-outline-subtle p-2">
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
                <button type="button" className="glass-button text-text-primary" onClick={() => setSelected(null)}>Cancel</button>
                <button type="button" className="glass-button-primary" disabled={saving} onClick={() => void handleSaveDeal()}>
                  {saving ? 'Saving...' : 'Save'}
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
                <h3 className="text-xl font-semibold tracking-tight">Delete this deal?</h3>
                <button
                  className="rounded-lg p-1 hover:bg-surface-secondary"
                  onClick={() => !isDeletingDeal && setDealToDelete(null)}
                  aria-label="Close delete dialog"
                >
                  <X size={16} />
                </button>
              </div>
              <p className="mt-3 text-[13px] text-text-secondary">
                This will soft-delete the lead/deal and remove it from Pipeline and Leads.
              </p>
              <p className="mt-2 inline-flex items-center gap-2 rounded-lg bg-warning-light px-3 py-2 text-xs text-warning">
                <AlertTriangle size={14} />
                Only owner/admin can perform this action.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button className="glass-button text-text-primary" onClick={() => setDealToDelete(null)} disabled={isDeletingDeal}>
                  Cancel
                </button>
                <button
                  className="glass-button-primary bg-danger hover:bg-danger/90"
                  onClick={() => void handleConfirmDeleteDeal()}
                  disabled={isDeletingDeal}
                >
                  {isDeletingDeal ? 'Deleting...' : 'Delete'}
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
              <h3 className="text-lg font-semibold">Delete this lead?</h3>
              <p className="mt-2 text-[13px] text-text-secondary">This action permanently deletes the lead.</p>
              <label className="mt-3 flex items-center gap-2 rounded-xl border-[1.5px] border-outline-subtle bg-surface px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={alsoDeleteLinkedClient}
                  onChange={(e) => setAlsoDeleteLinkedClient(e.target.checked)}
                />
                Also delete the client linked to this lead
              </label>
              <div className="mt-5 flex justify-end gap-2">
                <button className="glass-button" onClick={() => setIsDeleteLeadOpen(false)} disabled={isDeletingLead}>
                  Cancel
                </button>
                <button
                  className="glass-button-primary bg-danger hover:bg-danger/90"
                  onClick={() => void handleDeleteLeadWithOptionalClient()}
                  disabled={isDeletingLead}
                >
                  {isDeletingLead ? 'Deleting...' : 'Delete'}
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
                <h3 className="text-lg font-semibold">Available time slots</h3>
                <button onClick={() => setIsSlotPickerOpen(false)} disabled={slotSaving}>
                  <X size={16} />
                </button>
              </div>
              {slotLoading ? (
                <div className="mt-4 h-24 rounded-lg bg-surface-secondary" />
              ) : availableSlots.length === 0 ? (
                <div className="mt-4 rounded-lg border border-warning/20 bg-warning-light px-3 py-3 text-sm text-warning">
                  No availability found for the next 14 days. Create availability in Schedule.
                  <div className="mt-2">
                    <button className="glass-button" onClick={() => navigate('/schedule')}>
                      Open Schedule
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
