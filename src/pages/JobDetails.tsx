import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, Link as LinkIcon, Save, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { formatCurrency, formatDate } from '../lib/utils';
import { getJobById, updateJob } from '../lib/jobsApi';
import { createInvoiceFromJob } from '../lib/invoicesApi';
import { Job } from '../types';
import { PageHeader } from '../components/ui';
import StatusBadge from '../components/ui/StatusBadge';

const STATUS_OPTIONS = [
  'Draft',
  'Scheduled',
  'In Progress',
  'Completed',
  'Cancelled',
];

/* Status pill styling now handled by <StatusBadge /> component */

export default function JobDetails() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showInvoicePrompt, setShowInvoicePrompt] = useState(false);
  const [isInvoiceActionLoading, setIsInvoiceActionLoading] = useState(false);
  const [invoiceReadyId, setInvoiceReadyId] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('Draft');
  const [scheduledAt, setScheduledAt] = useState('');
  const [total, setTotal] = useState('');
  const [address, setAddress] = useState('');
  const [jobType, setJobType] = useState('');

  const toStatusSlug = (value: string | null | undefined) => String(value || '').trim().toLowerCase().replace(/\s+/g, '_');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getJobById(id)
      .then((data) => {
        if (!data) {
          setError('Job not found');
          return;
        }
        setJob(data);
        setTitle(data.title);
        setStatus(data.status || 'Draft');
        setScheduledAt(data.scheduled_at ? new Date(data.scheduled_at).toISOString().slice(0, 16) : '');
        setTotal((data.total_cents / 100).toFixed(2));
        setAddress(data.property_address);
        setJobType(data.job_type || '');
      })
      .catch((err) => setError(err.message || 'Failed to load job'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleSave = async () => {
    if (!job) return;
    setIsSaving(true);
    try {
      const wasCompleted = toStatusSlug(job.status) === 'completed';
      const nextCompleted = toStatusSlug(status) === 'completed';
      const totalCents = Math.round(Number(total || 0) * 100);
      const updated = await updateJob(job.id, {
        title: title.trim(),
        status,
        scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        total_cents: totalCents,
        property_address: address.trim(),
        job_type: jobType.trim() || null,
      });
      setJob(updated);
      if (!wasCompleted && nextCompleted) {
        const created = await createInvoiceFromJob({ jobId: job.id, sendNow: false });
        const readyId = String(created.invoice_id || created.invoice?.id || '').trim() || null;
        setInvoiceReadyId(readyId);
        toast.success(created.already_exists ? 'Invoice already exists for this completed job.' : 'Invoice draft created automatically.');
        setShowInvoicePrompt(true);
      } else {
        toast.success('Job updated.');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to update job');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateInvoiceFromCompletedJob = async (sendNow: boolean) => {
    if (!job || isInvoiceActionLoading) return;
    setIsInvoiceActionLoading(true);
    try {
      const result = await createInvoiceFromJob({
        jobId: job.id,
        sendNow,
      });

      const invoiceId = String(result.invoice_id || result.invoice?.id || '').trim();
      if (!invoiceId) throw new Error('Invoice created but missing invoice id.');

      queryClient.invalidateQueries({ queryKey: ['invoicesKpis30d'] });
      queryClient.invalidateQueries({ queryKey: ['invoicesTable'] });
      queryClient.invalidateQueries({ queryKey: ['jobsTable'] });
      queryClient.invalidateQueries({ queryKey: ['jobsKpis'] });
      queryClient.invalidateQueries({ queryKey: ['insightsOverview'] });
      queryClient.invalidateQueries({ queryKey: ['insightsRevenueSeries'] });
      queryClient.invalidateQueries({ queryKey: ['insightsInvoicesSummary'] });

      if (sendNow) {
        toast.success(result.already_exists ? 'Existing invoice sent via email workflow.' : 'Invoice sent via email workflow.');
      } else {
        toast.info('SMS provider not configured. Opening invoice so you can copy payment link.');
      }
      setShowInvoicePrompt(false);
      navigate(`/invoices/${invoiceId}`);
    } catch (err: any) {
      toast.error(err?.message || 'Unable to create invoice from this job.');
    } finally {
      setIsInvoiceActionLoading(false);
    }
  };

  const formatMoney = (jobItem: Job) => {
    const amount = Math.round(jobItem.total_cents / 100);
    if (!jobItem.currency || jobItem.currency === 'USD') {
      return formatCurrency(amount);
    }
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: jobItem.currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  if (loading) {
    return (
      <div className="section-card">
        <div className="h-6 w-32 bg-surface-secondary rounded mb-4" />
        <div className="h-4 w-56 bg-surface-secondary rounded mb-2" />
        <div className="h-4 w-48 bg-surface-secondary rounded" />
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="section-card space-y-3">
        <p className="text-sm text-danger">{error || 'Job not found'}</p>
        <button onClick={() => navigate('/jobs')} className="glass-button w-fit">
          Back to Jobs
        </button>
      </div>
    );
  }

  return (
    <>
    <div className="space-y-8">
      <header className="space-y-4">
        <button
          onClick={() => navigate('/jobs')}
          className="glass-button flex items-center gap-2 w-fit"
        >
          <ArrowLeft size={16} />
          Back to Jobs
        </button>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h1 className="text-[15px] font-bold tracking-tight text-text-primary">
                #{job.job_number} {job.title}
              </h1>
              <StatusBadge status={job.status} />
            </div>
            <p className="text-[13px] text-text-tertiary">
              {job.client_name || 'Unassigned client'} • {job.property_address}
            </p>
          </div>
          <div className="section-card px-5 py-4 w-fit">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Total</p>
            <p className="text-[13px] text-text-primary">{formatMoney(job)}</p>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="section-card lg:col-span-2 space-y-6">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">Status</p>
            <p className="text-[13px] font-medium text-text-primary">{job.status}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">Schedule</p>
            <p className="text-[13px] text-text-secondary">
              {job.scheduled_at ? formatDate(job.scheduled_at) : 'Not scheduled'}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">Job Type</p>
            <p className="text-[13px] text-text-secondary">
              {job.job_type || 'Not specified'}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">Notes</p>
            <p className="text-[13px] text-text-secondary">
              {job.notes || 'No notes recorded yet.'}
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">Attachments</p>
            {job.attachments && job.attachments.length > 0 ? (
              <ul className="space-y-2">
                {job.attachments.map((file) => (
                  <li key={file.url} className="flex items-center gap-2 text-[13px]">
                    <LinkIcon size={14} className="text-text-tertiary" />
                    <a className="text-text-primary hover:underline" href={file.url} target="_blank" rel="noreferrer">
                      {file.name}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-text-secondary">No attachments uploaded.</p>
            )}
          </div>
          {job.invoice_url && (
            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">Invoice</p>
              <a
                className="glass-button flex items-center gap-2 w-fit"
                href={job.invoice_url}
                target="_blank"
                rel="noreferrer"
              >
                <LinkIcon size={14} />
                View invoice
              </a>
            </div>
          )}
        </div>

        <div className="section-card space-y-6">
          <h2 className="text-[15px] font-bold text-text-primary">Quick Edit</h2>
          <div className="space-y-2">
            <label className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="glass-input w-full"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="glass-input w-full"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">Schedule</label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="glass-input w-full"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">Total</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={total}
              onChange={(e) => setTotal(e.target.value)}
              className="glass-input w-full"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">Property Address</label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="glass-input w-full"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">Job Type</label>
            <input
              value={jobType}
              onChange={(e) => setJobType(e.target.value)}
              className="glass-input w-full"
            />
          </div>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="glass-button-primary w-full flex items-center justify-center gap-2"
          >
            <Save size={14} />
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </section>
    </div>
    <AnimatePresence>
      {showInvoicePrompt ? (
        <motion.div
          className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm p-4 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="section-card w-full max-w-xl"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[15px] font-bold tracking-tight text-text-primary">Job completed - Create invoice now?</h3>
              <button
                className="rounded-lg p-1 hover:bg-surface-secondary"
                onClick={() => !isInvoiceActionLoading && setShowInvoicePrompt(false)}
                aria-label="Close create invoice dialog"
              >
                <X size={16} />
              </button>
            </div>
            <p className="mt-3 text-[13px] text-text-secondary">
              Invoice is ready for job <strong>#{job.job_number}</strong>. You can send it now.
            </p>
            <p className="mt-2 inline-flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle size={14} />
              SMS provider fallback: if not configured, open invoice and copy payment link manually.
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                className="glass-button"
                onClick={() => {
                  setShowInvoicePrompt(false);
                  if (invoiceReadyId) navigate(`/invoices/${invoiceReadyId}`);
                }}
                disabled={isInvoiceActionLoading}
              >
                Not now
              </button>
              <button
                className="glass-button"
                onClick={() => void handleCreateInvoiceFromCompletedJob(true)}
                disabled={isInvoiceActionLoading}
              >
                {isInvoiceActionLoading ? 'Sending...' : 'Send via Email'}
              </button>
              <button
                className="glass-button-primary"
                onClick={() => void handleCreateInvoiceFromCompletedJob(false)}
                disabled={isInvoiceActionLoading}
              >
                {isInvoiceActionLoading ? 'Opening...' : 'Send via SMS'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
    </>
  );
}
