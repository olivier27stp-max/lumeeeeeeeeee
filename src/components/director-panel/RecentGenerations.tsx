import React, { useCallback, useEffect, useState } from 'react';
import {
  Image as ImageIcon,
  Film,
  Wand2,
  Layers,
  Trash2,
  Copy,
  ExternalLink,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  Palette,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import {
  listGenerations,
  deleteGeneration,
  generationToStyleDna,
  type DirectorGeneration,
} from '../../lib/directorApi';

const TYPE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'image', label: 'Images' },
  { key: 'video', label: 'Videos' },
  { key: 'edit', label: 'Edits' },
] as const;

const TYPE_ICONS: Record<string, React.FC<{ className?: string }>> = {
  image: ImageIcon,
  video: Film,
  edit: Wand2,
  batch: Layers,
};

const STATUS_BADGE: Record<string, { icon: React.FC<{ className?: string }>; color: string }> = {
  completed: { icon: CheckCircle2, color: 'text-emerald-500' },
  processing: { icon: Clock, color: 'text-amber-500' },
  failed: { icon: AlertCircle, color: 'text-red-500' },
};

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

interface Props {
  orgId: string;
}

export default function RecentGenerations({ orgId }: Props) {
  const [items, setItems] = useState<DirectorGeneration[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const PAGE_SIZE = 12;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listGenerations(orgId, { type: filter, limit: PAGE_SIZE });
      setItems(result.data);
      setTotal(result.total);
    } catch {
      // Table might not exist yet
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [orgId, filter]);

  useEffect(() => { void load(); }, [load]);

  const handleDelete = async (id: string) => {
    try {
      await deleteGeneration(id);
      setItems((prev) => prev.filter((g) => g.id !== id));
      setTotal((prev) => prev - 1);
      toast.success('Generation deleted');
    } catch {
      toast.error('Failed to delete');
    } finally {
      setDeleteConfirm(null);
    }
  };

  const handleCopyPrompt = (prompt: string | null) => {
    if (!prompt) return;
    navigator.clipboard.writeText(prompt).then(() => toast.success('Prompt copied'));
  };

  const loadMore = async () => {
    try {
      const result = await listGenerations(orgId, { type: filter, limit: PAGE_SIZE, offset: items.length });
      setItems((prev) => [...prev, ...result.data]);
    } catch {
      toast.error('Failed to load more');
    }
  };

  return (
    <div>
      {/* Filters */}
      <div className="flex items-center gap-1 mb-4">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              'px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors',
              filter === f.key
                ? 'bg-primary text-white'
                : 'text-text-tertiary hover:text-text-primary hover:bg-surface-secondary'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="aspect-square rounded-lg bg-surface-secondary animate-pulse border border-outline" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="py-16 text-center">
          <ImageIcon className="w-8 h-8 text-text-tertiary/40 mx-auto mb-3" />
          <p className="text-[13px] text-text-tertiary">No generations yet</p>
          <p className="text-[11px] text-text-tertiary mt-1">Run a flow to see your outputs here</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {items.map((gen) => {
              const TypeIcon = TYPE_ICONS[gen.output_type] || ImageIcon;
              const statusInfo = STATUS_BADGE[gen.status] || STATUS_BADGE.completed;
              const StatusIcon = statusInfo.icon;
              const isDeleting = deleteConfirm === gen.id;

              return (
                <div
                  key={gen.id}
                  className="group relative rounded-lg border border-outline bg-surface overflow-hidden hover:border-primary/30 transition-all"
                >
                  {/* Thumbnail */}
                  <div className="aspect-square bg-surface-secondary relative overflow-hidden">
                    {gen.output_url ? (
                      gen.output_type === 'video' ? (
                        <video
                          src={gen.output_url}
                          className="w-full h-full object-cover"
                          muted
                          playsInline
                          onMouseEnter={(e) => (e.target as HTMLVideoElement).play().catch(() => {})}
                          onMouseLeave={(e) => { (e.target as HTMLVideoElement).pause(); (e.target as HTMLVideoElement).currentTime = 0; }}
                        />
                      ) : (
                        <img
                          src={gen.thumbnail_url || gen.output_url}
                          alt={gen.title}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      )
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <TypeIcon className="w-8 h-8 text-text-tertiary/30" />
                      </div>
                    )}

                    {/* Type badge */}
                    <span className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/60 text-[9px] font-semibold text-white uppercase">
                      <TypeIcon className="w-2.5 h-2.5" />
                      {gen.output_type}
                    </span>

                    {/* Status badge */}
                    {gen.status !== 'completed' && (
                      <span className={cn('absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/60 text-[9px] font-semibold text-white', statusInfo.color)}>
                        <StatusIcon className="w-2.5 h-2.5" />
                        {gen.status}
                      </span>
                    )}

                    {/* Hover actions */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                      {gen.output_url && (
                        <a
                          href={gen.output_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 rounded-lg bg-white/20 text-white hover:bg-white/30 transition-colors"
                          title="Open"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                      {gen.prompt && (
                        <button
                          onClick={() => handleCopyPrompt(gen.prompt)}
                          className="p-2 rounded-lg bg-white/20 text-white hover:bg-white/30 transition-colors"
                          title="Copy prompt"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => {
                          const name = prompt('Style name:', gen.title || 'My Style');
                          if (!name) return;
                          generationToStyleDna(gen.id, orgId, name)
                            .then(() => toast.success('Style DNA created'))
                            .catch(() => toast.error('Failed to create style'));
                        }}
                        className="p-2 rounded-lg bg-white/20 text-white hover:bg-purple-500/60 transition-colors"
                        title="Save as Style DNA"
                      >
                        <Palette className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(gen.id)}
                        className="p-2 rounded-lg bg-white/20 text-white hover:bg-red-500/60 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Info */}
                  <div className="px-2.5 py-2">
                    <p className="text-[12px] font-medium text-text-primary truncate">{gen.title}</p>
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-[10px] text-text-tertiary truncate">
                        {gen.flow?.title || gen.model || gen.provider || ''}
                      </p>
                      <p className="text-[10px] text-text-tertiary shrink-0 ml-1">{timeAgo(gen.created_at)}</p>
                    </div>
                    {gen.prompt && (
                      <p className="text-[10px] text-text-tertiary truncate mt-1 italic">{gen.prompt.slice(0, 60)}</p>
                    )}
                  </div>

                  {/* Delete confirmation overlay */}
                  {isDeleting && (
                    <div className="absolute inset-0 bg-surface/95 flex flex-col items-center justify-center gap-3 z-10 p-4">
                      <p className="text-[12px] font-medium text-text-primary text-center">Delete this generation?</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => void handleDelete(gen.id)}
                          className="px-3 py-1.5 rounded-md bg-danger text-white text-[11px] font-medium hover:bg-danger/80 transition-colors"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="px-3 py-1.5 rounded-md bg-surface-secondary border border-outline text-[11px] font-medium text-text-secondary hover:bg-surface-tertiary transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Load more */}
          {items.length < total && (
            <div className="flex justify-center mt-4">
              <button
                onClick={() => void loadMore()}
                className="glass-button text-[12px] px-4 py-2"
              >
                Load more ({total - items.length} remaining)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
