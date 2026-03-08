import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpDown,
  ArrowUpRight,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  Download,
  MoreHorizontal,
  Plus,
  Trash2,
  X,
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
import { PageHeader, StatCard, EmptyState } from '../components/ui';
import { FilterSelect } from '../components/ui/FilterBar';
import StatusBadge from '../components/ui/StatusBadge';

const STATUS_FILTERS = [
  'All',
  'Late',
  'Unscheduled',
  'Requires Invoicing',
  'Action Required',
  'Ending within 30 days',
];

const COLUMN_CONFIG: Array<{
  key: JobSort;
  label: string;
  className?: string;
}> = [
  { key: 'client', label: 'Client' },
  { key: 'job_number', label: 'Job number' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'status', label: 'Status' },
  { key: 'total', label: 'Total', className: 'text-right' },
];

const overviewBullets = [
  { label: 'Ending within 30 days', key: 'ending_within_30', dot: 'bg-danger' },
  { label: 'Late', key: 'late', dot: 'bg-danger' },
  { label: 'Requires Invoicing', key: 'requires_invoicing', dot: 'bg-warning' },
  { label: 'Action Required', key: 'action_required', dot: 'bg-warning' },
  { label: 'Unscheduled', key: 'unscheduled', dot: 'bg-warning' },
] as const;

export default function Jobs() {
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
  const [pageSize, setPageSize] = useState(10);
  const [jobTypes, setJobTypes] = useState<string[]>([]);
  const [showMoreActions, setShowMoreActions] = useState(false);
  const [isTeamsManagerOpen, setIsTeamsManagerOpen] = useState(false);
  const [jobToDelete, setJobToDelete] = useState<Job | null>(null);
  const [isDeletingJob, setIsDeletingJob] = useState(false);
  const { openJobModal } = useJobModalController();

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadJobs = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getJobs({
        status: statusFilter,
        jobType: jobTypeFilter,
        q: debouncedQuery,
        sort: sortBy,
        sortDirection,
        page,
        pageSize,
      });
      setJobs(result.jobs);
      setTotal(result.total);
    } catch (err: any) {
      setError(err.message || 'Failed to load jobs.');
    } finally {
      setLoading(false);
    }
  };

  const loadKpis = async () => {
    setKpiLoading(true);
    try {
      const result = await getJobsKpis({
        status: statusFilter,
        jobType: jobTypeFilter,
        q: debouncedQuery,
      });
      setKpis(result);
    } catch {
      setKpis(null);
    } finally {
      setKpiLoading(false);
    }
  };

  useEffect(() => {
    getJobTypes()
      .then(setJobTypes)
      .catch(() => setJobTypes([]));
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [statusFilter, jobTypeFilter, debouncedQuery, sortBy, sortDirection, page, pageSize]);

  useEffect(() => {
    void loadKpis();
  }, [statusFilter, jobTypeFilter, debouncedQuery]);

  const trends = useMemo(() => {
    if (!kpis) return { recent: 0, scheduled: 0 };

    const calcTrend = (current: number, previous: number) => {
      if (!previous && current > 0) return 100;
      if (!previous) return 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    return {
      recent: calcTrend(kpis.recent_visits, kpis.recent_visits_prev),
      scheduled: calcTrend(kpis.visits_scheduled, kpis.visits_scheduled_prev),
    };
  }, [kpis]);

  const handleSort = (key: JobSort) => {
    setPage(1);
    if (sortBy === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortBy(key);
    setSortDirection(key === 'total' ? 'desc' : 'asc');
  };

  const handleExportCsv = async () => {
    try {
      const csv = await exportJobsCsv({
        status: statusFilter,
        jobType: jobTypeFilter,
        q: debouncedQuery,
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `jobs-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setShowMoreActions(false);
    } catch (err: any) {
      setError(err.message || 'Failed to export CSV.');
      toast.error(err.message || 'Failed to export CSV.');
    }
  };

  const formatMoney = (job: Job) => {
    const amount = Math.round(job.total_cents / 100);
    if (!job.currency || job.currency === 'USD') {
      return formatCurrency(amount);
    }
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: job.currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const handleDeleteJob = async () => {
    if (!jobToDelete || isDeletingJob) return;
    setIsDeletingJob(true);
    try {
      const result = await softDeleteJob(jobToDelete.id);
      if (result.job < 1) {
        toast.error('Job not found or already deleted.');
        return;
      }
      setJobs((prev) => prev.filter((job) => job.id !== jobToDelete.id));
      setTotal((prev) => Math.max(0, prev - 1));
      setJobToDelete(null);
      await Promise.all([loadJobs(), loadKpis()]);
      toast.success('Job deleted.');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete job.');
    } finally {
      setIsDeletingJob(false);
    }
  };

  return (
    <>
      <div className="space-y-5">
        <PageHeader title="Jobs" subtitle={`${total} total`} icon={Briefcase} iconColor="amber">
          <div className="flex items-center gap-2">
            <button onClick={() => setIsTeamsManagerOpen(true)} className="glass-button inline-flex items-center gap-1.5">
              <Plus size={14} />
              Teams
            </button>
            <button
              onClick={() =>
                openJobModal({
                  sourceContext: { type: 'jobs' },
                  onCreated: async () => {
                    await Promise.all([loadJobs(), loadKpis()]);
                  },
                })
              }
              className="glass-button-primary inline-flex items-center gap-1.5"
            >
              <Plus size={14} />
              New Job
            </button>
            <div className="relative">
              <button onClick={() => setShowMoreActions((prev) => !prev)} className="glass-button inline-flex items-center gap-1.5">
                <MoreHorizontal size={14} />
              </button>
              <AnimatePresence>
                {showMoreActions && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    className="dropdown-menu absolute right-0 mt-1 w-48"
                  >
                    <button onClick={handleExportCsv} className="dropdown-item flex items-center gap-2">
                      <Download size={13} />
                      Export CSV
                    </button>
                    <button
                      onClick={() => {
                        void Promise.all([loadJobs(), loadKpis()]);
                        setShowMoreActions(false);
                      }}
                      className="dropdown-item"
                    >
                      Refresh data
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </PageHeader>

        {/* KPIs */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
          <div className="section-card p-4">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mb-3">Overview</h3>
            <div className="space-y-1.5">
              {overviewBullets.map((item) => (
                <div key={item.label} className="flex items-center gap-2 text-[13px] text-text-secondary">
                  <span className={cn('h-2 w-2 rounded-full shrink-0', item.dot)} />
                  <span>{item.label}</span>
                  <span className="ml-auto font-semibold text-text-primary tabular-nums">
                    {kpiLoading ? '--' : (kpis?.[item.key] ?? 0)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <StatCard
            label="Recent visits"
            subtitle="Past 30 days"
            value={kpiLoading ? '--' : (kpis?.recent_visits ?? 0)}
            trend={trends.recent}
            iconColor="green"
          />

          <StatCard
            label="Visits scheduled"
            subtitle="Next 30 days"
            value={kpiLoading ? '--' : (kpis?.visits_scheduled ?? 0)}
            trend={trends.scheduled}
            iconColor="blue"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              value={statusFilter}
              onChange={(v) => { setStatusFilter(v); setPage(1); }}
              options={STATUS_FILTERS.map((s) => ({ value: s, label: s }))}
            />
            <FilterSelect
              value={jobTypeFilter}
              onChange={(v) => { setJobTypeFilter(v); setPage(1); }}
              options={[{ value: 'All', label: 'All types' }, ...jobTypes.map((t) => ({ value: t, label: t }))]}
            />
          </div>
          <div className="relative w-full max-w-xs">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search jobs..."
              className="glass-input w-full"
            />
          </div>
        </div>

        {/* Table */}
        <div className="section-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                    <button onClick={() => handleSort('client')} className="inline-flex items-center gap-1">
                      Client <ArrowUpDown size={12} className="text-text-tertiary" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                    <button onClick={() => handleSort('job_number')} className="inline-flex items-center gap-1">
                      Job # <ArrowUpDown size={12} className="text-text-tertiary" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Property</th>
                  {COLUMN_CONFIG.filter((c) => ['schedule', 'status', 'total'].includes(c.key)).map((col) => (
                    <th key={col.key} className={cn('px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary', col.className)}>
                      <button onClick={() => handleSort(col.key)} className={cn('inline-flex items-center gap-1', col.className)}>
                        {col.label} <ArrowUpDown size={12} className="text-text-tertiary" />
                      </button>
                    </th>
                  ))}
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading &&
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={`sk-${i}`} className="border-b border-border">
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} className="px-4 py-3"><div className="skeleton h-4 w-full max-w-[120px]" /></td>
                      ))}
                    </tr>
                  ))}

                {!loading && error && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-danger text-[13px]">{error}</td>
                  </tr>
                )}

                {!loading && !error && jobs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10">
                      <EmptyState icon={Briefcase} title="No jobs found" description="Adjust filters or create a new job." />
                    </td>
                  </tr>
                )}

                {!loading &&
                  !error &&
                  jobs.map((job) => (
                    <tr
                      key={job.id}
                      className="table-row-hover cursor-pointer"
                      onClick={() =>
                        openJobModal({
                          jobId: job.id,
                          sourceContext: { type: 'jobs' },
                          onCreated: async () => {
                            await Promise.all([loadJobs(), loadKpis()]);
                          },
                        })
                      }
                    >
                      <td className="px-4 py-3 text-[13px] font-medium text-text-primary">{job.client_name || '--'}</td>
                      <td className="px-4 py-3">
                        <p className="text-[13px] font-medium text-text-primary">#{job.job_number}</p>
                        <p className="text-xs text-text-tertiary">{job.title}</p>
                      </td>
                      <td className="px-4 py-3 text-[13px] text-text-secondary">{job.property_address || '--'}</td>
                      <td className="px-4 py-3 text-[13px] text-text-secondary tabular-nums">
                        {job.scheduled_at ? formatDate(job.scheduled_at) : '--'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={job.status} />
                      </td>
                      <td className="px-4 py-3 text-right text-[13px] font-medium text-text-primary tabular-nums">{formatMoney(job)}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setJobToDelete(job);
                          }}
                          className="p-1.5 text-text-tertiary hover:text-danger hover:bg-danger-light rounded transition-all opacity-0 group-hover:opacity-100"
                          aria-label={`Delete job ${job.job_number}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <p className="text-xs text-text-tertiary">
              Page {page} of {pageCount}
            </p>
            <div className="flex items-center gap-2">
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="glass-input !py-1 text-xs"
              >
                {[10, 20, 30, 50].map((size) => (
                  <option key={size} value={size}>
                    {size} / page
                  </option>
                ))}
              </select>
              <button className="glass-button !px-2" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                <ChevronLeft size={14} />
              </button>
              <button className="glass-button !px-2" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Delete confirmation */}
      <AnimatePresence>
        {jobToDelete && (
          <div className="modal-overlay" onClick={() => !isDeletingJob && setJobToDelete(null)}>
            <motion.div
              className="modal-content max-w-md"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[15px] font-semibold text-text-primary">Delete this job?</h3>
                  <button className="p-1 rounded hover:bg-surface-secondary" onClick={() => !isDeletingJob && setJobToDelete(null)}>
                    <X size={14} className="text-text-tertiary" />
                  </button>
                </div>
                <p className="mt-3 text-[13px] text-text-secondary">
                  You are deleting job <strong>#{jobToDelete.job_number}</strong>. This will hide it from active views.
                </p>
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-warning-light px-3 py-1.5 text-xs text-warning">
                  Only owner/admin can perform this action.
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button className="glass-button" onClick={() => setJobToDelete(null)} disabled={isDeletingJob}>
                    Cancel
                  </button>
                  <button className="glass-button-danger" onClick={() => void handleDeleteJob()} disabled={isDeletingJob}>
                    {isDeletingJob ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <TeamsManagerModal isOpen={isTeamsManagerOpen} onClose={() => setIsTeamsManagerOpen(false)} />
    </>
  );
}
