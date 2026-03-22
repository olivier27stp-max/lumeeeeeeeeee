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
import { useTranslation } from '../i18n';
import { supabase } from '../lib/supabase';
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
        'inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all whitespace-nowrap',
        active
          ? 'bg-text-primary text-surface shadow-sm'
          : 'bg-surface-secondary/60 text-text-secondary hover:bg-surface-secondary hover:text-text-primary'
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', color)} />
      {label}
      <span className={cn('font-bold tabular-nums', active ? 'text-surface' : 'text-text-primary')}>
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
      className="w-full text-left rounded-xl bg-surface border border-outline-subtle/60 p-4 hover:border-primary/30 hover:shadow-md transition-all group relative"
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
            className="p-1 rounded-md text-text-tertiary hover:text-danger hover:bg-danger/10 opacity-0 group-hover:opacity-100 transition-all"
          >
            <Trash2 size={12} />
          </button>
        </div>

        {/* Title */}
        <h3 className="text-[14px] font-semibold text-text-primary leading-snug mb-1.5 group-hover:text-primary transition-colors line-clamp-1">
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
        <div className="flex items-center justify-between pt-2 border-t border-outline-subtle/50">
          <span className="text-[11px] text-text-tertiary flex items-center gap-1">
            <Calendar size={10} />
            {job.scheduled_at ? formatDate(job.scheduled_at) : 'Unscheduled'}
          </span>
          <span className="text-[13px] font-bold text-text-primary tabular-nums">
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
      className="w-[420px] shrink-0 h-full border-l border-outline-subtle bg-surface overflow-y-auto"
    >
      {/* Header */}
      <div className="sticky top-0 bg-surface z-10 px-5 py-4 border-b border-outline-subtle/60">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className={cn('w-2.5 h-2.5 rounded-full', statusColor(job.status))} />
            <span className="text-[11px] font-bold text-text-tertiary tabular-nums">#{job.job_number}</span>
            <StatusBadge status={job.status} />
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onEdit} className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors">
              <Edit2 size={13} />
            </button>
            <button onClick={onClose} className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors">
              <X size={14} />
            </button>
          </div>
        </div>
        <h2 className="text-[17px] font-bold text-text-primary mt-2 leading-snug">{job.title}</h2>
      </div>

      <div className="px-5 py-4 space-y-5">
        {/* Amount card */}
        <div className="rounded-xl bg-surface-secondary/80 p-4">
          <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider mb-1">Total Value</p>
          <p className="text-[24px] font-bold text-text-primary tabular-nums">{formatMoney(job)}</p>
        </div>

        {/* Client */}
        <div>
          <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider mb-2.5">Client</p>
          <div className="space-y-2">
            {job.client_name && (
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-text-primary text-surface flex items-center justify-center text-[11px] font-bold shrink-0">
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
            <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider mb-2.5">Property</p>
            <div className="flex items-start gap-2.5 rounded-lg bg-surface-secondary/60 p-3">
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
          <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider mb-2.5">Schedule</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-surface-secondary/60 p-3">
              <p className="text-[10px] font-medium text-text-tertiary uppercase mb-1">Date</p>
              <p className="text-[13px] font-semibold text-text-primary">
                {job.scheduled_at ? formatDate(job.scheduled_at) : 'Unscheduled'}
              </p>
            </div>
            <div className="rounded-lg bg-surface-secondary/60 p-3">
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
          <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider mb-2.5">Details</p>
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
            <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider mb-2.5">Notes</p>
            <div className="rounded-lg bg-surface-secondary/60 p-3">
              <p className="text-[13px] text-text-secondary leading-relaxed whitespace-pre-wrap">{job.notes}</p>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="sticky bottom-0 bg-surface px-5 py-3 border-t border-outline-subtle/60 flex items-center justify-between">
        <button
          onClick={onDelete}
          className="text-[12px] font-medium text-danger hover:text-danger flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-danger/10 transition-colors"
        >
          <Trash2 size={12} /> Delete
        </button>
        <button
          onClick={onEdit}
          className="glass-button-primary !text-[12px] !px-3.5 inline-flex items-center gap-1.5"
        >
          <Edit2 size={12} /> Edit Job
        </button>
      </div>
    </motion.div>
  );
}

// ─── Main Component ──────────────────────────────────────────────
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
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
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
      toast.success(t.jobs.jobDeleted);
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

  return (
    <>
      <div className="h-full flex flex-col">
        {/* ═══ HEADER ═══ */}
        <div className="flex items-center justify-between px-1 pb-4">
          <div className="flex items-center gap-3">
            <h1 className="text-[20px] font-bold text-text-primary tracking-tight">{t.jobs.title}</h1>
            <span className="text-[12px] font-medium text-text-tertiary bg-surface-secondary rounded-md px-2 py-0.5 tabular-nums">
              {total}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setIsTeamsManagerOpen(true)} className="glass-button !text-[12px] inline-flex items-center gap-1.5">
              <Users size={13} /> {t.jobs.teams}
            </button>
            <button
              onClick={() => openJobModal({
                sourceContext: { type: 'jobs' },
                onCreated: async () => { await Promise.all([loadJobs(), loadKpis()]); },
              })}
              className="glass-button-primary !text-[12px] inline-flex items-center gap-1.5"
            >
              <Plus size={13} /> {t.jobs.newJob}
            </button>
            <div className="relative">
              <button onClick={() => setShowMoreActions((prev) => !prev)} className="glass-button !px-2">
                <MoreHorizontal size={14} />
              </button>
              <AnimatePresence>
                {showMoreActions && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowMoreActions(false)} />
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                      className="absolute right-0 mt-1 w-44 z-50 rounded-lg border border-outline bg-surface shadow-lg py-1"
                    >
                      <button onClick={handleExportCsv} className="w-full px-3 py-2 text-[13px] text-text-primary hover:bg-surface-secondary flex items-center gap-2 text-left">
                        <Download size={13} /> {t.jobs.exportCsv}
                      </button>
                      <button
                        onClick={() => { void Promise.all([loadJobs(), loadKpis()]); setShowMoreActions(false); }}
                        className="w-full px-3 py-2 text-[13px] text-text-primary hover:bg-surface-secondary text-left"
                      >
                        {t.common.refresh}
                      </button>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* ═══ STAT CHIPS ═══ */}
        <div className="flex items-center gap-2 px-1 pb-4 overflow-x-auto">
          {overviewBullets.map((item) => (
            <StatChip
              key={item.key}
              label={item.label}
              value={kpiLoading ? '--' : (kpis?.[item.key] ?? 0)}
              color={item.color}
              active={statusFilter === item.filter}
              onClick={() => {
                setStatusFilter(statusFilter === item.filter ? 'All' : item.filter);
                setPage(1);
              }}
            />
          ))}
          {statusFilter !== 'All' && (
            <button
              onClick={() => { setStatusFilter('All'); setPage(1); }}
              className="text-[11px] text-text-tertiary hover:text-text-primary flex items-center gap-1 ml-1"
            >
              <X size={11} /> Clear
            </button>
          )}
        </div>

        {/* ═══ TOOLBAR ═══ */}
        <div className="flex items-center justify-between gap-3 px-1 pb-4">
          <div className="flex items-center gap-2 flex-1">
            {/* Search */}
            <div className="relative flex-1 max-w-sm">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.jobs.searchJobs}
                className="w-full bg-surface-secondary/60 border border-outline-subtle/60 rounded-lg pl-8 pr-3 py-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-primary/40 focus:bg-surface transition-colors"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary">
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Type filter */}
            {jobTypes.length > 0 && (
              <select
                value={jobTypeFilter}
                onChange={(e) => { setJobTypeFilter(e.target.value); setPage(1); }}
                className="bg-surface-secondary/60 border border-outline-subtle/60 rounded-lg px-3 py-2 text-[13px] text-text-primary focus:outline-none focus:border-primary/40 cursor-pointer"
              >
                <option value="All">{t.common.allTypes}</option>
                {jobTypes.map((jt) => <option key={jt} value={jt}>{jt}</option>)}
              </select>
            )}

            {/* Sort */}
            <select
              value={`${sortBy}-${sortDirection}`}
              onChange={(e) => {
                const [s, d] = e.target.value.split('-');
                setSortBy(s as JobSort);
                setSortDirection(d as JobSortDirection);
                setPage(1);
              }}
              className="bg-surface-secondary/60 border border-outline-subtle/60 rounded-lg px-3 py-2 text-[13px] text-text-primary focus:outline-none focus:border-primary/40 cursor-pointer"
            >
              <option value="schedule-asc">Schedule (earliest)</option>
              <option value="schedule-desc">Schedule (latest)</option>
              <option value="client-asc">Client A-Z</option>
              <option value="client-desc">Client Z-A</option>
              <option value="total-desc">Amount (high)</option>
              <option value="total-asc">Amount (low)</option>
              <option value="job_number-desc">Newest first</option>
              <option value="job_number-asc">Oldest first</option>
            </select>
          </div>

          {/* View toggle */}
          <div className="flex items-center rounded-lg border border-outline-subtle/60 overflow-hidden">
            <button
              onClick={() => setViewMode('grid')}
              className={cn(
                'p-2 transition-colors',
                viewMode === 'grid' ? 'bg-text-primary text-surface' : 'bg-surface-secondary/60 text-text-tertiary hover:text-text-primary'
              )}
            >
              <LayoutGrid size={14} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={cn(
                'p-2 transition-colors',
                viewMode === 'list' ? 'bg-text-primary text-surface' : 'bg-surface-secondary/60 text-text-tertiary hover:text-text-primary'
              )}
            >
              <List size={14} />
            </button>
          </div>
        </div>

        {/* ═══ MAIN CONTENT (with optional preview panel) ═══ */}
        <div className="flex-1 flex min-h-0 overflow-hidden rounded-xl border border-outline-subtle/40">
          {/* Jobs area */}
          <div className="flex-1 overflow-y-auto">
            {/* Loading */}
            {loading && (
              <div className="p-5">
                <div className={cn(
                  viewMode === 'grid'
                    ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3'
                    : 'space-y-1'
                )}>
                  {Array.from({ length: 9 }).map((_, i) => (
                    <div key={i} className="rounded-xl bg-surface-secondary/40 animate-pulse h-[140px]" />
                  ))}
                </div>
              </div>
            )}

            {/* Error */}
            {!loading && error && (
              <div className="flex items-center justify-center h-48">
                <div className="text-center">
                  <AlertCircle size={24} className="text-danger mx-auto mb-2" />
                  <p className="text-[13px] text-danger">{error}</p>
                </div>
              </div>
            )}

            {/* Empty */}
            {!loading && !error && jobs.length === 0 && (
              <div className="flex items-center justify-center h-48">
                <div className="text-center">
                  <Briefcase size={28} className="text-text-tertiary mx-auto mb-3 opacity-40" />
                  <p className="text-[14px] font-medium text-text-secondary">{t.jobs.noJobsFound}</p>
                  <p className="text-[12px] text-text-tertiary mt-1">{t.jobs.adjustFilters}</p>
                </div>
              </div>
            )}

            {/* Grid view */}
            {!loading && !error && jobs.length > 0 && viewMode === 'grid' && (
              <div className="p-4">
                <AnimatePresence mode="popLayout">
                  <div className={cn(
                    'grid gap-3',
                    selectedJob
                      ? 'grid-cols-1 md:grid-cols-2'
                      : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
                  )}>
                    {jobs.map((job) => (
                      <JobCard
                        key={job.id}
                        job={job}
                        onClick={() => handleJobClick(job)}
                        onDelete={(e) => { e.stopPropagation(); setJobToDelete(job); }}
                        formatMoney={formatMoney}
                      />
                    ))}
                  </div>
                </AnimatePresence>
              </div>
            )}

            {/* List view */}
            {!loading && !error && jobs.length > 0 && viewMode === 'list' && (
              <div className="space-y-2">
                {jobs.map((job) => (
                  <button
                    key={job.id}
                    onClick={() => handleJobClick(job)}
                    className={cn(
                      'w-full flex items-center gap-4 px-5 py-3.5 text-left rounded-xl bg-surface border border-outline-subtle/60 hover:border-primary/30 hover:shadow-md transition-all group relative',
                      selectedJob?.id === job.id && 'border-primary/40 shadow-sm'
                    )}
                  >
                    <div className={cn('absolute left-0 top-3 bottom-3 w-[3px] rounded-full', statusColor(job.status))} />
                    <div className="flex-1 min-w-0 pl-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold text-text-tertiary tabular-nums">#{job.job_number}</span>
                        <span className="text-[13px] font-semibold text-text-primary truncate">{job.title}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        {job.client_name && (
                          <span className="text-[12px] text-text-tertiary truncate">{job.client_name}</span>
                        )}
                        {job.property_address && (
                          <span className="text-[11px] text-text-tertiary truncate flex items-center gap-1">
                            <MapPin size={9} /> {job.property_address}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[13px] font-bold text-text-primary tabular-nums">{formatMoney(job)}</p>
                      <p className="text-[11px] text-text-tertiary">
                        {job.scheduled_at ? formatDate(job.scheduled_at) : 'Unscheduled'}
                      </p>
                    </div>
                    <StatusBadge status={job.status} />
                    <button
                      onClick={(e) => { e.stopPropagation(); setJobToDelete(job); }}
                      className="p-1 rounded-md text-text-tertiary hover:text-danger hover:bg-danger/10 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 size={12} />
                    </button>
                  </button>
                ))}
              </div>
            )}

            {/* Pagination */}
            {!loading && !error && total > 0 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-outline-subtle/30">
                <p className="text-[11px] text-text-tertiary">
                  {t.common.page} {page} {t.common.of} {pageCount} <span className="ml-2 text-text-tertiary">({total} jobs)</span>
                </p>
                <div className="flex items-center gap-2">
                  <select
                    value={pageSize}
                    onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                    className="bg-surface-secondary/60 border border-outline-subtle/60 rounded-md px-2 py-1 text-[11px] text-text-primary focus:outline-none cursor-pointer"
                  >
                    {[10, 20, 30, 50].map((size) => (
                      <option key={size} value={size}>{size} / page</option>
                    ))}
                  </select>
                  <button className="p-1.5 rounded-md bg-surface-secondary/60 text-text-tertiary hover:text-text-primary disabled:opacity-30" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    <ChevronLeft size={13} />
                  </button>
                  <button className="p-1.5 rounded-md bg-surface-secondary/60 text-text-tertiary hover:text-text-primary disabled:opacity-30" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
                    <ChevronRight size={13} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Preview panel */}
          <AnimatePresence>
            {selectedJob && (
              <JobPreviewPanel
                job={selectedJob}
                onClose={() => setSelectedJob(null)}
                onEdit={() => handleEditJob(selectedJob)}
                onDelete={() => { setJobToDelete(selectedJob); }}
                formatMoney={formatMoney}
              />
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Delete confirmation modal */}
      <AnimatePresence>
        {jobToDelete && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => !isDeletingJob && setJobToDelete(null)}>
            <motion.div
              className="bg-surface rounded-xl border border-outline shadow-2xl max-w-sm w-full mx-4"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-5">
                <h3 className="text-[15px] font-semibold text-text-primary">{t.jobs.deleteThisJob}</h3>
                <p className="mt-2 text-[13px] text-text-secondary">
                  {t.jobs.deletingJobMsg.replace('{number}', String(jobToDelete.job_number))}
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <button className="glass-button !text-[12px]" onClick={() => setJobToDelete(null)} disabled={isDeletingJob}>
                    {t.common.cancel}
                  </button>
                  <button className="glass-button-danger !text-[12px]" onClick={() => void handleDeleteJob()} disabled={isDeletingJob}>
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
              { id: 'complete', label: t.jobs?.markComplete || 'Complete', icon: Briefcase, variant: 'primary' },
              { id: 'delete', label: t.common.delete, icon: Trash2, variant: 'danger' },
            ]}
            onAction={async (actionId) => {
              const ids = Array.from(selectedJobIds);
              if (actionId === 'delete') {
                if (!window.confirm(`Delete ${ids.length} jobs?`)) return;
                for (const jid of ids) { await softDeleteJob(String(jid)).catch(() => {}); }
                setJobs((prev) => prev.filter((j) => !selectedJobIds.has(j.id)));
                toast.success(`${ids.length} jobs deleted`);
              }
              if (actionId === 'complete') {
                for (const jid of ids) {
                  await supabase.from('jobs').update({ status: 'completed', updated_at: new Date().toISOString() }).eq('id', jid).then(() => {});
                }
                setJobs((prev) => prev.map((j) => selectedJobIds.has(j.id) ? { ...j, status: 'completed' } : j));
                toast.success(`${ids.length} jobs completed`);
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
