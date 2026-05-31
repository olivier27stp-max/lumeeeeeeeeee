import React, { useEffect, useState } from 'react';
import { Archive, Loader2, RotateCcw, Search, Trash2, User, Briefcase, Contact } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from '../i18n';
import { formatDate, cn } from '../lib/utils';
import {
  ArchiveData,
  ArchivedItem,
  ArchiveItemType,
  fetchArchivedItems,
  permanentDeleteItem,
  restoreItem,
} from '../lib/archiveApi';
import { EmptyState } from './ui';
import StatusBadge from './ui/StatusBadge';

type ArchiveTab = 'all' | 'clients' | 'leads' | 'jobs';

export default function ArchivesPanel() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ArchiveData>({ clients: [], leads: [], jobs: [] });
  const [tab, setTab] = useState<ArchiveTab>('all');
  const [search, setSearch] = useState('');
  const [actionId, setActionId] = useState<string | null>(null);

  const loadArchives = async () => {
    setLoading(true);
    try {
      const result = await fetchArchivedItems();
      setData(result);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load archives');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadArchives();
  }, []);

  const handleRestore = async (item: ArchivedItem) => {
    if (!window.confirm(t.archives.confirmRestore)) return;
    setActionId(item.id);
    try {
      await restoreItem(item.type, item.id);
      toast.success(t.archives.restored);
      await loadArchives();
    } catch (err: any) {
      toast.error(err?.message || t.archives.failedRestore);
    } finally {
      setActionId(null);
    }
  };

  const handleDelete = async (item: ArchivedItem) => {
    if (!window.confirm(t.archives.confirmDelete)) return;
    setActionId(item.id);
    try {
      await permanentDeleteItem(item.type, item.id);
      toast.success(t.archives.deleted);
      await loadArchives();
    } catch (err: any) {
      toast.error(err?.message || t.archives.failedDelete);
    } finally {
      setActionId(null);
    }
  };

  const allItems: ArchivedItem[] = [
    ...data.clients,
    ...data.leads,
    ...data.jobs,
  ].sort((a, b) => new Date(b.archived_at).getTime() - new Date(a.archived_at).getTime());

  const getFilteredItems = (): ArchivedItem[] => {
    let items: ArchivedItem[];
    switch (tab) {
      case 'clients': items = data.clients; break;
      case 'leads': items = data.leads; break;
      case 'jobs': items = data.jobs; break;
      default: items = allItems;
    }
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (item) =>
        item.name?.toLowerCase().includes(q) ||
        item.email?.toLowerCase().includes(q) ||
        item.company?.toLowerCase().includes(q) ||
        item.client_name?.toLowerCase().includes(q)
    );
  };

  const filteredItems = getFilteredItems();

  const tabs: { key: ArchiveTab; label: string; count: number }[] = [
    { key: 'all', label: t.archives.all, count: allItems.length },
    { key: 'clients', label: t.archives.clients, count: data.clients.length },
    { key: 'leads', label: t.archives.leads, count: data.leads.length },
    { key: 'jobs', label: t.archives.jobs, count: data.jobs.length },
  ];

  const typeIcon = (type: ArchiveItemType) => {
    switch (type) {
      case 'client': return User;
      case 'lead': return Contact;
      case 'job': return Briefcase;
    }
  };

  const typeLabel = (type: ArchiveItemType) => {
    switch (type) {
      case 'client': return t.archives.clients;
      case 'lead': return t.archives.leads;
      case 'job': return t.archives.jobs;
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 size={18} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Tabs */}
      <div className="flex items-center gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all',
              tab === t.key
                ? 'bg-surface-secondary text-text-primary font-semibold'
                : 'text-text-secondary hover:bg-surface-secondary/50'
            )}
          >
            {t.label}
            {t.count > 0 && (
              <span className="ml-1.5 text-[10px] bg-surface-tertiary text-text-tertiary rounded-full px-1.5 py-0.5">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
        <input
          type="text"
          placeholder={t.archives.searchArchives}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="glass-input w-full pl-9"
        />
      </div>

      {/* List */}
      {filteredItems.length === 0 ? (
        <EmptyState
          icon={Archive}
          title={t.archives.noArchives}
          description={t.archives.noArchivesDesc}
        />
      ) : (
        <div className="section-card overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  {t.archives.type}
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  {t.archives.name}
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  {t.common.status}
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  {t.archives.archivedOn}
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  {t.common.actions}
                </th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence mode="popLayout">
                {filteredItems.map((item) => {
                  const Icon = typeIcon(item.type);
                  const isActing = actionId === item.id;
                  return (
                    <motion.tr
                      key={`${item.type}-${item.id}`}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="border-b border-border"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Icon size={14} className="text-text-tertiary" />
                          <span className="text-[12px] font-medium text-text-secondary">{typeLabel(item.type)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-[13px] font-medium text-text-primary">{item.name}</p>
                        {item.email && (
                          <p className="text-xs text-text-tertiary">{item.email}</p>
                        )}
                        {item.client_name && item.type === 'job' && (
                          <p className="text-xs text-text-tertiary">{item.client_name}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={item.status || 'archived'} />
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-[13px] text-text-tertiary">
                          {item.archived_at ? formatDate(item.archived_at) : '—'}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => void handleRestore(item)}
                            disabled={isActing}
                            className="glass-button inline-flex items-center gap-1 text-xs disabled:opacity-50"
                          >
                            {isActing ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <RotateCcw size={12} />
                            )}
                            {t.archives.restore}
                          </button>
                          <button
                            onClick={() => void handleDelete(item)}
                            disabled={isActing}
                            className="glass-button-danger inline-flex items-center gap-1 text-xs disabled:opacity-50"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
