import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRecentItems } from '../hooks/useRecentItems';
import {
  ArrowLeft,
  Briefcase,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Download,
  Edit3,
  Eye,
  FileSignature,
  FileText,
  Link as LinkIcon,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Printer,
  ReceiptText,
  Send,
  Trash2,
  X,
  Copy,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { cn, formatDate } from '../lib/utils';
import { supabase } from '../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../lib/orgApi';
import { getJobById, getJobLineItems, listSalespeople, updateJob, type JobLineItem } from '../lib/jobsApi';
import AddVisitModal from '../components/AddVisitModal';
import { invalidateScheduleCache, rescheduleEvent, unscheduleJob } from '../lib/scheduleApi';
import { listTeams, type TeamRecord } from '../lib/teamsApi';
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
import EventsPanel from '../components/events/EventsPanel';
import { useDropZone } from '../hooks/useDropZone';
import { getRecurrenceRule, createRecurrenceRule, deactivateRecurrenceRule, type RecurrenceRule, type RecurrenceFrequency } from '../lib/recurringJobsApi';
import { getServiceContractByJob, type ServiceContract } from '../lib/serviceContractsApi';
import { getJobAgreementByJob, sendAgreementEmail, type JobAgreement } from '../lib/jobAgreementsApi';
import { getQuoteForJob, getQuoteStatusLabel, type Quote } from '../lib/quotesApi';
import { resolveApprovedDocument } from '../lib/approvedDocument';
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
  notes: string | null;
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
  // Visit mini-popup ("visit hub"): opened by clicking a visit row.
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);
  const [visitMoreOpen, setVisitMoreOpen] = useState(false);
  // Inline visit editing (reschedule + team) + per-visit removal
  const [editingVisitId, setEditingVisitId] = useState<string | null>(null);
  const [editVisitDate, setEditVisitDate] = useState('');
  const [editVisitStart, setEditVisitStart] = useState('');
  const [editVisitEnd, setEditVisitEnd] = useState('');
  const [editVisitTeamId, setEditVisitTeamId] = useState('');
  const [visitActionBusy, setVisitActionBusy] = useState(false);
  // Assignment context: teams (visit.team_id → name/color) and the job's
  // individual assignee ("technician" — jobs.assigned_user_id), shown as the
  // fallback when a visit has no team of its own.
  const [teams, setTeams] = useState<TeamRecord[]>([]);
  const [salespeople, setSalespeople] = useState<Array<{ id: string; label: string }>>([]);
  const [jobAssignedUserId, setJobAssignedUserId] = useState<string | null>(null);

  useEffect(() => {
    listTeams().then(setTeams).catch(() => setTeams([]));
    listSalespeople().then(setSalespeople).catch(() => setSalespeople([]));
  }, []);

  // assigned_user_id lives on the jobs row but isn't part of the mapped Job type.
  useEffect(() => {
    if (!id) return;
    supabase
      .from('jobs')
      .select('assigned_user_id')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => setJobAssignedUserId((data as any)?.assigned_user_id || null));
  }, [id]);

  const teamById = useMemo(() => new Map(teams.map((tm) => [tm.id, tm])), [teams]);
  const jobAssigneeLabel = useMemo(
    () => (jobAssignedUserId ? salespeople.find((p) => p.id === jobAssignedUserId)?.label || null : null),
    [jobAssignedUserId, salespeople]
  );

  // Who's on a visit: the visit's own team first, else the job's individual
  // assignee (technician), else the job's team, else unassigned.
  const getVisitAssignment = (visit: ScheduleEvent): { team: TeamRecord | undefined; label: string } => {
    const visitTeam = visit.team_id ? teamById.get(visit.team_id) : undefined;
    const jobTeam = !visit.team_id && job?.team_id ? teamById.get(job.team_id) : undefined;
    const team = visitTeam || (jobAssigneeLabel ? undefined : jobTeam);
    const label = visitTeam?.name
      || (visit.team_id ? (language === 'fr' ? 'Équipe assignée' : 'Team assigned') : null)
      || (jobAssigneeLabel ? `${language === 'fr' ? 'Technicien' : 'Technician'} · ${jobAssigneeLabel}` : null)
      || jobTeam?.name
      || (language === 'fr' ? 'Pas encore assignée' : 'Not assigned yet');
    return { team, label };
  };

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

  // "Send booking confirmation" picker (texto / courriel). Auto-opened when
  // landing here right after creating the job; reopenable from the More menu.
  const location = useLocation();
  const [confirmPrompt, setConfirmPrompt] = useState<null | 'created' | 'manual'>(null);
  useEffect(() => {
    if ((location.state as any)?.justCreated) {
      setConfirmPrompt('created');
      // Clear the flag so a refresh or back-navigation doesn't re-open it.
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.state, location.pathname, navigate]);

  // Service plan contract (12-month calendar snapshot, optional)
  const [contract, setContract] = useState<ServiceContract | null>(null);

  // Written agreement (job contract, optional)
  const [agreement, setAgreement] = useState<JobAgreement | null>(null);
  const [showAgreementPreview, setShowAgreementPreview] = useState(false);
  const [showAgreementCreate, setShowAgreementCreate] = useState(false);
  const [agreementSending, setAgreementSending] = useState(false);

  // Source quote (the job was converted from it) — the signed quote IS the
  // job's approved contract: no agreement allowed, no second signature.
  const [sourceQuote, setSourceQuote] = useState<Quote | null>(null);

  // Public client-approval link offered in the SMS/email confirmation modals.
  // Same precedence as resolveApprovedDocument: the converted quote wins.
  const approvalLink = useMemo(() => {
    if (sourceQuote?.view_token) {
      return { kind: 'quote' as const, url: `${window.location.origin}/quote/${sourceQuote.view_token}` };
    }
    if (agreement?.view_token) {
      return { kind: 'agreement' as const, url: `${window.location.origin}/contract/${agreement.view_token}` };
    }
    return null;
  }, [sourceQuote?.view_token, agreement?.view_token]);

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
          toast.success(language === 'fr' ? `${file.name} téléversé` : `${file.name} uploaded`);
        } catch (err: any) {
          toast.error(err?.message || (language === 'fr' ? `Échec du téléversement de ${file.name}` : `Failed to upload ${file.name}`));
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
      .catch((err) => setError(err.message || (language === 'fr' ? 'Échec du chargement du job' : 'Failed to load job')))
      .finally(() => setLoading(false));
  }, [id]);

  // ── Load visits (schedule_events) for this job ──
  const loadVisits = useCallback(async () => {
    if (!id) return;
    try {
      const { data } = await supabase
        .from('schedule_events')
        .select('id,start_at,end_at,start_time,end_time,status,team_id,notes')
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

  // ── Visit actions: inline reschedule + removal ──
  const startEditVisit = (visit: ScheduleEvent) => {
    if (!visit.start_at) return;
    const start = new Date(visit.start_at);
    const end = visit.end_at ? new Date(visit.end_at) : null;
    const pad = (n: number) => String(n).padStart(2, '0');
    setEditingVisitId(visit.id);
    setEditVisitDate(`${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`);
    setEditVisitStart(`${pad(start.getHours())}:${pad(start.getMinutes())}`);
    setEditVisitEnd(end ? `${pad(end.getHours())}:${pad(end.getMinutes())}` : '');
    setEditVisitTeamId(visit.team_id || '');
  };

  const handleSaveVisit = async () => {
    if (!editingVisitId || visitActionBusy) return;
    if (!editVisitDate || !editVisitStart || !editVisitEnd) {
      toast.error(language === 'fr' ? 'Date et heures requises.' : 'Date and times are required.');
      return;
    }
    const start = new Date(`${editVisitDate}T${editVisitStart}`);
    const end = new Date(`${editVisitDate}T${editVisitEnd}`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      toast.error(language === 'fr' ? "L'heure de fin doit être après le début." : 'End time must be after the start.');
      return;
    }
    setVisitActionBusy(true);
    try {
      // rpc_reschedule_event keeps the current team when p_team_id is null
      // (coalesce), so unassigning needs an explicit clear first.
      const original = visits.find((v) => v.id === editingVisitId);
      if (original?.team_id && !editVisitTeamId) {
        const { error: clearErr } = await supabase
          .from('schedule_events')
          .update({ team_id: null, updated_at: new Date().toISOString() })
          .eq('id', editingVisitId);
        if (clearErr) throw clearErr;
      }
      await rescheduleEvent({
        eventId: editingVisitId,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        teamId: editVisitTeamId || null,
      });
      toast.success(language === 'fr' ? 'Visite mise à jour.' : 'Visit updated.');
      setEditingVisitId(null);
      await handleVisitAdded();
    } catch (err: any) {
      toast.error(err?.message || (language === 'fr' ? 'Impossible de mettre à jour la visite.' : 'Could not update the visit.'));
    } finally {
      setVisitActionBusy(false);
    }
  };

  // Check off a visit (→ completed) or bring it back (→ scheduled). This is
  // what clears a "Late" job: derived_status counts past NON-completed visits.
  const handleToggleVisitCompleted = async (visit: ScheduleEvent) => {
    if (visitActionBusy) return;
    const wasCompleted = (visit.status || '').toLowerCase() === 'completed';
    setVisitActionBusy(true);
    try {
      const { error: updErr } = await supabase
        .from('schedule_events')
        .update({ status: wasCompleted ? 'scheduled' : 'completed', updated_at: new Date().toISOString() })
        .eq('id', visit.id);
      if (updErr) throw updErr;
      invalidateScheduleCache();
      toast.success(wasCompleted
        ? (language === 'fr' ? 'Visite remise à faire.' : 'Visit set back to scheduled.')
        : (language === 'fr' ? 'Visite complétée.' : 'Visit completed.'));
      await handleVisitAdded();
    } catch (err: any) {
      toast.error(err?.message || (language === 'fr' ? 'Impossible de mettre à jour la visite.' : 'Could not update the visit.'));
    } finally {
      setVisitActionBusy(false);
    }
  };

  const handleDeleteVisit = async (visitId: string) => {
    if (!id || visitActionBusy) return;
    const msg = language === 'fr'
      ? 'Retirer cette visite du calendrier ? Le job est conservé.'
      : 'Remove this visit from the calendar? The job itself is kept.';
    if (typeof window !== 'undefined' && !window.confirm(msg)) return;
    setVisitActionBusy(true);
    try {
      await unscheduleJob({ jobId: id, eventId: visitId });
      toast.success(language === 'fr' ? 'Visite retirée.' : 'Visit removed.');
      if (editingVisitId === visitId) setEditingVisitId(null);
      if (selectedVisitId === visitId) setSelectedVisitId(null);
      await handleVisitAdded();
    } catch (err: any) {
      toast.error(err?.message || (language === 'fr' ? 'Impossible de retirer la visite.' : 'Could not remove the visit.'));
    } finally {
      setVisitActionBusy(false);
    }
  };

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
          subject: r.subject || (language === 'fr' ? 'Pour services rendus' : 'For Services Rendered'),
          total_cents: Number(r.total_cents || 0),
          balance_cents: Number(r.balance_cents ?? r.total_cents ?? 0),
          billing_milestone_id: r.billing_milestone_id || null,
        })),
      );
    } catch (err: any) {
      console.warn('Failed to load invoices:', err?.message);
    }
  }, [id, language]);

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

  // Load the source quote — when present it is the job's approved document.
  useEffect(() => {
    if (!id) return;
    getQuoteForJob(id).then(setSourceQuote).catch(() => {});
  }, [id]);

  // Single source of truth: the job's contractual document is the quote OR
  // the agreement, never both (same rule as the DB trigger).
  const approvedDoc = resolveApprovedDocument(sourceQuote, agreement);

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
      || (language === 'fr'
        ? 'Marquer ce job comme complété ? Cela verrouille le job (sauf action admin).'
        : 'Mark this job as completed? This locks the job for edits (except via admin action).');
    if (typeof window !== 'undefined' && !window.confirm(confirmMsg)) return;
    setIsClosing(true);
    try {
      const updated = await updateJob(job.id, { status: 'completed' });
      setJob(updated);
      toast.success(language === 'fr' ? 'Job marqué comme complété' : 'Job marked as completed');
      setMoreActionsOpen(false);

      // Auto-propose invoice creation if no invoice exists
      // (split jobs are billed through their payment schedule instead)
      if (invoices.length === 0 && !job.billing_split) {
        const shouldCreate = window.confirm(
          t.jobDetails?.createInvoicePrompt
            || (language === 'fr' ? 'Job complété ! Voulez-vous créer une facture maintenant ?' : 'Job completed! Would you like to create an invoice now?')
        );
        if (shouldCreate) {
          handleCreateInvoice();
        }
      }
    } catch (err: any) {
      toast.error(err?.message || (language === 'fr' ? 'Échec de la fermeture du job' : 'Failed to close job'));
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
      toast.info(t.jobDetails?.splitUsesSchedule || (language === 'fr' ? 'Ce job utilise un échéancier de paiement — créez les factures depuis l\'échéancier de facturation.' : 'This job uses a payment schedule — create invoices from the billing schedule.'));
      return;
    }
    setIsCreatingInvoice(true);
    try {
      const result = await createInvoiceFromJob({ jobId: job.id, sendNow: false });
      const invoiceId = String(result.invoice_id || result.invoice?.id || '').trim();
      if (!invoiceId) throw new Error(language === 'fr' ? "Facture créée mais l'identifiant est manquant." : 'Invoice created but ID is missing.');
      queryClient.invalidateQueries({ queryKey: ['invoicesTable'] });
      queryClient.invalidateQueries({ queryKey: ['jobsTable'] });
      toast.success(result.already_exists ? (language === 'fr' ? 'La facture existe déjà' : 'Invoice already exists') : (language === 'fr' ? 'Brouillon de facture créé' : 'Invoice draft created'));
      setMoreActionsOpen(false);
      navigate(result.already_exists ? `/invoices/${invoiceId}` : `/invoices/${invoiceId}/edit`);
    } catch (err: any) {
      toast.error(err?.message || (language === 'fr' ? 'Échec de la création de la facture' : 'Failed to create invoice'));
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
            label: t.jobDetails?.deposit || (language === 'fr' ? 'Dépôt' : 'Deposit'),
            percent: 50,
            amount_cents: deposit,
            due_date: isoDatePlusDays(0),
          },
          {
            id: null,
            key: crypto.randomUUID(),
            label: t.jobDetails?.finalPayment || (language === 'fr' ? 'Paiement final' : 'Final payment'),
            percent: 50,
            amount_cents: displayTotalCents - deposit,
            due_date: isoDatePlusDays(30),
          },
        ]);
        setScheduleDirty(true);
      }
    } catch (err: any) {
      toast.error(err?.message || (language === 'fr' ? 'Échec de la mise à jour du mode de facturation' : 'Failed to update billing mode'));
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
      toast.success(t.jobDetails?.scheduleSaved || (language === 'fr' ? 'Échéancier de paiement enregistré.' : 'Payment schedule saved.'));
    } catch (err: any) {
      toast.error(err?.message || (language === 'fr' ? "Échec de l'enregistrement de l'échéancier" : 'Failed to save payment schedule'));
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
          ? (t.jobDetails?.milestoneInvoiceExists || (language === 'fr' ? 'Une facture existe déjà pour ce paiement.' : 'An invoice already exists for this payment.'))
          : (t.jobDetails?.milestoneInvoiceCreated || (language === 'fr' ? 'Facture créée pour ce paiement.' : 'Invoice created for this payment.')),
        invoiceId
          ? { action: { label: t.jobDetails?.viewInvoiceAction || (language === 'fr' ? 'Voir la facture' : 'View invoice'), onClick: () => navigate(`/invoices/${invoiceId}`) } }
          : undefined,
      );
      await loadInvoices();
    } catch (err: any) {
      toast.error(err?.message || (language === 'fr' ? 'Échec de la création de la facture' : 'Failed to create invoice'));
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
            <p className="text-primary font-semibold text-lg">{language === 'fr' ? 'Déposez les fichiers ici' : 'Drop files here'}</p>
          </div>
        )}
        {/* ═══ BREADCRUMB ═══ */}
        <nav className="flex items-center gap-1.5 text-[12px] print:hidden">
          <button onClick={() => navigate('/jobs')} className="text-text-tertiary hover:text-text-primary transition-colors">{language === 'fr' ? 'Jobs' : 'Jobs'}</button>
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
          iconTileClass="text-entity-job"
          status={job.status}
          statusExtra={isToday ? <span className="badge-neutral text-[11px]">{language === 'fr' ? "Aujourd'hui" : 'Today'}</span> : null}
          title={job.title || job.client_name || 'Job'}
          number={
            <EntityNumberEditor
              entity="job"
              entityId={job.id}
              value={job.job_number}
              onSaved={(n) => setJob((prev) => (prev ? { ...prev, job_number: n } : prev))}
            />
          }
          client={{ id: job.client_id, name: job.client_name || (language === 'fr' ? 'Non assigné' : 'Unassigned') }}
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
              <Edit3 size={14} /> {language === 'fr' ? 'Modifier' : 'Edit'}
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
                        toast.success(language === 'fr' ? 'Job complété et facture créée' : 'Job completed & invoice created', {
                          action: { label: language === 'fr' ? 'Voir la facture' : 'View Invoice', onClick: () => navigate(`/invoices/${invoiceId}`) },
                        });
                        navigate(`/invoices/${invoiceId}/edit`);
                        return;
                      }
                    }
                    toast.success(language === 'fr' ? 'Job complété' : 'Job completed');
                  } catch (err: any) {
                    toast.error(err?.message || (language === 'fr' ? 'Échec' : 'Failed'));
                  } finally {
                    setIsClosing(false);
                  }
                }}
                disabled={isClosing}
                className="px-3 py-1.5 rounded-lg bg-primary text-white text-[12px] font-semibold hover:opacity-90 transition-all inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <CheckCircle2 size={13} /> {isClosing ? (language === 'fr' ? 'Traitement...' : 'Processing...') : (canSeeInvoices ? (language === 'fr' ? 'Compléter et facturer' : 'Complete & Invoice') : (language === 'fr' ? 'Compléter' : 'Complete'))}
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
                    <DropdownItem icon={<CheckCircle2 size={13} />} label={isClosing ? (language === 'fr' ? 'Fermeture...' : 'Closing...') : (language === 'fr' ? 'Fermer le job' : 'Close Job')} onClick={handleCloseJob} disabled={isClosing} />
                    <DropdownItem icon={<MessageSquare size={13} />} label={language === 'fr' ? 'Envoyer une confirmation' : 'Send Confirmation'} onClick={() => { setConfirmPrompt('manual'); setMoreActionsOpen(false); }} />
                    <DropdownItem icon={<Send size={13} />} label={language === 'fr' ? 'Envoyer un suivi' : 'Send Follow-up'} onClick={() => { setEmailMode('followup'); setShowEmailModal(true); setMoreActionsOpen(false); }} />
                    <DropdownItem icon={<Mail size={13} />} label={language === 'fr' ? 'Envoyer un courriel' : 'Send Email'} onClick={() => { setEmailMode('generic'); setShowEmailModal(true); setMoreActionsOpen(false); }} />
                    <div className="border-t border-border my-1" />
                    {canSeeInvoices && <DropdownItem icon={<FileText size={13} className="text-entity-invoice" />} label={isCreatingInvoice ? (language === 'fr' ? 'Création...' : 'Creating...') : (language === 'fr' ? 'Créer une facture' : 'Create Invoice')} onClick={handleCreateInvoice} disabled={isCreatingInvoice} />}
                    <DropdownItem icon={<Copy size={13} />} label={language === 'fr' ? 'Dupliquer le job' : 'Clone Job'} onClick={() => {
                      setMoreActionsOpen(false);
                      openJobModal({
                        initialValues: {
                          title: `${job.title} ${language === 'fr' ? '(copie)' : '(copy)'}`,
                          client_id: job.client_id || null,
                          property_address: job.property_address || null,
                          description: (job as any).description || null,
                          line_items: lineItems.map(li => ({ name: (li as any).name || (li as any).description || '', qty: li.qty, unit_price_cents: li.unit_price_cents })),
                        },
                        onCreated: () => { toast.success(language === 'fr' ? 'Job dupliqué' : 'Job cloned', { action: { label: language === 'fr' ? 'Voir' : 'View', onClick: () => navigate('/jobs') } }); },
                      });
                    }} />
                    <DropdownItem icon={<Download size={13} />} label={language === 'fr' ? 'Télécharger le PDF' : 'Download PDF'} onClick={handleDownloadPdf} />
                    <DropdownItem icon={<Printer size={13} />} label={language === 'fr' ? 'Imprimer' : 'Print'} onClick={handlePrint} />
                  </div>
                </>
              )}
            </div>
          </>
          }
        />

        {/* ═══ FLOW PROGRESS — shows where job is in the lifecycle ═══ */}
        <div className="flex items-center gap-0 px-1 pb-4">
          {(() => {
            // Each step lights only when truly reached: draft/cancelled jobs light
            // nothing, Invoiced counts non-void invoices, Paid requires every
            // non-void invoice paid (a billing split stays unpaid until the last
            // milestone clears).
            const billable = invoices.filter((inv) => inv.status !== 'void');
            const steps = [
              { label: 'Scheduled', labelFr: 'Planifié', done: job.status === 'scheduled' || job.status === 'in_progress' || job.status === 'completed' },
              { label: 'Completed', labelFr: 'Complété', done: job.status === 'completed' },
              { label: 'Invoiced', labelFr: 'Facturé', done: billable.length > 0 },
              { label: 'Paid', labelFr: 'Payé', done: billable.length > 0 && billable.every((inv) => inv.status === 'paid') },
            ];
            return steps.map((step, i) => {
              const onClick =
                step.label === 'Completed' && (job.status === 'scheduled' || job.status === 'in_progress')
                  ? () => { void handleCloseJob(); }
                  : step.label === 'Invoiced' && billable.length > 0
                    ? () => navigate(`/invoices/${billable[0].id}`)
                    : undefined;
              const prevDone = i > 0 && steps[i - 1].done;
              return (
                <React.Fragment key={step.label}>
                  {i > 0 && <div className={cn('flex-1 h-px', step.done && prevDone ? 'bg-primary' : 'bg-outline')} />}
                  <div className="flex flex-col items-center gap-1">
                    <div className={cn('w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold border',
                      step.done ? 'bg-primary text-white border-text-primary' : 'bg-surface text-text-tertiary border-outline')}>
                      {step.done ? '\u2713' : i + 1}
                    </div>
                    <span className={cn('text-[9px] font-medium whitespace-nowrap', step.done ? 'text-text-primary' : 'text-text-tertiary',
                      onClick && 'cursor-pointer hover:underline')}
                      onClick={onClick}>{language === 'fr' ? step.labelFr : step.label}</span>
                  </div>
                </React.Fragment>
              );
            });
          })()}
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
                  {language === 'fr' ? "Aujourd'hui" : 'Today'}
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
              <p className="text-xs font-medium uppercase tracking-wider text-text-tertiary mb-2">{language === 'fr' ? 'Détails du job' : 'Job details'}</p>
              <div className="space-y-0">
                <JobDetailRow label={language === 'fr' ? 'Type de job' : 'Job type'} value={job.job_type || (language === 'fr' ? 'Job unique' : 'One-off job')} />
                <JobDetailRow label={language === 'fr' ? 'Débute le' : 'Starts on'} value={job.scheduled_at ? formatDate(job.scheduled_at) : '—'} />
                <JobDetailRow label={language === 'fr' ? 'Se termine le' : 'Ends on'} value={job.end_at ? formatDate(job.end_at) : (job.scheduled_at ? formatDate(job.scheduled_at) : '—')} />
                <JobDetailRow label={language === 'fr' ? 'Fréquence de facturation' : 'Billing frequency'} value={(job as any).requires_invoicing === false ? (language === 'fr' ? 'Sans facturation' : 'No invoicing') : (language === 'fr' ? 'À la fin du job' : 'Upon job completion')} />
                <JobDetailRow label={language === 'fr' ? 'Dépôt' : 'Deposit'} value={(job as any).deposit_required ? `${(job as any).deposit_type === 'percentage' ? `${(job as any).deposit_value}%` : `$${(job as any).deposit_value}`}` : (language === 'fr' ? 'Aucun' : 'None')} />
                <JobDetailRow label={language === 'fr' ? 'Vendeur' : 'Salesperson'} value={(job as any).salesperson_name || (job as any).salesperson?.full_name || '—'} isLast />
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
              {language === 'fr' ? (showProfitability ? 'Masquer la rentabilité' : 'Afficher la rentabilité') : `${showProfitability ? 'Hide' : 'Show'} Profitability`}
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
                      <p className="text-[11px] text-text-tertiary mt-1">{language === 'fr' ? 'Marge de profit' : 'Profit margin'}</p>
                    </div>

                    {/* Breakdown */}
                    <div className="flex flex-wrap items-center gap-3 text-[13px]">
                      <ProfitBlock label={language === 'fr' ? 'Prix total' : 'Total price'} value={formatCents(displayTotalCents)} />
                      <span className="text-text-tertiary font-medium">−</span>
                      <ProfitBlock label={language === 'fr' ? 'Coût des articles' : 'Line Item Cost'} value={formatCents(lineItemCostCents)} color="text-text-secondary" />
                      <span className="text-text-tertiary font-medium">−</span>
                      <ProfitBlock label={language === 'fr' ? "Main-d'œuvre" : 'Labour'} value="$0.00" color="text-text-secondary" />
                      <span className="text-text-tertiary font-medium">−</span>
                      <ProfitBlock label={language === 'fr' ? 'Dépenses' : 'Expenses'} value="$0.00" color="text-text-tertiary" />
                      <span className="text-text-tertiary font-medium">=</span>
                      <ProfitBlock label={language === 'fr' ? 'Profit' : 'Profit'} value={formatCents(profitCents)} color="text-text-primary" />
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
              <div className="icon-tile icon-tile-sm text-entity-job">
                <Briefcase size={13} strokeWidth={2} />
              </div>
              {language === 'fr' ? 'Articles' : 'Line Items'}
            </h2>
            <button onClick={handleEdit} className="glass-button !text-[12px] !px-2.5 !py-1 inline-flex items-center gap-1 print:hidden">
              <Plus size={12} /> {language === 'fr' ? 'Nouvel article' : 'New Line Item'}
            </button>
          </div>

          <div className="p-5">
            {lineItems.length === 0 ? (
              <p className="text-[13px] text-text-tertiary py-4 text-center">{language === 'fr' ? 'Aucun article' : 'No line items'}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-0 py-2.5 text-xs font-medium uppercase tracking-wider text-text-tertiary">{language === 'fr' ? 'Produit / Service' : 'Product / Service'}</th>
                      <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wider text-text-tertiary text-center w-24">{language === 'fr' ? 'Quantité' : 'Quantity'}</th>
                      {canSeeMargins && <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wider text-text-tertiary text-right w-28">{language === 'fr' ? 'Coût' : 'Cost'}</th>}
                      {canSeePricing && <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wider text-text-tertiary text-right w-28">{language === 'fr' ? 'Prix' : 'Price'}</th>}
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
                    <span className="text-text-secondary">{language === 'fr' ? 'Sous-total' : 'Subtotal'}</span>
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
              {language === 'fr' ? 'Visites' : 'Visits'}
            </h2>
            <button onClick={() => setShowAddVisit(true)} className="glass-button !text-[12px] !px-2.5 !py-1 inline-flex items-center gap-1 print:hidden">
              {language === 'fr' ? 'Nouvelle visite' : 'New Visit'}
            </button>
          </div>
          <div className="p-5">
            {visits.length === 0 && job.scheduled_at ? (
              <div className="rounded-lg border border-outline-subtle bg-surface-secondary p-3.5 flex items-center justify-between">
                <span className="text-[13px] font-semibold text-text-primary">
                  {formatDate(job.scheduled_at)}
                </span>
                <span className="text-[12px] text-text-tertiary">{language === 'fr' ? 'Pas encore assignée' : 'Not assigned yet'}</span>
              </div>
            ) : visits.length > 0 ? (
              <div className="space-y-2">
                {visits.map((visit) => {
                  const tloc = language === 'fr' ? 'fr-CA' : 'en-CA';
                  const timeRange = visit.start_at
                    ? `${new Date(visit.start_at).toLocaleTimeString(tloc, { hour: '2-digit', minute: '2-digit' })}${visit.end_at ? ` — ${new Date(visit.end_at).toLocaleTimeString(tloc, { hour: '2-digit', minute: '2-digit' })}` : ''}`
                    : null;
                  const { team: assignedTeam, label: assignLabel } = getVisitAssignment(visit);
                  const visitStatus = (visit.status || '').toLowerCase();
                  const isCompleted = visitStatus === 'completed';
                  const isCancelled = visitStatus === 'cancelled';
                  return (
                    // The whole row opens the visit mini-popup (details + actions).
                    <button
                      key={visit.id}
                      type="button"
                      onClick={() => { setEditingVisitId(null); setVisitMoreOpen(false); setSelectedVisitId(visit.id); }}
                      className="w-full text-left rounded-lg border border-outline-subtle bg-surface-secondary p-3.5 flex items-center justify-between gap-3 transition-colors hover:border-primary/40 cursor-pointer"
                    >
                      <div className="min-w-0">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className={cn(
                            'text-[13px] font-semibold truncate',
                            isCompleted ? 'text-text-tertiary line-through' : 'text-text-primary'
                          )}>
                            {visit.start_at ? formatDate(visit.start_at) : (language === 'fr' ? 'Non planifiée' : 'Unscheduled')}
                          </span>
                          {isCompleted && (
                            <span className="text-[10px] font-bold uppercase tracking-wide text-success bg-success/10 border border-success/30 rounded-full px-2 py-0.5 shrink-0">
                              {language === 'fr' ? 'Complétée' : 'Completed'}
                            </span>
                          )}
                          {isCancelled && (
                            <span className="text-[10px] font-bold uppercase tracking-wide text-danger bg-danger/10 border border-danger/30 rounded-full px-2 py-0.5 shrink-0">
                              {language === 'fr' ? 'Annulée' : 'Cancelled'}
                            </span>
                          )}
                        </span>
                        {timeRange && (
                          <span className="block text-[12px] text-text-tertiary tabular-nums">{timeRange}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[12px] text-text-tertiary hidden sm:flex items-center gap-1.5">
                          {assignedTeam && (
                            <span
                              className="w-2 h-2 rounded-full inline-block shrink-0"
                              style={{ backgroundColor: assignedTeam.color_hex || '#3B82F6' }}
                            />
                          )}
                          {assignLabel}
                        </span>
                        <ChevronRight size={14} className="text-text-tertiary print:hidden" />
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-[13px] text-text-tertiary py-4 text-center">
                {language === 'fr'
                  ? 'Aucune visite planifiée — ajoutez une visite pour placer ce job au calendrier.'
                  : 'No visits scheduled — add a visit to place this job on the calendar.'}
              </p>
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

        {/* ═══ CLIENT APPROVAL — the job's contractual document is its quote
             OR a written agreement, never both. A signed quote replaces the
             agreement: no second signature is ever requested. ═══ */}
        {approvedDoc?.type === 'QUOTE' && sourceQuote ? (
          <div
            className="rounded-xl border border-outline bg-surface overflow-hidden cursor-pointer transition-colors hover:border-primary/40"
            onClick={() => navigate(`/quotes/${sourceQuote.id}`)}
            title={language === 'fr' ? 'Ouvrir la soumission' : 'Open the quote'}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline-subtle">
              <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
                <div className="icon-tile icon-tile-sm text-entity-quote">
                  <FileText size={13} strokeWidth={2} />
                </div>
                {language === 'fr' ? 'Soumission approuvée' : 'Approved Quote'} · #{sourceQuote.quote_number}
              </h2>
              <span className={cn(
                'text-[11px] font-semibold px-2.5 py-0.5 rounded-full border',
                sourceQuote.approved_at
                  ? 'bg-success-light text-success border-success/30'
                  : 'bg-primary/5 text-primary border-primary/20'
              )}>
                {sourceQuote.approved_at
                  ? (language === 'fr' ? 'Signée' : 'Signed')
                  : getQuoteStatusLabel(sourceQuote.status, language)}
              </span>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-[0.05em]">
                    {sourceQuote.approved_at
                      ? (language === 'fr' ? 'Signée le' : 'Signed on')
                      : (language === 'fr' ? 'Convertie le' : 'Converted on')}
                  </p>
                  <p className="text-[13px] font-semibold text-text-primary mt-0.5">
                    {formatDate(sourceQuote.approved_at || sourceQuote.converted_at || sourceQuote.created_at)}
                  </p>
                </div>
                {canSeePricing && (
                  <div>
                    <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-[0.05em]">
                      {language === 'fr' ? 'Total approuvé' : 'Approved total'}
                    </p>
                    <p className="text-[13px] font-semibold text-text-primary mt-0.5 tabular-nums">
                      {formatCents(sourceQuote.total_cents || 0)}
                    </p>
                  </div>
                )}
              </div>

              <p className="text-[12px] text-text-tertiary leading-relaxed rounded-lg border border-outline-subtle bg-surface-secondary/40 px-3 py-2.5">
                {language === 'fr'
                  ? 'Cette soumission constitue le document approuvé de cette job. Aucun contrat séparé ni deuxième signature n’est requis.'
                  : 'This quote serves as the approved document for this job. No separate agreement or second signature is required.'}
              </p>

              <div className="flex flex-wrap gap-2 print:hidden" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => navigate(`/quotes/${sourceQuote.id}`)}
                  className="bg-primary text-primary-foreground rounded-lg px-3.5 py-1.5 text-[12px] font-semibold hover:opacity-90 transition-opacity inline-flex items-center gap-1.5"
                >
                  <Eye size={12} />
                  {language === 'fr' ? 'Voir la soumission' : 'View quote'}
                </button>
                <button
                  onClick={() => window.open(`/quote/${sourceQuote.view_token}`, '_blank')}
                  className="glass-button !text-[12px] !px-3 !py-1.5"
                >
                  {language === 'fr' ? 'Vue client' : 'Client view'}
                </button>
              </div>
            </div>
          </div>
        ) : agreement ? (
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
          /* No quote and no agreement — the job saves fine; note quietly that
             the client has no approved document to review or sign. */
          <div className="rounded-xl border border-outline bg-surface overflow-hidden print:hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline-subtle">
              <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
                <div className="icon-tile icon-tile-sm icon-tile-blue">
                  <FileText size={13} strokeWidth={2} />
                </div>
                {language === 'fr' ? 'Approbation du client' : 'Client Approval'}
              </h2>
              <span className="text-[11px] font-medium text-text-tertiary">
                {language === 'fr' ? 'Aucun document approuvé' : 'No approved document'}
              </span>
            </div>
            <div className="p-5">
              <div className="rounded-lg border-2 border-warning px-4 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="text-[13px] font-medium text-text-secondary">
                    {language === 'fr'
                      ? 'Aucun document approuvé n’est associé à cette job.'
                      : 'No approved document is associated with this job.'}
                  </p>
                  <p className="text-[12px] text-text-tertiary mt-0.5">
                    {language === 'fr'
                      ? 'Le client ne pourra pas consulter le prix, les services et les conditions tant qu’un contrat n’aura pas été créé.'
                      : 'The client will not be able to review the price, services and terms unless an agreement is created.'}
                  </p>
                </div>
                <button
                  onClick={() => setShowAgreementCreate(true)}
                  className="glass-button-primary inline-flex items-center gap-1.5 text-[12px] shrink-0"
                >
                  <FileSignature size={13} />
                  {language === 'fr' ? 'Créer un contrat' : 'Create Agreement'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ═══ INVOICES — hidden for financially restricted roles ═══ */}
        {canSeeInvoices && <div className="rounded-xl border border-outline bg-surface overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline-subtle">
            <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
              <div className="icon-tile icon-tile-sm text-entity-invoice">
                <ReceiptText size={13} strokeWidth={2} />
              </div>
              {language === 'fr' ? 'Factures' : 'Invoices'}
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
                  {tab === 'billing' ? (language === 'fr' ? 'Facturation' : 'Billing') : (language === 'fr' ? 'Rappels' : 'Reminders')}
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
                  {t.modals?.splitInvoices || (language === 'fr' ? 'Diviser en plusieurs factures avec un échéancier de paiement' : 'Split into multiple invoices with a payment schedule')}
                </label>

                {job.billing_split && (
                  <div className="mb-5 rounded-lg border border-outline-subtle bg-surface-secondary/40 p-4 space-y-3 print:hidden">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-[12px] font-semibold text-text-primary">{t.jobDetails?.paymentSchedule || (language === 'fr' ? 'Échéancier de paiement' : 'Payment schedule')}</p>
                        <p className="text-[11px] text-text-tertiary mt-0.5">{t.jobDetails?.paymentScheduleHint || (language === 'fr' ? 'Divisez le total du job en paiements planifiés, chacun facturé séparément.' : 'Split the job total into scheduled payments, each billed with its own invoice.')}</p>
                      </div>
                      {canSeePricing && (
                        <p className={cn('text-[11px] font-semibold tabular-nums', scheduledTotalCents === displayTotalCents ? 'text-text-tertiary' : 'text-amber-600')}>
                          {t.jobDetails?.scheduledTotal || (language === 'fr' ? 'Planifié' : 'Scheduled')}: {formatCents(scheduledTotalCents)} / {formatCents(displayTotalCents)}
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
                              placeholder={`${t.jobDetails?.payment || (language === 'fr' ? 'Paiement' : 'Payment')} ${idx + 1}`}
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
                                  title={scheduleDirty ? (t.jobDetails?.scheduleUnsavedHint || (language === 'fr' ? "Enregistrez l'échéancier avant de créer des factures." : 'Save the schedule before creating invoices.')) : undefined}
                                  className="glass-button !text-[12px] !px-2.5 !py-1 disabled:opacity-50"
                                >
                                  {creatingMilestoneId === m.id ? '...' : (t.jobDetails?.createMilestoneInvoice || (language === 'fr' ? 'Créer une facture' : 'Create invoice'))}
                                </button>
                                <button
                                  onClick={() => handleRemoveMilestone(m.key)}
                                  className="p-1 text-text-tertiary hover:text-red-500 transition-colors"
                                  aria-label={language === 'fr' ? 'Retirer le paiement' : 'Remove payment'}
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
                        <Plus size={12} /> {t.jobDetails?.addPayment || (language === 'fr' ? 'Ajouter un paiement' : 'Add payment')}
                      </button>
                      {scheduleDirty && (
                        <>
                          <button
                            onClick={handleSaveSchedule}
                            disabled={savingSchedule}
                            className="bg-primary text-primary-foreground rounded-lg px-3 py-1 text-[12px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
                          >
                            {savingSchedule ? '...' : (t.jobDetails?.saveSchedule || (language === 'fr' ? "Enregistrer l'échéancier" : 'Save schedule'))}
                          </button>
                          <span className="text-[11px] text-text-tertiary">{t.jobDetails?.scheduleUnsavedHint || (language === 'fr' ? "Enregistrez l'échéancier avant de créer des factures." : 'Save the schedule before creating invoices.')}</span>
                        </>
                      )}
                    </div>
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="px-0 py-2.5 text-xs font-medium uppercase tracking-wider text-text-tertiary">{language === 'fr' ? 'Facture' : 'Invoice'}</th>
                        <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wider text-text-tertiary">{language === 'fr' ? "Échéance" : 'Due Date'}</th>
                        <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wider text-text-tertiary">{language === 'fr' ? 'Statut' : 'Status'}</th>
                        <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wider text-text-tertiary">{language === 'fr' ? 'Objet' : 'Subject'}</th>
                        <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wider text-text-tertiary text-right">{language === 'fr' ? 'Solde' : 'Balance'}</th>
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
                              {isCreatingInvoice ? (language === 'fr' ? 'Création...' : 'Creating...') : (language === 'fr' ? 'Créer' : 'Create')}
                            </button>
                          </td>
                          <td className="px-3 py-3 text-[13px] text-text-tertiary">—</td>
                          <td className="px-3 py-3"><StatusBadge status="Upcoming" /></td>
                          <td className="px-3 py-3 text-[13px] text-text-secondary">{language === 'fr' ? 'Pour services rendus' : 'For Services Rendered'}</td>
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
                <p className="text-[13px] text-text-tertiary py-4 text-center">{language === 'fr' ? 'Aucun rappel configuré' : 'No reminders configured'}</p>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-[13px] text-text-secondary">
                    <span className={cn('w-2 h-2 rounded-full shrink-0', reminderSettings.enabled ? 'bg-emerald-500' : 'bg-outline')} />
                    {reminderSettings.enabled
                      ? (t.jobDetails?.remindersActive || (language === 'fr' ? 'Les rappels de paiement automatiques sont activés pour les factures en retard.' : 'Automatic payment reminders are enabled for overdue invoices.'))
                      : (t.jobDetails?.remindersDisabled || (language === 'fr' ? 'Les rappels de paiement automatiques sont désactivés pour votre organisation.' : 'Automatic payment reminders are disabled for your organization.'))}
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
                            ? (t.jobDetails?.reminderDayAfterDue || (language === 'fr' ? "jour après l'échéance" : 'day after due date'))
                            : (t.jobDetails?.reminderDaysAfterDue || (language === 'fr' ? "jours après l'échéance" : 'days after due date'))}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div>
                    <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-[0.05em] mb-2">
                      {t.jobDetails?.sentReminders || (language === 'fr' ? 'Rappels envoyés pour ce job' : 'Reminders sent for this job')}
                    </p>
                    {jobReminderLog.length === 0 ? (
                      <p className="text-[13px] text-text-tertiary">
                        {t.jobDetails?.noRemindersSentYet || (language === 'fr' ? "Aucun rappel envoyé pour les factures de ce job." : "No reminders sent yet for this job's invoices.")}
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
              {language === 'fr' ? 'Horaire récurrent' : 'Recurring Schedule'}
            </h2>
            {!recurrence && !showRecurrenceSetup && (
              <button
                onClick={() => setShowRecurrenceSetup(true)}
                className="glass-button !text-[12px] !px-2.5 !py-1 print:hidden"
              >
                {language === 'fr' ? 'Rendre récurrent' : 'Make Recurring'}
              </button>
            )}
          </div>
          <div className="p-5">
            {recurrence ? (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[13px] font-semibold text-text-primary capitalize">
                    {recurrence.frequency === 'biweekly'
                      ? (language === 'fr' ? 'Aux 2 semaines' : 'Every 2 weeks')
                      : (language === 'fr' ? recFreqLabelFr(recurrence.frequency) : recurrence.frequency)}
                  </p>
                  <p className="text-[12px] text-text-tertiary">
                    {language === 'fr' ? 'Depuis' : 'Since'} {new Date(recurrence.start_date).toLocaleDateString(language === 'fr' ? 'fr-CA' : 'en-US')} — {recurrence.occurrences_created} {language === 'fr' ? 'créées' : 'created'}
                    {recurrence.end_date ? ` — ${language === 'fr' ? 'se termine le' : 'ends'} ${new Date(recurrence.end_date).toLocaleDateString(language === 'fr' ? 'fr-CA' : 'en-US')}` : ''}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    await deactivateRecurrenceRule(recurrence.id);
                    setRecurrence(null);
                    toast.success(language === 'fr' ? 'Récurrence arrêtée' : 'Recurrence stopped');
                  }}
                  className="glass-button !text-[12px] text-danger hover:bg-danger-light"
                >
                  {language === 'fr' ? 'Arrêter' : 'Stop'}
                </button>
              </div>
            ) : showRecurrenceSetup ? (
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{language === 'fr' ? 'Fréquence' : 'Frequency'}</label>
                  <select value={recFreq} onChange={(e) => setRecFreq(e.target.value as RecurrenceFrequency)} className="glass-input w-full mt-1">
                    <option value="daily">{language === 'fr' ? 'Quotidien' : 'Daily'}</option>
                    <option value="weekly">{language === 'fr' ? 'Hebdomadaire' : 'Weekly'}</option>
                    <option value="biweekly">{language === 'fr' ? 'Aux 2 semaines' : 'Every 2 weeks'}</option>
                    <option value="monthly">{language === 'fr' ? 'Mensuel' : 'Monthly'}</option>
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
                        toast.success(language === 'fr' ? 'Récurrence activée' : 'Recurrence activated');
                      } catch (err: any) {
                        toast.error(err?.message || (language === 'fr' ? 'Échec de la création de la récurrence' : 'Failed to create recurrence'));
                      } finally {
                        setRecSaving(false);
                      }
                    }}
                    className="glass-button-primary !text-[12px]"
                  >
                    {recSaving ? (language === 'fr' ? 'Enregistrement...' : 'Saving...') : (language === 'fr' ? 'Activer' : 'Activate')}
                  </button>
                  <button onClick={() => setShowRecurrenceSetup(false)} className="glass-button !text-[12px]">{language === 'fr' ? 'Annuler' : 'Cancel'}</button>
                </div>
              </div>
            ) : (
              <p className="text-[13px] text-text-tertiary">{language === 'fr' ? "Il s'agit d'un job unique." : 'This is a one-time job.'}</p>
            )}
          </div>
        </div>

        {/* ═══ ATTACHMENTS ═══ */}
        {job.attachments && job.attachments.length > 0 && (
          <div className="rounded-xl border border-outline bg-surface overflow-hidden">
            <div className="px-5 py-3.5 border-b border-outline-subtle">
              <h2 className="text-[13px] font-semibold text-text-primary">{language === 'fr' ? 'Pièces jointes' : 'Attachments'}</h2>
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

        {/* ═══ EVENTS (unified activity center) ═══ */}
        <EventsPanel entityType="job" entityId={id!} clientId={job.client_id || undefined} />

        {/* ═══ COMMUNICATIONS ═══ */}
        <CommunicationsTimeline jobId={id!} clientId={job.client_id || undefined} refreshKey={commRefreshKey} />

        {/* ═══ ACTIVITY ═══ */}
        <ActivityTimeline entityType="job" entityId={id!} />

        {/* Leave-without-saving confirmation (unsaved payment schedule) */}
        <LeaveFormConfirm open={guard.active} onConfirm={guard.confirmLeave} onCancel={guard.cancelLeave} />
      </div>

      {/* ── Booking-confirmation picker (texto / courriel) ── */}
      <AnimatePresence>
        {confirmPrompt && job && (
          <ModalOverlay onClose={() => setConfirmPrompt(null)}>
            <div className="p-6">
              <div className="flex flex-col items-center text-center mb-5">
                {confirmPrompt === 'created' && (
                  <span className="w-11 h-11 rounded-full bg-success-light text-success flex items-center justify-center mb-3">
                    <CheckCircle2 size={22} />
                  </span>
                )}
                <h3 className="text-[17px] font-bold text-text-primary">
                  {confirmPrompt === 'created'
                    ? (language === 'fr' ? 'Job créé !' : 'Job created!')
                    : (language === 'fr' ? 'Envoyer une confirmation' : 'Send Confirmation')}
                </h3>
                <p className="text-[13px] text-text-secondary mt-1">
                  {language === 'fr'
                    ? `Envoyer une confirmation de rendez-vous${job.client_name ? ` à ${job.client_name}` : ' au client'} ?`
                    : `Send a booking confirmation${job.client_name ? ` to ${job.client_name}` : ' to the client'}?`}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => { setConfirmPrompt(null); setShowSmsModal(true); }}
                  className="rounded-xl border border-outline hover:border-primary hover:bg-primary-lighter transition-colors p-4 flex flex-col items-center gap-2 min-w-0"
                >
                  <MessageSquare size={20} className="text-primary" />
                  <span className="text-[13px] font-semibold text-text-primary">{language === 'fr' ? 'Par texto' : 'By text'}</span>
                  <span className="text-[11px] text-text-tertiary truncate max-w-full">
                    {clientInfo?.phone || (language === 'fr' ? 'Aucun numéro au dossier' : 'No phone on file')}
                  </span>
                </button>
                <button
                  onClick={() => { setConfirmPrompt(null); setEmailMode('confirmation'); setShowEmailModal(true); }}
                  className="rounded-xl border border-outline hover:border-primary hover:bg-primary-lighter transition-colors p-4 flex flex-col items-center gap-2 min-w-0"
                >
                  <Mail size={20} className="text-primary" />
                  <span className="text-[13px] font-semibold text-text-primary">{language === 'fr' ? 'Par courriel' : 'By email'}</span>
                  <span className="text-[11px] text-text-tertiary truncate max-w-full">
                    {clientInfo?.email || (language === 'fr' ? 'Aucun courriel au dossier' : 'No email on file')}
                  </span>
                </button>
              </div>
              <button
                onClick={() => setConfirmPrompt(null)}
                className="w-full mt-3 py-2 text-[12px] text-text-tertiary hover:text-text-primary transition-colors"
              >
                {language === 'fr' ? 'Pas maintenant' : 'Not now'}
              </button>
            </div>
          </ModalOverlay>
        )}
      </AnimatePresence>

      {/* ── SMS Modal ── */}
      <AnimatePresence>
        {showSmsModal && job && (
          <ModalOverlay onClose={() => setShowSmsModal(false)} size="xl">
            <SendSmsModal
              phone={clientInfo?.phone}
              defaultBody={`Confirmation rendez-vous ${clientInfo?.company || job.title}.\n\n${language === 'fr' ? 'Emplacement' : 'Location'}: ${job.property_address || 'TBD'}\nDate: ${job.scheduled_at ? formatDate(job.scheduled_at) : 'TBD'}`}
              clientId={job.client_id}
              jobId={job.id}
              clientName={job.client_name || undefined}
              companyName={clientInfo?.company || undefined}
              propertyAddress={job.property_address || undefined}
              scheduledDate={job.scheduled_at ? formatDate(job.scheduled_at) : undefined}
              approvalLink={approvalLink}
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
              defaultSubject={emailMode === 'confirmation' ? `Confirmation rendez-vous ${clientInfo?.company || job.title}` : emailMode === 'followup' ? (language === 'fr' ? `Suivi — ${job.title}` : `Follow-up — ${job.title}`) : (language === 'fr' ? `Concernant ${job.title}` : `Regarding ${job.title}`)}
              defaultBody={emailMode === 'confirmation' ? `Bonjour ${job.client_name || (language === 'fr' ? '' : 'there')},\n\nMerci d'avoir fait affaire avec nous !\n\n${language === 'fr' ? 'Emplacement' : 'Location'}: ${job.property_address || 'TBD'}\nDate: ${job.scheduled_at ? formatDate(job.scheduled_at) : 'TBD'}\n\nCordialement,\n\n${clientInfo?.company || ''}` : emailMode === 'followup' ? (language === 'fr' ? `Bonjour ${job.client_name || ''},\n\nNous faisons un suivi concernant « ${job.title} ». N'hésitez pas à nous contacter pour toute question.\n\nMerci !` : `Hi ${job.client_name || 'there'},\n\nJust following up on "${job.title}". Please let us know if you have any questions.\n\nThank you!`) : `Bonjour ${job.client_name || (language === 'fr' ? '' : 'there')},\n\n`}
              clientId={job.client_id}
              jobId={job.id}
              clientName={job.client_name || undefined}
              approvalLink={approvalLink}
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

      {/* ═══ VISIT MINI-POPUP ("visit hub") — opened by clicking a visit row ═══ */}
      {job && (() => {
        const visit = visits.find((v) => v.id === selectedVisitId);
        if (!visit) return null;
        const fr = language === 'fr';
        const tloc = fr ? 'fr-CA' : 'en-CA';
        const visitStatus = (visit.status || '').toLowerCase();
        const isCompleted = visitStatus === 'completed';
        const isCancelled = visitStatus === 'cancelled';
        const isPast = visit.start_at ? new Date(visit.start_at).getTime() < Date.now() : false;
        const isEditing = editingVisitId === visit.id;
        const { team: assignedTeam, label: assignLabel } = getVisitAssignment(visit);
        const timeRange = visit.start_at
          ? `${new Date(visit.start_at).toLocaleTimeString(tloc, { hour: '2-digit', minute: '2-digit' })}${visit.end_at ? ` — ${new Date(visit.end_at).toLocaleTimeString(tloc, { hour: '2-digit', minute: '2-digit' })}` : ''}`
          : (fr ? 'Toute la journée' : 'Anytime');
        const detailsSentence = isCancelled
          ? (fr ? 'Cette visite a été annulée — elle ne compte plus dans le statut du job.' : 'This visit was cancelled — it no longer counts toward the job status.')
          : isCompleted
            ? (fr ? 'Visite complétée — elle ne rend plus le job « En retard ».' : 'Visit completed — it no longer makes the job "Late".')
            : isPast
              ? (fr ? 'Cette visite est passée mais n’est pas marquée complétée — le job apparaît « En retard ».' : 'This visit is past but not marked complete — the job shows as "Late".')
              : (fr ? 'Visite à venir — elle apparaît au calendrier.' : 'Upcoming visit — it shows on the calendar.');
        const closePopup = () => { setSelectedVisitId(null); setEditingVisitId(null); setVisitMoreOpen(false); };
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4" onClick={closePopup}>
            <div
              className="w-full max-w-md rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-outline-subtle">
                <h2 className="text-[15px] font-bold text-text-primary flex items-center gap-2">
                  <Calendar size={15} className="text-text-secondary" />
                  {fr ? 'Détails de la visite' : 'Visit details'}
                </h2>
                <button onClick={closePopup} className="rounded-lg p-1.5 text-text-secondary hover:bg-surface-tertiary"><X size={16} /></button>
              </div>

              <div className="px-5 py-4 space-y-4">
                {/* Context line — which job/client this visit belongs to */}
                <p className="text-[13px] text-text-secondary">
                  {fr ? 'Visite pour le job' : 'Visit for job'} <span className="font-semibold text-text-primary">#{job.job_number}</span>
                  {job.client_name ? <> — <span className="font-semibold text-text-primary">{job.client_name}</span></> : null}
                </p>

                {isEditing ? (
                  <>
                    {/* Edit mode: date + time window + team.
                        Labels and input text: black bold (white in dark mode). */}
                    <div className="space-y-3">
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-widest text-black dark:text-white">Date</label>
                        <input type="date" value={editVisitDate} onChange={(e) => setEditVisitDate(e.target.value)} className="glass-input mt-1 w-full !font-bold !text-black dark:!text-white" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-widest text-black dark:text-white">{fr ? 'Début' : 'Start'}</label>
                          <input type="time" value={editVisitStart} onChange={(e) => setEditVisitStart(e.target.value)} className="glass-input mt-1 w-full !font-bold !text-black dark:!text-white" />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-widest text-black dark:text-white">{fr ? 'Fin' : 'End'}</label>
                          <input type="time" value={editVisitEnd} onChange={(e) => setEditVisitEnd(e.target.value)} className="glass-input mt-1 w-full !font-bold !text-black dark:!text-white" />
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-widest text-black dark:text-white">{fr ? 'Équipe' : 'Team'}</label>
                        <select value={editVisitTeamId} onChange={(e) => setEditVisitTeamId(e.target.value)} className="glass-input mt-1 w-full !font-bold !text-black dark:!text-white">
                          <option value="">{fr ? 'Non assignée' : 'Unassigned'}</option>
                          {teams
                            .filter((tm) => tm.is_active !== false || tm.id === editVisitTeamId)
                            .map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setEditingVisitId(null)}
                        disabled={visitActionBusy}
                        className="glass-button !text-[13px] !px-3 !py-1.5"
                      >
                        {fr ? 'Annuler' : 'Cancel'}
                      </button>
                      <button
                        onClick={() => void handleSaveVisit()}
                        disabled={visitActionBusy}
                        className="rounded-lg bg-text-primary px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        {visitActionBusy ? (fr ? 'Enregistrement…' : 'Saving…') : (fr ? 'Enregistrer' : 'Save')}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Date + time + visit status */}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className={cn('text-[17px] font-bold tracking-tight', isCompleted ? 'text-text-tertiary line-through' : 'text-text-primary')}>
                          {visit.start_at ? formatDate(visit.start_at) : (fr ? 'Non planifiée' : 'Unscheduled')}
                        </p>
                        <p className="text-[13px] text-text-tertiary tabular-nums mt-0.5">{timeRange}</p>
                      </div>
                      {isCompleted && (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-success bg-success/10 border border-success/30 rounded-full px-2 py-0.5 shrink-0">
                          {fr ? 'Complétée' : 'Completed'}
                        </span>
                      )}
                      {isCancelled && (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-danger bg-danger/10 border border-danger/30 rounded-full px-2 py-0.5 shrink-0">
                          {fr ? 'Annulée' : 'Cancelled'}
                        </span>
                      )}
                    </div>

                    {/* Primary action + More Actions */}
                    <div className="flex items-center gap-2">
                      {!isCancelled && (
                        <button
                          onClick={() => void handleToggleVisitCompleted(visit)}
                          disabled={visitActionBusy}
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50',
                            isCompleted
                              ? 'border border-outline bg-surface-secondary text-text-primary'
                              : 'bg-text-primary text-white'
                          )}
                        >
                          <Check size={13} strokeWidth={3} />
                          {isCompleted
                            ? (fr ? 'Remettre à faire' : 'Mark incomplete')
                            : (fr ? 'Marquer complétée' : 'Mark complete')}
                        </button>
                      )}
                      <div className="relative">
                        <button
                          onClick={() => setVisitMoreOpen((o) => !o)}
                          disabled={visitActionBusy}
                          className="glass-button !text-[13px] !px-3 !py-1.5 inline-flex items-center gap-1"
                        >
                          {fr ? 'Plus d’actions' : 'More actions'}
                          <ChevronDown size={13} />
                        </button>
                        {visitMoreOpen && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setVisitMoreOpen(false)} />
                            <div className="absolute z-20 top-full left-0 mt-1 w-52 rounded-xl border border-border bg-surface shadow-lg overflow-hidden">
                              <button
                                onClick={() => { setVisitMoreOpen(false); startEditVisit(visit); }}
                                disabled={!visit.start_at}
                                className="w-full text-left px-3.5 py-2.5 text-[13px] text-text-primary hover:bg-surface-secondary flex items-center gap-2 disabled:opacity-40"
                              >
                                <Edit3 size={13} className="text-text-tertiary" />
                                {fr ? 'Modifier la visite' : 'Edit visit'}
                              </button>
                              <button
                                onClick={() => { setVisitMoreOpen(false); void handleDeleteVisit(visit.id); }}
                                className="w-full text-left px-3.5 py-2.5 text-[13px] text-danger hover:bg-danger/10 flex items-center gap-2"
                              >
                                <Trash2 size={13} />
                                {fr ? 'Retirer la visite' : 'Remove visit'}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Info card: job / title / client / assignment / details */}
                    <div className="rounded-xl border border-outline-subtle divide-y divide-outline-subtle">
                      <div className="flex items-center justify-between px-3.5 py-2.5 gap-3">
                        <span className="text-[11px] font-bold uppercase tracking-widest text-text-muted shrink-0">Job</span>
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="text-[13px] font-semibold text-text-primary"># {job.job_number}</span>
                          <StatusBadge status={job.status} />
                        </span>
                      </div>
                      {job.title && (
                        <div className="flex items-center justify-between px-3.5 py-2.5 gap-3">
                          <span className="text-[11px] font-bold uppercase tracking-widest text-text-muted shrink-0">{fr ? 'Titre' : 'Title'}</span>
                          <span className="text-[13px] text-text-primary truncate">{job.title}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between px-3.5 py-2.5 gap-3">
                        <span className="text-[11px] font-bold uppercase tracking-widest text-text-muted shrink-0">Client</span>
                        {job.client_id ? (
                          <button
                            onClick={() => { closePopup(); navigate(`/clients/${job.client_id}`); }}
                            className="text-[13px] font-semibold text-primary hover:underline truncate"
                          >
                            {job.client_name || (fr ? 'Voir le client' : 'View client')}
                          </button>
                        ) : (
                          <span className="text-[13px] text-text-primary truncate">{job.client_name || '—'}</span>
                        )}
                      </div>
                      <div className="flex items-center justify-between px-3.5 py-2.5 gap-3">
                        <span className="text-[11px] font-bold uppercase tracking-widest text-text-muted shrink-0">{fr ? 'Assignée à' : 'Assigned to'}</span>
                        <span className="text-[13px] text-text-primary flex items-center gap-1.5 truncate">
                          {assignedTeam && (
                            <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ backgroundColor: assignedTeam.color_hex || '#3B82F6' }} />
                          )}
                          {assignLabel}
                        </span>
                      </div>
                      <div className="px-3.5 py-2.5">
                        <span className="text-[11px] font-bold uppercase tracking-widest text-text-muted block mb-1">{fr ? 'Détails' : 'Details'}</span>
                        <p className="text-[12.5px] text-text-secondary leading-relaxed">{detailsSentence}</p>
                        {visit.notes && (
                          <p className="text-[12.5px] text-text-tertiary leading-relaxed mt-1.5 whitespace-pre-wrap">{visit.notes}</p>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Creating an agreement is impossible when the job has a quote — the quote is the approved contract. */}
      {job && !sourceQuote && (
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
            servicePlan: contract && contract.visits.length > 0
              ? { year: contract.year, visits: contract.visits }
              : null,
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
          serviceContract={contract}
          onSent={reloadAgreement}
        />
      )}
    </>
  );
}

// ─── Local Helpers ───────────────────────────────────────────────────

function recFreqLabelFr(freq: string): string {
  switch (freq) {
    case 'daily': return 'Quotidien';
    case 'weekly': return 'Hebdomadaire';
    case 'biweekly': return 'Aux 2 semaines';
    case 'monthly': return 'Mensuel';
    default: return freq;
  }
}

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

