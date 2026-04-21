import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useRecentItems } from '../hooks/useRecentItems';
import { toast } from 'sonner';
import {
  ArrowLeft,
  MapPin,
  Phone,
  Mail,
  Tag,
  Clock,
  FileText,
  Briefcase,
  DollarSign,
  Plus,
  ChevronDown,
  Edit2,
  Archive,
  User,
  Calendar,
  X,
  Navigation,
  Copy,
  MoreHorizontal,
  Send,
  StickyNote,
  CheckCircle2,
  ExternalLink,
  Contact,
} from 'lucide-react';
import { cn, formatCurrency, formatDate } from '../lib/utils';
import { getClientById, updateClient, listClientJobs, softDeleteClient } from '../lib/clientsApi';
import type { ClientRecord } from '../lib/clientsApi';
import { supabase } from '../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../lib/orgApi';
import { getInvoiceRowUiStatus } from '../lib/invoicesApi';
import { StatusBadge, Skeleton } from '../components/ui';
import { useTranslation } from '../i18n';
import ActivityTimeline from '../components/ActivityTimeline';
import { displayEmail, displayPhone, displayAddress } from '../lib/piiSanitizer';
import { useDropZone } from '../hooks/useDropZone';
import { useJobModalController } from '../contexts/JobModalController';
import UnifiedAvatar from '../components/ui/UnifiedAvatar';
import QuoteCreateModal from '../components/quotes/QuoteCreateModal';
import QuoteDetailsModal from '../components/quotes/QuoteDetailsModal';
import SpecificNotes from '../components/SpecificNotes';
import { getQuoteById, formatQuoteMoney, QUOTE_STATUS_LABELS, QUOTE_STATUS_COLORS, type QuoteDetail, type Quote } from '../lib/quotesApi';

// ─── Types ───────────────────────────────────────────────────────────
interface JobRecord {
  id: string;
  title: string;
  status: string;
  job_number?: string;
  scheduled_at?: string;
  total_amount?: number;
  total_cents?: number;
  property_address?: string;
  job_type?: string;
  assigned_to?: string;
  created_at: string;
}

interface InvoiceRecord {
  id: string;
  invoice_number?: string;
  subject?: string;
  status: string;
  total_cents: number;
  balance_cents: number;
  due_date?: string;
  issued_at?: string;
  created_at: string;
}

interface PaymentRecord {
  id: string;
  amount_cents: number;
  payment_date: string;
  method?: string;
  invoice_id?: string;
  created_at: string;
}

interface ScheduleEvent {
  id: string;
  title: string;
  start_at: string;
  end_at?: string;
  job_id?: string;
  job_title?: string;
  team_id?: string;
  status?: string;
  created_at: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────
function buildGoogleMapsUrl(client: ClientRecord): string {
  const lat = client.latitude || (client as any).lat;
  const lng = client.longitude || (client as any).lng;
  if (lat && lng) {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }
  const addr = [
    client.address || [client.street_number, client.street_name].filter(Boolean).join(' '),
    client.city,
    client.province,
    client.postal_code,
  ].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
}

function buildGoogleMapsDirectionsUrl(client: ClientRecord): string {
  const lat = client.latitude || (client as any).lat;
  const lng = client.longitude || (client as any).lng;
  if (lat && lng) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  }
  const addr = [
    client.address || [client.street_number, client.street_name].filter(Boolean).join(' '),
    client.city,
    client.province,
    client.postal_code,
  ].filter(Boolean).join(', ');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(dateStr);
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).then(() => toast.success('Copied!')).catch(() => {});
}

// ─── Tabs ────────────────────────────────────────────────────────────
type OverviewTab = 'active' | 'completed' | 'quotes' | 'jobs' | 'invoices' | 'leads' | 'specific_notes';

// ─── Skeleton ────────────────────────────────────────────────────────
function DetailPageSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-5 w-32" />
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-x-6 gap-y-6">
        <div className="lg:col-span-2 flex items-center gap-4">
          <Skeleton className="h-14 w-14 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-36" />
          </div>
        </div>
        <div className="space-y-6">
          <div className="section-card p-5 space-y-3"><Skeleton className="h-5 w-28" /><Skeleton className="h-16 w-full" /></div>
          <div className="section-card p-5 space-y-3"><Skeleton className="h-5 w-28" /><Skeleton className="h-24 w-full" /></div>
          <div className="section-card p-5 space-y-3"><Skeleton className="h-5 w-28" /><Skeleton className="h-40 w-full" /></div>
        </div>
        <div className="space-y-6">
          <div className="section-card p-5 space-y-3"><Skeleton className="h-5 w-28" /><Skeleton className="h-20 w-full" /></div>
          <div className="section-card p-5 space-y-3"><Skeleton className="h-5 w-28" /><Skeleton className="h-12 w-full" /></div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────
export default function ClientDetails() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const { updateLabel: updateRecentLabel } = useRecentItems();
  const [client, setClient] = useState<ClientRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Related data
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [scheduleEvents, setScheduleEvents] = useState<ScheduleEvent[]>([]);
  const [leads, setLeads] = useState<Array<{ id: string; first_name: string; last_name: string; status: string; source: string; value: number; created_at: string }>>([]);
  // Notes
  const [notes, setNotes] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesEdited, setNotesEdited] = useState(false);

  // Tags
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);

  // Drag-drop files
  const { isDragging: isDropping, dropHandlers } = useDropZone({
    accept: ['image/*', 'application/pdf'],
    maxSizeMB: 10,
    onDrop: async (files) => {
      if (!client) return;
      for (const file of files) {
        try {
          const ext = file.name.split('.').pop() ?? 'bin';
          const path = `clients/${client.id}/${crypto.randomUUID()}.${ext}`;
          const { error: err } = await supabase.storage.from('attachments').upload(path, file, { upsert: false });
          if (err) throw err;
          toast.success(`${file.name} uploaded`);
        } catch (err: any) {
          toast.error(err?.message || `Failed to upload ${file.name}`);
        }
      }
    },
  });

  // Tabs & dropdown
  const [activeTab, setActiveTab] = useState<OverviewTab>('active');
  const [showActionMenu, setShowActionMenu] = useState(false);

  // Real quotes (from quotes table, not invoices)
  const [realQuotes, setRealQuotes] = useState<Quote[]>([]);

  // Quote modals
  const [isQuoteCreateOpen, setIsQuoteCreateOpen] = useState(false);
  const [quoteDetail, setQuoteDetail] = useState<QuoteDetail | null>(null);
  const [isQuoteDetailsOpen, setIsQuoteDetailsOpen] = useState(false);

  // Job modal controller
  const { openJobModal } = useJobModalController();

  // ─── Data Loading ────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    loadAllData(id);
  }, [id]);

  async function loadAllData(clientId: string) {
    setLoading(true);
    setError(null);
    try {
      const orgId = await getCurrentOrgIdOrThrow();
      const [clientData, jobsData] = await Promise.all([
        getClientById(clientId),
        listClientJobs(clientId),
      ]);

      if (!clientData) {
        setError('Client not found.');
        setLoading(false);
        return;
      }

      setClient(clientData);
      updateRecentLabel(`/clients/${id}`, `${clientData.first_name} ${clientData.last_name}`.trim());
      setJobs((jobsData || []) as JobRecord[]);
      setNotes((clientData as any).notes || '');

      // Fetch invoices
      const { data: invoiceData } = await supabase
        .from('invoices')
        .select('*')
        .eq('org_id', orgId)
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
      setInvoices((invoiceData || []) as InvoiceRecord[]);

      // Fetch payments
      if (invoiceData && invoiceData.length > 0) {
        const invoiceIds = invoiceData.map((inv: any) => inv.id);
        const { data: paymentData } = await supabase
          .from('payments')
          .select('*')
          .in('invoice_id', invoiceIds)
          .order('payment_date', { ascending: false });
        setPayments((paymentData || []) as PaymentRecord[]);
      } else {
        setPayments([]);
      }

      // Fetch schedule events via client's jobs
      const clientJobIds = (jobsData || []).map((j: any) => j.id).filter(Boolean);
      if (clientJobIds.length > 0) {
        const { data: eventData } = await supabase
          .from('schedule_events')
          .select('id, job_id, start_at, end_at, team_id, status, created_at, job:jobs!schedule_events_job_id_fkey(title)')
          .eq('org_id', orgId)
          .in('job_id', clientJobIds)
          .is('deleted_at', null)
          .order('start_at', { ascending: true });
        setScheduleEvents((eventData || []).map((e: any) => ({
          ...e,
          title: e.job?.title || 'Event',
          job_title: e.job?.title || null,
        })) as ScheduleEvent[]);
      } else {
        setScheduleEvents([]);
      }

      // Fetch associated leads
      const { data: leadData } = await supabase
        .from('leads_active')
        .select('id,first_name,last_name,status,source,value,created_at')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
      setLeads((leadData || []) as any[]);

      // Fetch real quotes (from quotes table)
      const { data: quotesData } = await supabase
        .from('quotes')
        .select('id, quote_number, title, status, total_cents, currency, created_at')
        .eq('org_id', orgId)
        .eq('client_id', clientId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      setRealQuotes((quotesData || []) as Quote[]);

      // Tags
      try {
        const { data: tagData } = await supabase
          .from('client_tags')
          .select('tag')
          .eq('client_id', clientId);
        if (tagData) setTags(tagData.map((t: any) => t.tag));
      } catch {
        setTags([]);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load client data.');
    } finally {
      setLoading(false);
    }
  }

  // ─── Notes Save ─────────────────────────────────────────────────
  const handleSaveNotes = useCallback(async () => {
    if (!client || !notesEdited) return;
    setNotesSaving(true);
    try {
      const orgId = await getCurrentOrgIdOrThrow();
      await supabase.from('clients').update({ notes }).eq('id', client.id).eq('org_id', orgId);
      toast.success('Notes saved');
      setNotesEdited(false);
    } catch {
      toast.error('Failed to save notes');
    } finally {
      setNotesSaving(false);
    }
  }, [client, notes, notesEdited]);

  // ─── Actions ─────────────────────────────────────────────────────
  const handleArchive = async () => {
    if (!client) return;
    const displayName = [client.first_name, client.last_name].filter(Boolean).join(' ') || client.company || 'this client';
    const msg = language === 'fr'
      ? `Archiver ${displayName} ? Ses jobs, factures et devis existants restent visibles.`
      : `Archive ${displayName}? Existing jobs, invoices and quotes remain visible.`;
    if (typeof window !== 'undefined' && !window.confirm(msg)) {
      setShowActionMenu(false);
      return;
    }
    try {
      await softDeleteClient(client.id);
      toast.success(language === 'fr' ? 'Client archivé.' : 'Client archived.');
      navigate('/clients');
    } catch (err: any) {
      toast.error(err?.message || (language === 'fr' ? 'Échec de l\'archivage.' : 'Failed to archive client.'));
    }
    setShowActionMenu(false);
  };

  const handleAddTag = async () => {
    const trimmed = newTag.trim();
    if (!trimmed || !client) return;
    if (tags.includes(trimmed)) { setNewTag(''); setShowTagInput(false); return; }
    try {
      await supabase.from('client_tags').insert({ client_id: client.id, tag: trimmed });
    } catch { /* table may not exist */ }
    setTags((prev) => [...prev, trimmed]);
    setNewTag('');
    setShowTagInput(false);
  };

  const handleRemoveTag = async (tag: string) => {
    if (!client) return;
    const previous = tags;
    setTags((prev) => prev.filter((tg) => tg !== tag));
    try {
      await supabase.from('client_tags').delete().eq('client_id', client.id).eq('tag', tag);
    } catch {
      setTags(previous);
      toast.error(t.clientDetails.failedToRemoveTag);
    }
  };

  // ─── Derived Data ────────────────────────────────────────────────
  const activeJobs = jobs.filter((j) => {
    const s = (j.status || '').toLowerCase().replace(/\s+/g, '_');
    return s !== 'completed' && s !== 'cancelled';
  });

  const completedJobs = jobs.filter((j) => {
    const s = (j.status || '').toLowerCase().replace(/\s+/g, '_');
    return s === 'completed';
  });

  const quoteInvoices = invoices.filter((inv) => {
    const s = (inv.status || '').toLowerCase();
    return s === 'draft' || s === 'quote' || s === 'sent';
  });

  const getJobAmount = (j: JobRecord) => {
    if (j.total_cents !== undefined && j.total_cents !== null) return j.total_cents / 100;
    if (j.total_amount !== undefined && j.total_amount !== null) return Number(j.total_amount);
    return 0;
  };

  const totalInvoiced = invoices.reduce((acc, inv) => acc + (inv.total_cents || 0), 0) / 100;
  const totalPaid = payments.reduce((acc, p) => acc + (p.amount_cents || 0), 0) / 100;
  const currentBalance = totalInvoiced - totalPaid;

  const upcomingEvents = scheduleEvents.filter((e) => new Date(e.start_at) >= new Date());
  const pastEvents = scheduleEvents.filter((e) => new Date(e.start_at) < new Date());

  function getInitials(first: string, last: string) {
    return ((first?.[0] || '') + (last?.[0] || '')).toUpperCase() || '?';
  }

  // ─── Billing history: interleave invoices & payments by date ────
  const billingHistory = [
    ...invoices.map((inv) => ({
      type: 'invoice' as const,
      id: inv.id,
      date: inv.issued_at || inv.created_at,
      data: inv,
    })),
    ...payments.map((pay) => ({
      type: 'payment' as const,
      id: pay.id,
      date: pay.payment_date || pay.created_at,
      data: pay,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // ─── Render ──────────────────────────────────────────────────────
  if (loading) return <DetailPageSkeleton />;

  if (error || !client) {
    return (
      <div className="space-y-5">
        <button onClick={() => navigate('/clients')} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-text-secondary hover:text-text-primary transition-colors">
          <ArrowLeft size={14} /> {t.clients.title}
        </button>
        <div className="section-card p-12 text-center">
          <p className="text-[15px] text-text-secondary">{error || 'Client not found.'}</p>
        </div>
      </div>
    );
  }

  const fullName = `${client.first_name} ${client.last_name}`.trim();
  const fullAddress = [client.address || [client.street_number, client.street_name].filter(Boolean).join(' '), client.city, client.province, client.postal_code].filter(Boolean).join(', ');

  const overviewTabs: { key: OverviewTab; label: string; count: number }[] = [
    { key: 'active', label: language === 'fr' ? 'Travaux actifs' : 'Active Work', count: activeJobs.length },
    { key: 'completed', label: language === 'fr' ? 'Terminés' : 'Completed', count: completedJobs.length },
    { key: 'jobs', label: t.clients.jobs, count: jobs.length },
    { key: 'invoices', label: t.nav.invoices, count: invoices.length },
    { key: 'quotes', label: t.clientDetails.quotes, count: realQuotes.length },
    { key: 'leads', label: language === 'fr' ? 'Prospects' : 'Leads', count: leads.length },
    { key: 'specific_notes', label: language === 'fr' ? 'Notes spécifiques' : 'Specific Notes', count: 0 },
  ];

  // ─── Job row renderer (reused across tabs) ─────────────────────
  const renderJobRow = (job: JobRecord) => (
    <div key={job.id} className="w-full rounded-lg border border-outline-subtle bg-surface-secondary p-3.5 flex items-center justify-between text-left hover:border-primary/30 transition-colors group">
      <button
        onClick={() => navigate(`/jobs/${job.id}`)}
        className="flex items-center gap-3 flex-1 text-left"
      >
        <div className="w-6 h-6 rounded bg-surface-tertiary flex items-center justify-center text-text-secondary">
          <Briefcase size={13} strokeWidth={2} />
        </div>
        <div>
          <div className="flex items-center gap-2">
            {job.job_number && <span className="text-[11px] font-bold text-text-tertiary">#{job.job_number}</span>}
            <p className="text-[13px] font-semibold text-text-primary group-hover:text-primary transition-colors">{job.title}</p>
            <StatusBadge status={job.status} />
          </div>
          <div className="flex items-center gap-3 mt-1">
            {job.scheduled_at && (
              <span className="text-[12px] text-text-tertiary flex items-center gap-1">
                <Calendar size={11} /> {formatDate(job.scheduled_at)}
              </span>
            )}
            {job.property_address && (
              <span className="text-[12px] text-text-tertiary flex items-center gap-1">
                <MapPin size={11} /> {job.property_address}
              </span>
            )}
            {job.assigned_to && (
              <span className="text-[12px] text-text-tertiary flex items-center gap-1">
                <User size={11} /> {job.assigned_to}
              </span>
            )}
          </div>
        </div>
      </button>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[13px] font-semibold text-text-primary tabular-nums">
          {formatCurrency(Math.round(getJobAmount(job)))}
        </span>
        {job.scheduled_at && (
          <button
            onClick={() => navigate(`/calendar?date=${new Date(job.scheduled_at!).toISOString().slice(0, 10)}&view=day`)}
            className="p-1.5 rounded-md text-text-tertiary hover:text-primary hover:bg-primary/10 transition-colors"
            title="View in calendar"
          >
            <Calendar size={14} />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-[12px]">
        <button onClick={() => navigate('/clients')} className="text-text-tertiary hover:text-text-primary transition-colors">{t.clients.title}</button>
        <span className="text-text-tertiary">/</span>
        <span className="text-text-primary font-medium">{client?.first_name} {client?.last_name}</span>
      </nav>

      {/* ═══ UNIFIED GRID — header + content share the same column structure ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-x-6 gap-y-6 items-start">

        {/* ──── HEADER CARD: spans full grid width ──── */}
        <div className="lg:col-span-2 section-card px-5 py-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <UnifiedAvatar id={client.id} name={`${client.first_name || ''} ${client.last_name || ''}`.trim()} size={40} />
              <div>
                <div className="flex items-center gap-2.5">
                  <h1 className="text-[20px] font-bold text-text-primary leading-tight">{fullName}</h1>
                  <StatusBadge status={client.status} />
                </div>
                {client.company && <p className="text-[13px] text-text-secondary mt-0.5">{client.company}</p>}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              {client.phone && (
                <a href={`tel:${client.phone}`} className="inline-flex items-center gap-1.5 h-9 px-3 bg-surface border border-outline rounded-md text-[13px] text-text-primary font-normal hover:bg-surface-secondary transition-colors" title="Call">
                  <Phone size={14} /> Call
                </a>
              )}
              {client.email && (
                <a href={`mailto:${client.email}`} className="inline-flex items-center gap-1.5 h-9 px-3 bg-surface border border-outline rounded-md text-[13px] text-text-primary font-normal hover:bg-surface-secondary transition-colors" title="Email">
                  <Mail size={14} /> Email
                </a>
              )}
              {client.phone && (
                <a href={`sms:${client.phone}`} className="inline-flex items-center gap-1.5 h-9 px-3 bg-surface border border-outline rounded-md text-[13px] text-text-primary font-normal hover:bg-surface-secondary transition-colors" title="SMS">
                  <Send size={14} /> SMS
                </a>
              )}

              <button
                onClick={() => setIsQuoteCreateOpen(true)}
                className="inline-flex items-center gap-1.5 h-9 px-3 bg-surface border border-outline rounded-md text-[13px] text-text-primary font-normal hover:bg-surface-secondary transition-colors"
              >
                <FileText size={14} /> New Quote
              </button>
              <button
                onClick={() => openJobModal({
                  initialValues: {
                    client_id: client.id,
                    property_address: fullAddress || null,
                  },
                  onCreated: () => { if (id) loadAllData(id); },
                })}
                className="inline-flex items-center gap-1.5 h-9 px-4 bg-primary text-white rounded-md text-[13px] font-medium hover:bg-primary-hover transition-colors"
              >
                <Plus size={14} /> New Job
              </button>

              {/* More dropdown */}
              <div className="relative">
                <button onClick={() => setShowActionMenu(!showActionMenu)} className="inline-flex items-center gap-1 h-9 px-2.5 bg-surface border border-outline rounded-md text-text-secondary hover:bg-surface-secondary transition-colors">
                  <MoreHorizontal size={16} />
                </button>
                {showActionMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowActionMenu(false)} />
                    <div className="absolute right-0 top-full mt-1 z-50 w-44 bg-surface border border-outline rounded-md shadow-lg py-1">
                      <button
                        onClick={() => { navigate(`/clients/${client.id}/edit`); setShowActionMenu(false); }}
                        className="w-full px-3 py-2 text-[13px] text-text-secondary hover:bg-surface-secondary flex items-center gap-2 text-left transition-colors"
                      >
                        <Edit2 size={13} /> {t.common.edit}
                      </button>
                      <button
                        onClick={handleArchive}
                        className="w-full px-3 py-2 text-[13px] text-danger hover:bg-danger-light flex items-center gap-2 text-left transition-colors"
                      >
                        <Archive size={13} /> {t.clients.archive}
                      </button>
                      {(client as any).portal_token && (
                        <button
                          onClick={() => {
                            const url = `${window.location.origin}/portal/${(client as any).portal_token}`;
                            navigator.clipboard.writeText(url).then(() => toast.success(t.clientDetails.portalLinkCopied));
                            setShowActionMenu(false);
                          }}
                          className="w-full px-3 py-2 text-[13px] text-text-secondary hover:bg-surface-secondary flex items-center gap-2 text-left transition-colors"
                        >
                          <ExternalLink size={13} /> {t.clientDetails.copyPortalLink}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ──── LEFT COLUMN ──── */}
        <div className="space-y-6 min-w-0">
          {/* Properties Section */}
          <div className="section-card">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline">
              <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
                <MapPin size={15} className="text-text-secondary" />
                Properties
              </h2>
              <button
                className="inline-flex items-center gap-1 h-7 px-2.5 bg-surface border border-outline rounded-md text-[12px] text-text-primary hover:bg-surface-secondary transition-colors"
                onClick={() => {
                  const addr = prompt(t.clientDetails.propertyAddress);
                  if (addr && client) {
                    updateClient(client.id, { address: addr }).then((updated) => {
                      setClient(updated);
                      toast.success(t.clientDetails.propertyAdded);
                    }).catch((err: any) => toast.error(err?.message || 'Failed'));
                  }
                }}
              >
                <Plus size={12} /> New Property
              </button>
            </div>
            <div className="p-5">
              {fullAddress ? (
                <div className="flex items-start gap-3 rounded-lg border border-outline bg-surface-secondary p-3.5">
                  <a
                    href={buildGoogleMapsUrl(client)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 text-text-secondary hover:text-text-primary transition-colors"
                    title="Open in Google Maps"
                  >
                    <MapPin size={15} />
                  </a>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-text-primary">
                      {displayAddress(client.address || [client.street_number, client.street_name].filter(Boolean).join(' ') || 'Address')}
                    </p>
                    <p className="text-[12px] text-text-tertiary mt-0.5">
                      {[client.city, client.province, client.postal_code].filter(Boolean).join(', ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <a href={buildGoogleMapsDirectionsUrl(client)} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 h-6 px-2 bg-surface border border-outline rounded text-[11px] text-text-secondary hover:bg-surface-secondary transition-colors" title="Get directions">
                      <Navigation size={11} /> Directions
                    </a>
                    <a href={buildGoogleMapsUrl(client)} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 h-6 px-2 bg-surface border border-outline rounded text-[11px] text-text-secondary hover:bg-surface-secondary transition-colors" title="View on map">
                      <ExternalLink size={11} /> Map
                    </a>
                  </div>
                </div>
              ) : (
                <p className="text-[13px] text-text-tertiary">No properties added yet.</p>
              )}
            </div>
          </div>

          {/* Contacts Section */}
          <div className="section-card">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline">
              <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
                <User size={14} className="text-text-tertiary" />
                Contacts
              </h2>
            </div>
            <div className="p-5">
              <div className="flex items-center gap-3 rounded-lg border border-outline bg-surface-secondary p-4">
                <UnifiedAvatar id={client.id} name={`${client.first_name || ''} ${client.last_name || ''}`.trim()} size={36} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-semibold text-text-primary">{fullName}</p>
                    <span className="inline-flex items-center rounded-full bg-primary/10 text-primary text-[11px] font-semibold px-2.5 py-0.5">Primary</span>
                  </div>
                  <div className="flex items-center gap-4 mt-1.5">
                    {client.phone ? (
                      <span className="inline-flex items-center gap-1.5 text-[13px] text-text-secondary">
                        <Phone size={12} className="text-text-tertiary" />
                        <a href={`tel:${client.phone}`} className="hover:text-primary transition-colors">{displayPhone(client.phone)}</a>
                        <button onClick={() => copyToClipboard(client.phone!)} className="text-text-tertiary hover:text-text-primary transition-colors" title="Copy">
                          <Copy size={11} />
                        </button>
                      </span>
                    ) : null}
                    {client.email ? (
                      <span className="inline-flex items-center gap-1.5 text-[13px] text-text-secondary">
                        <Mail size={12} className="text-text-tertiary" />
                        <a href={`mailto:${client.email}`} className="hover:text-primary transition-colors">{displayEmail(client.email)}</a>
                        <button onClick={() => copyToClipboard(client.email!)} className="text-text-tertiary hover:text-text-primary transition-colors" title="Copy">
                          <Copy size={11} />
                        </button>
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Overview Section with Tabs */}
          <div className="section-card">
            <div className="px-5 pt-3.5 border-b border-outline">
              <div className="flex items-center gap-1 overflow-x-auto">
                {overviewTabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={cn(
                      'px-3 py-2.5 text-[13px] font-semibold border-b-2 transition-colors -mb-[1.5px] whitespace-nowrap',
                      activeTab === tab.key
                        ? 'border-primary text-text-primary'
                        : 'border-transparent text-text-tertiary hover:text-text-secondary'
                    )}
                  >
                    {tab.label}
                    {tab.count > 0 && (
                      <span className="ml-1.5 text-[11px] font-bold text-text-tertiary bg-surface-tertiary rounded-full px-1.5 py-0.5">
                        {tab.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-5">
              {/* Active Work Tab */}
              {activeTab === 'active' && (
                <div className="space-y-2.5">
                  {activeJobs.length === 0 ? (
                    <p className="text-[13px] text-text-tertiary py-4 text-center">No active work for this client.</p>
                  ) : activeJobs.map(renderJobRow)}
                </div>
              )}

              {/* Completed Tab */}
              {activeTab === 'completed' && (
                <div className="space-y-2.5">
                  {completedJobs.length === 0 ? (
                    <p className="text-[13px] text-text-tertiary py-4 text-center">No completed jobs.</p>
                  ) : completedJobs.map(renderJobRow)}
                </div>
              )}

              {/* Jobs Tab */}
              {activeTab === 'jobs' && (
                <div className="space-y-2.5">
                  {jobs.length === 0 ? (
                    <p className="text-[13px] text-text-tertiary py-4 text-center">{t.clients.noJobsLinked}</p>
                  ) : jobs.map(renderJobRow)}
                </div>
              )}

              {/* Invoices Tab */}
              {activeTab === 'invoices' && (
                <div className="space-y-2.5">
                  {invoices.length === 0 ? (
                    <p className="text-[13px] text-text-tertiary py-4 text-center">No invoices for this client.</p>
                  ) : invoices.map((inv) => (
                    <button
                      key={inv.id}
                      onClick={() => navigate(`/invoices/${inv.id}`)}
                      className="w-full rounded-lg border border-outline-subtle bg-surface-secondary p-3.5 flex items-center justify-between text-left hover:border-primary/30 transition-colors group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded bg-surface-tertiary flex items-center justify-center text-text-secondary"><FileText size={13} strokeWidth={2} /></div>
                        <div>
                          <div className="flex items-center gap-2">
                            {inv.invoice_number && <span className="text-[11px] font-bold text-text-tertiary">#{inv.invoice_number}</span>}
                            <p className="text-[13px] font-semibold text-text-primary group-hover:text-primary transition-colors">
                              {inv.subject || 'Invoice'}
                            </p>
                            <StatusBadge status={getInvoiceRowUiStatus(inv as any)} />
                          </div>
                          <span className="text-[12px] text-text-tertiary">
                            {inv.due_date ? `Due ${formatDate(inv.due_date)}` : formatDate(inv.created_at)}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-[13px] font-semibold text-text-primary tabular-nums">
                          {formatCurrency(Math.round(inv.total_cents || 0) / 100)}
                        </p>
                        {inv.balance_cents > 0 && (
                          <p className="text-[11px] text-warning font-medium tabular-nums">
                            {formatCurrency(Math.round(inv.balance_cents) / 100)} due
                          </p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Quotes Tab */}
              {activeTab === 'quotes' && (
                <div className="space-y-2.5">
                  <div className="flex justify-end mb-2">
                    <button
                      onClick={() => setIsQuoteCreateOpen(true)}
                      className="inline-flex items-center gap-1 h-7 px-2.5 bg-primary text-white rounded-md text-[12px] font-medium hover:bg-primary-hover transition-colors text-[12px] inline-flex items-center gap-1 px-2.5 py-1"
                    >
                      <Plus size={12} /> New Quote
                    </button>
                  </div>
                  {realQuotes.length === 0 ? (
                    <p className="text-[13px] text-text-tertiary py-4 text-center">No quotes for this client.</p>
                  ) : realQuotes.map((q) => (
                    <button
                      key={q.id}
                      onClick={async () => {
                        try {
                          const detail = await getQuoteById(q.id);
                          if (detail) { setQuoteDetail(detail); setIsQuoteDetailsOpen(true); }
                        } catch { toast.error('Failed to load quote'); }
                      }}
                      className="w-full rounded-lg border border-outline-subtle bg-surface-secondary p-3.5 flex items-center justify-between text-left hover:border-primary/30 transition-colors group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded bg-surface-tertiary flex items-center justify-center text-text-secondary"><FileText size={13} strokeWidth={2} /></div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold text-text-tertiary">#{q.quote_number}</span>
                            <p className="text-[13px] font-semibold text-text-primary group-hover:text-primary transition-colors">
                              {q.title || 'Quote'}
                            </p>
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${QUOTE_STATUS_COLORS[q.status] || 'bg-neutral-100 text-neutral-600'}`}>
                              {QUOTE_STATUS_LABELS[q.status] || q.status}
                            </span>
                          </div>
                          <span className="text-[12px] text-text-tertiary">{formatDate(q.created_at)}</span>
                        </div>
                      </div>
                      <p className="text-[13px] font-semibold text-text-primary tabular-nums">
                        {formatQuoteMoney(q.total_cents, q.currency)}
                      </p>
                    </button>
                  ))}
                </div>
              )}

              {/* Leads Tab */}
              {activeTab === 'leads' && (
                <div className="space-y-2.5">
                  {leads.length === 0 ? (
                    <p className="text-[13px] text-text-tertiary py-4 text-center">
                      {t.leads?.noLeadsFound || 'No leads for this client.'}
                    </p>
                  ) : leads.map((lead) => (
                    <button
                      key={lead.id}
                      onClick={() => navigate(`/leads?search=${encodeURIComponent(`${lead.first_name} ${lead.last_name}`)}`)}
                      className="w-full rounded-lg border border-outline-subtle bg-surface-secondary p-3.5 flex items-center justify-between text-left hover:border-primary/30 transition-colors group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded bg-surface-tertiary flex items-center justify-center text-text-secondary"><Contact size={13} strokeWidth={2} /></div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-[13px] font-semibold text-text-primary group-hover:text-primary transition-colors">
                              {lead.first_name} {lead.last_name}
                            </p>
                            <StatusBadge status={lead.status} />
                          </div>
                          <div className="flex items-center gap-2 text-[12px] text-text-tertiary">
                            {lead.source && <span>{lead.source}</span>}
                            <span>{formatDate(lead.created_at)}</span>
                          </div>
                        </div>
                      </div>
                      {lead.value > 0 && (
                        <p className="text-[13px] font-semibold text-text-primary tabular-nums">
                          {formatCurrency(lead.value)}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Specific Notes Tab */}
              {activeTab === 'specific_notes' && (
                <SpecificNotes entityType="client" entityId={id!} mode="tab" />
              )}
            </div>
          </div>

          {/* Schedule Section */}
          <div className="section-card">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline">
              <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
                <Calendar size={15} className="text-text-secondary" />
                {t.nav.calendar}
              </h2>
            </div>
            <div className="p-5 space-y-4">
              {/* Upcoming */}
              {upcomingEvents.length > 0 && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-text-tertiary mb-2">Upcoming</p>
                  <div className="space-y-2">
                    {upcomingEvents.slice(0, 5).map((event) => (
                      <div key={event.id} className="flex items-center gap-3 rounded-lg border border-outline-subtle bg-surface-secondary p-3">
                        <div className="w-6 h-6 rounded bg-surface-tertiary flex items-center justify-center text-text-secondary"><Clock size={13} strokeWidth={2} /></div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold text-text-primary truncate">{event.title}</p>
                          <p className="text-[12px] text-text-tertiary">
                            {formatDate(event.start_at)} {formatTime(event.start_at)}
                            {event.end_at && ` — ${formatTime(event.end_at)}`}
                          </p>
                          {event.status && (
                            <span className="inline-flex items-center rounded-full bg-primary/10 text-primary text-[10px] font-semibold px-2 py-0.5 mt-0.5">
                              {event.status}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Past */}
              {pastEvents.length > 0 && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-text-tertiary mb-2">Past</p>
                  <div className="space-y-2">
                    {pastEvents.slice(-3).reverse().map((event) => (
                      <div key={event.id} className="flex items-center gap-3 rounded-lg border border-outline-subtle bg-surface-secondary/50 p-3 opacity-70">
                        <div className="w-6 h-6 rounded bg-surface-tertiary flex items-center justify-center text-text-secondary"><CheckCircle2 size={13} strokeWidth={2} /></div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-text-secondary truncate">{event.title}</p>
                          <p className="text-[12px] text-text-tertiary">
                            {formatDate(event.start_at)} {formatTime(event.start_at)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {upcomingEvents.length === 0 && pastEvents.length === 0 && (
                <p className="text-[13px] text-text-tertiary text-center py-4">No schedule events.</p>
              )}
            </div>
          </div>

          {/* Activity Timeline — inside left column for proper alignment */}
          <ActivityTimeline entityType="client" entityId={id!} />
        </div>

        {/* ──── RIGHT SIDEBAR ──── */}
        <div className="space-y-6 lg:sticky lg:top-5">
          {/* Contact Info */}
          <div className="section-card">
            <div className="px-5 py-3.5 border-b border-outline">
              <h2 className="text-[13px] font-semibold text-text-primary">{language === 'fr' ? 'Informations de contact' : 'Contact Information'}</h2>
            </div>
            <div className="p-5 space-y-5">
              {/* Phone */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Phone size={12} className="text-text-tertiary" />
                  <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">{t.common.phone}</p>
                </div>
                {client.phone ? (
                  <div className="flex items-center gap-2 pl-5">
                    <a href={`tel:${client.phone}`} className="text-[13px] font-medium text-text-primary hover:text-primary transition-colors">{displayPhone(client.phone)}</a>
                    <button onClick={() => copyToClipboard(client.phone!)} className="text-text-tertiary hover:text-text-primary transition-colors" title="Copy">
                      <Copy size={11} />
                    </button>
                  </div>
                ) : (
                  <p className="text-[13px] text-text-tertiary pl-5">{t.common.noPhone}</p>
                )}
              </div>
              {/* Email */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Mail size={12} className="text-text-tertiary" />
                  <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">{t.common.email}</p>
                </div>
                {client.email ? (
                  <div className="flex items-center gap-2 pl-5 min-w-0">
                    <a href={`mailto:${client.email}`} className="text-[13px] font-medium text-text-primary hover:text-primary transition-colors truncate">{displayEmail(client.email)}</a>
                    <button onClick={() => copyToClipboard(client.email!)} className="text-text-tertiary hover:text-text-primary transition-colors flex-shrink-0" title="Copy">
                      <Copy size={11} />
                    </button>
                  </div>
                ) : (
                  <p className="text-[13px] text-text-tertiary pl-5">{t.common.noEmail}</p>
                )}
              </div>
              {/* Address */}
              {fullAddress && (
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <MapPin size={12} className="text-text-tertiary" />
                    <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">{language === 'fr' ? 'Adresse' : 'Address'}</p>
                  </div>
                  <a
                    href={buildGoogleMapsUrl(client)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[13px] font-medium text-text-primary hover:text-primary transition-colors pl-5 block"
                  >
                    {fullAddress}
                  </a>
                </div>
              )}
              {/* Lead source */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <User size={12} className="text-text-tertiary" />
                  <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">{language === 'fr' ? 'Source du lead' : 'Lead Source'}</p>
                </div>
                <p className="text-[13px] font-medium text-text-primary pl-5">
                  {leads[0]?.source || <span className="text-text-tertiary font-normal">{language === 'fr' ? 'Non spécifié' : 'Not specified'}</span>}
                </p>
              </div>
              {/* Client since */}
              <div className="pt-3 border-t border-outline/50">
                <div className="flex items-center gap-2 mb-1">
                  <Calendar size={12} className="text-text-tertiary" />
                  <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">{language === 'fr' ? 'Client depuis' : 'Client Since'}</p>
                </div>
                <p className="text-[13px] font-medium text-text-primary pl-5">{formatDate(client.created_at)}</p>
              </div>
            </div>
          </div>

          {/* Notes Section */}
          <div className="section-card">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline">
              <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
                <StickyNote size={15} className="text-text-secondary" />
                Notes
              </h2>
              {notesEdited && (
                <button
                  onClick={handleSaveNotes}
                  disabled={notesSaving}
                  className="inline-flex items-center gap-1 h-7 px-2.5 bg-primary text-white rounded-md text-[12px] font-medium hover:bg-primary-hover transition-colors"
                >
                  {notesSaving ? 'Saving...' : 'Save'}
                </button>
              )}
            </div>
            <div className="p-5">
              <textarea
                value={notes}
                onChange={(e) => { setNotes(e.target.value); setNotesEdited(true); }}
                onBlur={handleSaveNotes}
                placeholder="Add notes about this client..."
                className="w-full bg-transparent text-[13px] text-text-primary placeholder:text-text-tertiary resize-none min-h-[80px] focus:outline-none"
                rows={4}
              />
            </div>
          </div>

          {/* Tags Section */}
          <div className="section-card">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline">
              <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
                <Tag size={15} className="text-text-secondary" />
                Tags
              </h2>
              <button onClick={() => setShowTagInput(true)} className="inline-flex items-center gap-1 h-7 px-2.5 bg-surface border border-outline rounded-md text-[12px] text-text-primary hover:bg-surface-secondary transition-colors">
                <Plus size={12} /> New Tag
              </button>
            </div>
            <div className="p-5">
              {showTagInput && (
                <div className="flex items-center gap-2 mb-3">
                  <input
                    type="text"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddTag();
                      if (e.key === 'Escape') { setShowTagInput(false); setNewTag(''); }
                    }}
                    placeholder="Tag name..."
                    className="glass-input text-[13px] flex-1"
                    autoFocus
                  />
                  <button onClick={handleAddTag} className="inline-flex items-center gap-1 h-7 px-2.5 bg-primary text-white rounded-md text-[12px] font-medium hover:bg-primary-hover transition-colors !text-[12px] !px-2.5 !py-1">Add</button>
                  <button onClick={() => { setShowTagInput(false); setNewTag(''); }} className="inline-flex items-center gap-1 h-7 px-2.5 bg-surface border border-outline rounded-md text-[12px] text-text-primary hover:bg-surface-secondary transition-colors !text-[12px] !px-2.5 !py-1"><X size={12} /></button>
                </div>
              )}
              {tags.length === 0 && !showTagInput ? (
                <p className="text-[13px] text-text-tertiary">No tags added.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-tertiary text-[12px] font-medium text-text-secondary border border-outline-subtle group">
                      <Tag size={10} className="text-text-tertiary" />
                      {tag}
                      <button onClick={() => handleRemoveTag(tag)} className="ml-0.5 text-text-tertiary hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity">
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Billing History */}
          <div className="section-card">
            <div className="px-5 py-3.5 border-b border-outline">
              <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
                <DollarSign size={15} className="text-text-secondary" />
                Billing History
              </h2>
            </div>
            <div className="p-5">
              {/* Summary row */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="text-center">
                  <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Invoiced</p>
                  <p className="text-[14px] font-bold text-text-primary tabular-nums">{formatCurrency(Math.round(totalInvoiced))}</p>
                </div>
                <div className="text-center">
                  <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Paid</p>
                  <p className="text-[14px] font-bold text-success tabular-nums">{formatCurrency(Math.round(totalPaid))}</p>
                </div>
                <div className="text-center">
                  <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Balance</p>
                  <p className={cn('text-[14px] font-bold tabular-nums', currentBalance > 0 ? 'text-warning' : 'text-success')}>
                    {formatCurrency(Math.round(currentBalance))}
                  </p>
                </div>
              </div>

              {billingHistory.length === 0 ? (
                <p className="text-[13px] text-text-tertiary text-center py-2">No billing history.</p>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {billingHistory.slice(0, 10).map((item) =>
                    item.type === 'invoice' ? (
                      <button
                        key={`inv-${item.id}`}
                        onClick={() => navigate(`/invoices/${item.id}`)}
                        className="w-full flex items-center justify-between rounded-lg bg-surface-secondary p-2.5 hover:bg-surface-tertiary transition-colors text-left"
                      >
                        <div>
                          <p className="text-[13px] font-medium text-text-primary">
                            Invoice {(item.data as InvoiceRecord).invoice_number ? `#${(item.data as InvoiceRecord).invoice_number}` : ''}
                          </p>
                          <p className="text-[11px] text-text-tertiary">{formatDate(item.date)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[13px] font-semibold text-text-primary tabular-nums">
                            {formatCurrency(Math.round(((item.data as InvoiceRecord).total_cents || 0) / 100))}
                          </p>
                          <StatusBadge status={(item.data as InvoiceRecord).status} />
                        </div>
                      </button>
                    ) : (
                      <div
                        key={`pay-${item.id}`}
                        className="flex items-center justify-between rounded-lg bg-surface-secondary p-2.5"
                      >
                        <div>
                          <p className="text-[13px] font-medium text-text-primary flex items-center gap-1.5">
                            <DollarSign size={12} className="text-success" /> Payment
                            {(item.data as PaymentRecord).method && (
                              <span className="text-[11px] text-text-tertiary font-normal">({(item.data as PaymentRecord).method})</span>
                            )}
                          </p>
                          <p className="text-[11px] text-text-tertiary">{formatDate(item.date)}</p>
                        </div>
                        <p className="text-[13px] font-semibold text-success tabular-nums">
                          +{formatCurrency(Math.round(((item.data as PaymentRecord).amount_cents || 0) / 100))}
                        </p>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Quote Create Modal */}
      {isQuoteCreateOpen && client && (
        <QuoteCreateModal
          isOpen={isQuoteCreateOpen}
          onClose={() => setIsQuoteCreateOpen(false)}
          lead={{ id: '', first_name: client.first_name, last_name: client.last_name, email: client.email, phone: client.phone, company: client.company, client_id: client.id } as any}
          onCreated={(detail) => {
            setIsQuoteCreateOpen(false);
            setQuoteDetail(detail);
            setIsQuoteDetailsOpen(true);
            if (id) loadAllData(id);
          }}
        />
      )}

      {/* Quote Details Modal */}
      {isQuoteDetailsOpen && quoteDetail && (
        <QuoteDetailsModal
          isOpen={isQuoteDetailsOpen}
          onClose={() => { setIsQuoteDetailsOpen(false); setQuoteDetail(null); }}
          detail={quoteDetail}
          onRefresh={async () => {
            if (quoteDetail?.quote.id) {
              const refreshed = await getQuoteById(quoteDetail.quote.id);
              if (refreshed) setQuoteDetail(refreshed);
            }
          }}
          onConvertedToJob={(jobId) => navigate(`/jobs/${jobId}`)}
          onDuplicated={(dup) => setQuoteDetail(dup)}
        />
      )}
    </div>
  );
}
