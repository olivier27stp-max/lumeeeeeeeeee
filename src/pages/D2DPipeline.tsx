import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/d2d/button';
import { Avatar } from '../components/d2d/avatar';
import { getRepAvatar } from '../lib/constants/avatars';
import { cn } from '../lib/utils';
import { Settings, Plus, GripVertical } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface Lead {
  id: string;
  name: string;
  rep: string;
  value: string;
  time: string;
}

interface Stage {
  name: string;
  slug: string;
  color: string;
  value: string;
  leads: Lead[];
}

const STAGE_DEFS: Stage[] = [
  { name: 'New Lead', slug: 'new_lead', color: '#58A6FF', value: '$0', leads: [] },
  { name: 'Must Recall', slug: 'must_recall', color: '#D29922', value: '$0', leads: [] },
  { name: 'Quote Sent', slug: 'quote_sent', color: '#9CA3AF', value: '$0', leads: [] },
  { name: 'Closed Won', slug: 'closed_won', color: '#3FB950', value: '$0', leads: [] },
  { name: 'Closed Lost', slug: 'closed_lost', color: '#F85149', value: '$0', leads: [] },
];

function LeadCard({ lead, isDragging }: { lead: Lead; isDragging?: boolean }) {
  const navigate = useNavigate();
  return (
    <div
      className={cn(
        'group rounded-lg border border-border-subtle bg-surface p-3 transition-all duration-150',
        isDragging
          ? 'rotate-[2deg] scale-105 border-outline-strong bg-surface-elevated shadow-lg'
          : 'hover:border-border hover:bg-surface-elevated'
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-[13px] font-medium text-text-primary">{lead.name}</p>
          <div
            className="mt-1.5 flex items-center gap-1.5 cursor-pointer hover:opacity-80"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/reps/${lead.rep.toLowerCase().replace(/\s+/g, '-')}`);
            }}
          >
            <Avatar name={lead.rep} src={getRepAvatar(lead.rep)} size="sm" className="!h-5 !w-5 !text-[8px]" />
            <span className="text-[11px] text-text-muted hover:text-text-primary transition-colors">{lead.rep}</span>
          </div>
        </div>
        <GripVertical className="h-3.5 w-3.5 text-text-muted opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] font-medium text-text-secondary">{lead.value}</span>
        <span className="text-[10px] text-text-muted">{lead.time}</span>
      </div>
    </div>
  );
}

function SortableLeadCard({ lead }: { lead: Lead }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: lead.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing">
      <LeadCard lead={lead} />
    </div>
  );
}

function StageColumn({
  stage,
  isOver,
}: {
  stage: Stage;
  isOver: boolean;
}) {
  return (
    <div
      className={cn(
        'flex w-[272px] shrink-0 flex-col rounded-xl bg-white border transition-colors duration-200',
        isOver ? 'border-outline-strong bg-surface-secondary' : 'border-border-subtle'
      )}
    >
      {/* Column header */}
      <div
        className="flex items-center justify-between rounded-t-xl px-3 py-2.5"
        style={{ backgroundColor: stage.color }}
      >
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-semibold text-white">{stage.name}</h3>
          <span className="text-[11px] font-semibold text-white">{stage.leads.length}</span>
        </div>
        <span className="text-[11px] font-semibold text-white">{stage.value}</span>
      </div>

      {/* Cards */}
      <div className="flex-1 space-y-1.5 overflow-y-auto px-2 pt-2 pb-2 min-h-[80px]">
        <SortableContext items={stage.leads.map((l) => l.id)} strategy={verticalListSortingStrategy}>
          {stage.leads.map((lead) => (
            <SortableLeadCard key={lead.id} lead={lead} />
          ))}
        </SortableContext>

        {/* Add card button */}
        <button className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-border-subtle py-2 text-[11px] text-text-muted transition-colors hover:border-border hover:text-text-secondary">
          <Plus className="h-3 w-3" />
          Add lead
        </button>
      </div>
    </div>
  );
}

export default function D2DPipeline() {
  const [stages, setStages] = useState<Stage[]>(STAGE_DEFS);

  // Load real pipeline deals from DB
  useEffect(() => {
    (async () => {
      try {
        const { supabase } = await import('../lib/supabase');
        const { getCurrentOrgIdOrThrow } = await import('../lib/orgApi');
        const orgId = await getCurrentOrgIdOrThrow();
        const { data: deals } = await supabase
          .from('pipeline_deals')
          .select('id, title, value, stage, created_at, leads(first_name, last_name), clients(first_name, last_name)')
          .eq('org_id', orgId)
          .is('deleted_at', null)
          .order('created_at', { ascending: false });
        if (deals && deals.length > 0) {
          const stageMap: Record<string, string> = { 'Qualified': 'new_lead', 'Contact': 'must_recall', 'Quote Sent': 'quote_sent', 'Closed': 'closed_won', 'Lost': 'closed_lost' };
          const loaded = STAGE_DEFS.map(s => ({ ...s, leads: [] as Lead[], value: '$0' }));
          for (const deal of deals) {
            const slug = stageMap[deal.stage] || 'new_lead';
            const stage = loaded.find(s => s.slug === slug);
            if (stage) {
              const name = deal.leads ? `${(deal.leads as any).first_name || ''} ${(deal.leads as any).last_name || ''}`.trim()
                : deal.clients ? `${(deal.clients as any).first_name || ''} ${(deal.clients as any).last_name || ''}`.trim()
                : deal.title || 'Untitled';
              stage.leads.push({ id: deal.id, name, rep: '', value: `$${Number(deal.value || 0).toLocaleString()}`, time: '' });
            }
          }
          for (const s of loaded) {
            const total = s.leads.reduce((sum, l) => sum + Number(l.value.replace(/[$,]/g, '') || 0), 0);
            s.value = `$${total.toLocaleString()}`;
          }
          setStages(loaded);
        }
      } catch { /* keep empty stages on error */ }
    })();
  }, []);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const findStageByLeadId = (leadId: string): Stage | undefined =>
    stages.find((s) => s.leads.some((l) => l.id === leadId));

  const findLeadById = (leadId: string): Lead | undefined => {
    for (const stage of stages) {
      const lead = stage.leads.find((l) => l.id === leadId);
      if (lead) return lead;
    }
    return undefined;
  };

  const activeLead = activeId ? findLeadById(activeId) : undefined;

  // Find which stage slug is being hovered
  const getOverStageSlug = (): string | null => {
    if (!overId) return null;
    // overId could be a lead id or a stage slug
    const stageBySlug = stages.find((s) => s.slug === overId);
    if (stageBySlug) return stageBySlug.slug;
    const stageByLead = findStageByLeadId(overId);
    return stageByLead?.slug ?? null;
  };

  const overStageSlug = getOverStageSlug();

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) {
      setOverId(null);
      return;
    }

    setOverId(over.id as string);

    const activeStage = findStageByLeadId(active.id as string);
    // Determine if over is a stage or a lead
    let overStage = stages.find((s) => s.slug === (over.id as string));
    if (!overStage) {
      overStage = findStageByLeadId(over.id as string);
    }

    if (!activeStage || !overStage || activeStage.slug === overStage.slug) return;

    // Move lead to the new stage
    setStages((prev) => {
      const activeLeadIndex = activeStage.leads.findIndex((l) => l.id === active.id);
      const lead = activeStage.leads[activeLeadIndex];

      // Determine insertion index
      let overIndex = overStage!.leads.findIndex((l) => l.id === over.id);
      if (overIndex === -1) overIndex = overStage!.leads.length;

      return prev.map((s) => {
        if (s.slug === activeStage.slug) {
          return { ...s, leads: s.leads.filter((l) => l.id !== active.id) };
        }
        if (s.slug === overStage!.slug) {
          const newLeads = [...s.leads];
          newLeads.splice(overIndex, 0, lead);
          return { ...s, leads: newLeads };
        }
        return s;
      });
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    setOverId(null);

    if (!over) return;

    const activeStage = findStageByLeadId(active.id as string);
    if (!activeStage) return;

    // Reorder within the same stage
    if (active.id !== over.id) {
      const oldIndex = activeStage.leads.findIndex((l) => l.id === active.id);
      const newIndex = activeStage.leads.findIndex((l) => l.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        setStages((prev) =>
          prev.map((s) => {
            if (s.slug === activeStage.slug) {
              return { ...s, leads: arrayMove(s.leads, oldIndex, newIndex) };
            }
            return s;
          })
        );
      }
    }
  }

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle px-6 py-2.5">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Pipeline</h2>
          <p className="text-[11px] text-text-muted">
            Drag leads between stages to update their status
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5">
            <Settings className="h-3 w-3" />
            Configure
          </Button>
          <Button size="sm" className="gap-1.5 bg-[#121620] text-white hover:bg-[#1A1F2E]">
            <Plus className="h-3 w-3" />
            New Lead
          </Button>
        </div>
      </div>

      {/* Board */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex flex-1 gap-3 overflow-x-auto p-4">
          {stages.map((stage) => (
            <StageColumn
              key={stage.slug}
              stage={stage}
              isOver={overStageSlug === stage.slug && findStageByLeadId(activeId ?? '')?.slug !== stage.slug}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={{ duration: 200, easing: 'ease' }}>
          {activeLead ? (
            <div className="w-[248px]">
              <LeadCard lead={activeLead} isDragging />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
