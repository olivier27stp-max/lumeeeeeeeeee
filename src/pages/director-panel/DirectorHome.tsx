import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  ChevronRight,
  ChevronLeft,
  Coins,
  Grid3X3,
  List,
  Workflow,
  Sparkles,
  Play,
  Trash2,
  Clock,
  GraduationCap,
  Pencil,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import OnboardingTour from '../../components/director-panel/onboarding/OnboardingTour';
import { HOME_TOUR_KEY, HOME_TOUR_STEPS } from '../../components/director-panel/onboarding/tours';
import { PageHeader } from '../../components/ui';
import { getFlows, getCreditBalance } from '../../lib/directorApi';
import { BUILT_IN_TEMPLATES } from '../../lib/director-panel/config/templates';
import RecentGenerations from '../../components/director-panel/RecentGenerations';
import LiaCreativeDirector from '../../components/director-panel/LiaCreativeDirector';
import type { DirectorFlow } from '../../types/director';

import { TEMPLATE_IMAGES } from '../../lib/director-panel/config/template-images';

type LibraryTab = 'workflow' | 'generations';

export default function DirectorHome({ orgId }: { orgId: string }) {
  const navigate = useNavigate();
  const [flows, setFlows] = useState<DirectorFlow[]>([]);
  const [creditBalance, setCreditBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('workflow');
  const [fileSearch, setFileSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const carouselRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      try {
        const [f, cb] = await Promise.all([
          getFlows(orgId).catch(() => []),
          getCreditBalance(orgId).catch(() => null),
        ]);
        setFlows(f);
        setCreditBalance(cb?.credits_balance ?? 0);
      } finally {
        setLoading(false);
      }
    })();
  }, [orgId]);

  // Refresh credit balance every 30 seconds
  useEffect(() => {
    if (!orgId) return;
    const interval = setInterval(() => {
      getCreditBalance(orgId).then((cb) => {
        if (cb) setCreditBalance(cb.credits_balance);
      }).catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, [orgId]);

  const handleCreateFlow = async () => {
    try {
      const { createFlow } = await import('../../lib/directorApi');
      const flow = await createFlow({
        org_id: orgId,
        title: 'Untitled Flow',
        slug: 'untitled-flow',
        description: '',
        status: 'draft',
        created_by: null as any,
        updated_by: null as any,
        version_number: 1,
      });
      navigate(`/director-panel/flows/${flow.id}`);
    } catch {
      navigate('/director-panel/flows/new');
    }
  };

  const scrollCarousel = (dir: 'left' | 'right') => {
    if (!carouselRef.current) return;
    carouselRef.current.scrollBy({ left: dir === 'left' ? -400 : 400, behavior: 'smooth' });
  };

  const filteredFlows = flows.filter(
    (f) => !fileSearch || f.title.toLowerCase().includes(fileSearch.toLowerCase())
  );

  const handleDeleteFlow = async (flowId: string, title: string) => {
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
    try {
      const { deleteFlow } = await import('../../lib/directorApi');
      await deleteFlow(flowId);
      setFlows((prev) => prev.filter((f) => f.id !== flowId));
      toast.success(`"${title}" deleted`);
    } catch {
      toast.error('Failed to delete flow');
    }
  };

  const handleDuplicateFlow = async (flow: DirectorFlow) => {
    try {
      const { createFlow, getFlowNodes, getFlowEdges, upsertNodes, upsertEdges } = await import('../../lib/directorApi');
      const newFlow = await createFlow({
        org_id: flow.org_id,
        title: `${flow.title} (copy)`,
        slug: `${flow.slug}-copy`,
        description: flow.description,
        status: 'draft',
        created_by: flow.created_by,
        updated_by: flow.updated_by,
        version_number: 1,
      });
      // Copy nodes + edges
      const [nodes, edges] = await Promise.all([
        getFlowNodes(flow.id).catch(() => []),
        getFlowEdges(flow.id).catch(() => []),
      ]);
      if (nodes.length > 0) {
        const idMap = new Map<string, string>();
        const newNodes = nodes.map((n) => {
          const newId = crypto.randomUUID();
          idMap.set(n.id, newId);
          return { ...n, id: newId, flow_id: newFlow.id };
        });
        const newEdges = edges.map((e) => ({
          ...e,
          id: crypto.randomUUID(),
          flow_id: newFlow.id,
          source_node_id: idMap.get(e.source_node_id) || e.source_node_id,
          target_node_id: idMap.get(e.target_node_id) || e.target_node_id,
        }));
        await upsertNodes(newNodes);
        await upsertEdges(newEdges);
      }
      setFlows((prev) => [newFlow, ...prev]);
      toast.success(`"${flow.title}" duplicated`);
    } catch {
      toast.error('Failed to duplicate flow');
    }
  };

  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const handleRenameFlow = (flowId: string, currentTitle: string) => {
    setRenameId(flowId);
    setRenameValue(currentTitle);
  };

  const handleRenameSubmit = async () => {
    if (!renameId || !renameValue.trim()) { setRenameId(null); return; }
    try {
      const { updateFlow } = await import('../../lib/directorApi');
      await updateFlow(renameId, { title: renameValue.trim() });
      setFlows((prev) => prev.map((f) => f.id === renameId ? { ...f, title: renameValue.trim() } : f));
      toast.success('Flow renamed');
    } catch {
      toast.error('Failed to rename flow');
    } finally {
      setRenameId(null);
    }
  };

  const timeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(date).toLocaleDateString();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader title="Director Panel" subtitle="AI-powered creative generation studio" icon={Sparkles} iconColor="purple">
        <div data-tour="credits" className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface-secondary border border-outline text-[12px] font-medium text-text-secondary">
          <Coins className="w-3.5 h-3.5 text-amber-500" />
          {creditBalance} credits
        </div>
        <button onClick={() => navigate('/director-panel/training')} className="glass-button flex items-center gap-1.5 text-[12px]">
          <GraduationCap className="w-3.5 h-3.5" />
          Training
        </button>
        <button data-tour="new-flow" onClick={handleCreateFlow} className="glass-button-primary flex items-center gap-1.5 text-[13px]">
          <Plus className="w-4 h-4" />
          New Flow
        </button>
      </PageHeader>

      {/* ─── LIA Creative Director ─── */}
      <LiaCreativeDirector />

      {/* ─── Workflow Library ─── */}
      <div data-tour="workflow-library" className="section-card">
        {/* Tabs */}
        <div className="flex items-center gap-1 px-4 pt-3 pb-0">
          <button
            onClick={() => setLibraryTab('workflow')}
            className={cn(
              'px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors',
              libraryTab === 'workflow'
                ? 'bg-primary text-white'
                : 'text-text-tertiary hover:text-text-primary'
            )}
          >
            Workflow library
          </button>
          <button
            onClick={() => setLibraryTab('generations')}
            className={cn(
              'px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors',
              libraryTab === 'generations'
                ? 'bg-primary text-white'
                : 'text-text-tertiary hover:text-text-primary'
            )}
          >
            <span className="flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              Recent Generations
            </span>
          </button>
        </div>

        {/* Tab content */}
        {libraryTab === 'workflow' ? (
          <div className="relative px-4 py-4">
            <button
              onClick={() => scrollCarousel('left')}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-surface border border-outline shadow-sm flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div
              ref={carouselRef}
              className="flex gap-3 overflow-x-auto scroll-smooth"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
              {BUILT_IN_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => navigate(`/director-panel/flows/new?template=${tpl.id}`)}
                  className="group flex-shrink-0 w-[190px] rounded-lg overflow-hidden border border-outline hover:border-primary transition-all hover:shadow-md"
                >
                  <div className="relative h-[120px] bg-surface-tertiary overflow-hidden">
                    <img
                      src={TEMPLATE_IMAGES[tpl.id]}
                      alt={tpl.title}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                    <span className="absolute bottom-2 left-2.5 text-xs font-medium text-white drop-shadow-lg">
                      {tpl.title}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            <button
              onClick={() => scrollCarousel('right')}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-surface border border-outline shadow-sm flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="px-4 py-4">
            <RecentGenerations orgId={orgId} />
          </div>
        )}
      </div>

      {/* ─── My Files ─── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 data-tour="my-files" className="text-[14px] font-semibold text-text-primary">My files</h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary" />
              <input
                type="text"
                value={fileSearch}
                onChange={(e) => setFileSearch(e.target.value)}
                placeholder="Search"
                className="w-[160px] pl-8 pr-3 py-1.5 rounded-md bg-surface border border-outline text-[12px] text-text-primary placeholder:text-text-tertiary outline-none focus:border-primary transition-colors"
              />
            </div>
            <div className="flex rounded-md border border-outline overflow-hidden">
              <button
                onClick={() => setViewMode('list')}
                className={cn(
                  'p-1.5 transition-colors',
                  viewMode === 'list' ? 'bg-surface-tertiary text-text-primary' : 'text-text-tertiary hover:text-text-primary'
                )}
              >
                <List className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={cn(
                  'p-1.5 transition-colors',
                  viewMode === 'grid' ? 'bg-surface-tertiary text-text-primary' : 'text-text-tertiary hover:text-text-primary'
                )}
              >
                <Grid3X3 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="aspect-[4/3] rounded-lg bg-surface-secondary animate-pulse border border-outline" />
            ))}
          </div>
        ) : filteredFlows.length === 0 && !fileSearch ? (
          <div className={viewMode === 'grid' ? 'grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4' : 'space-y-2'}>
            <button onClick={handleCreateFlow} className="group flex flex-col text-left">
              {viewMode === 'grid' ? (
                <>
                  <div className="aspect-[4/3] rounded-lg bg-surface-secondary border border-dashed border-outline flex items-center justify-center group-hover:border-primary transition-colors">
                    <Workflow className="w-8 h-8 text-text-tertiary group-hover:text-primary transition-colors" />
                  </div>
                  <div className="mt-2 px-0.5">
                    <p className="text-[13px] font-medium text-text-primary">Create your first flow</p>
                    <p className="text-[11px] text-text-tertiary mt-0.5">Click to get started</p>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-dashed border-outline hover:border-primary transition-colors">
                  <Workflow className="w-5 h-5 text-text-tertiary" />
                  <span className="text-[13px] text-text-secondary">Create your first flow</span>
                </div>
              )}
            </button>
          </div>
        ) : filteredFlows.length === 0 && fileSearch ? (
          <div className="py-12 text-center">
            <p className="text-[13px] text-text-tertiary">No files matching "{fileSearch}"</p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {filteredFlows.map((flow) => (
              <div key={flow.id} className="group flex flex-col text-left relative">
                <button
                  onClick={() => navigate(`/director-panel/flows/${flow.id}`)}
                  className="flex flex-col text-left"
                >
                  <div className="aspect-[4/3] rounded-lg bg-surface-secondary border border-outline flex items-center justify-center group-hover:border-text-tertiary transition-colors overflow-hidden">
                    {flow.thumbnail_asset_id ? (
                      <img src={flow.thumbnail_asset_id} alt={flow.title} className="w-full h-full object-cover" />
                    ) : (
                      <Workflow className="w-8 h-8 text-text-tertiary/40" />
                    )}
                  </div>
                  <div className="mt-2 px-0.5">
                    <p className="text-[13px] font-medium text-text-primary truncate">{flow.title}</p>
                    <p className="text-[11px] text-text-tertiary mt-0.5">Last edited {timeAgo(flow.updated_at)}</p>
                  </div>
                </button>
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRenameFlow(flow.id, flow.title); }}
                    className="p-1.5 rounded-md bg-surface/80 border border-outline hover:bg-surface-tertiary text-text-tertiary hover:text-text-primary"
                    title="Rename"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDuplicateFlow(flow); }}
                    className="p-1.5 rounded-md bg-surface/80 border border-outline hover:bg-surface-tertiary text-text-tertiary hover:text-text-primary"
                    title="Duplicate"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteFlow(flow.id, flow.title); }}
                    className="p-1.5 rounded-md bg-surface/80 border border-outline hover:bg-danger-light hover:border-danger/30 hover:text-danger"
                    title="Delete"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="section-card divide-y divide-outline">
            {filteredFlows.map((flow) => (
              <div key={flow.id} className="group flex items-center gap-4 px-4 py-3 hover:bg-surface-secondary transition-colors">
                <button
                  onClick={() => navigate(`/director-panel/flows/${flow.id}`)}
                  className="flex items-center gap-4 flex-1 min-w-0 text-left"
                >
                  <div className="w-9 h-9 rounded-md bg-surface-tertiary border border-outline flex items-center justify-center shrink-0">
                    <Workflow className="w-4 h-4 text-text-tertiary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-text-primary truncate">{flow.title}</p>
                    <p className="text-[11px] text-text-tertiary">Last edited {timeAgo(flow.updated_at)}</p>
                  </div>
                  <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', {
                    'bg-success-light text-success': flow.status === 'active',
                    'bg-warning-light text-warning': flow.status === 'draft',
                    'bg-surface-tertiary text-text-tertiary': flow.status === 'archived',
                  })}>
                    {flow.status}
                  </span>
                </button>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => handleRenameFlow(flow.id, flow.title)} className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary" title="Rename">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDuplicateFlow(flow)} className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary" title="Duplicate">
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDeleteFlow(flow.id, flow.title)} className="p-1.5 rounded-md text-text-tertiary hover:text-danger hover:bg-danger-light" title="Delete">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Rename Modal */}
      {renameId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setRenameId(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-surface border border-outline p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[14px] font-semibold text-text-primary mb-3">Rename Flow</h3>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleRenameSubmit(); if (e.key === 'Escape') setRenameId(null); }}
              className="glass-input w-full mb-4"
              placeholder="Flow title..."
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setRenameId(null)} className="glass-button text-[12px]">Cancel</button>
              <button onClick={() => void handleRenameSubmit()} className="glass-button-primary text-[12px]">Rename</button>
            </div>
          </div>
        </div>
      )}

      {/* Onboarding Tour */}
      <OnboardingTour steps={HOME_TOUR_STEPS} tourKey={HOME_TOUR_KEY} />
    </div>
  );
}
