import React, { useEffect, useRef, useState } from 'react';
import { useRecentItems } from '../hooks/useRecentItems';
import {
  ArrowLeft,
  Briefcase,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Download,
  Edit3,
  FileText,
  Link as LinkIcon,
  Mail,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  Phone,
  Plus,
  Printer,
  Send,
  X,
  Copy,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { cn, formatDate } from '../lib/utils';
import { supabase } from '../lib/supabase';
import { getJobById, getJobLineItems, updateJob, type JobLineItem } from '../lib/jobsApi';
import { createInvoiceFromJob, getInvoiceRowUiStatus } from '../lib/invoicesApi';
import { formatCents, type TaxLine } from '../lib/jobCalc';
import { Job } from '../types';
import StatusBadge from '../components/ui/StatusBadge';
import { useJobModalController } from '../contexts/JobModalController';
import { useTranslation } from '../i18n';
import ActivityTimeline from '../components/ActivityTimeline';
import { useDropZone } from '../hooks/useDropZone';
import { getRecurrenceRule, createRecurrenceRule, deactivateRecurrenceRule, type RecurrenceRule, type RecurrenceFrequency } from '../lib/recurringJobsApi';
import SendSmsModal from '../components/communications/SendSmsModal';
import SendEmailModal from '../components/communications/SendEmailModal';
import CommunicationsTimeline from '../components/communications/CommunicationsTimeline';
import SpecificNotes from '../components/SpecificNotes';

// ─── Types ───────────────────────────────────────────────────────────
interface ScheduleEvent {
  id: string;
  start_at: string | null;
  end_at: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string | null;
  team_id: string | null;
}

interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  status: string;
  due_date: string | null;
  subject: string | null;
  total_cents: number;
  balance_cents: number;
}

interface ClientInfo {
  phone: string | null;
  email: string | null;
  address: string | null;
  company: string | null;
}

// ─── Component ───────────────────────────────────────────────────────
export default function JobDetails() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const { openJobModal } = useJobModalController();

  const { updateLabel: updateRecentLabel } = useRecentItems();
  const [job, setJob] = useState<Job | null>(null);
  const [lineItems, setLineItems] = useState<JobLineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Extra data
  const [visits, setVisits] = useState<ScheduleEvent[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null);

  // Action states
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isCreatingInvoice, setIsCreatingInvoice] = useState(false);
  const [showProfitability, setShowProfitability] = useState(false);
  const [invoiceTab, setInvoiceTab] = useState<'billing' | 'reminders'>('billing');

  // Modals
  const [showSmsModal, setShowSmsModal] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailMode, setEmailMode] = useState<'confirmation' | 'followup' | 'generic'>('confirmation');
  const [commRefreshKey, setCommRefreshKey] = useState(0);

  // Recurrence
  const [recurrence, setRecurrence] = useState<RecurrenceRule | null>(null);
  const [showRecurrenceSetup, setShowRecurrenceSetup] = useState(false);
  const [recFreq, setRecFreq] = useState<RecurrenceFrequency>('weekly');
  const [recSaving, setRecSaving] = useState(false);

  const moreActionsRef = useRef<HTMLDivElement>(null);

  // Drag-and-drop file upload
  const { isDragging, dropHandlers } = useDropZone({
    accept: ['image/*', 'application/pdf', 'text/*'],
    maxSizeMB: 15,
    onDrop: async (files) => {
      if (!job) return;
      for (const file of files) {
        try {
          const ext = file.name.split('.').pop() ?? 'bin';
          const path = `jobs/${job.id}/${crypto.randomUUID()}.${ext}`;
          const { error: uploadErr } = await supabase.storage.from('attachments').upload(path, file, { upsert: false });
          if (uploadErr) throw uploadErr;
          const { data: { publicUrl } } = supabase.storage.from('attachments').getPublicUrl(path);
          // Append to job attachments
          const current = job.attachments || [];
          const updated = [...current, { name: file.name, url: publicUrl }];
          await supabase.from('jobs').update({ attachments: updated, updated_at: new Date().toISOString() }).eq('id', job.id);
          setJob((prev) => prev ? { ...prev, attachments: updated } : prev);
          toast.success(`${file.name} uploaded`);
        } catch (err: any) {
          toast.error(err?.message || `Failed to upload ${file.name}`);
        }
      }
    },
  });

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (moreActionsRef.current && !moreActionsRef.current.contains(e.target as Node)) {
        setMoreActionsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // ── Load job + line items ──
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    Promise.all([getJobById(id), getJobLineItems(id)])
      .then(([jobData, items]) => {
        if (!jobData) {
          setError(t.jobs.jobNotFound);
          return;
        }
        setJob(jobData);
        updateRecentLabel(`/jobs/${id}`, `#${jobData.job_number} ${jobData.title || ''}`);
        setLineItems(items);
      })
      .catch((err) => setError(err.message || 'Failed to load job'))
      .finally(() => setLoading(false));
  }, [id]);

  // ── Load visits (schedule_events) for this job ──
  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const { data } = await supabase
          .from('schedule_events')
          .select('id,start_at,end_at,start_time,end_time,status,team_id')
          .eq('job_id', id)
          .is('deleted_at', null)
          .order('start_at', { ascending: true });
        setVisits((data as ScheduleEvent[]) || []);
      } catch (err: any) {
        console.warn('Failed to load schedule events:', err?.message);
      }
    })();
  }, [id]);

  // ── Load invoices for this job ──
  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const { data } = await supabase
          .from('invoices')
          .select('id,invoice_number,status,due_date,subject,total_cents,balance_cents')
          .eq('job_id', id)
          .is('deleted_at', null)
          .order('created_at', { ascending: true });
        setInvoices(
          (data || []).map((r: any) => ({
            id: r.id,
            invoice_number: r.invoice_number || null,
            status: r.status || 'draft',
            due_date: r.due_date || null,
            subject: r.subject || 'For Services Rendered',
            total_cents: Number(r.total_cents || 0),
            balance_cents: Number(r.balance_cents ?? r.total_cents ?? 0),
          })),
        );
      } catch (err: any) {
        console.warn('Failed to load invoices:', err?.message);
      }
    })();
  }, [id]);

  // ── Load client contact info ──
  useEffect(() => {
    if (!job?.client_id) return;
    (async () => {
      try {
        const { data } = await supabase
          .from('clients')
          .select('phone,email,address,company')
          .is('deleted_at', null)
          .eq('id', job.client_id)
          .maybeSingle();
        if (data) setClientInfo(data as ClientInfo);
      } catch (err: any) {
        console.warn('Failed to load client info:', err?.message);
      }
    })();
  }, [job?.client_id]);

  // Load recurrence rule
  useEffect(() => {
    if (!id) return;
    getRecurrenceRule(id).then(setRecurrence).catch(() => {});
  }, [id]);

  const reload = () => {
    if (!id) return;
    Promise.all([getJobById(id), getJobLineItems(id)])
      .then(([jobData, items]) => {
        if (jobData) setJob(jobData);
        setLineItems(items);
      })
      .catch(() => {});
  };

  // ── Financials from DB ──
  // job.subtotal / job.total are in DOLLARS, job.total_cents is in CENTS
  const subtotalCents = Math.round((job?.subtotal ?? 0) * 100);
  const taxCents = Math.round((job?.tax_total ?? 0) * 100);
  const totalCents = job?.total_cents
    ? Math.round(job.total_cents)
    : job?.total
      ? Math.round(job.total * 100)
      : 0;
  const taxLines: TaxLine[] = Array.isArray(job?.tax_lines) ? job.tax_lines as TaxLine[] : [];
  const enabledTaxes = taxLines.filter((tx) => tx.enabled && tx.rate > 0);

  const computedSubtotalCents = lineItems.reduce((sum, item) => sum + Math.round(item.qty * item.unit_price_cents), 0);
  const displaySubtotalCents = subtotalCents > 0 ? subtotalCents : computedSubtotalCents;
  const displayTaxCents = subtotalCents > 0 ? taxCents : enabledTaxes.reduce((sum, tx) => sum + Math.round(computedSubtotalCents * (tx.rate / 100)), 0);
  const displayTotalCents = subtotalCents > 0 ? totalCents : displaySubtotalCents + displayTaxCents;

  // Profitability — cost_cents on line items if available, otherwise 0 (not revenue)
  const lineItemCostCents = lineItems.reduce((sum, item) => sum + Math.round(item.qty * ((item as any).cost_cents || 0)), 0);
  const profitCents = displayTotalCents - lineItemCostCents;
  const profitMargin = displayTotalCents > 0 ? Math.round((profitCents / displayTotalCents) * 100) : 0;

  // Status helpers
  const isToday = job?.scheduled_at && new Date(job.scheduled_at).toDateString() === new Date().toDateString();

  // ── Actions ──
  const handleEdit = () => {
    if (!job) return;
    openJobModal({ jobId: job.id, onCreated: () => reload() });
  };

  const handleCloseJob = async () => {
    if (!job) return;
    setIsClosing(true);
    try {
      const updated = await updateJob(job.id, { status: 'completed' });
      setJob(updated);
      toast.success('Job marked as completed');
      setMoreActionsOpen(false);

      // Auto-propose invoice creation if no invoice exists
      if (invoices.length === 0) {
        const shouldCreate = window.confirm(
          t.jobDetails?.createInvoicePrompt
            || 'Job completed! Would you like to create an invoice now?'
        );
        if (shouldCreate) {
          handleCreateInvoice();
        }
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to close job');
    } finally {
      setIsClosing(false);
    }
  };

  const handleCreateInvoice = async () => {
    if (!job) return;
    setIsCreatingInvoice(true);
    try {
      const result = await createInvoiceFromJob({ jobId: job.id, sendNow: false });
      const invoiceId = String(result.invoice_id || result.invoice?.id || '').trim();
      if (!invoiceId) throw new Error('Invoice created but ID is missing.');
      queryClient.invalidateQueries({ queryKey: ['invoicesTable'] });
      queryClient.invalidateQueries({ queryKey: ['jobsTable'] });
      toast.success(result.already_exists ? 'Invoice already exists' : 'Invoice draft created');
      setMoreActionsOpen(false);
      navigate(result.already_exists ? `/invoices/${invoiceId}` : `/invoices/${invoiceId}/edit`);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create invoice');
    } finally {
      setIsCreatingInvoice(false);
    }
  };

  const handlePrint = () => { setMoreActionsOpen(false); window.print(); };
  const handleDownloadPdf = () => { setMoreActionsOpen(false); window.print(); };

  // ── Loading / Error ──
  if (loading) {
    return (
      <div className="space-y-5 p-6">
        <div className="h-5 w-32 bg-surface-secondary rounded animate-pulse" />
        <div className="h-8 w-64 bg-surface-secondary rounded animate-pulse" />
        <div className="h-64 bg-surface-secondary rounded-xl animate-pulse" />
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="space-y-5">
        <button onClick={() => navigate('/jobs')} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-text-secondary hover:text-text-primary transition-colors">
          <ArrowLeft size={14} /> {t.jobDetails.backToJobs}
        </button>
        <div className="section-card p-12 text-center">
          <p className="text-[15px] text-text-secondary">{error || t.jobs.jobNotFound}</p>
        </div>
      </div>
    );
  }

  // ── Render ──
  return (
    <>
      <div className="space-y-8 print:space-y-4 relative" {...dropHandlers}>
        {/* Drop zone overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-50 bg-primary/10 border-2 border-dashed border-primary rounded-xl flex items-center justify-center pointer-events-none">
            <p className="text-primary font-semibold text-lg">Drop files here</p>
          </div>
        )}
        {/* ═══ BREADCRUMB ═══ */}
        <nav className="flex items-center gap-1.5 text-[12px] print:hidden">
          <button onClick={() => navigate('/jobs')} className="text-text-tertiary hover:text-text-primary transition-colors">Jobs</button>
          <span className="text-text-tertiary">/</span>
          {job.client_name && (
            <>
              <button onClick={() => job.client_id && navigate(`/clients/${job.client_id}`)} className="text-text-tertiary hover:text-text-primary transition-colors">{job.client_name}</button>
              <span className="text-text-tertiary">/</span>
            </>
          )}
          <span className="text-text-primary font-medium">#{job.job_number}</span>
        </nav>

        {/* ═══ HEADER ═══ */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4">
            <div className="icon-tile icon-tile-lg icon-tile-blue">
              <Briefcase size={18} strokeWidth={2} />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-[22px] font-bold text-text-primary leading-tight">
                  {job.client_name || 'Unassigned'}
                </h1>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[13px] text-text-secondary">{job.title}</span>
                <StatusBadge status={job.status} />
                {isToday && (
                  <span className="badge-neutral text-[11px]">Today</span>
                )}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 print:hidden">
            <button
              onClick={() => setShowSmsModal(true)}
              className="glass-button-primary inline-flex items-center gap-1.5"
            >
              <MessageSquare size={14} /> Text Confirmation
            </button>
            <button onClick={handleEdit} className="glass-button inline-flex items-center gap-1.5">
              <Edit3 size={14} /> Edit
            </button>

            {/* 1-click Complete & Invoice — primary CTA when job is active */}
            {job.status !== 'completed' && job.status !== 'cancelled' && (
              <button
                onClick={async () => {
                  setIsClosing(true);
                  try {
                    const updated = await updateJob(job.id, { status: 'completed' });
                    setJob(updated);
                    // Auto-create invoice immediately — no confirmation needed
                    if (invoices.length === 0) {
                      const result = await createInvoiceFromJob({ jobId: job.id, sendNow: false });
                      const invoiceId = String(result.invoice_id || result.invoice?.id || '').trim();
                      if (invoiceId) {
                        toast.success('Job completed & invoice created', {
                          action: { label: 'View Invoice', onClick: () => navigate(`/invoices/${invoiceId}`) },
                        });
                        navigate(`/invoices/${invoiceId}/edit`);
                        return;
                      }
                    }
                    toast.success('Job completed');
                  } catch (err: any) {
                    toast.error(err?.message || 'Failed');
                  } finally {
                    setIsClosing(false);
                  }
                }}
                disabled={isClosing}
                className="px-3 py-1.5 rounded-lg bg-primary text-white text-[12px] font-semibold hover:opacity-90 transition-all inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <CheckCircle2 size={13} /> {isClosing ? 'Processing...' : 'Complete & Invoice'}
              </button>
            )}

            {/* More dropdown */}
            <div className="relative" ref={moreActionsRef}>
              <button
                onClick={() => setMoreActionsOpen((prev) => !prev)}
                className="glass-button inline-flex items-center gap-1"
              >
                <MoreHorizontal size={14} />
              </button>
              {moreActionsOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMoreActionsOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-lg border border-outline bg-surface shadow-lg py-1">
                    <DropdownItem icon={<CheckCircle2 size={13} />} label={isClosing ? 'Closing...' : 'Close Job'} onClick={handleCloseJob} disabled={isClosing} />
                    <DropdownItem icon={<Send size={13} />} label="Send Follow-up" onClick={() => { setEmailMode('followup'); setShowEmailModal(true); setMoreActionsOpen(false); }} />
                    <DropdownItem icon={<Mail size={13} />} label="Send Email" onClick={() => { setEmailMode('generic'); setShowEmailModal(true); setMoreActionsOpen(false); }} />
                    <div className="border-t border-border my-1" />
                    <DropdownItem icon={<FileText size={13} />} label={isCreatingInvoice ? 'Creating...' : 'Create Invoice'} onClick={handleCreateInvoice} disabled={isCreatingInvoice} />
                    <DropdownItem icon={<Copy size={13} />} label="Clone Job" onClick={() => {
                      setMoreActionsOpen(false);
                      openJobModal({
                        initialValues: {
                          title: `${job.title} (copy)`,
                          client_id: job.client_id || null,
                          property_address: job.property_address || null,
                          description: (job as any).description || null,
                          line_items: lineItems.map(li => ({ name: (li as any).name || (li as any).description || '', qty: li.qty, unit_price_cents: li.unit_price_cents })),
                        },
                        onCreated: () => { toast.success('Job cloned', { action: { label: 'View', onClick: () => navigate('/jobs') } }); },
                      });
                    }} />
                    <DropdownItem icon={<Download size={13} />} label="Download PDF" onClick={handleDownloadPdf} />
                    <DropdownItem icon={<Printer size={13} />} label="Print" onClick={handlePrint} />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ═══ FLOW PROGRESS — shows where job is in the lifecycle ═══ */}
        <div className="flex items-center gap-0 px-1 pb-4">
          {['Scheduled', 'In Progress', 'Completed', 'Invoiced', 'Paid'].map((step, i) => {
            const currentIdx = job.status === 'scheduled' ? 0 : job.status === 'in_progress' ? 1 : job.status === 'completed' ? (invoices.length > 0 ? 3 : 2) : job.status === 'cancelled' ? -1 : 0;
            const isPaidIdx = invoices.some((inv: any) => inv.status === 'paid') ? 4 : -1;
            const activeIdx = isPaidIdx === 4 ? 4 : currentIdx;
            const done = i <= activeIdx;
            return (
              <React.Fragment key={step}>
                {i > 0 && <div className={cn('flex-1 h-px', done ? 'bg-primary' : 'bg-outline')} />}
                <div className="flex flex-col items-center gap-1">
                  <div className={cn('w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold border',
                    done ? 'bg-primary text-white border-text-primary' : 'bg-surface text-text-tertiary border-outline')}>
                    {done ? '\u2713' : i + 1}
                  </div>
                  <span className={cn('text-[9px] font-medium whitespace-nowrap', done ? 'text-text-primary' : 'text-text-tertiary',
                    step === 'Invoiced' && invoices.length > 0 && 'cursor-pointer hover:underline')}
                    onClick={() => { if (step === 'Invoiced' && invoices[0]) navigate(`/invoices/${(invoices[0] as any).id}`); }}>{step}</span>
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {/* ═══ SUMMARY CARD — green accent top ═══ */}
        <div className="rounded-xl border border-outline bg-surface overflow-hidden">
          {/* Accent bar */}
          <div className="h-1 bg-primary" />

          {/* Status row */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-outline-subtle">
            <div className="flex items-center gap-2.5">
              <StatusBadge status={job.status} />
              {isToday && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-text-primary">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  Today
                </span>
              )}
              {job.scheduled_at && (
                <span className="text-[12px] text-text-tertiary flex items-center gap-1">
                  <Calendar size={11} /> {formatDate(job.scheduled_at)}
                </span>
              )}
            </div>
            <span className="text-[13px] font-semibold text-text-secondary tabular-nums">
              Job #{job.job_number}
            </span>
          </div>

          {/* Client name + service */}
          <div className="px-5 pt-5 pb-1">
            <div className="flex items-center gap-2">
              <h2 className="text-[20px] font-bold text-text-primary">
                {job.client_name || 'Unassigned'}
              </h2>
            </div>
            <p className="text-[13px] text-text-secondary mt-0.5">{job.title}</p>
          </div>

          {/* Two-column: address/contact | job details */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 lg:divide-x lg:divide-outline-subtle">
            {/* Left: Property address + Contact */}
            <div className="p-5 space-y-5">
              {/* Property address */}
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-text-tertiary mb-2">Property address</p>
                <div className="flex items-start gap-3">
                  <div className="icon-tile icon-tile-sm icon-tile-blue mt-0.5">
                    <MapPin size={13} strokeWidth={2} />
                  </div>
                  <div className="text-[13px] text-text-primary leading-relaxed">
                    {job.property_address ? (
                      job.property_address.split(',').map((part, i) => (
                        <div key={i}>{part.trim()}</div>
                      ))
                    ) : (
                      <span className="text-text-tertiary">No address</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Contact details */}
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-text-tertiary mb-2">Contact details</p>
                <div className="space-y-1.5">
                  {clientInfo?.phone && (
                    <a href={`tel:${clientInfo.phone}`} className="flex items-center gap-2 text-[13px] text-text-primary hover:text-text-secondary transition-colors">
                      <Phone size={13} className="text-text-tertiary" />
                      {clientInfo.phone}
                    </a>
                  )}
                  {clientInfo?.email && (
                    <a href={`mailto:${clientInfo.email}`} className="flex items-center gap-2 text-[13px] text-text-primary hover:underline">
                      <Mail size={13} className="text-text-tertiary" />
                      {clientInfo.email}
                    </a>
                  )}
                  {!clientInfo?.phone && !clientInfo?.email && (
                    <p className="text-[13px] text-text-tertiary">No contact info</p>
                  )}
                </div>
              </div>
            </div>

            {/* Right: Job details */}
            <div className="p-5">
              <p className="text-xs font-medium uppercase tracking-wider text-text-tertiary mb-2">Job details</p>
              <div className="space-y-0">
                <JobDetailRow label="Job type" value={job.job_type || 'One-off job'} />
                <JobDetailRow label="Starts on" value={job.scheduled_at ? formatDate(job.scheduled_at) : '—'} />
                <JobDetailRow label="Ends on" value={job.end_at ? formatDate(job.end_at) : (job.scheduled_at ? formatDate(job.scheduled_at) : '—')} />
                <JobDetailRow label="Billing frequency" value={(job as any).requires_invoicing === false ? 'No invoicing' : 'Upon job completion'} />
                <JobDetailRow label="Deposit" value={(job as any).deposit_required ? `${(job as any).deposit_type === 'percentage' ? `${(job as any).deposit_value}%` : `$${(job as any).deposit_value}`}` : 'None'} />
                <JobDetailRow label="Salesperson" value={(job as any).salesperson_id || '—'} isLast />
              </div>
            </div>
          </div>
        </div>

        {/* ═══ PROFITABILITY + LINE ITEMS ═══ */}
        <div className="rounded-xl border border-outline bg-surface overflow-hidden">
          {/* Profitability toggle */}
          <div className="px-5 py-3.5 border-b border-outline-subtle">
            <button
              onClick={() => setShowProfitability(!showProfitability)}
              className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-text-secondary hover:text-text-primary transition-colors"
            >
              {showProfitability ? 'Hide' : 'Show'} Profitability
              {showProfitability ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>

            <AnimatePresence>
              {showProfitability && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="pt-4 flex flex-col lg:flex-row lg:items-center gap-5">
                    {/* Margin */}
                    <div>
                      <p className="text-[28px] font-bold text-text-primary leading-none">{profitMargin}%</p>
                      <p className="text-[11px] text-text-tertiary mt-1">Profit margin</p>
                    </div>

                    {/* Breakdown */}
                    <div className="flex flex-wrap items-center gap-3 text-[13px]">
                      <ProfitBlock label="Total price" value={formatCents(displayTotalCents)} />
                      <span className="text-text-tertiary font-medium">−</span>
                      <ProfitBlock label="Line Item Cost" value={formatCents(lineItemCostCents)} color="text-text-secondary" />
                      <span className="text-text-tertiary font-medium">−</span>
                      <ProfitBlock label="Labour" value="$0.00" color="text-text-secondary" />
                      <span className="text-text-tertiary font-medium">−</span>
                      <ProfitBlock label="Expenses" value="$0.00" color="text-text-tertiary" />
                      <span className="text-text-tertiary font-medium">=</span>
                      <ProfitBlock label="Profit" value={formatCents(profitCents)} color="text-text-primary" />
                    </div>

                    {/* Mini donut */}
                    <div className="ml-auto hidden lg:block">
                      <div className="w-10 h-10 rounded-full border-[3px] border-text-primary flex items-center justify-center">
                        <div className="w-4 h-4 rounded-full bg-primary/10" />
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Line Items */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline-subtle">
            <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
              <div className="icon-tile icon-tile-sm icon-tile-blue">
                <Briefcase size={13} strokeWidth={2} />
              </div>
              Line Items
            </h2>
            <button onClick={handleEdit} className="glass-button !text-[12px] !px-2.5 !py-1 inline-flex items-center gap-1 print:hidden">
              <Plus size={12} /> New Line Item
            </button>
          </div>

          <div className="p-5">
            {lineItems.length === 0 ? (
              <p className="text-[13px] text-text-tertiary py-4 text-center">No line items</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-0 py-2.5 text-xs font-medium uppercase tracking-wider text-text-tertiary">Product / Service</th>
                      <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wider text-text-tertiary text-center w-24">Quantity</th>
                      <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wider text-text-tertiary text-right w-28">Cost</th>
                      <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wider text-text-tertiary text-right w-28">Price</th>
                      <th className="px-0 py-2.5 text-xs font-medium uppercase tracking-wider text-text-tertiary text-right w-28">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((item) => {
                      const lineTotalCents = Math.round(item.qty * item.unit_price_cents);
                      return (
                        <tr key={item.id} className="border-b border-border-light">
                          <td className="py-3 pr-3">
                            <span className="text-[13px] font-semibold text-text-primary">{item.name}</span>
                          </td>
                          <td className="px-3 py-3 text-[13px] text-text-secondary text-center tabular-nums">{item.qty}</td>
                          <td className="px-3 py-3 text-[13px] text-text-secondary text-right tabular-nums">{formatCents((item as any).cost_cents || 0)}</td>
                          <td className="px-3 py-3 text-[13px] text-text-secondary text-right tabular-nums">{formatCents(item.unit_price_cents)}</td>
                          <td className="py-3 text-[13px] text-text-primary font-semibold text-right tabular-nums">{formatCents(lineTotalCents)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Totals */}
            {lineItems.length > 0 && (
              <div className="border-t border-border pt-4 mt-2 flex justify-end">
                <div className="w-60 space-y-1.5">
                  <div className="flex justify-between text-[13px]">
                    <span className="text-text-secondary">Subtotal</span>
                    <span className="text-text-primary tabular-nums font-semibold">{formatCents(displaySubtotalCents)}</span>
                  </div>
                  {enabledTaxes.map((tax) => {
                    const taxAmountCents = Math.round(displaySubtotalCents * (tax.rate / 100));
                    return (
                      <div key={tax.code} className="flex justify-between text-[13px]">
                        <span className="text-text-secondary">{tax.label} ({tax.rate}%)</span>
                        <span className="text-text-primary tabular-nums">{formatCents(taxAmountCents)}</span>
                      </div>
                    );
                  })}
                  <div className="flex justify-between text-[15px] font-bold border-t border-border pt-2">
                    <span className="text-text-primary">Total</span>
                    <span className="text-text-primary tabular-nums">{formatCents(displayTotalCents)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ═══ VISITS ═══ */}
        <div className="rounded-xl border border-outline bg-surface overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline-subtle">
            <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
              <div className="icon-tile icon-tile-sm icon-tile-blue">
                <Calendar size={13} strokeWidth={2} />
              </div>
              Visits
            </h2>
            <button onClick={handleEdit} className="glass-button !text-[12px] !px-2.5 !py-1 inline-flex items-center gap-1 print:hidden">
              New Visit
            </button>
          </div>
          <div className="p-5">
            {/* Time range */}
            {job.scheduled_at && (
              <p className="text-[12px] font-semibold text-text-secondary mb-3">
                {(() => {
                  const start = new Date(job.scheduled_at);
                  const end = job.end_at ? new Date(job.end_at) : null;
                  const sameDay = end && start.toDateString() === end.toDateString();
                  if (!end || sameDay) return 'All day / Any time';
                  return `${start.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })} — ${end.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })}`;
                })()}
              </p>
            )}

            {visits.length === 0 && job.scheduled_at ? (
              <div className="rounded-lg border border-outline-subtle bg-surface-secondary p-3.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-4 h-4 rounded border border-outline bg-surface-secondary inline-block shrink-0" />
                  <span className="text-[13px] font-semibold text-text-primary">
                    {formatDate(job.scheduled_at)}
                  </span>
                </div>
                <span className="text-[12px] text-text-tertiary">Not assigned yet</span>
              </div>
            ) : visits.length > 0 ? (
              <div className="space-y-2">
                {visits.map((visit) => (
                  <div key={visit.id} className="rounded-lg border border-outline-subtle bg-surface-secondary p-3.5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="w-4 h-4 rounded border border-outline bg-surface-secondary inline-block shrink-0" />
                      <span className="text-[13px] font-semibold text-text-primary">
                        {visit.start_at ? formatDate(visit.start_at) : 'Unscheduled'}
                      </span>
                    </div>
                    <span className="text-[12px] text-text-tertiary">
                      {visit.team_id ? 'Team assigned' : 'Not assigned yet'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-text-tertiary py-4 text-center">No visits scheduled</p>
            )}
          </div>
        </div>

        {/* ═══ INVOICES ═══ */}
        <div className="rounded-xl border border-outline bg-surface overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline-subtle">
            <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
              <div className="icon-tile icon-tile-sm icon-tile-blue">
                <DollarSign size={13} strokeWidth={2} />
              </div>
              Invoices
            </h2>
          </div>

          {/* Tabs */}
          <div className="px-5 border-b border-outline-subtle">
            <div className="flex items-center gap-1">
              {(['billing', 'reminders'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setInvoiceTab(tab)}
                  className={cn(
                    'px-3 py-2.5 text-[13px] font-semibold border-b-2 transition-colors -mb-[1.5px] capitalize',
                    invoiceTab === tab
                      ? 'border-text-primary text-text-primary'
                      : 'border-transparent text-text-tertiary hover:text-text-secondary',
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div className="p-5">
            {invoiceTab === 'billing' && (
              <>
                {job.billing_split !== undefined && (
                  <div className="flex items-center gap-2 text-[13px] text-text-secondary mb-4">
                    <span className={cn('w-4 h-4 rounded border inline-flex items-center justify-center', job.billing_split ? 'bg-primary border-primary text-white' : 'border-outline bg-surface-secondary')}>
                      {job.billing_split && <span className="text-[9px]">✓</span>}
                    </span>
                    Split into multiple invoices with a payment schedule
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="px-0 py-2.5 text-xs font-medium uppercase tracking-wider text-text-tertiary">Invoice</th>
                        <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wider text-text-tertiary">Due Date</th>
                        <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wider text-text-tertiary">Status</th>
                        <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wider text-text-tertiary">Subject</th>
                        <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wider text-text-tertiary text-right">Balance</th>
                        <th className="px-0 py-2.5 text-xs font-medium uppercase tracking-wider text-text-tertiary text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.length === 0 ? (
                        <tr className="border-b border-border-light">
                          <td className="py-3 pr-3">
                            <button
                              onClick={handleCreateInvoice}
                              disabled={isCreatingInvoice}
                              className="glass-button !text-[12px] !px-2.5 !py-1"
                            >
                              {isCreatingInvoice ? 'Creating...' : 'Create'}
                            </button>
                          </td>
                          <td className="px-3 py-3 text-[13px] text-text-tertiary">—</td>
                          <td className="px-3 py-3"><StatusBadge status="Upcoming" /></td>
                          <td className="px-3 py-3 text-[13px] text-text-secondary">For Services Rendered</td>
                          <td className="px-3 py-3 text-[13px] text-text-primary text-right tabular-nums">{formatCents(displayTotalCents)}</td>
                          <td className="py-3 text-[13px] text-text-primary text-right tabular-nums">{formatCents(displayTotalCents)}</td>
                        </tr>
                      ) : (
                        invoices.map((inv) => (
                          <tr
                            key={inv.id}
                            className="border-b border-border-light cursor-pointer hover:bg-surface-secondary transition-colors"
                            onClick={() => navigate(`/invoices/${inv.id}`)}
                          >
                            <td className="py-3 pr-3 text-[13px] font-semibold text-text-primary">
                              #{inv.invoice_number || '—'}
                            </td>
                            <td className="px-3 py-3 text-[13px] text-text-secondary">
                              {inv.due_date ? formatDate(inv.due_date) : '—'}
                            </td>
                            <td className="px-3 py-3"><StatusBadge status={getInvoiceRowUiStatus(inv as any)} /></td>
                            <td className="px-3 py-3 text-[13px] text-text-secondary">{inv.subject}</td>
                            <td className="px-3 py-3 text-[13px] text-text-primary text-right tabular-nums">{formatCents(inv.balance_cents)}</td>
                            <td className="py-3 text-[13px] text-text-primary text-right tabular-nums">{formatCents(inv.total_cents)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {invoiceTab === 'reminders' && (
              <p className="text-[13px] text-text-tertiary py-4 text-center">No reminders configured</p>
            )}
          </div>
        </div>

        {/* ═══ NOTES ═══ */}
        {job.notes && (
          <div className="rounded-xl border border-outline bg-surface overflow-hidden">
            <div className="px-5 py-3.5 border-b border-outline-subtle">
              <h2 className="text-[13px] font-semibold text-text-primary">Notes</h2>
            </div>
            <div className="p-5">
              <p className="text-[13px] text-text-secondary whitespace-pre-wrap leading-relaxed">{job.notes}</p>
            </div>
          </div>
        )}

        {/* ═══ SPECIFIC NOTES ═══ */}
        <SpecificNotes entityType="job" entityId={id!} mode="full" />

        {/* ═══ RECURRENCE ═══ */}
        <div className="rounded-xl border border-outline bg-surface overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline-subtle">
            <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
              Recurring Schedule
            </h2>
            {!recurrence && !showRecurrenceSetup && (
              <button
                onClick={() => setShowRecurrenceSetup(true)}
                className="glass-button !text-[12px] !px-2.5 !py-1 print:hidden"
              >
                Make Recurring
              </button>
            )}
          </div>
          <div className="p-5">
            {recurrence ? (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[13px] font-semibold text-text-primary capitalize">
                    {recurrence.frequency === 'biweekly' ? 'Every 2 weeks' : recurrence.frequency}
                  </p>
                  <p className="text-[12px] text-text-tertiary">
                    Since {new Date(recurrence.start_date).toLocaleDateString()} — {recurrence.occurrences_created} created
                    {recurrence.end_date ? ` — ends ${new Date(recurrence.end_date).toLocaleDateString()}` : ''}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    await deactivateRecurrenceRule(recurrence.id);
                    setRecurrence(null);
                    toast.success('Recurrence stopped');
                  }}
                  className="glass-button !text-[12px] text-danger hover:bg-danger-light"
                >
                  Stop
                </button>
              </div>
            ) : showRecurrenceSetup ? (
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Frequency</label>
                  <select value={recFreq} onChange={(e) => setRecFreq(e.target.value as RecurrenceFrequency)} className="glass-input w-full mt-1">
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Every 2 weeks</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <button
                    disabled={recSaving}
                    onClick={async () => {
                      if (!id) return;
                      setRecSaving(true);
                      try {
                        const rule = await createRecurrenceRule({
                          job_id: id,
                          frequency: recFreq,
                          start_date: new Date().toISOString().slice(0, 10),
                        });
                        setRecurrence(rule);
                        setShowRecurrenceSetup(false);
                        toast.success('Recurrence activated');
                      } catch (err: any) {
                        toast.error(err?.message || 'Failed to create recurrence');
                      } finally {
                        setRecSaving(false);
                      }
                    }}
                    className="glass-button-primary !text-[12px]"
                  >
                    {recSaving ? 'Saving...' : 'Activate'}
                  </button>
                  <button onClick={() => setShowRecurrenceSetup(false)} className="glass-button !text-[12px]">Cancel</button>
                </div>
              </div>
            ) : (
              <p className="text-[13px] text-text-tertiary">This is a one-time job.</p>
            )}
          </div>
        </div>

        {/* ═══ ATTACHMENTS ═══ */}
        {job.attachments && job.attachments.length > 0 && (
          <div className="rounded-xl border border-outline bg-surface overflow-hidden">
            <div className="px-5 py-3.5 border-b border-outline-subtle">
              <h2 className="text-[13px] font-semibold text-text-primary">Attachments</h2>
            </div>
            <div className="p-5 space-y-2">
              {job.attachments.map((file) => (
                <a
                  key={file.url}
                  href={file.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 text-[13px] text-text-primary hover:underline"
                >
                  <LinkIcon size={13} className="text-text-tertiary" />
                  {file.name}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* ═══ COMMUNICATIONS ═══ */}
        <CommunicationsTimeline jobId={id!} clientId={job.client_id || undefined} refreshKey={commRefreshKey} />

        {/* ═══ ACTIVITY ═══ */}
        <ActivityTimeline entityType="job" entityId={id!} />
      </div>

      {/* ── SMS Modal ── */}
      <AnimatePresence>
        {showSmsModal && job && (
          <ModalOverlay onClose={() => setShowSmsModal(false)} size="xl">
            <SendSmsModal
              phone={clientInfo?.phone}
              defaultBody={`Confirmation rendez-vous ${clientInfo?.company || job.title}.\n\nLocation: ${job.property_address || 'TBD'}\nDate: ${job.scheduled_at ? formatDate(job.scheduled_at) : 'TBD'}`}
              clientId={job.client_id}
              jobId={job.id}
              clientName={job.client_name || undefined}
              companyName={clientInfo?.company || undefined}
              propertyAddress={job.property_address || undefined}
              scheduledDate={job.scheduled_at ? formatDate(job.scheduled_at) : undefined}
              onClose={() => setShowSmsModal(false)}
              onSent={() => setCommRefreshKey((k) => k + 1)}
            />
          </ModalOverlay>
        )}
      </AnimatePresence>

      {/* ── Email Modal ── */}
      <AnimatePresence>
        {showEmailModal && job && (
          <ModalOverlay onClose={() => setShowEmailModal(false)} size="2xl">
            <SendEmailModal
              email={clientInfo?.email}
              defaultSubject={emailMode === 'confirmation' ? `Confirmation rendez-vous ${clientInfo?.company || job.title}` : emailMode === 'followup' ? `Follow-up — ${job.title}` : `Regarding ${job.title}`}
              defaultBody={emailMode === 'confirmation' ? `Bonjour ${job.client_name || 'there'},\n\nMerci d'avoir fait affaire avec nous !\n\nLocation: ${job.property_address || 'TBD'}\nDate: ${job.scheduled_at ? formatDate(job.scheduled_at) : 'TBD'}\n\nCordialement,\n\n${clientInfo?.company || ''}` : emailMode === 'followup' ? `Hi ${job.client_name || 'there'},\n\nJust following up on "${job.title}". Please let us know if you have any questions.\n\nThank you!` : `Hi ${job.client_name || 'there'},\n\n`}
              clientId={job.client_id}
              jobId={job.id}
              clientName={job.client_name || undefined}
              onClose={() => setShowEmailModal(false)}
              onSent={() => setCommRefreshKey((k) => k + 1)}
            />
          </ModalOverlay>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── Local Helpers ───────────────────────────────────────────────────

function JobDetailRow({ label, value, isLast }: { label: string; value: string; isLast?: boolean }) {
  return (
    <div className={cn(
      'flex justify-between py-2 text-[13px]',
      !isLast && 'border-b border-outline-subtle',
    )}>
      <span className="text-text-secondary">{label}</span>
      <span className="text-text-primary font-medium">{value}</span>
    </div>
  );
}

function ProfitBlock({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="text-center min-w-[70px]">
      <p className="text-[11px] text-text-tertiary mb-0.5">{label}</p>
      <p className={cn('font-semibold tabular-nums text-[13px]', color || 'text-text-primary')}>{value}</p>
    </div>
  );
}

function DropdownItem({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-2 text-[13px] text-text-primary hover:bg-surface-secondary transition-colors text-left',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function ModalOverlay({ children, onClose, size = 'lg' }: { children: React.ReactNode; onClose: () => void; size?: 'lg' | 'xl' | '2xl' }) {
  const maxW = size === '2xl' ? 'max-w-3xl' : size === 'xl' ? 'max-w-2xl' : 'max-w-lg';
  return (
    <motion.div
      className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm p-4 flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        className={cn('section-card w-full', maxW)}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

