import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Eye,
  FileText,
  Link as LinkIcon,
  Mail,
  MessageSquare,
  MoreHorizontal,
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
import { getCurrentOrgIdOrThrow } from '../lib/orgApi';
import { getJobById, getJobLineItems, updateJob, type JobLineItem } from '../lib/jobsApi';
import AddVisitModal from '../components/AddVisitModal';
import { createInvoiceFromJob, getInvoiceRowUiStatus } from '../lib/invoicesApi';
import {
  listJobBillingMilestones,
  saveJobBillingMilestones,
  setJobBillingSplit,
  createInvoiceForMilestone,
  type JobBillingMilestone,
} from '../lib/jobBillingApi';
import { fetchReminderSettings, fetchReminderLog, type ReminderSettings, type ReminderLogEntry } from '../lib/remindersApi';
import { formatCents, type TaxLine } from '../lib/jobCalc';
import { Job } from '../types';
import StatusBadge from '../components/ui/StatusBadge';
import { useJobModalController } from '../contexts/JobModalController';
import { useTranslation } from '../i18n';
import ActivityTimeline from '../components/ActivityTimeline';
import { useDropZone } from '../hooks/useDropZone';
import { getRecurrenceRule, createRecurrenceRule, deactivateRecurrenceRule, type RecurrenceRule, type RecurrenceFrequency } from '../lib/recurringJobsApi';
import { getServiceContractByJob, type ServiceContract } from '../lib/serviceContractsApi';
import { getJobAgreementByJob, sendAgreementEmail, type JobAgreement } from '../lib/jobAgreementsApi';
import AgreementPreviewModal from '../components/agreements/AgreementPreviewModal';
import AgreementCreateModal from '../components/agreements/AgreementCreateModal';
import AgreementServicesSummary from '../components/agreements/AgreementServicesSummary';
import { buildAgreementDocData, getAgreementCompanyBranding } from '../lib/agreementDoc';
import { downloadAgreementPdf } from '../lib/generateAgreementPdf';
import SendSmsModal from '../components/communications/SendSmsModal';
import SendEmailModal from '../components/communications/SendEmailModal';
import CommunicationsTimeline from '../components/communications/CommunicationsTimeline';
import { usePermissions } from '../hooks/usePermissions';
import { hasPermission } from '../lib/permissions';
import SpecificNotes from '../components/SpecificNotes';
import LeaveFormConfirm from '../components/ui/LeaveFormConfirm';
import { useNavigationGuard } from '../contexts/NavigationGuard';
import EntityHubHeader from '../components/EntityHubHeader';
import EntityNumberEditor from '../components/EntityNumberEditor';
import ClientPinMiniMap, { type ClientMapPin } from '../components/map-d2d/ClientPinMiniMap';
import { getPins } from '../lib/fieldSalesApi';

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
  billing_milestone_id: string | null;
}

// Local editable row for the payment schedule (billing split)
interface MilestoneRowUI {
  id: string | null; // null until saved
  key: string; // stable React key
  label: string;
  percent: number | null;
  amount_cents: number;
  due_date: string | null;
}

const toMilestoneRowUI = (m: JobBillingMilestone): MilestoneRowUI => ({
  id: m.id,
  key: m.id,
  label: m.label,
  percent: m.percent,
  amount_cents: m.amount_cents,
  due_date: m.due_date,
});

interface ClientInfo {
  phone: string | null;
  email: string | null;
  address: string | null;
  company: string | null;
  latitude: number | null;
  longitude: number | null;
}

// ─── Component ───────────────────────────────────────────────────────
export default function JobDetails() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const { openJobModal } = useJobModalController();
  const permsCtx = usePermissions();
  const canSeePricing = permsCtx.role === 'owner' || permsCtx.role === 'admin' ||
    hasPermission(permsCtx.permissions, 'financial.view_pricing', permsCtx.role ?? undefined);
  const canSeeInvoices = permsCtx.role === 'owner' || permsCtx.role === 'admin' ||
    hasPermission(permsCtx.permissions, 'financial.view_invoices', permsCtx.role ?? undefined);
  const canSeeMargins = permsCtx.role === 'owner' || permsCtx.role === 'admin' ||
    hasPermission(permsCtx.permissions, 'financial.view_margins', permsCtx.role ?? undefined);

  const { updateLabel: updateRecentLabel } = useRecentItems();
  const [job, setJob] = useState<Job | null>(null);
  const [lineItems, setLineItems] = useState<JobLineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Extra data
  const [visits, setVisits] = useState<ScheduleEvent[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null);
  const [showAddVisit, setShowAddVisit] = useState(false);

  // Action states
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isCreatingInvoice, setIsCreatingInvoice] = useState(false);
  const [showProfitability, setShowProfitability] = useState(false);
  const [invoiceTab, setInvoiceTab] = useState<'billing' | 'reminders'>('billing');

  // Billing split — payment schedule
  const [milestones, setMilestones] = useState<MilestoneRowUI[]>([]);
  const [scheduleDirty, setScheduleDirty] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [togglingSplit, setTogglingSplit] = useState(false);
  const [creatingMilestoneId, setCreatingMilestoneId] = useState<string | null>(null);

  // Leave-without-saving guard while the payment schedule holds unsaved edits.
  const guard = useNavigationGuard(scheduleDirty);
  useEffect(() => {
    if (!scheduleDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [scheduleDirty]);

  // Payment reminders (org settings + log, loaded when the tab opens)
  const [reminderSettings, setReminderSettings] = useState<ReminderSettings | null>(null);
  const [reminderLog, setReminderLog] = useState<ReminderLogEntry[]>([]);
  const [remindersLoading, setRemindersLoading] = useState(false);
  const [remindersLoaded, setRemindersLoaded] = useState(false);

  // Modals
  const [showSmsModal, setShowSmsModal] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailMode, setEmailMode] = useState<'confirmation' | 'followup' | 'generic'>('confirmation');
  const [commRefreshKey, setCommRefreshKey] = useState(0);

  // Service plan contract (12-month calendar snapshot, optional)
  const [contract, setContract] = useState<ServiceContract | null>(null);

  // Written agreement (job contract, optional)
  const [agreement, setAgreement] = useState<JobAgreement | null>(null);
  const [showAgreementPreview, setShowAgreementPreview] = useState(false);
  const [showAgreementCreate, setShowAgreementCreate] = useState(false);
  const [agreementSending, setAgreementSending] = useState(false);

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
          const orgId = await getCurrentOrgIdOrThrow();
          await supabase.from('jobs').update({ attachments: updated, updated_at: new Date().toISOString() }).eq('id', job.id).eq('org_id', orgId);
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
  const loadVisits = useCallback(async () => {
    if (!id) return;
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
  }, [id]);

  useEffect(() => {
    void loadVisits();
  }, [loadVisits]);

  // Reload visits + job (jobs.scheduled_at is recomputed server-side) after a
  // visit is added, so the header date reflects the next upcoming visit.
  const handleVisitAdded = useCallback(async () => {
    await loadVisits();
    if (id) {
      try {
        const fresh = await getJobById(id);
        if (fresh) setJob(fresh);
      } catch { /* non-blocking */ }
    }
  }, [id, loadVisits]);

  // ── Load invoices for this job ──
  const loadInvoices = useCallback(async () => {
    if (!id) return;
    try {
      let { data, error: invErr } = await supabase
        .from('invoices')
        .select('id,invoice_number,status,due_date,subject,total_cents,balance_cents,billing_milestone_id')
        .eq('job_id', id)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
      if (invErr) {
        // billing_milestone_id may not exist yet (migration pending) — degrade gracefully
        const fallback = await supabase
          .from('invoices')
          .select('id,invoice_number,status,due_date,subject,total_cents,balance_cents')
          .eq('job_id', id)
          .is('deleted_at', null)
          .order('created_at', { ascending: true });
        if (fallback.error) throw fallback.error;
        data = fallback.data as any;
      }
      setInvoices(
        (data || []).map((r: any) => ({
          id: r.id,
          invoice_number: r.invoice_number || null,
          status: r.status || 'draft',
          due_date: r.due_date || null,
          subject: r.subject || 'For Services Rendered',
          total_cents: Number(r.total_cents || 0),
          balance_cents: Number(r.balance_cents ?? r.total_cents ?? 0),
          billing_milestone_id: r.billing_milestone_id || null,
        })),
      );
    } catch (err: any) {
      console.warn('Failed to load invoices:', err?.message);
    }
  }, [id]);

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  // ── Load payment schedule (billing split milestones) ──
  const loadMilestones = useCallback(async () => {
    if (!id) return;
    try {
      const rows = await listJobBillingMilestones(id);
      setMilestones(rows.map(toMilestoneRowUI));
      setScheduleDirty(false);
    } catch (err: any) {
      console.warn('Failed to load payment schedule:', err?.message);
    }
  }, [id]);

  useEffect(() => {
    void loadMilestones();
  }, [loadMilestones]);

  // Milestone id → its invoice (for locked rows / links)
  const invoiceByMilestone = useMemo(() => {
    const map = new Map<string, InvoiceRow>();
    for (const inv of invoices) {
      if (inv.billing_milestone_id) map.set(inv.billing_milestone_id, inv);
    }
    return map;
  }, [invoices]);

  // ── Load reminder settings + log when the reminders tab opens ──
  useEffect(() => {
    if (invoiceTab !== 'reminders' || remindersLoaded || remindersLoading) return;
    setRemindersLoading(true);
    Promise.all([fetchReminderSettings(), fetchReminderLog(200)])
      .then(([settings, log]) => {
        setReminderSettings(settings);
        setReminderLog(log);
        setRemindersLoaded(true);
      })
      .catch((err: any) => console.warn('Failed to load reminders:', err?.message))
      .finally(() => setRemindersLoading(false));
  }, [invoiceTab, remindersLoaded, remindersLoading]);

  // Reminder log entries for this job's invoices only
  const jobReminderLog = useMemo(() => {
    if (invoices.length === 0) return [] as ReminderLogEntry[];
    const ids = new Set(invoices.map((inv) => inv.id));
    return reminderLog.filter((entry) => entry.invoice_id && ids.has(entry.invoice_id));
  }, [invoices, reminderLog]);

  // ── Load client contact info ──
  useEffect(() => {
    if (!job?.client_id) return;
    (async () => {
      try {
        const { data } = await supabase
          .from('clients')
          .select('phone,email,address,company,latitude,longitude')
          .is('deleted_at', null)
          .eq('id', job.client_id)
          .maybeSingle();
        if (data) setClientInfo(data as ClientInfo);
      } catch (err: any) {
        console.warn('Failed to load client info:', err?.message);
      }
    })();
  }, [job?.client_id]);

  // ── D2D sales-map pin for the mini map next to Specific Notes ──
  // All pins are fetched (same data as the full map) but only the one tied to
  // this job or its client is shown.
  const [d2dPin, setD2dPin] = useState<ClientMapPin | null>(null);
  useEffect(() => {
    let active = true;
    setD2dPin(null);
    if (!id) return;
    getPins()
      .then((pins) => {
        if (!active) return;
        const clientId = job?.client_id || null;
        const match =
          pins.find((p) => p.job_id === id) ||
          (clientId ? pins.find((p) => p.client_id === clientId || p.lead_id === clientId) : null) ||
          null;
        setD2dPin(match ? { lat: match.lat, lng: match.lng, status: match.status } : null);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [id, job?.client_id]);

  // Best coordinates for the mini map: the D2D pin when one exists, else the
  // job's geocoded position, else the client record's.
  const miniMapPin = useMemo<ClientMapPin | null>(() => {
    if (d2dPin) return d2dPin;
    if (job?.latitude != null && job?.longitude != null) {
      return { lat: job.latitude, lng: job.longitude, status: 'other' };
    }
    if (clientInfo?.latitude != null && clientInfo?.longitude != null) {
      return { lat: clientInfo.latitude, lng: clientInfo.longitude, status: 'other' };
    }
    return null;
  }, [d2dPin, job?.latitude, job?.longitude, clientInfo?.latitude, clientInfo?.longitude]);

  // Load recurrence rule
  useEffect(() => {
    if (!id) return;
    getRecurrenceRule(id).then(setRecurrence).catch(() => {});
  }, [id]);

  // Load service plan contract (null when none / migration pending)
  useEffect(() => {
    if (!id) return;
    getServiceContractByJob(id).then(setContract).catch(() => {});
  }, [id]);

  // Load written agreement (null when none / migration pending)
  const reloadAgreement = useCallback(() => {
    if (!id) return;
    getJobAgreementByJob(id).then(setAgreement).catch(() => {});
  }, [id]);

  useEffect(() => {
    reloadAgreement();
  }, [reloadAgreement]);

  // ── Agreement actions ──
  const handleAgreementDownload = async () => {
    if (!agreement || !job) return;
    try {
      const company = await getAgreementCompanyBranding();
      const docData = buildAgreementDocData({
        agreement,
        job,
        lineItems,
        company,
        clientName: job.client_name || null,
        clientEmail: clientInfo?.email || null,
        clientPhone: clientInfo?.phone || null,
      });
      downloadAgreementPdf(docData);
    } catch (err: any) {
      toast.error(err?.message || (language === 'fr' ? 'Échec du téléchargement.' : 'Download failed.'));
    }
  };

  const handleAgreementSend = async () => {
    if (!agreement) return;
    setAgreementSending(true);
    try {
      await sendAgreementEmail(agreement.id);
      toast.success(language === 'fr' ? 'Contrat envoyé par courriel.' : 'Agreement sent by email.');
      reloadAgreement();
    } catch (err: any) {
      toast.error(err?.message || (language === 'fr' ? "Échec de l'envoi du contrat." : 'Failed to send the agreement.'));
    } finally {
      setAgreementSending(false);
    }
  };

  const copyAgreementSignatureLink = () => {
    if (!agreement) return;
    const url = `${window.location.origin}/contract/${agreement.view_token}`;
    navigator.clipboard.writeText(url)
      .then(() => toast.success(language === 'fr' ? 'Lien de signature copié.' : 'Signature link copied.'))
      .catch(() => toast.error(language === 'fr' ? 'Impossible de copier le lien.' : 'Could not copy the link.'));
  };

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
    if (isClosing) return; // prevent double-click race
    const confirmMsg = t.jobDetails?.markCompletedPrompt
      || 'Mark this job as completed? This locks the job for edits (except via admin action).';
    if (typeof window !== 'undefined' && !window.confirm(confirmMsg)) return;
    setIsClosing(true);
    try {
      const updated = await updateJob(job.id, { status: 'completed' });
      setJob(updated);
      toast.success('Job marked as completed');
      setMoreActionsOpen(false);

      // Auto-propose invoice creation if no invoice exists
      // (split jobs are billed through their payment schedule instead)
      if (invoices.length === 0 && !job.billing_split) {
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
    if (job.billing_split) {
      // Split jobs are billed through the payment schedule, not a single full invoice
      setInvoiceTab('billing');
      setMoreActionsOpen(false);
      toast.info(t.jobDetails?.splitUsesSchedule || 'This job uses a payment schedule — create invoices from the billing schedule.');
      return;
    }
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

  // ── Billing split (payment schedule) actions ──
  const scheduledTotalCents = milestones.reduce((sum, m) => sum + m.amount_cents, 0);

  const isoDatePlusDays = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

  const handleToggleSplit = async () => {
    if (!job || togglingSplit) return;
    const next = !job.billing_split;
    setTogglingSplit(true);
    try {
      await setJobBillingSplit(job.id, next);
      setJob((prev) => (prev ? { ...prev, billing_split: next } : prev));
      if (next && milestones.length === 0) {
        // Seed a 50/50 deposit + final payment schedule as a starting point
        const deposit = Math.round(displayTotalCents / 2);
        setMilestones([
          {
            id: null,
            key: crypto.randomUUID(),
            label: t.jobDetails?.deposit || 'Deposit',
            percent: 50,
            amount_cents: deposit,
            due_date: isoDatePlusDays(0),
          },
          {
            id: null,
            key: crypto.randomUUID(),
            label: t.jobDetails?.finalPayment || 'Final payment',
            percent: 50,
            amount_cents: displayTotalCents - deposit,
            due_date: isoDatePlusDays(30),
          },
        ]);
        setScheduleDirty(true);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update billing mode');
    } finally {
      setTogglingSplit(false);
    }
  };

  const updateMilestone = (key: string, patch: Partial<MilestoneRowUI>) => {
    setMilestones((prev) => prev.map((m) => (m.key === key ? { ...m, ...patch } : m)));
    setScheduleDirty(true);
  };

  const handleMilestoneAmountChange = (key: string, dollars: number) => {
    const cents = Math.max(0, Math.round(dollars * 100));
    updateMilestone(key, {
      amount_cents: cents,
      percent: displayTotalCents > 0 ? Math.round((cents / displayTotalCents) * 10000) / 100 : null,
    });
  };

  const handleMilestonePercentChange = (key: string, pct: number) => {
    const clamped = Math.max(0, pct);
    updateMilestone(key, {
      percent: clamped,
      amount_cents: Math.max(0, Math.round((displayTotalCents * clamped) / 100)),
    });
  };

  const handleAddMilestone = () => {
    const remaining = Math.max(0, displayTotalCents - scheduledTotalCents);
    setMilestones((prev) => [
      ...prev,
      {
        id: null,
        key: crypto.randomUUID(),
        label: '',
        percent: displayTotalCents > 0 ? Math.round((remaining / displayTotalCents) * 10000) / 100 : null,
        amount_cents: remaining,
        due_date: null,
      },
    ]);
    setScheduleDirty(true);
  };

  const handleRemoveMilestone = (key: string) => {
    setMilestones((prev) => prev.filter((m) => m.key !== key));
    setScheduleDirty(true);
  };

  const handleSaveSchedule = async () => {
    if (!job || savingSchedule) return;
    setSavingSchedule(true);
    try {
      const saved = await saveJobBillingMilestones(
        job.id,
        milestones.map((m, idx) => ({
          id: m.id,
          position: idx,
          label: m.label,
          percent: m.percent,
          amount_cents: m.amount_cents,
          due_date: m.due_date,
        })),
      );
      setMilestones(saved.map(toMilestoneRowUI));
      setScheduleDirty(false);
      toast.success(t.jobDetails?.scheduleSaved || 'Payment schedule saved.');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save payment schedule');
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleCreateMilestoneInvoice = async (row: MilestoneRowUI) => {
    if (!job || !row.id || creatingMilestoneId) return;
    setCreatingMilestoneId(row.id);
    try {
      const result = await createInvoiceForMilestone({ jobId: job.id, milestoneId: row.id, sendNow: false });
      const invoiceId = String(result.invoice_id || result.invoice?.id || '').trim();
      queryClient.invalidateQueries({ queryKey: ['invoicesTable'] });
      toast.success(
        result.already_exists
          ? (t.jobDetails?.milestoneInvoiceExists || 'An invoice already exists for this payment.')
          : (t.jobDetails?.milestoneInvoiceCreated || 'Invoice created for this payment.'),
        invoiceId
          ? { action: { label: t.jobDetails?.viewInvoiceAction || 'View invoice', onClick: () => navigate(`/invoices/${invoiceId}`) } }
          : undefined,
      );
      await loadInvoices();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create invoice');
    } finally {
      setCreatingMilestoneId(null);
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

        {/* ═══ HUB HEADER ═══ */}
        <EntityHubHeader
          icon={<Briefcase size={18} strokeWidth={2} />}
          status={job.status}
          statusExtra={isToday ? <span className="badge-neutral text-[11px]">Today</span> : null}
          title={job.title || job.client_name || 'Job'}
          number={
            <EntityNumberEditor
              entity="job"
              entityId={job.id}
              value={job.job_number}
              onSaved={(n) => setJob((prev) => (prev ? { ...prev, job_number: n } : prev))}
            />
          }
          client={{ id: job.client_id, name: job.client_name || 'Unassigned' }}
          address={job.property_address}
          phone={clientInfo?.phone}
          email={clientInfo?.email}
          actions={
          <>
            <button
              onClick={() => {
                if (!clientInfo?.phone) {
                  toast.error(language === 'fr' ? 'Numéro de téléphone manquant pour ce client' : 'No phone number for this client');
                  return;
                }
                const params = new URLSearchParams({
                  ...(job.client_id ? { clientId: job.client_id } : {}),
                  phone: clientInfo.phone,
                  ...(job.client_name ? { name: job.client_name } : {}),
                });
                navigate(`/messages?${params.toString()}`);
              }}
              className="glass-button-primary inline-flex items-center gap-1.5"
            >
              <MessageSquare size={14} /> {language === 'fr' ? 'Texter le client' : 'Text Client'}
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
                    // (split jobs are billed through their payment schedule instead)
                    if (invoices.length === 0 && !job.billing_split) {
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
                <CheckCircle2 size={13} /> {isClosing ? 'Processing...' : (canSeeInvoices ? 'Complete & Invoice' : 'Complete')}
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
                    {canSeeInvoices && <DropdownItem icon={<FileText size={13} />} label={isCreatingInvoice ? 'Creating...' : 'Create Invoice'} onClick={handleCreateInvoice} disabled={isCreatingInvoice} />}
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
          </>
          }
        />

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

          {/* Job details (client name, address and contact now live in the hub header) */}
          <div>
            <div className="p-5">
              <p className="text-xs font-medium uppercase tracking-wider text-text-tertiary mb-2">Job details</p>
              <div className="space-y-0">
                <JobDetailRow label="Job type" value={job.job_type || 'One-off job'} />
                <JobDetailRow label="Starts on" value={job.scheduled_at ? formatDate(job.scheduled_at) : '—'} />
                <JobDetailRow label="Ends on" value={job.end_at ? formatDate(job.end_at) : (job.scheduled_at ? formatDate(job.scheduled_at) : '—')} />
                <JobDetailRow label="Billing frequency" value={(job as any).requires_invoicing === false ? 'No invoicing' : 'Upon job completion'} />
                <JobDetailRow label="Deposit" value={(job as any).deposit_required ? `${(job as any).deposit_type === 'percentage' ? `${(job as any).deposit_value}%` : `$${(job as any).deposit_value}`}` : 'None'} />
                <JobDetailRow label="Salesperson" value={(job as any).salesperson_name || (job as any).salesperson?.full_name || '—'} isLast />
              </div>
            </div>
          </div>
        </div>

        {/* ═══ PROFITABILITY + LINE ITEMS ═══ */}
        <div className="rounded-xl border border-outline bg-surface overflow-hidden">
          {/* Profitability toggle — hidden for roles without margin access */}
          {canSeeMargins && (
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
          )}

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
                      {canSeeMargins && <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wider text-text-tertiary text-right w-28">Cost</th>}
                      {canSeePricing && <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wider text-text-tertiary text-right w-28">Price</th>}
                      {canSeePricing && <th className="px-0 py-2.5 text-xs font-medium uppercase tracking-wider text-text-tertiary text-right w-28">Total</th>}
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
                          {canSeeMargins && <td className="px-3 py-3 text-[13px] text-text-secondary text-right tabular-nums">{formatCents((item as any).cost_cents || 0)}</td>}
                          {canSeePricing && <td className="px-3 py-3 text-[13px] text-text-secondary text-right tabular-nums">{formatCents(item.unit_price_cents)}</td>}
                          {canSeePricing && <td className="py-3 text-[13px] text-text-primary font-semibold text-right tabular-nums">{formatCents(lineTotalCents)}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Totals — hidden without pricing access */}
            {canSeePricing && lineItems.length > 0 && (
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
            <button onClick={() => setShowAddVisit(true)} className="glass-button !text-[12px] !px-2.5 !py-1 inline-flex items-center gap-1 print:hidden">
              {language === 'fr' ? 'Nouvelle visite' : 'New Visit'}
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
                  const tloc = language === 'fr' ? 'fr-CA' : 'en-CA';
                  return `${start.toLocaleTimeString(tloc, { hour: '2-digit', minute: '2-digit' })} — ${end.toLocaleTimeString(tloc, { hour: '2-digit', minute: '2-digit' })}`;
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

        {/* ═══ SERVICE PLAN CONTRACT — 12-month calendar, planned months show their visit date ═══ */}
        {contract && (
          <div className="rounded-xl border border-outline bg-surface overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline-subtle">
              <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
                <div className="icon-tile icon-tile-sm icon-tile-blue">
                  <FileText size={13} strokeWidth={2} />
                </div>
                {language === 'fr' ? 'Contrat de service' : 'Service contract'} · {contract.year}
              </h2>
              <span className="text-[12px] text-text-tertiary">
                {contract.visits.length} {language === 'fr' ? 'visites planifiées' : 'planned visits'}
              </span>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
                  const visit = contract.visits.find((v) => v.month === month);
                  const monthName = new Date(2000, month - 1, 1)
                    .toLocaleDateString(language === 'fr' ? 'fr-CA' : 'en-CA', { month: 'long' });
                  return (
                    <div
                      key={month}
                      className={cn(
                        'rounded-lg border p-3',
                        visit
                          ? 'border-primary/50 bg-primary/5'
                          : 'border-outline-subtle bg-surface-secondary/40 opacity-60'
                      )}
                    >
                      <p className={cn('text-[12px] font-semibold capitalize', visit ? 'text-primary' : 'text-text-tertiary')}>
                        {monthName}
                      </p>
                      <p className={cn('text-[13px] mt-1 tabular-nums', visit ? 'text-text-primary font-semibold' : 'text-text-tertiary')}>
                        {visit ? formatDate(`${visit.date}T12:00:00`) : '—'}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ═══ AGREEMENT (written contract) ═══ */}
        {agreement ? (
          <div
            className="rounded-xl border border-outline bg-surface overflow-hidden cursor-pointer transition-colors hover:border-primary/40"
            onClick={() => window.open(`/contract/${agreement.view_token}`, '_blank')}
            title={language === 'fr' ? 'Voir le contrat tel que le client le voit' : 'View the contract as the client sees it'}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline-subtle">
              <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
                <div className="icon-tile icon-tile-sm icon-tile-blue">
                  <FileText size={13} strokeWidth={2} />
                </div>
                {language === 'fr' ? 'Contrat' : 'Agreement'} · CTR-{job.job_number}
              </h2>
              <span className={cn(
                'text-[11px] font-semibold px-2.5 py-0.5 rounded-full border',
                agreement.status === 'signed'
                  ? 'bg-success-light text-success border-success/30'
                  : agreement.status === 'sent' && agreement.require_signature
                    ? 'bg-warning-light text-warning border-warning/30'
                    : agreement.status === 'sent'
                      ? 'bg-primary/5 text-primary border-primary/20'
                      : 'bg-surface-secondary text-text-secondary border-outline'
              )}>
                {agreement.status === 'signed'
                  ? (language === 'fr' ? 'Signé' : 'Signed')
                  : agreement.status === 'sent' && agreement.require_signature
                    ? (language === 'fr' ? 'En attente de signature' : 'Awaiting signature')
                    : agreement.status === 'sent'
                      ? (language === 'fr' ? 'Envoyé' : 'Sent')
                      : (language === 'fr' ? 'Brouillon' : 'Draft')}
              </span>
            </div>
            <div className="p-5 space-y-4">
              {agreement.status === 'signed' && agreement.signature_data && (
                <div className="flex items-center gap-3 rounded-lg border border-success/30 bg-success-light px-3 py-2.5">
                  <img src={agreement.signature_data} alt="Signature" className="h-10 max-w-[140px] object-contain shrink-0" />
                  <div>
                    <p className="text-[12.5px] font-semibold text-success">
                      {(language === 'fr' ? 'Signé par ' : 'Signed by ') + (agreement.signer_name || '—')}
                    </p>
                    {agreement.signed_at && (
                      <p className="text-[11.5px] text-text-tertiary">{formatDate(agreement.signed_at)}</p>
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-[0.05em]">
                    {language === 'fr' ? 'Créé le' : 'Created'}
                  </p>
                  <p className="text-[13px] font-semibold text-text-primary mt-0.5">{formatDate(agreement.created_at)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-[0.05em]">
                    {language === 'fr' ? 'Signature requise' : 'Signature required'}
                  </p>
                  <p className="text-[13px] font-semibold text-text-primary mt-0.5">
                    {agreement.require_signature ? (language === 'fr' ? 'Oui' : 'Yes') : (language === 'fr' ? 'Non' : 'No')}
                  </p>
                </div>
                {canSeePricing && (
                  <div>
                    <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-[0.05em]">Total</p>
                    <p className="text-[13px] font-semibold text-text-primary mt-0.5 tabular-nums">
                      {formatCents(agreement.snapshot?.total_cents ?? displayTotalCents)}
                    </p>
                  </div>
                )}
              </div>

              {/* Services + prices the contract covers — frozen snapshot once signed, live job items otherwise */}
              {canSeePricing && (
                <AgreementServicesSummary
                  title={agreement.snapshot
                    ? (language === 'fr' ? 'Services et prix (figés à la signature)' : 'Services and prices (frozen at signature)')
                    : (language === 'fr' ? 'Services et prix du job' : 'Job services and prices')}
                  data={agreement.snapshot
                    ? {
                        items: agreement.snapshot.items || [],
                        subtotalCents: agreement.snapshot.subtotal_cents || 0,
                        discount: agreement.snapshot.discount_cents
                          ? { amountCents: agreement.snapshot.discount_cents, percent: agreement.snapshot.discount_percent ?? null }
                          : null,
                        taxLines: agreement.snapshot.tax_lines || [],
                        totalCents: agreement.snapshot.total_cents || 0,
                      }
                    : {
                        items: lineItems
                          .filter((it) => it.included)
                          .map((it) => ({ name: it.name, qty: it.qty, unit_price_cents: it.unit_price_cents, total_cents: it.total_cents })),
                        subtotalCents: displaySubtotalCents,
                        taxLines: enabledTaxes.map((tx) => ({
                          label: tx.label,
                          rate: tx.rate,
                          amount_cents: Math.round(displaySubtotalCents * (tx.rate / 100)),
                        })),
                        totalCents: displayTotalCents,
                      }}
                />
              )}

              {agreement.terms && (
                <p className="text-[12px] text-text-tertiary leading-relaxed rounded-lg border border-outline-subtle bg-surface-secondary/40 px-3 py-2.5 line-clamp-2">
                  {agreement.terms}
                </p>
              )}

              <div className="flex flex-wrap gap-2 print:hidden" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => window.open(`/contract/${agreement.view_token}`, '_blank')}
                  className="bg-primary text-primary-foreground rounded-lg px-3.5 py-1.5 text-[12px] font-semibold hover:opacity-90 transition-opacity inline-flex items-center gap-1.5"
                >
                  <Eye size={12} />
                  {language === 'fr' ? 'Voir le contrat' : 'View contract'}
                </button>
                <button
                  onClick={() => setShowAgreementPreview(true)}
                  className="glass-button !text-[12px] !px-3 !py-1.5"
                >
                  {language === 'fr' ? 'Aperçu' : 'Preview'}
                </button>
                <button onClick={handleAgreementDownload} className="glass-button !text-[12px] !px-3 !py-1.5 inline-flex items-center gap-1.5">
                  <Download size={12} />
                  {language === 'fr' ? 'Télécharger le PDF' : 'Download PDF'}
                </button>
                <button
                  onClick={handleAgreementSend}
                  disabled={agreementSending}
                  className="glass-button !text-[12px] !px-3 !py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Mail size={12} />
                  {language === 'fr' ? 'Envoyer par courriel' : 'Send by email'}
                </button>
                {agreement.require_signature && agreement.status !== 'signed' && (
                  <button onClick={copyAgreementSignatureLink} className="glass-button !text-[12px] !px-3 !py-1.5 inline-flex items-center gap-1.5">
                    <LinkIcon size={12} />
                    {language === 'fr' ? 'Copier le lien de signature' : 'Copy signature link'}
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* No agreement yet — offer to create one for this existing job */
          <div className="rounded-xl border border-outline bg-surface overflow-hidden print:hidden">
            <div className="flex items-center justify-between px-5 py-3.5">
              <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
                <div className="icon-tile icon-tile-sm icon-tile-blue">
                  <FileText size={13} strokeWidth={2} />
                </div>
                {language === 'fr' ? 'Contrat' : 'Agreement'}
                <span className="text-[12px] font-normal text-text-tertiary ml-1">
                  {language === 'fr' ? 'Aucun contrat pour ce job' : 'No agreement for this job'}
                </span>
              </h2>
              <button
                onClick={() => setShowAgreementCreate(true)}
                className="glass-button !text-[12px] !px-2.5 !py-1 inline-flex items-center gap-1"
              >
                <Plus size={12} />
                {language === 'fr' ? 'Créer un contrat' : 'Create agreement'}
              </button>
            </div>
          </div>
        )}

        {/* ═══ INVOICES — hidden for financially restricted roles ═══ */}
        {canSeeInvoices && <div className="rounded-xl border border-outline bg-surface overflow-hidden">
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
                <label className={cn('flex items-center gap-2 text-[13px] text-text-secondary mb-4 w-fit select-none print:hidden', togglingSplit ? 'opacity-50 cursor-wait' : 'cursor-pointer')}>
                  <input type="checkbox" className="sr-only" checked={!!job.billing_split} disabled={togglingSplit} onChange={handleToggleSplit} />
                  <span className={cn('w-4 h-4 rounded border inline-flex items-center justify-center transition-colors', job.billing_split ? 'bg-primary border-primary text-white' : 'border-outline bg-surface-secondary')}>
                    {job.billing_split && <span className="text-[9px]">✓</span>}
                  </span>
                  {t.modals?.splitInvoices || 'Split into multiple invoices with a payment schedule'}
                </label>

                {job.billing_split && (
                  <div className="mb-5 rounded-lg border border-outline-subtle bg-surface-secondary/40 p-4 space-y-3 print:hidden">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-[12px] font-semibold text-text-primary">{t.jobDetails?.paymentSchedule || 'Payment schedule'}</p>
                        <p className="text-[11px] text-text-tertiary mt-0.5">{t.jobDetails?.paymentScheduleHint || 'Split the job total into scheduled payments, each billed with its own invoice.'}</p>
                      </div>
                      {canSeePricing && (
                        <p className={cn('text-[11px] font-semibold tabular-nums', scheduledTotalCents === displayTotalCents ? 'text-text-tertiary' : 'text-amber-600')}>
                          {t.jobDetails?.scheduledTotal || 'Scheduled'}: {formatCents(scheduledTotalCents)} / {formatCents(displayTotalCents)}
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      {milestones.map((m, idx) => {
                        const linkedInvoice = m.id ? invoiceByMilestone.get(m.id) : undefined;
                        const locked = !!linkedInvoice;
                        return (
                          <div key={m.key} className="flex flex-wrap items-center gap-2">
                            <input
                              type="text"
                              value={m.label}
                              disabled={locked}
                              onChange={(e) => updateMilestone(m.key, { label: e.target.value })}
                              placeholder={`${t.jobDetails?.payment || 'Payment'} ${idx + 1}`}
                              className="flex-1 min-w-[120px] rounded-lg border border-outline bg-surface px-2.5 py-1.5 text-[12px] text-text-primary disabled:opacity-60"
                            />
                            <div className="relative">
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-text-tertiary">$</span>
                              <input
                                type="number"
                                min={0}
                                step={0.01}
                                value={m.amount_cents === 0 ? '' : m.amount_cents / 100}
                                disabled={locked}
                                onChange={(e) => handleMilestoneAmountChange(m.key, Number(e.target.value) || 0)}
                                className="w-28 rounded-lg border border-outline bg-surface pl-5 pr-2 py-1.5 text-[12px] text-text-primary tabular-nums disabled:opacity-60"
                              />
                            </div>
                            <div className="relative">
                              <input
                                type="number"
                                min={0}
                                step={0.01}
                                value={m.percent ?? ''}
                                disabled={locked}
                                onChange={(e) => handleMilestonePercentChange(m.key, Number(e.target.value) || 0)}
                                className="w-20 rounded-lg border border-outline bg-surface pl-2 pr-6 py-1.5 text-[12px] text-text-primary tabular-nums disabled:opacity-60"
                              />
                              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-text-tertiary">%</span>
                            </div>
                            <input
                              type="date"
                              value={m.due_date || ''}
                              disabled={locked}
                              onChange={(e) => updateMilestone(m.key, { due_date: e.target.value || null })}
                              className="rounded-lg border border-outline bg-surface px-2.5 py-1.5 text-[12px] text-text-primary disabled:opacity-60"
                            />
                            {linkedInvoice ? (
                              <button
                                onClick={() => navigate(`/invoices/${linkedInvoice.id}`)}
                                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-text-primary hover:underline"
                              >
                                #{linkedInvoice.invoice_number || '—'}
                                <StatusBadge status={getInvoiceRowUiStatus(linkedInvoice as any)} />
                              </button>
                            ) : (
                              <>
                                <button
                                  onClick={() => handleCreateMilestoneInvoice(m)}
                                  disabled={scheduleDirty || !m.id || m.amount_cents <= 0 || creatingMilestoneId === m.id}
                                  title={scheduleDirty ? (t.jobDetails?.scheduleUnsavedHint || 'Save the schedule before creating invoices.') : undefined}
                                  className="glass-button !text-[12px] !px-2.5 !py-1 disabled:opacity-50"
                                >
                                  {creatingMilestoneId === m.id ? '...' : (t.jobDetails?.createMilestoneInvoice || 'Create invoice')}
                                </button>
                                <button
                                  onClick={() => handleRemoveMilestone(m.key)}
                                  className="p-1 text-text-tertiary hover:text-red-500 transition-colors"
                                  aria-label="Remove payment"
                                >
                                  <X size={13} />
                                </button>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button onClick={handleAddMilestone} className="glass-button !text-[12px] !px-2.5 !py-1 inline-flex items-center gap-1">
                        <Plus size={12} /> {t.jobDetails?.addPayment || 'Add payment'}
                      </button>
                      {scheduleDirty && (
                        <>
                          <button
                            onClick={handleSaveSchedule}
                            disabled={savingSchedule}
                            className="bg-primary text-primary-foreground rounded-lg px-3 py-1 text-[12px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
                          >
                            {savingSchedule ? '...' : (t.jobDetails?.saveSchedule || 'Save schedule')}
                          </button>
                          <span className="text-[11px] text-text-tertiary">{t.jobDetails?.scheduleUnsavedHint || 'Save the schedule before creating invoices.'}</span>
                        </>
                      )}
                    </div>
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
              remindersLoading ? (
                <div className="py-4 space-y-2">
                  <div className="h-4 w-2/3 bg-surface-secondary rounded animate-pulse" />
                  <div className="h-4 w-1/2 bg-surface-secondary rounded animate-pulse" />
                </div>
              ) : !reminderSettings ? (
                <p className="text-[13px] text-text-tertiary py-4 text-center">No reminders configured</p>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-[13px] text-text-secondary">
                    <span className={cn('w-2 h-2 rounded-full shrink-0', reminderSettings.enabled ? 'bg-emerald-500' : 'bg-outline')} />
                    {reminderSettings.enabled
                      ? (t.jobDetails?.remindersActive || 'Automatic payment reminders are enabled for overdue invoices.')
                      : (t.jobDetails?.remindersDisabled || 'Automatic payment reminders are disabled for your organization.')}
                  </div>

                  {reminderSettings.enabled && (reminderSettings.schedule || []).length > 0 && (
                    <ul className="space-y-1.5">
                      {(reminderSettings.schedule || []).map((entry, i) => (
                        <li key={i} className="text-[13px] text-text-secondary flex items-center gap-2">
                          <span className="badge-neutral text-[11px]">
                            {entry.channel === 'both' ? 'Email + SMS' : entry.channel === 'sms' ? 'SMS' : 'Email'}
                          </span>
                          {entry.days_after_due}{' '}
                          {entry.days_after_due === 1
                            ? (t.jobDetails?.reminderDayAfterDue || 'day after due date')
                            : (t.jobDetails?.reminderDaysAfterDue || 'days after due date')}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div>
                    <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-[0.05em] mb-2">
                      {t.jobDetails?.sentReminders || 'Reminders sent for this job'}
                    </p>
                    {jobReminderLog.length === 0 ? (
                      <p className="text-[13px] text-text-tertiary">
                        {t.jobDetails?.noRemindersSentYet || "No reminders sent yet for this job's invoices."}
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {jobReminderLog.map((entry) => {
                          const inv = invoices.find((row) => row.id === entry.invoice_id);
                          return (
                            <li key={entry.id} className="text-[13px] text-text-secondary flex flex-wrap items-center gap-2">
                              <button
                                onClick={() => entry.invoice_id && navigate(`/invoices/${entry.invoice_id}`)}
                                className="font-semibold text-text-primary hover:underline"
                              >
                                #{inv?.invoice_number || '—'}
                              </button>
                              <span className="badge-neutral text-[11px]">
                                {entry.channel === 'both' ? 'Email + SMS' : entry.channel === 'sms' ? 'SMS' : 'Email'}
                              </span>
                              <span>{entry.sent_at ? formatDate(entry.sent_at) : '—'}</span>
                              {entry.sent_to && <span className="text-text-tertiary">{entry.sent_to}</span>}
                              {entry.status && entry.status !== 'sent' && (
                                <span className="text-[11px] text-red-500">{entry.status}</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              )
            )}
          </div>
        </div>}

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

        {/* ═══ SPECIFIC NOTES + CLIENT SALES-MAP PIN ═══ */}
        <div className="grid gap-4 md:grid-cols-2">
          <SpecificNotes entityType="job" entityId={id!} mode="full" />
          <ClientPinMiniMap
            pin={miniMapPin}
            hasClient={Boolean(job.client_id)}
            onOpen={() => {
              if (miniMapPin) navigate(`/field-sales?lat=${miniMapPin.lat}&lng=${miniMapPin.lng}`);
            }}
          />
        </div>

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

        {/* Leave-without-saving confirmation (unsaved payment schedule) */}
        <LeaveFormConfirm open={guard.active} onConfirm={guard.confirmLeave} onCancel={guard.cancelLeave} />
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

      {job && (
        <AddVisitModal
          open={showAddVisit}
          onClose={() => setShowAddVisit(false)}
          onAdded={() => void handleVisitAdded()}
          job={{ id: job.id, label: [job.title, job.client_name].filter(Boolean).join(' — ') || (language === 'fr' ? 'Job' : 'Job') }}
        />
      )}

      {job && (
        <AgreementCreateModal
          open={showAgreementCreate}
          onClose={() => setShowAgreementCreate(false)}
          jobId={job.id}
          clientId={job.client_id || null}
          onCreated={setAgreement}
          preview={{
            numberLabel: `CTR-${job.job_number}`,
            clientName: job.client_name || null,
            clientEmail: clientInfo?.email || null,
            clientPhone: clientInfo?.phone || null,
            propertyAddress: job.property_address || null,
            items: lineItems
              .filter((it) => it.included)
              .map((it) => ({ name: it.name, qty: it.qty, unit_price_cents: it.unit_price_cents, total_cents: it.total_cents })),
            taxLines: enabledTaxes.map((tx) => ({ label: tx.label, rate: tx.rate })),
            subtotalCents: displaySubtotalCents,
          }}
        />
      )}

      {job && agreement && (
        <AgreementPreviewModal
          open={showAgreementPreview}
          onClose={() => setShowAgreementPreview(false)}
          agreement={agreement}
          job={job}
          lineItems={lineItems}
          clientName={job.client_name || null}
          clientEmail={clientInfo?.email || null}
          clientPhone={clientInfo?.phone || null}
          onSent={reloadAgreement}
        />
      )}
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

