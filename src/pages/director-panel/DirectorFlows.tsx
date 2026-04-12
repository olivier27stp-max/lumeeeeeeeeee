import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Workflow, Search, Copy, Pencil, Trash2, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { PageHeader } from '../../components/ui';
import type { DirectorFlow } from '../../types/director';

type StatusFilter = 'all' | 'draft' | 'active' | 'archived';
type SortBy = 'newest' | 'oldest' | 'alpha';

export default function DirectorFlows({ orgId }: { orgId: string }) {
  const navigate = useNavigate();
  const [flows, setFlows] = useState<DirectorFlow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('newest');
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  useEffect(() => {
    if (!orgId) return;
    import('../../lib/directorApi')
      .then((m) => m.getFlows(orgId))
      .then(setFlows)
      .catch(() => setFlows([]))
      .finally(() => setLoading(false));
  }, [orgId]);

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

  // Filter by search + status
  const filtered = flows
    .filter((f) => f.title.toLowerCase().includes(search.toLowerCase()))
    .filter((f) => statusFilter === 'all' || f.status === statusFilter);

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'newest') return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    if (sortBy === 'oldest') return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
    return a.title.localeCompare(b.title);
  });

  const timeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return days < 7 ? `${days}d ago` : new Date(date).toLocaleDateString();
  };

  const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'draft', label: 'Draft' },
    { value: 'active', label: 'Active' },
    { value: 'archived', label: 'Archived' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Flows" icon={Workflow} iconColor="blue">
        <button onClick={() => navigate('/director-panel/flows/new')} className="glass-button-primary flex items-center gap-1.5 text-[13px]">
          <Plus className="w-4 h-4" /> New Flow
        </button>
      </PageHeader>

      {/* Filters row */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative max-w-xs flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search flows..."
            className="w-full pl-8 pr-3 py-2 rounded-md bg-surface border border-outline text-[13px] text-text-primary placeholder:text-text-tertiary outline-none focus:border-primary"
          />
        </div>

        {/* Status filter buttons */}
        <div className="flex items-center gap-1 rounded-md border border-outline overflow-hidden">
          {STATUS_FILTERS.map((sf) => (
            <button
              key={sf.value}
              onClick={() => setStatusFilter(sf.value)}
              className={cn(
                'px-3 py-1.5 text-[12px] font-medium transition-colors',
                statusFilter === sf.value
                  ? 'bg-primary text-white'
                  : 'text-text-tertiary hover:text-text-primary hover:bg-surface-secondary'
              )}
            >
              {sf.label}
            </button>
          ))}
        </div>

        {/* Sort dropdown */}
        <div className="relative">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="appearance-none pl-3 pr-7 py-1.5 rounded-md bg-surface border border-outline text-[12px] text-text-secondary cursor-pointer outline-none focus:border-primary"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="alpha">A-Z</option>
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-tertiary pointer-events-none" />
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="aspect-[4/3] rounded-lg bg-surface-secondary animate-pulse border border-outline" />)}
        </div>
      ) : sorted.length === 0 ? (
        <div className="section-card flex flex-col items-center justify-center py-16">
          <Workflow className="w-10 h-10 text-text-tertiary mb-3" />
          <p className="text-[13px] text-text-tertiary">{search || statusFilter !== 'all' ? 'No matching flows' : 'No flows yet'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {sorted.map((flow) => (
            <div key={flow.id} className="group flex flex-col text-left relative">
              <button onClick={() => navigate(`/director-panel/flows/${flow.id}`)} className="flex flex-col text-left">
                <div className="aspect-[4/3] rounded-lg bg-surface-secondary border border-outline flex items-center justify-center group-hover:border-text-tertiary transition-colors">
                  <Workflow className="w-8 h-8 text-text-tertiary/40" />
                </div>
                <div className="mt-2 px-0.5">
                  {renameId === flow.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleRenameSubmit(); if (e.key === 'Escape') setRenameId(null); }}
                      onBlur={() => void handleRenameSubmit()}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full text-[13px] font-medium text-text-primary bg-surface border border-primary rounded px-1 py-0.5 outline-none"
                    />
                  ) : (
                    <p
                      className="text-[13px] font-medium text-text-primary truncate"
                      onDoubleClick={(e) => { e.stopPropagation(); handleRenameFlow(flow.id, flow.title); }}
                    >
                      {flow.title}
                    </p>
                  )}
                  <p className="text-[11px] text-text-tertiary mt-0.5">Last edited {timeAgo(flow.updated_at)}</p>
                </div>
              </button>
              {/* Action buttons */}
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
                  <Copy className="w-3 h-3" />
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
      )}

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
    </div>
  );
}
