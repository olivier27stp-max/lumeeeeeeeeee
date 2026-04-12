import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  Briefcase,
  ChevronLeft,
  ChevronRight,
  Download,
  MoreHorizontal,
  Plus,
  Trash2,
  X,
  Search,
  MapPin,
  Calendar,
  Clock,
  DollarSign,
  User,
  Phone,
  Mail,
  FileText,
  Edit2,
  ChevronDown,
  AlertCircle,
  Timer,
  Receipt,
  CircleDot,
  CalendarClock,
  ArrowRight,
  ExternalLink,
  Users,
  Filter,
  LayoutGrid,
  List,
  Copy,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import TeamsManagerModal from '../components/TeamsManagerModal';
import { useJobModalController } from '../contexts/JobModalController';
import { cn, formatCurrency, formatDate } from '../lib/utils';
import {
  exportJobsCsv,
  getJobs,
  getJobsKpis,
  getJobTypes,
  JobsKpis,
  JobSort,
  JobSortDirection,
  softDeleteJob,
} from '../lib/jobsApi';
import { Job } from '../types';
import StatusBadge from '../components/ui/StatusBadge';
import { CrmPageHeader, CrmFilterBtn, CrmTableCard, CrmAvatar, CrmBadge } from '../components/ui/CrmTable';
import { useTranslation } from '../i18n';
import { supabase } from '../lib/supabase';
import UnifiedAvatar from '../components/ui/UnifiedAvatar';
import BulkActionBar from '../components/BulkActionBar';

// ─── View mode ───────────────────────────────────────────────────
type ViewMode = 'grid' | 'list';

// ─── Stat chip for the compact top bar ───────────────────────────
interface StatChipProps {
  label: string;
  value: number | string;
  color: string;
  active?: boolean;
  onClick?: () => void;
}

const StatChip: React.FC<StatChipProps> = ({ label, value, color, active, onClick }) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 h-8 px-3.5 rounded-full text-xs font-medium transition-all whitespace-nowrap',
        active
          ? 'bg-primary text-white shadow-sm'
          : 'text-text-tertiary hover:text-text-primary hover:bg-surface-secondary'
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', color, active && 'bg-surface/60')} />
      {label}
      <span className={cn('font-bold tabular-nums', active ? 'text-white' : 'text-text-primary')}>
        {value}
      </span>
    </button>
  );
}

// ─── Job Card (grid mode) ────────────────────────────────────────
interface JobCardProps {
  job: Job;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
  formatMoney: (job: Job) => string;
}

const JobCard: React.FC<JobCardProps> = ({ job, onClick, onDelete, formatMoney }) => {
  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      onClick={onClick}
      className="w-full text-left rounded-2xl bg-surface-card border border-outline p-5 hover:border-primary/30 hover:shadow-card-hover transition-all group relative"
    >
      {/* Status stripe */}
      <div className={cn(
        'absolute left-0 top-3 bottom-3 w-[3px] rounded-full',
        statusColor(job.status)
      )} />

      <div className="pl-3">
        {/* Top row: number + status */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-text-tertiary tabular-nums">#{job.job_number}</span>
            <StatusBadge status={job.status} />
          </div>
          <button
            onClick={onDelete}
            className="p-1 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 opacity-0 group-hover:opacity-100 transition-all"
          >
            <Trash2 size={12} />
          </button>
        </div>

        {/* Title */}
        <h3 className="text-sm font-semibold text-text-primary leading-snug mb-1.5 group-hover:text-primary transition-colors line-clamp-1">
          {job.title}
        </h3>

        {/* Client */}
        {job.client_name && (
          <p className="text-[12px] text-text-secondary flex items-center gap-1.5 mb-1">
            <User size={11} className="text-text-tertiary shrink-0" />
            <span className="truncate">{job.client_name}</span>
          </p>
        )}

        {/* Address */}
        {job.property_address && (
          <p className="text-[12px] text-text-tertiary flex items-center gap-1.5 mb-2">
            <MapPin size={11} className="shrink-0" />
            <span className="truncate">{job.property_address}</span>
          </p>
        )}

        {/* Bottom row: schedule + amount */}
        <div className="flex items-center justify-between pt-2 border-t border-outline/30">
          <span className="text-[11px] text-text-tertiary flex items-center gap-1">
            <Calendar size={10} />
            {job.scheduled_at ? formatDate(job.scheduled_at) : 'Unscheduled'}
          </span>
          <span className="text-sm font-bold text-text-primary tabular-nums">
            {formatMoney(job)}
          </span>
        </div>
      </div>
    </motion.button>
  );
}

// ─── Status color helper ─────────────────────────────────────────
function statusColor(status: string): string {
  const s = (status || '').toLowerCase().replace(/\s+/g, '_');
  if (s === 'completed' || s === 'done') return 'bg-success';
  if (s === 'scheduled' || s === 'confirmed') return 'bg-info';
  if (s === 'in_progress' || s === 'active') return 'bg-primary';
  if (s === 'cancelled') return 'bg-danger';
  if (s === 'late' || s === 'overdue') return 'bg-danger';
  if (s === 'requires_invoicing') return 'bg-warning';
  return 'bg-text-tertiary';
}

// ─── Preview Panel ───────────────────────────────────────────────
function JobPreviewPanel({ job, onClose, onEdit, onDelete, formatMoney }: {
  job: Job;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  formatMoney: (job: Job) => string;
}) {
  const { t } = useTranslation();
  const mapsUrl = job.property_address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.property_address)}`
    : null;

  return (
    <motion.div
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className="w-[420px] shrink-0 h-full border-l border-outline/40 bg-surface overflow-y-auto"
    >
      {/* Header */}
      <div className="sticky top-0 bg-surface z-10 px-5 py-4 border-b border-outline/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className={cn('w-2.5 h-2.5 rounded-full', statusColor(job.status))} />
            <span className="text-[11px] font-bold text-text-tertiary tabular-nums">#{job.job_number}</span>
            <StatusBadge status={job.status} />
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onEdit} className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-secondary transition-colors focus:ring-1 focus:ring-primary/30 outline-none">
              <Edit2 size={13} />
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-secondary transition-colors focus:ring-1 focus:ring-primary/30 outline-none">
              <X size={14} />
            </button>
          </div>
        </div>
        <h2 className="text-[17px] font-bold text-text-primary mt-2 leading-snug">{job.title}</h2>
      </div>

      <div className="px-5 py-4 space-y-5">
        {/* Amount card */}
        <div className="stat-card">
          <p className="text-xs font-medium text-text-tertiary mb-1">Total Value</p>
          <p className="text-[24px] font-extrabold text-text-primary tabular-nums">{formatMoney(job)}</p>
        </div>

        {/* Client */}
        <div>
          <p className="text-xs font-medium text-text-tertiary mb-2.5">Client</p>
          <div className="space-y-2">
            {job.client_name && (
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center text-[11px] font-bold shrink-0">
                  {job.client_name.charAt(0).toUpperCase()}
                </div>
                <span className="text-[13px] font-semibold text-text-primary">{job.client_name}</span>
              </div>
            )}
          </div>
        </div>

        {/* Address */}
        {job.property_address && (
          <div>
            <p className="text-xs font-medium text-text-tertiary mb-2.5">Property</p>
            <div className="flex items-start gap-2.5 rounded-xl bg-surface-secondary/50 p-3">
              <MapPin size={13} className="text-text-tertiary mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-text-primary">{job.property_address}</p>
                {mapsUrl && (
                  <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary hover:underline mt-1 inline-flex items-center gap-1">
                    Open in Google Maps <ExternalLink size={9} />
                  </a>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Schedule */}
        <div>
          <p className="text-xs font-medium text-text-tertiary mb-2.5">Schedule</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-surface-secondary/50 p-3">
              <p className="text-[10px] font-medium text-text-tertiary uppercase mb-1">Date</p>
              <p className="text-[13px] font-semibold text-text-primary">
                {job.scheduled_at ? formatDate(job.scheduled_at) : 'Unscheduled'}
              </p>
            </div>
            <div className="rounded-xl bg-surface-secondary/50 p-3">
              <p className="text-[10px] font-medium text-text-tertiary uppercase mb-1">Time</p>
              <p className="text-[13px] font-semibold text-text-primary">
                {job.scheduled_at
                  ? new Date(job.scheduled_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                  : '--'}
                {job.end_at && ` — ${new Date(job.end_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
              </p>
            </div>
          </div>
        </div>

        {/* Details */}
        <div>
          <p className="text-xs font-medium text-text-tertiary mb-2.5">Details</p>
          <div className="space-y-2">
            {job.job_type && (
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-text-tertiary">Type</span>
                <span className="text-text-primary font-medium">{job.job_type}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-text-tertiary">Invoicing</span>
              <span className="text-text-primary font-medium">
                {job.requires_invoicing ? 'Required' : 'Not required'}
              </span>
            </div>
          </div>
        </div>

        {/* Notes */}
        {job.notes && (
          <div>
            <p className="text-xs font-medium text-text-tertiary mb-2.5">Notes</p>
            <div className="rounded-xl bg-surface-secondary/50 p-3">
              <p className="text-[13px] text-text-secondary leading-relaxed whitespace-pre-wrap">{job.notes}</p>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="sticky bottom-0 bg-surface px-5 py-3 border-t border-outline/40 flex items-center justify-between">
        <button
          onClick={onDelete}
          className="glass-button-ghost text-[12px] font-medium text-danger hover:text-danger flex items-center gap-1.5 hover:bg-danger/10"
        >
          <Trash2 size={13} /> Delete
        </button>
        <button
          onClick={onEdit}
          className="glass-button-primary inline-flex items-center gap-1.5"
        >
          <Edit2 size={13} /> Edit Job
        </button>
      </div>
    </motion.div>
  );
}

// ─── Main Component ──────────────────────────────────────────────
function JobStatusDropdown({ value, onChange, fr }: { value: string; onChange: (v: string) => void; fr: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isActive = value !== 'All';

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const options = [
    { value: 'All', label: fr ? 'Tous' : 'All' },
    { value: 'scheduled', label: fr ? 'Planifié' : 'Scheduled' },
    { value: 'in_progress', label: fr ? 'En cours' : 'In Progress' },
    { value: 'action_required', label: fr ? 'Action requise' : 'Action Required' },
    { value: 'late', label: fr ? 'En retard' : 'Late' },
    { value: 'completed', label: fr ? 'Complété' : 'Done' },
    { value: 'draft', label: fr ? 'Brouillon' : 'Draft' },
    { value: 'cancelled', label: fr ? 'Annulé' : 'Cancelled' },
  ];

  const activeLabel = options.find(o => o.value === value)?.label;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex items-center gap-1.5 h-9 px-3 border rounded-md text-[14px] font-normal transition-colors',
          isActive
            ? 'bg-primary text-white border-primary'
            : 'bg-surface text-text-primary border-outline hover:bg-surface-secondary'
        )}
      >
        <Filter size={14} className={isActive ? 'text-white' : 'text-[#64748b]'} />
        Status
        {isActive && <span className="ml-0.5 text-[11px] opacity-80">({activeLabel})</span>}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1.5 w-48 bg-surface-elevated border border-outline rounded-md shadow-dropdown z-50 py-1">
          {options.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={cn(
                'w-full text-left px-3 py-1.5 text-[13px] transition-colors',
                value === opt.value
                  ? 'bg-primary-light text-text-primary font-medium'
                  : 'text-text-secondary hover:bg-surface-secondary'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Jobs() {
  const { t, language } = useTranslation();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [kpiLoading, setKpiLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kpis, setKpis] = useState<JobsKpis | null>(null);
  const [statusFilter, setStatusFilter] = useState('All');
  const [jobTypeFilter, setJobTypeFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [sortBy, setSortBy] = useState<JobSort>('schedule');
  const [sortDirection, setSortDirection] = useState<JobSortDirection>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [jobTypes, setJobTypes] = useState<string[]>([]);
  const [showMoreActions, setShowMoreActions] = useState(false);
  const [isTeamsManagerOpen, setIsTeamsManagerOpen] = useState(false);
  const [jobToDelete, setJobToDelete] = useState<Job | null>(null);
  const [isDeletingJob, setIsDeletingJob] = useState(false);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  // Keyboard navigation in list view
  useEffect(() => {
    if (viewMode !== 'list' || jobs.length === 0) return;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setFocusedIdx(prev => Math.min(jobs.length - 1, prev + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setFocusedIdx(prev => Math.max(0, prev - 1)); }
      else if (e.key === 'Enter' && focusedIdx >= 0 && focusedIdx < jobs.length) { e.preventDefault(); handleJobClick(jobs[focusedIdx]); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [viewMode, jobs, focusedIdx]);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const { openJobModal } = useJobModalController();

  const STATUS_FILTERS = useMemo(() => [
    t.common.all,
    t.jobs.late,
    t.jobs.unscheduled,
    t.jobs.requiresInvoicing,
    t.jobs.actionRequired,
    t.jobs.endingWithin30,
  ], [t]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedQuery(searchQuery); setPage(1); }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadJobs = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getJobs({ status: statusFilter, jobType: jobTypeFilter, q: debouncedQuery, sort: sortBy, sortDirection, page, pageSize });
      setJobs(result.jobs);
      setTotal(result.total);
    } catch (err: any) {
      setError(err.message || t.jobs.failedLoad);
    } finally {
      setLoading(false);
    }
  };

  const loadKpis = async () => {
    setKpiLoading(true);
    try {
      // KPIs should always count ALL jobs (not filtered by active status tab)
      // so each badge shows the true count regardless of which tab is selected
      const result = await getJobsKpis({ jobType: jobTypeFilter, q: debouncedQuery });
      setKpis(result);
    } catch { setKpis(null); }
    finally { setKpiLoading(false); }
  };

  useEffect(() => { getJobTypes().then(setJobTypes).catch(() => setJobTypes([])); }, []);
  useEffect(() => { void loadJobs(); }, [statusFilter, jobTypeFilter, debouncedQuery, sortBy, sortDirection, page, pageSize]);
  useEffect(() => { void loadKpis(); }, [jobTypeFilter, debouncedQuery]);

  // Listen for command palette create event
  useEffect(() => {
    const handler = () => openJobModal({ onCreated: () => { void loadJobs(); void loadKpis(); } });
    window.addEventListener('crm:open-new-job', handler);
    return () => window.removeEventListener('crm:open-new-job', handler);
  }, [openJobModal]);

  // Realtime subscription — refresh when jobs change from any source
  useEffect(() => {
    const channel = supabase
      .channel('jobs-page-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => {
        void loadJobs();
        void loadKpis();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [statusFilter, jobTypeFilter, debouncedQuery, sortBy, sortDirection, page, pageSize]);

  const handleSort = (key: JobSort) => {
    setPage(1);
    if (sortBy === key) { setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc')); return; }
    setSortBy(key);
    setSortDirection(key === 'total' ? 'desc' : 'asc');
  };

  const handleExportCsv = async () => {
    try {
      const csv = await exportJobsCsv({ status: statusFilter, jobType: jobTypeFilter, q: debouncedQuery });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `jobs-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setShowMoreActions(false);
    } catch (err: any) {
      toast.error(err.message || t.jobs.failedExport);
    }
  };

  const formatMoney = (job: Job) => {
    const amount = Math.round(job.total_cents / 100);
    if (!job.currency || job.currency === 'USD') return formatCurrency(amount);
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: job.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  };

  const handleDeleteJob = async () => {
    if (!jobToDelete || isDeletingJob) return;
    setIsDeletingJob(true);
    try {
      const result = await softDeleteJob(jobToDelete.id);
      if (result.job < 1) { toast.error(t.jobs.jobNotFound); return; }
      setJobs((prev) => prev.filter((job) => job.id !== jobToDelete.id));
      setTotal((prev) => Math.max(0, prev - 1));
      if (selectedJob?.id === jobToDelete.id) setSelectedJob(null);
      setJobToDelete(null);
      await Promise.all([loadJobs(), loadKpis()]);
      toast.success(t.jobs.jobDeleted, {
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              await supabase.from('jobs').update({ deleted_at: null, updated_at: new Date().toISOString() }).eq('id', jobToDelete.id);
              await loadJobs();
              toast.success('Job restored');
            } catch { toast.error('Failed to restore'); }
          },
        },
        duration: 6000,
      });
    } catch (err: any) {
      toast.error(err?.message || t.jobs.failedDelete);
    } finally { setIsDeletingJob(false); }
  };

  const handleJobClick = (job: Job) => {
    setSelectedJob(job);
  };

  const handleEditJob = (job: Job) => {
    openJobModal({
      jobId: job.id,
      sourceContext: { type: 'jobs' },
      onCreated: async () => { await Promise.all([loadJobs(), loadKpis()]); },
    });
    setSelectedJob(null);
  };

  const overviewBullets = useMemo(() => [
    { label: 'Due soon', key: 'ending_within_30' as const, color: 'bg-danger', filter: t.jobs.endingWithin30 },
    { label: 'Late', key: 'late' as const, color: 'bg-danger', filter: t.jobs.late },
    { label: 'Needs invoice', key: 'requires_invoicing' as const, color: 'bg-warning', filter: t.jobs.requiresInvoicing },
    { label: 'Action needed', key: 'action_required' as const, color: 'bg-warning', filter: t.jobs.actionRequired },
    { label: 'Unscheduled', key: 'unscheduled' as const, color: 'bg-text-tertiary', filter: t.jobs.unscheduled },
  ], [t]);

  const fr = language === 'fr';
  const allSel = jobs.length > 0 && selectedJobIds.size === jobs.length;
  const toggleAll = () => { allSel ? setSelectedJobIds(new Set()) : setSelectedJobIds(new Set(jobs.map(j => j.id))); };
  const toggleOne = (id: string) => { const n = new Set(selectedJobIds); n.has(id) ? n.delete(id) : n.add(id); setSelectedJobIds(n); };


  function JobBadge({ status }: { status: string }) {
    const s = (status || 'draft').toLowerCase();
    const map: Record<string, { label: string; badge: string }> = {
      completed: { label: fr ? 'Complété' : 'Completed', badge: 'badge-success' },
      scheduled: { label: fr ? 'Planifié' : 'Scheduled', badge: 'badge-info' },
      in_progress: { label: fr ? 'En cours' : 'In Progress', badge: 'badge-warning' },
      cancelled: { label: fr ? 'Annulé' : 'Cancelled', badge: 'badge-danger' },
      draft: { label: fr ? 'Brouillon' : 'Draft', badge: 'badge-neutral' },
    };
    const v = map[s] || map.draft;
    return <span className={v.badge}>{v.label}</span>;
  }

  const IconSort = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>;
  const IconPlus = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>;
  const IconPlusSm = (c: string) => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>;
  const IconSliders = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/></svg>;
  const IconDots = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>;

  return (
    <>
      {/* ── PAGE HEADER ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-[28px] font-bold text-text-primary leading-tight">Jobs</h1>
        <button onClick={() => openJobModal({ sourceContext: { type: 'jobs' }, onCreated: async () => { await Promise.all([loadJobs(), loadKpis()]); } })}
          className="inline-flex items-center gap-2 h-10 px-5 bg-primary text-white rounded-md text-[14px] font-medium hover:bg-primary-hover active:scale-[0.98] transition-all">
          {IconPlus} {t.jobs.newJob}
        </button>
      </div>

      {/* ── TOOLBAR ── */}
      <div className="flex items-center gap-2 mt-5 mb-4">
        <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
          placeholder={fr ? 'Rechercher jobs...' : 'Search jobs...'}
          className="h-9 w-[200px] px-3 text-[14px] bg-surface border border-outline rounded-md text-text-primary placeholder:text-text-tertiary outline-none focus:ring-1 focus:ring-[#94a3b8] focus:border-[#94a3b8] transition-all" />
        <JobStatusDropdown
          value={statusFilter}
          onChange={(v) => { setStatusFilter(v); setPage(1); }}
          fr={fr}
        />
      </div>

      {/* ── TABLE (grid layout — identical structure to Clients & Devis) ── */}
      <div className="border border-outline rounded-md overflow-hidden bg-surface">
        <div className="grid" style={{ gridTemplateColumns: '40px 1fr 1fr 1fr 1fr 100px 100px 48px' }}>
          {/* HEADER */}
          <div className="py-3 pl-4 border-b border-outline flex items-center"><input type="checkbox" checked={allSel} onChange={toggleAll} className="rounded-[3px] border-outline w-4 h-4 accent-primary cursor-pointer" /></div>
          <div className="py-3 px-4 border-b border-outline flex items-center text-[14px] font-medium text-text-primary"><span className="inline-flex items-center gap-1">{fr ? 'Titre' : 'Title'} {IconSort}</span></div>
          <div className="py-3 px-4 border-b border-outline flex items-center text-[14px] font-medium text-text-primary"><span className="inline-flex items-center gap-1">Client {IconSort}</span></div>
          <div className="py-3 px-4 border-b border-outline flex items-center text-[14px] font-medium text-text-primary"><span className="inline-flex items-center gap-1">{fr ? 'Date' : 'Date'} {IconSort}</span></div>
          <div className="py-3 px-4 border-b border-outline flex items-center text-[14px] font-medium text-text-primary"><span className="inline-flex items-center gap-1">Total {IconSort}</span></div>
          <div className="py-3 px-4 border-b border-outline flex items-center text-[14px] font-medium text-text-primary"><span className="inline-flex items-center gap-1">Status {IconSort}</span></div>
          <div className="py-3 px-4 border-b border-outline" />
          <div className="py-3 border-b border-outline" />

          {/* LOADING */}
          {loading && Array.from({ length: 10 }).map((_, i) => (
            <React.Fragment key={`sk-${i}`}>
              <div className="py-3 pl-4 border-b border-outline/30 flex items-center"><div className="w-4 h-4 bg-surface-tertiary rounded animate-pulse" /></div>
              <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-24 bg-surface-tertiary rounded animate-pulse" /></div>
              <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-20 bg-surface-tertiary rounded animate-pulse" /></div>
              <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-20 bg-surface-tertiary rounded animate-pulse" /></div>
              <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-16 bg-surface-tertiary rounded animate-pulse" /></div>
              <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-14 bg-surface-tertiary rounded animate-pulse" /></div>
              <div className="py-3 px-4 border-b border-outline/30" />
              <div className="py-3 border-b border-outline/30" />
            </React.Fragment>
          ))}

          {/* EMPTY */}
          {!loading && jobs.length === 0 && (
            <div className="col-span-8 py-20 text-center text-[14px] text-text-tertiary">{t.jobs.noJobsFound}</div>
          )}

          {/* ROWS */}
          {!loading && jobs.map(job => {
            const rowCls = `border-b border-outline/30 transition-colors ${selectedJobIds.has(job.id) ? 'bg-[#f0f4ff]' : 'hover:bg-surface-secondary'}`;
            const click = () => handleJobClick(job);
            return (
              <React.Fragment key={job.id}>
                <div className={`py-3 pl-4 flex items-center ${rowCls}`} onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={selectedJobIds.has(job.id)} onChange={() => toggleOne(job.id)} className="rounded-[3px] border-outline w-4 h-4 accent-primary cursor-pointer" />
                </div>
                <div className={`py-3 px-4 flex items-center min-w-0 cursor-pointer ${rowCls}`} onClick={click}>
                  <div className="flex items-center gap-3 min-w-0">
                    <UnifiedAvatar id={job.client_id || job.id} name={job.client_name || job.title} />
                    <span className="text-[14px] text-text-primary truncate">{job.title}</span>
                  </div>
                </div>
                <div className={`py-3 px-4 flex items-center overflow-hidden cursor-pointer ${rowCls}`} onClick={click}><span className="text-[14px] text-text-primary truncate">{job.client_name || '—'}</span></div>
                <div className={`py-3 px-4 flex items-center overflow-hidden cursor-pointer ${rowCls}`} onClick={click}><span className="text-[14px] text-text-primary tabular-nums truncate">{job.scheduled_at ? formatDate(job.scheduled_at) : (fr ? 'Non planifié' : 'Unscheduled')}</span></div>
                <div className={`py-3 px-4 flex items-center overflow-hidden cursor-pointer ${rowCls}`} onClick={click}><span className="text-[14px] font-semibold text-text-primary tabular-nums">{formatMoney(job)}</span></div>
                <div className={`py-3 px-4 flex items-center cursor-pointer ${rowCls}`} onClick={click}><JobBadge status={job.status} /></div>
                <div className={`py-3 px-4 flex items-center justify-end gap-1 ${rowCls}`}>
                  <button onClick={(e) => { e.stopPropagation(); handleEditJob(job); }} className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors">
                    <Edit2 size={14} />
                  </button>
                </div>
                <div className={`py-3 pr-4 flex items-center justify-center ${rowCls}`}>
                  <button className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors" onClick={e => { e.stopPropagation(); setJobToDelete(job); }}>
                    {IconDots}
                  </button>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* ── FOOTER ── */}
      <div className="flex items-center justify-between mt-3">
        <span className="text-[14px] text-text-secondary">{selectedJobIds.size} of {total} row(s) selected.</span>
        <div className="flex items-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}
            className="h-9 px-4 bg-surface border border-outline rounded-md text-[14px] text-text-primary font-normal disabled:opacity-40 disabled:cursor-default hover:bg-surface-secondary transition-colors cursor-pointer">Previous</button>
          <button disabled={page >= pageCount} onClick={() => setPage(p => Math.min(pageCount, p + 1))}
            className="h-9 px-4 bg-surface border border-outline rounded-md text-[14px] text-text-primary font-normal disabled:opacity-40 disabled:cursor-default hover:bg-surface-secondary transition-colors cursor-pointer">Next</button>
        </div>
      </div>

      {/* Delete confirmation modal */}
      <AnimatePresence>
        {jobToDelete && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => !isDeletingJob && setJobToDelete(null)}>
            <motion.div
              className="bg-surface rounded-2xl border border-outline/40 shadow-2xl max-w-sm w-full mx-4"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <h3 className="text-[15px] font-bold text-text-primary">{t.jobs.deleteThisJob}</h3>
                <p className="mt-2 text-[13px] text-text-secondary leading-relaxed">
                  {t.jobs.deletingJobMsg.replace('{number}', String(jobToDelete.job_number))}
                </p>
                <div className="mt-5 flex justify-end gap-3">
                  <button className="glass-button" onClick={() => setJobToDelete(null)} disabled={isDeletingJob}>
                    {t.common.cancel}
                  </button>
                  <button className="glass-button-danger" onClick={() => void handleDeleteJob()} disabled={isDeletingJob}>
                    {isDeletingJob ? t.common.deleting : t.common.delete}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <TeamsManagerModal isOpen={isTeamsManagerOpen} onClose={() => setIsTeamsManagerOpen(false)} />

      {/* Bulk actions */}
      <AnimatePresence>
        {selectedJobIds.size > 0 && (
          <BulkActionBar
            count={selectedJobIds.size}
            actions={[
              { id: 'schedule', label: 'Schedule', icon: Calendar, variant: 'default' as any },
              { id: 'in_progress', label: 'In Progress', icon: Clock, variant: 'default' as any },
              { id: 'complete', label: t.jobs?.markComplete || 'Complete', icon: Briefcase, variant: 'primary' },
              { id: 'delete', label: t.common.delete, icon: Trash2, variant: 'danger' },
            ]}
            onAction={async (actionId) => {
              const ids = Array.from(selectedJobIds);
              if (actionId === 'delete') {
                if (!window.confirm(`Delete ${ids.length} jobs?`)) return;
                let deleteFailed = 0;
                for (const jid of ids) { await softDeleteJob(String(jid)).catch(() => { deleteFailed++; }); }
                setJobs((prev) => prev.filter((j) => !selectedJobIds.has(j.id)));
                if (deleteFailed > 0) toast.error(`${deleteFailed} job(s) failed to delete`);
                else toast.success(`${ids.length} jobs deleted`);
              }
              if (actionId === 'complete' || actionId === 'in_progress' || actionId === 'schedule') {
                const statusMap: Record<string, string> = { complete: 'completed', in_progress: 'in_progress', schedule: 'scheduled' };
                const newStatus = statusMap[actionId] || 'completed';
                let updateFailed = 0;
                for (const jid of ids) {
                  const { error: updateErr } = await supabase.from('jobs').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', jid);
                  if (updateErr) updateFailed++;
                }
                setJobs((prev) => prev.map((j) => selectedJobIds.has(j.id) ? { ...j, status: newStatus } : j));
                if (updateFailed > 0) toast.error(`${updateFailed}/${ids.length} job(s) failed to update`);
                else toast.success(`${ids.length} jobs updated to ${newStatus}`);
              }
              setSelectedJobIds(new Set());
            }}
            onClear={() => setSelectedJobIds(new Set())}
            language={language}
          />
        )}
      </AnimatePresence>
    </>
  );
}
