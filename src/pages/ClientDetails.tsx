import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
import { StatusBadge, Skeleton } from '../components/ui';
import { useTranslation } from '../i18n';
import ActivityTimeline from '../components/ActivityTimeline';
import { useDropZone } from '../hooks/useDropZone';
import { useJobModalController } from '../contexts/JobModalController';
import QuoteCreateModal from '../components/quotes/QuoteCreateModal';
import QuoteDetailsModal from '../components/quotes/QuoteDetailsModal';
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
  start_time: string;
  end_time?: string;
  job_id?: string;
  assigned_to?: string;
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
type OverviewTab = 'active' | 'completed' | 'quotes' | 'jobs' | 'invoices' | 'leads';

// ─── Skeleton ────────────────────────────────────────────────────────
function DetailPageSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-5 w-32" />
      <div className="flex items-center gap-4">
        <Skeleton className="h-14 w-14 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-36" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-5">
        <div className="space-y-5">
          <div className="section-card p-5 space-y-3"><Skeleton className="h-5 w-28" /><Skeleton className="h-16 w-full" /></div>
          <div className="section-card p-5 space-y-3"><Skeleton className="h-5 w-28" /><Skeleton className="h-24 w-full" /></div>
          <div className="section-card p-5 space-y-3"><Skeleton className="h-5 w-28" /><Skeleton className="h-40 w-full" /></div>
        </div>
        <div className="space-y-5">
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
      setJobs((jobsData || []) as JobRecord[]);
      setNotes((clientData as any).notes || '');

      // Fetch invoices
      const { data: invoiceData } = await supabase
        .from('invoices')
        .select('*')
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

      // Fetch schedule events
      const { data: eventData } = await supabase
        .from('schedule_events')
        .select('*')
        .eq('client_id', clientId)
        .order('start_time', { ascending: true });
      setScheduleEvents((eventData || []) as ScheduleEvent[]);

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
      await supabase.from('clients').update({ notes }).eq('id', client.id);
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
    try {
      await softDeleteClient(client.id);
      toast.success('Client archived.');
      navigate('/clients');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to archive client.');
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
    setTags((prev) => prev.filter((t) => t !== tag));
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

  const upcomingEvents = scheduleEvents.filter((e) => new Date(e.start_time) >= new Date());
  const pastEvents = scheduleEvents.filter((e) => new Date(e.start_time) < new Date());

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
    { key: 'active', label: 'Active Work', count: activeJobs.length },
    { key: 'completed', label: 'Completed', count: completedJobs.length },
    { key: 'jobs', label: t.clients.jobs, count: jobs.length },
    { key: 'invoices', label: t.nav.invoices, count: invoices.length },
    { key: 'quotes', label: t.clientDetails.quotes, count: realQuotes.length },
    { key: 'leads', label: t.clientDetails.quotes, count: leads.length },
  ];

  // ─── Job row renderer (reused across tabs) ─────────────────────
  const renderJobRow = (job: JobRecord) => (
    <div key={job.id} className="w-full rounded-lg border border-outline-subtle bg-surface-secondary p-3.5 flex items-center justify-between text-left hover:border-primary/30 transition-colors group">
      <button
        onClick={() => navigate(`/jobs/${job.id}`)}
        className="flex items-center gap-3 flex-1 text-left"
      >
        <div className="icon-tile icon-tile-sm icon-tile-blue">
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
    <div className="space-y-5">
      {/* Back navigation */}
      <button onClick={() => navigate('/clients')} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-text-secondary hover:text-text-primary transition-colors">
        <ArrowLeft size={14} /> {t.clients.title}
      </button>

      {/* ═══ HEADER ═══ */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-text-primary text-surface flex items-center justify-center text-[18px] font-bold">
            {getInitials(client.first_name, client.last_name)}
          </div>
          <div>
            <h1 className="text-[22px] font-extrabold text-text-primary leading-tight">{fullName}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              {client.company && <span className="text-[13px] text-text-secondary">{client.company}</span>}
              <StatusBadge status={client.status} />
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {client.phone && (
            <a href={`tel:${client.phone}`} className="glass-button inline-flex items-center gap-1.5" title="Call">
              <Phone size={14} /> Call
            </a>
          )}
          {client.email && (
            <a href={`mailto:${client.email}`} className="glass-button inline-flex items-center gap-1.5" title="Email">
              <Mail size={14} /> Email
            </a>
          )}
          {client.phone && (
            <a href={`sms:${client.phone}`} className="glass-button inline-flex items-center gap-1.5" title="SMS">
              <Send size={14} /> SMS
            </a>
          )}

          <button
            onClick={() => setIsQuoteCreateOpen(true)}
            className="glass-button inline-flex items-center gap-1.5"
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
            className="glass-button-primary inline-flex items-center gap-1.5"
          >
            <Plus size={14} /> New Job
          </button>

          {/* More dropdown */}
          <div className="relative">
            <button onClick={() => setShowActionMenu(!showActionMenu)} className="glass-button inline-flex items-center gap-1">
              <MoreHorizontal size={14} />
            </button>
            {showActionMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowActionMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-lg border border-outline bg-surface shadow-lg py-1">
                  <button
                    onClick={() => { navigate(`/clients/${client.id}/edit`); setShowActionMenu(false); }}
                    className="w-full px-3 py-2 text-[13px] text-text-primary hover:bg-surface-secondary flex items-center gap-2 text-left"
                  >
                    <Edit2 size={13} /> {t.common.edit}
                  </button>
                  <button
                    onClick={handleArchive}
                    className="w-full px-3 py-2 text-[13px] text-danger hover:bg-surface-secondary flex items-center gap-2 text-left"
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
                      className="w-full px-3 py-2 text-[13px] text-text-primary hover:bg-surface-secondary flex items-center gap-2 text-left"
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

      {/* ═══ TWO COLUMN LAYOUT ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-5">
        {/* ──── LEFT COLUMN ──── */}
        <div className="space-y-5">
          {/* Properties Section */}
          <div className="rounded-xl border border-outline bg-surface">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline-subtle">
              <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
                <div className="icon-tile icon-tile-sm icon-tile-blue"><MapPin size={13} strokeWidth={2} /></div>
                Properties
              </h2>
              <button
                className="glass-button !text-[12px] !px-2.5 !py-1 inline-flex items-center gap-1"
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
                <div className="flex items-start gap-3 rounded-lg border border-outline-subtle bg-surface-secondary p-3.5">
                  {/* Clickable map icon → Google Maps */}
                  <a
                    href={buildGoogleMapsUrl(client)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="icon-tile icon-tile-sm icon-tile-blue mt-0.5 hover:scale-110 transition-transform cursor-pointer"
                    title="Open in Google Maps"
                  >
                    <MapPin size={13} strokeWidth={2} />
                  </a>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-text-primary">
                      {client.address || [client.street_number, client.street_name].filter(Boolean).join(' ') || 'Address'}
                    </p>
                    <p className="text-[12px] text-text-tertiary mt-0.5">
                      {[client.city, client.province, client.postal_code].filter(Boolean).join(', ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <a
                      href={buildGoogleMapsDirectionsUrl(client)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="glass-button !text-[11px] !px-2 !py-1 inline-flex items-center gap-1"
                      title="Get directions"
                    >
                      <Navigation size={11} /> Directions
                    </a>
                    <a
                      href={buildGoogleMapsUrl(client)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="glass-button !text-[11px] !px-2 !py-1 inline-flex items-center gap-1"
                      title="View on map"
                    >
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
          <div className="rounded-xl border border-outline bg-surface">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline-subtle">
              <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
                <div className="icon-tile icon-tile-sm icon-tile-blue"><User size={13} strokeWidth={2} /></div>
                Contacts
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{t.common.name}</th>
                    <th className="px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Role</th>
                    <th className="px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{t.common.phone}</th>
                    <th className="px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{t.common.email}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border-light">
                    <td className="px-5 py-3 text-[13px] font-semibold text-text-primary">{fullName}</td>
                    <td className="px-5 py-3 text-[13px] text-text-secondary">Primary</td>
                    <td className="px-5 py-3 text-[13px] text-text-secondary">
                      {client.phone ? (
                        <span className="inline-flex items-center gap-1.5">
                          <a href={`tel:${client.phone}`} className="text-primary hover:underline">{client.phone}</a>
                          <button onClick={() => copyToClipboard(client.phone!)} className="text-text-tertiary hover:text-text-primary" title="Copy">
                            <Copy size={11} />
                          </button>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-5 py-3 text-[13px] text-text-secondary">
                      {client.email ? (
                        <span className="inline-flex items-center gap-1.5">
                          <a href={`mailto:${client.email}`} className="text-primary hover:underline">{client.email}</a>
                          <button onClick={() => copyToClipboard(client.email!)} className="text-text-tertiary hover:text-text-primary" title="Copy">
                            <Copy size={11} />
                          </button>
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Overview Section with Tabs */}
          <div className="rounded-xl border border-outline bg-surface">
            <div className="px-5 pt-3.5 border-b border-outline-subtle">
              <div className="flex items-center gap-1 overflow-x-auto">
                {overviewTabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={cn(
                      'px-3 py-2.5 text-[13px] font-semibold border-b-2 transition-colors -mb-[1.5px] whitespace-nowrap',
                      activeTab === tab.key
                        ? 'border-text-primary text-text-primary'
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
                        <div className="icon-tile icon-tile-sm icon-tile-blue"><FileText size={13} strokeWidth={2} /></div>
                        <div>
                          <div className="flex items-center gap-2">
                            {inv.invoice_number && <span className="text-[11px] font-bold text-text-tertiary">#{inv.invoice_number}</span>}
                            <p className="text-[13px] font-semibold text-text-primary group-hover:text-primary transition-colors">
                              {inv.subject || 'Invoice'}
                            </p>
                            <StatusBadge status={inv.status} />
                          </div>
                          <span className="text-[12px] text-text-tertiary">
                            {inv.due_date ? `Due ${formatDate(inv.due_date)}` : formatDate(inv.created_at)}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-[13px] font-semibold text-text-primary tabular-nums">
                          {formatCurrency(Math.round((inv.total_cents || 0) / 100))}
                        </p>
                        {inv.balance_cents > 0 && (
                          <p className="text-[11px] text-warning font-medium tabular-nums">
                            {formatCurrency(Math.round(inv.balance_cents / 100))} due
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
                      className="glass-button-primary text-[12px] inline-flex items-center gap-1 px-2.5 py-1"
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
                        <div className="icon-tile icon-tile-sm icon-tile-blue"><FileText size={13} strokeWidth={2} /></div>
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
                        <div className="icon-tile icon-tile-sm icon-tile-purple"><Contact size={13} strokeWidth={2} /></div>
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
            </div>
          </div>

          {/* Schedule Section */}
          <div className="rounded-xl border border-outline bg-surface">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline-subtle">
              <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
                <div className="icon-tile icon-tile-sm icon-tile-blue"><Calendar size={13} strokeWidth={2} /></div>
                {t.nav.calendar}
              </h2>
            </div>
            <div className="p-5 space-y-4">
              {/* Upcoming */}
              {upcomingEvents.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-2">Upcoming</p>
                  <div className="space-y-2">
                    {upcomingEvents.slice(0, 5).map((event) => (
                      <div key={event.id} className="flex items-center gap-3 rounded-lg border border-outline-subtle bg-surface-secondary p-3">
                        <div className="icon-tile icon-tile-sm icon-tile-blue"><Clock size={13} strokeWidth={2} /></div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold text-text-primary truncate">{event.title}</p>
                          <p className="text-[12px] text-text-tertiary">
                            {formatDate(event.start_time)} {formatTime(event.start_time)}
                            {event.end_time && ` — ${formatTime(event.end_time)}`}
                          </p>
                          {event.assigned_to && (
                            <p className="text-[11px] text-text-tertiary flex items-center gap-1 mt-0.5">
                              <User size={10} /> {event.assigned_to}
                            </p>
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
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-2">Past</p>
                  <div className="space-y-2">
                    {pastEvents.slice(-3).reverse().map((event) => (
                      <div key={event.id} className="flex items-center gap-3 rounded-lg border border-outline-subtle bg-surface-secondary/50 p-3 opacity-70">
                        <div className="icon-tile icon-tile-sm icon-tile-gray"><CheckCircle2 size={13} strokeWidth={2} /></div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-text-secondary truncate">{event.title}</p>
                          <p className="text-[12px] text-text-tertiary">
                            {formatDate(event.start_time)} {formatTime(event.start_time)}
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
        </div>

        {/* ──── RIGHT SIDEBAR ──── */}
        <div className="space-y-5">
          {/* Contact Info */}
          <div className="rounded-xl border border-outline bg-surface">
            <div className="px-5 py-3.5 border-b border-outline-subtle">
              <h2 className="text-[13px] font-semibold text-text-primary">Contact Information</h2>
            </div>
            <div className="p-5 space-y-4">
              {/* Phone */}
              <div className="flex items-center gap-3">
                <div className="icon-tile icon-tile-sm icon-tile-blue"><Phone size={13} strokeWidth={2} /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.common.phone}</p>
                  {client.phone ? (
                    <div className="flex items-center gap-2 mt-0.5">
                      <a href={`tel:${client.phone}`} className="text-[13px] font-semibold text-primary hover:underline">{client.phone}</a>
                      <button onClick={() => copyToClipboard(client.phone!)} className="text-text-tertiary hover:text-text-primary" title="Copy phone">
                        <Copy size={11} />
                      </button>
                    </div>
                  ) : (
                    <p className="text-[13px] text-text-tertiary font-normal mt-0.5">{t.common.noPhone}</p>
                  )}
                </div>
              </div>
              {/* Email */}
              <div className="flex items-center gap-3">
                <div className="icon-tile icon-tile-sm icon-tile-blue"><Mail size={13} strokeWidth={2} /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.common.email}</p>
                  {client.email ? (
                    <div className="flex items-center gap-2 mt-0.5">
                      <a href={`mailto:${client.email}`} className="text-[13px] font-semibold text-primary hover:underline truncate">{client.email}</a>
                      <button onClick={() => copyToClipboard(client.email!)} className="text-text-tertiary hover:text-text-primary flex-shrink-0" title="Copy email">
                        <Copy size={11} />
                      </button>
                    </div>
                  ) : (
                    <p className="text-[13px] text-text-tertiary font-normal mt-0.5">{t.common.noEmail}</p>
                  )}
                </div>
              </div>
              {/* Address with map link */}
              {fullAddress && (
                <div className="flex items-center gap-3">
                  <a
                    href={buildGoogleMapsUrl(client)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="icon-tile icon-tile-sm icon-tile-blue hover:scale-110 transition-transform"
                    title="Open in Google Maps"
                  >
                    <MapPin size={13} strokeWidth={2} />
                  </a>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Address</p>
                    <a
                      href={buildGoogleMapsUrl(client)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[13px] font-semibold text-primary hover:underline mt-0.5 block"
                    >
                      {fullAddress}
                    </a>
                  </div>
                </div>
              )}
              {/* Lead source */}
              <div className="flex items-center gap-3">
                <div className="icon-tile icon-tile-sm icon-tile-blue"><User size={13} strokeWidth={2} /></div>
                <div>
                  <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Lead Source</p>
                  <p className="text-[13px] font-semibold text-text-primary mt-0.5">
                    {leads[0]?.source || <span className="text-text-tertiary font-normal">Not specified</span>}
                  </p>
                </div>
              </div>
              <div className="pt-2 border-t border-outline-subtle">
                <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Client since</p>
                <p className="text-[13px] font-semibold text-text-primary mt-0.5">{formatDate(client.created_at)}</p>
              </div>
            </div>
          </div>

          {/* Notes Section */}
          <div className="rounded-xl border border-outline bg-surface">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline-subtle">
              <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
                <div className="icon-tile icon-tile-sm icon-tile-blue"><StickyNote size={13} strokeWidth={2} /></div>
                Notes
              </h2>
              {notesEdited && (
                <button
                  onClick={handleSaveNotes}
                  disabled={notesSaving}
                  className="glass-button-primary !text-[12px] !px-2.5 !py-1"
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
          <div className="rounded-xl border border-outline bg-surface">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline-subtle">
              <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
                <div className="icon-tile icon-tile-sm icon-tile-blue"><Tag size={13} strokeWidth={2} /></div>
                Tags
              </h2>
              <button onClick={() => setShowTagInput(true)} className="glass-button !text-[12px] !px-2.5 !py-1 inline-flex items-center gap-1">
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
                  <button onClick={handleAddTag} className="glass-button-primary !text-[12px] !px-2.5 !py-1">Add</button>
                  <button onClick={() => { setShowTagInput(false); setNewTag(''); }} className="glass-button !text-[12px] !px-2.5 !py-1"><X size={12} /></button>
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
          <div className="rounded-xl border border-outline bg-surface">
            <div className="px-5 py-3.5 border-b border-outline-subtle">
              <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
                <div className="icon-tile icon-tile-sm icon-tile-blue"><DollarSign size={13} strokeWidth={2} /></div>
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

      <ActivityTimeline entityType="client" entityId={id!} />

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
