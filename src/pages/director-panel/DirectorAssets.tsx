import React, { useCallback, useEffect, useState } from 'react';
import {
  Image as ImageIcon, Film, Music, Search, Grid3X3, List, Download,
  Trash2, Copy, ExternalLink, Loader2, FolderOpen, X, Palette, Heart,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { PageHeader } from '../../components/ui';
import { listGenerations, deleteGeneration, generationToStyleDna, toggleFavorite, type DirectorGeneration } from '../../lib/directorApi';
import { supabase } from '../../lib/supabase';

const TYPE_FILTERS = [
  { key: 'all', label: 'All', icon: FolderOpen },
  { key: 'image', label: 'Images', icon: ImageIcon },
  { key: 'video', label: 'Videos', icon: Film },
  { key: 'edit', label: 'Edits', icon: ImageIcon },
  { key: 'favorites', label: 'Favorites', icon: Heart },
] as const;

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

export default function DirectorAssets() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [items, setItems] = useState<DirectorGeneration[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewItem, setPreviewItem] = useState<DirectorGeneration | null>(null);
  const PAGE_SIZE = 24;

  useEffect(() => {
    supabase.rpc('current_org_id').then(({ data }) => { if (data) setOrgId(String(data)); });
  }, []);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const result = await listGenerations(orgId, { type: filter, limit: PAGE_SIZE });
      setItems(result.data);
      setTotal(result.total);
    } catch { setItems([]); setTotal(0); }
    finally { setLoading(false); }
  }, [orgId, filter]);

  useEffect(() => { void load(); }, [load]);

  const filtered = search
    ? items.filter((g) => [g.title, g.prompt, g.model, g.provider].join(' ').toLowerCase().includes(search.toLowerCase()))
    : items;

  const handleDelete = async (id: string) => {
    try {
      await deleteGeneration(id);
      setItems((prev) => prev.filter((g) => g.id !== id));
      setTotal((prev) => prev - 1);
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
      if (previewItem?.id === id) setPreviewItem(null);
      toast.success('Deleted');
    } catch { toast.error('Failed to delete'); }
  };

  const handleToggleFavorite = async (gen: DirectorGeneration) => {
    const newVal = !gen.is_favorite;
    try {
      await toggleFavorite(gen.id, newVal);
      setItems((prev) => prev.map((g) => g.id === gen.id ? { ...g, is_favorite: newVal } : g));
      toast.success(newVal ? 'Added to favorites' : 'Removed from favorites');
    } catch { toast.error('Failed to update favorite'); }
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${selectedIds.size} items?`)) return;
    for (const id of selectedIds) { await deleteGeneration(id).catch(() => {}); }
    setItems((prev) => prev.filter((g) => !selectedIds.has(g.id)));
    setTotal((prev) => prev - selectedIds.size);
    setSelectedIds(new Set());
    toast.success(`Deleted`);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const loadMore = async () => {
    if (!orgId) return;
    const result = await listGenerations(orgId, { type: filter, limit: PAGE_SIZE, offset: items.length });
    setItems((prev) => [...prev, ...result.data]);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Assets" subtitle={`${total} generations`} icon={FolderOpen}>
        {selectedIds.size > 0 && (
          <button onClick={handleBulkDelete} className="glass-button text-[12px] text-danger flex items-center gap-1.5">
            <Trash2 className="w-3.5 h-3.5" /> Delete {selectedIds.size}
          </button>
        )}
      </PageHeader>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          {TYPE_FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors',
                filter === f.key ? 'bg-primary text-white' : 'text-text-tertiary hover:text-text-primary hover:bg-surface-secondary')}>
              <f.icon className="w-3 h-3" /> {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..."
              className="w-[200px] pl-8 pr-3 py-1.5 rounded-lg bg-surface border border-outline text-[12px] text-text-primary outline-none focus:border-primary" />
          </div>
          <div className="flex rounded-lg border border-outline overflow-hidden">
            <button onClick={() => setViewMode('grid')} className={cn('p-1.5', viewMode === 'grid' ? 'bg-surface-tertiary text-text-primary' : 'text-text-tertiary')}><Grid3X3 className="w-3.5 h-3.5" /></button>
            <button onClick={() => setViewMode('list')} className={cn('p-1.5', viewMode === 'list' ? 'bg-surface-tertiary text-text-primary' : 'text-text-tertiary')}><List className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-text-tertiary" /></div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center">
          <ImageIcon className="w-10 h-10 text-text-tertiary/30 mx-auto mb-3" />
          <p className="text-[14px] text-text-tertiary">No assets yet</p>
          <p className="text-[12px] text-text-tertiary mt-1">Run a flow to generate your first assets</p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {filtered.map((gen) => (
            <div key={gen.id} className={cn('group relative rounded-xl border overflow-hidden cursor-pointer transition-all',
              selectedIds.has(gen.id) ? 'border-primary ring-2 ring-primary/20' : 'border-outline hover:border-primary/30')}>
              <div className="aspect-square bg-surface-secondary relative" onClick={() => setPreviewItem(gen)}>
                {gen.output_url ? (
                  gen.output_type === 'video' ? (
                    <video src={gen.output_url} className="w-full h-full object-cover" muted playsInline
                      onMouseEnter={(e) => (e.target as HTMLVideoElement).play().catch(() => {})}
                      onMouseLeave={(e) => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }} />
                  ) : <img src={gen.thumbnail_url || gen.output_url} alt={gen.title} className="w-full h-full object-cover" loading="lazy" />
                ) : <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-8 h-8 text-text-tertiary/20" /></div>}
                <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/60 text-[9px] font-bold text-white uppercase">{gen.output_type}</span>
                <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <input type="checkbox" checked={selectedIds.has(gen.id)} onChange={(e) => { e.stopPropagation(); toggleSelect(gen.id); }} className="w-4 h-4 accent-primary cursor-pointer" />
                </div>
                {/* Hover actions */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100">
                  {gen.output_url && <a href={gen.output_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="p-1.5 rounded-lg bg-white/20 text-white hover:bg-white/30"><Download className="w-3.5 h-3.5" /></a>}
                  {gen.prompt && <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(gen.prompt!); toast.success('Copied'); }} className="p-1.5 rounded-lg bg-white/20 text-white hover:bg-white/30"><Copy className="w-3.5 h-3.5" /></button>}
                  {orgId && <button onClick={(e) => { e.stopPropagation(); const n = prompt('Style name:', gen.title); if (n) generationToStyleDna(gen.id, orgId, n).then(() => toast.success('Style created')).catch(() => toast.error('Failed')); }} className="p-1.5 rounded-lg bg-white/20 text-white hover:bg-purple-500/60"><Palette className="w-3.5 h-3.5" /></button>}
                  <button onClick={(e) => { e.stopPropagation(); void handleToggleFavorite(gen); }} className={`p-1.5 rounded-lg bg-white/20 text-white hover:bg-pink-500/60 ${gen.is_favorite ? 'bg-pink-500/60' : ''}`}><Heart className={`w-3.5 h-3.5 ${gen.is_favorite ? 'fill-current' : ''}`} /></button>
                  <button onClick={(e) => { e.stopPropagation(); void handleDelete(gen.id); }} className="p-1.5 rounded-lg bg-white/20 text-white hover:bg-red-500/60"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              <div className="px-2.5 py-2">
                <p className="text-[11px] font-medium text-text-primary truncate">{gen.title}</p>
                <p className="text-[10px] text-text-tertiary mt-0.5">{gen.model || ''} · {timeAgo(gen.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="section-card divide-y divide-outline">
          {filtered.map((gen) => (
            <div key={gen.id} className="flex items-center gap-4 px-4 py-3 hover:bg-surface-secondary transition-colors cursor-pointer" onClick={() => setPreviewItem(gen)}>
              <input type="checkbox" checked={selectedIds.has(gen.id)} onChange={(e) => { e.stopPropagation(); toggleSelect(gen.id); }} className="w-4 h-4 accent-primary" />
              <div className="w-12 h-12 rounded-lg bg-surface-tertiary border border-outline overflow-hidden shrink-0">
                {gen.output_url && gen.output_type !== 'video' ? <img src={gen.thumbnail_url || gen.output_url} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center"><Film className="w-4 h-4 text-text-tertiary" /></div>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-text-primary truncate">{gen.title}</p>
                <p className="text-[11px] text-text-tertiary">{gen.model || ''} · {gen.output_type} · {timeAgo(gen.created_at)}</p>
                {gen.prompt && <p className="text-[10px] text-text-tertiary truncate mt-0.5 italic">{gen.prompt}</p>}
              </div>
              <div className="flex gap-1 shrink-0">
                {gen.output_url && <a href={gen.output_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="p-1.5 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary"><Download className="w-3.5 h-3.5" /></a>}
                <button onClick={(e) => { e.stopPropagation(); void handleToggleFavorite(gen); }} className={`p-1.5 rounded hover:bg-surface-tertiary ${gen.is_favorite ? 'text-pink-500' : 'text-text-tertiary hover:text-pink-500'}`}><Heart className={`w-3.5 h-3.5 ${gen.is_favorite ? 'fill-current' : ''}`} /></button>
                <button onClick={(e) => { e.stopPropagation(); void handleDelete(gen.id); }} className="p-1.5 rounded text-text-tertiary hover:text-danger hover:bg-danger-light"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {items.length < total && (
        <div className="flex justify-center"><button onClick={() => void loadMore()} className="glass-button text-[12px]">Load more ({total - items.length} remaining)</button></div>
      )}

      {/* Preview lightbox */}
      {previewItem && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setPreviewItem(null)}>
          <div className="relative max-w-3xl max-h-[85vh] w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setPreviewItem(null)} className="absolute -top-3 -right-3 z-10 w-8 h-8 rounded-full bg-white text-black flex items-center justify-center shadow-lg"><X className="w-4 h-4" /></button>
            {previewItem.output_type === 'video' && previewItem.output_url ? <video src={previewItem.output_url} className="w-full rounded-xl" controls autoPlay muted />
              : previewItem.output_url ? <img src={previewItem.output_url} alt={previewItem.title} className="w-full rounded-xl" /> : null}
            <div className="mt-3 bg-surface rounded-xl border border-outline p-4">
              <p className="text-[14px] font-semibold text-text-primary">{previewItem.title}</p>
              <p className="text-[12px] text-text-tertiary mt-1">{previewItem.model} · {previewItem.output_type} · {timeAgo(previewItem.created_at)}</p>
              {previewItem.prompt && <p className="text-[12px] text-text-secondary mt-2 italic">{previewItem.prompt}</p>}
              <div className="flex gap-2 mt-3">
                {previewItem.output_url && <a href={previewItem.output_url} target="_blank" rel="noopener noreferrer" className="glass-button text-[11px] flex items-center gap-1"><ExternalLink className="w-3 h-3" /> Open</a>}
                {previewItem.prompt && <button onClick={() => { navigator.clipboard.writeText(previewItem.prompt!); toast.success('Copied'); }} className="glass-button text-[11px] flex items-center gap-1"><Copy className="w-3 h-3" /> Copy prompt</button>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
