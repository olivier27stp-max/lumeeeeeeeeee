import React, { useEffect, useState } from 'react';
import {
  Plus,
  Mail,
  Building2,
  Trash2,
  Edit2,
  Users,
  X,
  FileText,
  Package,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { Lead } from '../types';
import { formatCurrency, cn, expiryLabel } from '../lib/utils';
import { EmailConflictRecord, convertLeadToClient, createLeadScoped, deleteLeadScoped, fetchLeadsScoped, findEmailConflict, updateLeadScoped, updateLeadStatus, LEAD_STATUS_LABELS, type LeadStatus } from '../lib/leadsApi';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { PageHeader, StatCard, EmptyState } from '../components/ui';
import { useTranslation } from '../i18n';
import { useEscapeKey } from '../hooks/useEscapeKey';
import QuickActions from '../components/QuickActions';
import QuoteCreateModal from '../components/quotes/QuoteCreateModal';
import QuoteDetailsModal from '../components/quotes/QuoteDetailsModal';
import PresetSelectModal from '../components/quotes/PresetSelectModal';
import { type QuoteDetail, type Quote, listQuotesForLead, getQuoteById, formatQuoteMoney, QUOTE_STATUS_LABELS, QUOTE_STATUS_COLORS, fetchQuoteKpis, fetchAllQuotesWithContext, deleteQuote } from '../lib/quotesApi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { QuotePreset } from '../types';

type SortBy = 'recent' | 'oldest';

const STATUS_OPTIONS = ['All', 'New Prospect', 'No Response', 'Quote Sent', 'Closed Won', 'Closed Lost'];

export default function Leads() {
  const navigate = useNavigate();
  const { t, language } = useTranslation();
  const queryClient = useQueryClient();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedLeads, setSelectedLeads] = useState<string[]>([]);
  const [isNewLeadModalOpen, setIsNewLeadModalOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>('recent');
  const [statusFilter, setStatusFilter] = useState('All');
  const [sourceFilter, setSourceFilter] = useState('All');
  const [assignedFilter, setAssignedFilter] = useState('All');

  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreatingLead, setIsCreatingLead] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [isPresetSelectOpen, setIsPresetSelectOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<QuotePreset | null>(null);

  const [isEditingLead, setIsEditingLead] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [isUpdatingLead, setIsUpdatingLead] = useState(false);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editCompany, setEditCompany] = useState('');
  const [editStatus, setEditStatus] = useState('Lead');
  const [editAssignedTo, setEditAssignedTo] = useState('');
  const [editValue, setEditValue] = useState('0');
  const [emailConflict, setEmailConflict] = useState<EmailConflictRecord | null>(null);
  const [pendingLeadPayload, setPendingLeadPayload] = useState<any | null>(null);
  const [isResolvingConflict, setIsResolvingConflict] = useState(false);

  const [isAutoConverting, setIsAutoConverting] = useState(false);

  // Quote state
  const [isQuoteCreateOpen, setIsQuoteCreateOpen] = useState(false);
  const [quoteLeadOverride, setQuoteLeadOverride] = useState<any>(null);
  const [quoteDetail, setQuoteDetail] = useState<QuoteDetail | null>(null);
  const [isQuoteDetailsOpen, setIsQuoteDetailsOpen] = useState(false);
  const [leadQuotes, setLeadQuotes] = useState<Quote[]>([]);
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const [quotesByLeadId, setQuotesByLeadId] = useState<Map<string, Quote[]>>(new Map());

  // All quotes query (unified view)
  const allQuotesQuery = useQuery({
    queryKey: ['all-quotes-page'],
    queryFn: fetchAllQuotesWithContext,
    staleTime: 30_000,
  });

  const pendingQuoteKpis = useQuery({
    queryKey: ['pending-quotes-kpis'],
    queryFn: fetchQuoteKpis,
    staleTime: 30_000,
  });

  // Escape key closes drawer/modal
  useEscapeKey(() => {
    if (selectedLead) { setSelectedLead(null); return; }
    if (isNewLeadModalOpen) { setIsNewLeadModalOpen(false); return; }
  }, !!(selectedLead || isNewLeadModalOpen));

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    fetchLeads();
  }, [sortBy, statusFilter, sourceFilter, assignedFilter, debouncedSearch]);

  // Listen for command palette create event
  useEffect(() => {
    const handler = () => setIsNewLeadModalOpen(true);
    window.addEventListener('crm:open-new-lead', handler);
    return () => window.removeEventListener('crm:open-new-lead', handler);
  }, []);

  useEffect(() => {
    if (!selectedLead) { setLeadQuotes([]); return; }
    setEditFirstName(selectedLead.first_name || '');
    setEditLastName(selectedLead.last_name || '');
    setEditEmail(selectedLead.email || '');
    setEditCompany(selectedLead.company || '');
    setEditStatus(selectedLead.status || 'Lead');
    setEditAssignedTo(selectedLead.assigned_to || '');
    setEditValue(String(selectedLead.value || 0));
    setEditError(null);
    setIsEditingLead(false);
    // Load quotes for this lead
    setLoadingQuotes(true);
    listQuotesForLead(selectedLead.id)
      .then(setLeadQuotes)
      .catch(() => setLeadQuotes([]))
      .finally(() => setLoadingQuotes(false));
  }, [selectedLead]);

  async function fetchLeads() {
    setLoading(true);
    setListError(null);
    try {
      const data = await fetchLeadsScoped({
        search: debouncedSearch,
        sort: sortBy,
        status: statusFilter,
        source: sourceFilter,
        assignedTo: assignedFilter,
      });
      setLeads(data);

      // Fetch quotes for all leads in one query
      const leadIds = data.map(l => l.id);
      if (leadIds.length > 0) {
        const { data: allQuotes } = await supabase
          .from('quotes')
          .select('id, lead_id, quote_number, title, status, total_cents, currency, created_at')
          .in('lead_id', leadIds)
          .is('deleted_at', null)
          .order('created_at', { ascending: false });
        const grouped = new Map<string, Quote[]>();
        for (const q of (allQuotes || []) as any[]) {
          const arr = grouped.get(q.lead_id) || [];
          arr.push(q as Quote);
          grouped.set(q.lead_id, arr);
        }
        setQuotesByLeadId(grouped);
      }
    } catch (error: any) {
      setListError(error?.message || t.leads.failedLoad);
    } finally {
      setLoading(false);
    }
  }

  const createLeadFromPayload = async (leadData: any, forceWithoutEmail = false) => {
    return createLeadScoped({
      first_name: String(leadData.first_name || '').trim(),
      last_name: String(leadData.last_name || '').trim(),
      email: forceWithoutEmail ? '' : String(leadData.email || '').trim(),
      address: String(leadData.address || '').trim(),
      company: String(leadData.company || '').trim(),
      value: Number(leadData.value || 0),
      status: String(leadData.status || 'Lead'),
      tags: [],
    });
  };

  const handleCreateLead = async (leadData: any) => {
    setCreateError(null);
    setSaveSuccess(null);
    setIsCreatingLead(true);

    try {
      const email = String(leadData.email || '').trim();
      if (email) {
        const conflict = await findEmailConflict(email);
        if (conflict && conflict.kind === 'lead') {
          setPendingLeadPayload(leadData);
          setEmailConflict(conflict);
          setCreateError(t.leads.emailConflictChoose);
          throw new Error('EMAIL_CONFLICT');
        }
      }

      const created = await createLeadFromPayload(leadData);
      if (!created?.id) {
        throw new Error('Lead save failed: no lead id returned.');
      }

      setIsNewLeadModalOpen(false);
      setLeads((prev) => [created, ...prev]);
      setSaveSuccess(t.leads.leadSaved);
      window.dispatchEvent(new CustomEvent('crm:lead-created', { detail: { leadId: created.id } }));
      await fetchLeads();
    } catch (error: any) {
      console.error('Lead create failed:', error);
      const message = String(error?.message || '');
      const isEmailConflict = error?.code === '23505'
        || message.includes('uq_leads_org_email_notnull')
        || message.includes('leads_org_email_unique_active_idx')
        || message.includes('EMAIL_CONFLICT');
      if (isEmailConflict) {
        if (!emailConflict) {
          const conflict = await findEmailConflict(String(leadData.email || '').trim());
          if (conflict && conflict.kind === 'lead') {
            setPendingLeadPayload(leadData);
            setEmailConflict(conflict);
          }
        }
        setCreateError(t.leads.emailConflictChoose);
      } else {
        setCreateError(message || t.leads.failedSave);
      }
      throw error;
    } finally {
      setIsCreatingLead(false);
    }
  };

  const resolveConflictCancel = () => {
    setEmailConflict(null);
    setPendingLeadPayload(null);
    setIsResolvingConflict(false);
  };

  const resolveConflictAdd = async () => {
    if (!pendingLeadPayload) return;
    setIsResolvingConflict(true);
    setCreateError(null);
    try {
      const created = await createLeadFromPayload(pendingLeadPayload, true);
      if (!created?.id) throw new Error('Lead save failed: no lead id returned.');
      setIsNewLeadModalOpen(false);
      setLeads((prev) => [created, ...prev]);
      setSaveSuccess(t.leads.addedWithoutDuplicate);
      window.dispatchEvent(new CustomEvent('crm:lead-created', { detail: { leadId: created.id } }));
      resolveConflictCancel();
      await fetchLeads();
    } catch (error: any) {
      setCreateError(error?.message || t.leads.failedSave);
    } finally {
      setIsResolvingConflict(false);
    }
  };

  const resolveConflictReplace = async () => {
    if (!pendingLeadPayload || !emailConflict) return;
    setIsResolvingConflict(true);
    setCreateError(null);
    try {
      await updateLeadScoped(emailConflict.id, {
        first_name: String(pendingLeadPayload.first_name || '').trim(),
        last_name: String(pendingLeadPayload.last_name || '').trim(),
        email: String(pendingLeadPayload.email || '').trim(),
        address: String(pendingLeadPayload.address || '').trim(),
        company: String(pendingLeadPayload.company || '').trim(),
        value: Number(pendingLeadPayload.value || 0),
        status: String(pendingLeadPayload.status || 'Lead'),
      });
      setSaveSuccess(t.leads.existingReplaced);
      setIsNewLeadModalOpen(false);
      resolveConflictCancel();
      await fetchLeads();
    } catch (error: any) {
      setCreateError(error?.message || t.leads.failedSave);
    } finally {
      setIsResolvingConflict(false);
    }
  };

  const handleUpdateLead = async () => {
    if (!selectedLead) return;
    setEditError(null);

    if (!editFirstName.trim() || !editLastName.trim() || !editCompany.trim()) {
      setEditError(t.leads.requiredFields);
      return;
    }

    setIsUpdatingLead(true);
    try {
      const updated = await updateLeadScoped(selectedLead.id, {
        first_name: editFirstName.trim(),
        last_name: editLastName.trim(),
        email: editEmail.trim(),
        company: editCompany.trim(),
        value: Number(editValue || 0),
        status: editStatus,
        assigned_to: editAssignedTo || null,
      });
      setLeads((prev) => prev.map((lead) => (lead.id === updated.id ? updated : lead)));
      setSelectedLead(updated);
      setIsEditingLead(false);
    } catch (error: any) {
      console.error('Lead update failed:', error);
      setEditError(error?.message || t.leads.failedSave);
    } finally {
      setIsUpdatingLead(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedLeads.length === leads.length) {
      setSelectedLeads([]);
    } else {
      setSelectedLeads(leads.map((lead) => lead.id));
    }
  };

  const toggleSelectLead = (id: string) => {
    setSelectedLeads((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const deleteLead = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!window.confirm(t.leads.confirmDelete)) return;

    const previousLeads = leads;
    const previousSelected = selectedLead;
    const previousSelectedIds = selectedLeads;
    setLeads((prev) => prev.filter((lead) => lead.id !== id));
    setSelectedLeads((prev) => prev.filter((leadId) => leadId !== id));
    if (selectedLead?.id === id) setSelectedLead(null);

    try {
      await deleteLeadScoped(id);
      window.dispatchEvent(new CustomEvent('crm:lead-deleted', { detail: { leadId: id } }));
      toast.success(t.leads.leadDeleted);
      // Invalidate quote KPIs since lead's quotes may now be orphaned
      void queryClient.invalidateQueries({ queryKey: ['pending-quotes-kpis'] });
      void queryClient.invalidateQueries({ queryKey: ['all-quotes-page'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-quote-kpis'] });
    } catch (error: any) {
      console.error('Error deleting lead:', error);
      setLeads(previousLeads);
      setSelectedLead(previousSelected);
      setSelectedLeads(previousSelectedIds);
      setListError(error?.message || t.leads.failedDelete);
      toast.error(error?.message || t.leads.failedDelete);
    } finally {
      void fetchLeads();
    }
  };

  const deleteSelected = async () => {
    if (!selectedLeads.length) return;
    if (!window.confirm(t.leads.confirmDeleteMultiple.replace('{count}', String(selectedLeads.length)))) return;

    const idsToDelete = [...selectedLeads];
    const previousLeads = leads;
    const previousSelected = selectedLead;
    setLeads((prev) => prev.filter((lead) => !idsToDelete.includes(lead.id)));
    setSelectedLeads([]);
    if (selectedLead && idsToDelete.includes(selectedLead.id)) setSelectedLead(null);

    try {
      await Promise.all(
        idsToDelete.map(async (id) => {
          await deleteLeadScoped(id);
          window.dispatchEvent(new CustomEvent('crm:lead-deleted', { detail: { leadId: id } }));
        })
      );
      toast.success(t.leads.leadsDeleted.replace('{count}', String(idsToDelete.length)));
      // Invalidate quote KPIs since leads' quotes may now be orphaned
      void queryClient.invalidateQueries({ queryKey: ['pending-quotes-kpis'] });
      void queryClient.invalidateQueries({ queryKey: ['all-quotes-page'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-quote-kpis'] });
    } catch (error: any) {
      setLeads(previousLeads);
      setSelectedLead(previousSelected);
      setSelectedLeads(idsToDelete);
      setListError(error?.message || t.leads.failedDelete);
      toast.error(error?.message || t.leads.failedDelete);
    } finally {
      void fetchLeads();
    }
  };

  const handleConvertLead = async () => {
    if (!selectedLead) return;
    setIsConverting(true);
    setEditError(null);
    try {
      const { lead } = await convertLeadToClient(selectedLead.id);
      setLeads((prev) => prev.map((item) => (item.id === lead.id ? lead : item)));
      setSelectedLead(lead);
      setSaveSuccess(t.leads.leadConverted);
    } catch (error: any) {
      setEditError(error?.message || t.leads.failedConvert);
    } finally {
      setIsConverting(false);
    }
  };

  const handleAutoConvert = async () => {
    if (!selectedLead) return;
    setIsAutoConverting(true);
    setEditError(null);
    try {
      const { data, error } = await supabase.rpc('auto_convert_lead_to_deal_and_job', {
        p_lead_id: selectedLead.id,
      });
      if (error) throw error;
      const result = data as any;
      toast.success(t.leads.autoConverted);
      setSelectedLead(null);
      await fetchLeads();
      if (result?.job_id) {
        navigate(`/jobs/${result.job_id}`);
      }
    } catch (error: any) {
      setEditError(error?.message || t.leads.failedAutoConvert);
      toast.error(error?.message || t.leads.failedAutoConvert);
    } finally {
      setIsAutoConverting(false);
    }
  };


  return (
    <div className="space-y-0">
      {(() => {
        const activeQuotes = allQuotesQuery.data || [];
        const kpiTotal = activeQuotes.length;
        const kpiApproved = activeQuotes.filter((q) => q.status === 'approved').length;
        const kpiValue = activeQuotes.reduce((s, q) => s + Number((q as any).total_cents || 0), 0);
        return (
          <>
            {/* ── Attio header ── */}
            <div className="flex items-center justify-between px-1 py-4">
              <div className="flex items-center gap-3">
                <h1 className="text-[16px] font-bold text-text-primary tracking-tight">{t.leads.title}</h1>
                <span className="text-[12px] text-text-tertiary font-medium tabular-nums">{kpiTotal}</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => navigate('/quotes/presets')}
                  className="px-3 py-1.5 rounded-lg border border-outline text-[12px] font-medium text-text-secondary hover:text-text-primary hover:border-text-tertiary transition-all inline-flex items-center gap-1.5">
                  <Package size={12} /> Presets
                </button>
                <button onClick={() => setIsPresetSelectOpen(true)}
                  className="px-3 py-1.5 rounded-lg bg-primary text-white text-[12px] font-semibold hover:opacity-90 transition-all inline-flex items-center gap-1.5">
                  <Plus size={13} /> {t.leads.addLead}
                </button>
              </div>
            </div>

            {/* ── KPI strip ── */}
            <div className="flex items-center gap-6 px-1 pb-4">
              {[
                { label: t.leads.totalLeads, value: String(kpiTotal) },
                { label: t.leads.qualified, value: String(kpiApproved) },
                { label: t.leads.totalValue, value: formatCurrency(kpiValue / 100) },
              ].map((m) => (
                <div key={m.label} className="min-w-[100px]">
                  <p className="text-[10px] font-medium text-text-tertiary uppercase tracking-wider">{m.label}</p>
                  <p className="text-[16px] font-bold text-text-primary tabular-nums mt-0.5">{m.value}</p>
                </div>
              ))}
            </div>
          </>
        );
      })()}

      {saveSuccess && <div className="rounded-lg bg-surface-secondary border border-outline px-4 py-2 text-[12px] text-text-primary mx-1 mb-3">{saveSuccess}</div>}
      {listError && <div className="rounded-lg bg-surface-secondary border border-outline px-4 py-2 text-[12px] text-danger mx-1 mb-3">{listError}</div>}

      {/* ── Search bar ── */}
      <div className="flex items-center gap-2 px-1 pb-3">
        <input type="text" placeholder={t.leads.searchLeads} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full max-w-xs pl-3 pr-3 py-1.5 text-[12px] border border-outline rounded-lg bg-surface text-text-primary placeholder:text-text-tertiary outline-none focus:border-text-tertiary transition-colors" />
      </div>

      {/* ── Attio-style quotes table ── */}
      {(() => {
        const allQuotes = allQuotesQuery.data || [];
        const filtered = debouncedSearch
          ? allQuotes.filter((q) => {
              const s = debouncedSearch.toLowerCase();
              return (
                (q.client_name || '').toLowerCase().includes(s) ||
                (q.lead_name || '').toLowerCase().includes(s) ||
                (q.quote_number || '').toLowerCase().includes(s) ||
                (q.title || '').toLowerCase().includes(s)
              );
            })
          : allQuotes;
        const quotesLoading = allQuotesQuery.isLoading;
        const noQuotes = !quotesLoading && filtered.length === 0;

        return (
      <div className="border border-outline rounded-xl overflow-hidden bg-surface">
        <div className="grid" style={{ gridTemplateColumns: '1fr 60px 1fr 100px 90px 100px 70px 36px' }}>
          {/* Header */}
          <div className="px-4 py-2.5 border-b border-outline text-[10px] font-semibold uppercase tracking-widest text-text-tertiary flex items-center">{t.invoices.client}</div>
          <div className="px-3 py-2.5 border-b border-outline text-[10px] font-semibold uppercase tracking-widest text-text-tertiary flex items-center">#</div>
          <div className="px-3 py-2.5 border-b border-outline text-[10px] font-semibold uppercase tracking-widest text-text-tertiary flex items-center">{t.quotes?.title || 'Title'}</div>
          <div className="px-3 py-2.5 border-b border-outline text-[10px] font-semibold uppercase tracking-widest text-text-tertiary flex items-center">{language === 'fr' ? 'Statut' : 'Status'}</div>
          <div className="px-3 py-2.5 border-b border-outline text-[10px] font-semibold uppercase tracking-widest text-text-tertiary flex items-center justify-end">{t.common.value}</div>
          <div className="px-3 py-2.5 border-b border-outline text-[10px] font-semibold uppercase tracking-widest text-text-tertiary flex items-center">{t.leads.dateCreated}</div>
          <div className="px-3 py-2.5 border-b border-outline text-[10px] font-semibold uppercase tracking-widest text-text-tertiary flex items-center">{language === 'fr' ? 'Expire' : 'Expires'}</div>
          <div className="border-b border-outline" />

          {/* Loading */}
          {quotesLoading && Array.from({ length: 6 }).map((_, idx) => (
            <React.Fragment key={`sk-${idx}`}>
              <div className="px-4 py-3 border-b border-outline/50"><div className="h-4 w-20 bg-surface-secondary rounded animate-pulse" /></div>
              <div className="px-3 py-3 border-b border-outline/50"><div className="h-4 w-8 bg-surface-secondary rounded animate-pulse" /></div>
              <div className="px-3 py-3 border-b border-outline/50"><div className="h-4 w-24 bg-surface-secondary rounded animate-pulse" /></div>
              <div className="px-3 py-3 border-b border-outline/50"><div className="h-4 w-14 bg-surface-secondary rounded-full animate-pulse" /></div>
              <div className="px-3 py-3 border-b border-outline/50"><div className="h-4 w-12 bg-surface-secondary rounded animate-pulse ml-auto" /></div>
              <div className="px-3 py-3 border-b border-outline/50"><div className="h-4 w-16 bg-surface-secondary rounded animate-pulse" /></div>
              <div className="px-3 py-3 border-b border-outline/50"><div className="h-4 w-10 bg-surface-secondary rounded animate-pulse" /></div>
              <div className="border-b border-outline/50" />
            </React.Fragment>
          ))}

          {/* Rows */}
          {!quotesLoading && filtered.map((quote) => {
            const contactName = quote.client_name || quote.lead_name || '\u2014';
            const statusLabel = QUOTE_STATUS_LABELS[quote.status as keyof typeof QUOTE_STATUS_LABELS] || quote.status;
            const rowCls = 'border-b border-outline/50 hover:bg-surface-secondary/40 cursor-pointer transition-colors';
            const openQuote = async () => {
              try {
                const detail = await getQuoteById(quote.id);
                if (detail) { setQuoteDetail(detail); setIsQuoteDetailsOpen(true); }
              } catch { toast.error(t.leads.failedToLoadQuote); }
            };
            return (
              <React.Fragment key={quote.id}>
                <div className={`px-4 py-2.5 flex items-center gap-2 min-w-0 ${rowCls}`} onClick={openQuote}>
                  <div className="w-6 h-6 rounded-full bg-surface-secondary border border-outline flex items-center justify-center text-[9px] font-bold text-text-tertiary shrink-0">
                    {contactName.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-[12px] font-medium text-text-primary truncate">{contactName}</span>
                </div>
                <div className={`px-3 py-2.5 flex items-center ${rowCls}`} onClick={openQuote}>
                  <span className="text-[12px] font-medium text-text-secondary tabular-nums">#{quote.quote_number}</span>
                </div>
                <div className={`px-3 py-2.5 flex items-center min-w-0 ${rowCls}`} onClick={openQuote}>
                  <span className="text-[12px] text-text-secondary truncate">{(quote as any).title || '\u2014'}</span>
                </div>
                <div className={`px-3 py-2.5 flex items-center ${rowCls}`} onClick={openQuote}>
                  <span className={cn('inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium',
                    quote.status === 'draft' ? 'bg-surface-secondary text-text-tertiary' :
                    quote.status === 'approved' ? 'bg-surface-secondary text-text-primary' :
                    quote.status === 'declined' || quote.status === 'expired' ? 'bg-surface-secondary text-text-tertiary' :
                    'bg-surface-secondary text-text-secondary')}>
                    {statusLabel}
                  </span>
                </div>
                <div className={`px-3 py-2.5 flex items-center justify-end ${rowCls}`} onClick={openQuote}>
                  <span className="text-[12px] font-semibold text-text-primary tabular-nums">{formatQuoteMoney(quote.total_cents, quote.currency)}</span>
                </div>
                <div className={`px-3 py-2.5 flex items-center ${rowCls}`} onClick={openQuote}>
                  <span className="text-[11px] text-text-tertiary tabular-nums">
                    {new Date(quote.created_at).toLocaleDateString(t.dashboard.enus, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
                <div className={`px-3 py-2.5 flex items-center ${rowCls}`} onClick={openQuote}>
                  {(quote as any).valid_until ? (() => {
                    const exp = expiryLabel((quote as any).valid_until, language === 'fr');
                    return <span className={cn('text-[10px]', exp.className)}>{exp.text}</span>;
                  })() : <span className="text-[10px] text-text-tertiary">—</span>}
                </div>
                <div className={`py-2.5 flex items-center justify-center ${rowCls} group`}>
                  <button onClick={async (e) => {
                    e.stopPropagation();
                    if (!window.confirm(t.leads.confirmDelete)) return;
                    try {
                      await deleteQuote(quote.id);
                      toast.success(t.leads.leadDeleted);
                      void queryClient.invalidateQueries({ queryKey: ['all-quotes-page'] });
                      void queryClient.invalidateQueries({ queryKey: ['pending-quotes-kpis'] });
                    } catch (err: any) { toast.error(err?.message || t.leads.failedDelete); }
                  }}
                    className="p-1 rounded text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-danger transition-all">
                    <Trash2 size={13} />
                  </button>
                </div>
              </React.Fragment>
            );
          })}

          {/* Empty */}
          {noQuotes && (
            <div className="col-span-8 px-4 py-16 text-center">
              <FileText size={20} className="mx-auto text-text-tertiary opacity-40 mb-2" />
              <p className="text-[12px] text-text-tertiary">{allQuotes.length === 0 ? t.leads.getStartedByCreatingYourFirstQuote : t.leads.tryAdjusting}</p>
              {allQuotes.length === 0 && (
                <button onClick={() => setIsNewLeadModalOpen(true)}
                  className="mt-3 px-3 py-1.5 rounded-lg bg-primary text-white text-[12px] font-semibold hover:opacity-90 transition-all inline-flex items-center gap-1.5">
                  <Plus size={13} /> {t.leads.addLead}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
        );
      })()}

      {/* Preset Selection Modal */}
      <AnimatePresence>
        {isPresetSelectOpen && (
          <PresetSelectModal
            isOpen={isPresetSelectOpen}
            isFr={language === 'fr'}
            onClose={() => setIsPresetSelectOpen(false)}
            onStartFromScratch={() => {
              setIsPresetSelectOpen(false);
              setSelectedPreset(null);
              setIsNewLeadModalOpen(true);
            }}
            onSelectPreset={(preset) => {
              setIsPresetSelectOpen(false);
              setSelectedPreset(preset);
              setIsNewLeadModalOpen(true);
            }}
            onCreatePreset={() => {
              setIsPresetSelectOpen(false);
              navigate('/quotes/presets');
            }}
          />
        )}
      </AnimatePresence>

      {/* New Lead = QuoteCreateModal with inline lead creation */}
      <AnimatePresence>
        {isNewLeadModalOpen && (
          <QuoteCreateModal
            isOpen={isNewLeadModalOpen}
            onClose={() => { setIsNewLeadModalOpen(false); setSelectedPreset(null); setCreateError(null); }}
            createLeadInline
            preset={selectedPreset}
            onCreated={(detail) => {
              setIsNewLeadModalOpen(false);
              setSelectedPreset(null);
              fetchLeads();
              void queryClient.invalidateQueries({ queryKey: ['all-quotes-page'] });
              void queryClient.invalidateQueries({ queryKey: ['pending-quotes-kpis'] });
              void queryClient.invalidateQueries({ queryKey: ['dashboard-quote-kpis'] });
              setSaveSuccess(t.leads.quoteCreatedSuccessfully);
              const goToQuote = window.confirm(
                language === 'fr'
                  ? `Devis #${detail.quote.quote_number} créé. Voulez-vous le voir maintenant?`
                  : `Quote #${detail.quote.quote_number} created. View it now?`
              );
              if (goToQuote) navigate(`/quotes/${detail.quote.id}`);
            }}
          />
        )}
      </AnimatePresence>

      {/* Email conflict modal */}
      <AnimatePresence>
        {emailConflict && pendingLeadPayload && (
          <div className="modal-overlay">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="modal-content max-w-md"
            >
              <div className="p-5">
                <h3 className="text-[15px] font-semibold text-text-primary">{t.leads.emailConflictTitle}</h3>
                <p className="mt-2 text-[13px] text-text-secondary">
                  {t.leads.emailConflictMsg} <span className="font-medium text-text-primary">{emailConflict.email}</span>
                </p>
                <p className="mt-1 text-xs text-text-tertiary">
                  {emailConflict.first_name || ''} {emailConflict.last_name || ''}
                </p>
                <div className="mt-5 flex items-center justify-end gap-2">
                  <button onClick={resolveConflictCancel} disabled={isResolvingConflict} className="glass-button">
                    {t.common.cancel}
                  </button>
                  <button onClick={() => void resolveConflictAdd()} disabled={isResolvingConflict} className="glass-button">
                    {t.common.addAnyway}
                  </button>
                  <button onClick={() => void resolveConflictReplace()} disabled={isResolvingConflict} className="glass-button-primary">
                    {t.common.replace}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Lead drawer */}
      <AnimatePresence>
        {selectedLead && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedLead(null)}
              className="fixed inset-0 bg-black/20 backdrop-blur-[2px] z-40"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 h-screen w-full max-w-lg bg-surface border-l border-outline z-50 overflow-y-auto"
            >
              {/* Drawer header */}
              <div className="sticky top-0 z-10 bg-surface border-b border-border px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="avatar-md text-base">
                    {selectedLead.first_name?.[0]}
                    {selectedLead.last_name?.[0]}
                  </div>
                  <div>
                    <h2 className="text-[15px] font-bold text-text-primary">
                      {selectedLead.first_name} {selectedLead.last_name}
                    </h2>
                    <p className="text-xs text-text-tertiary">{selectedLead.company}</p>
                  </div>
                </div>
                <button onClick={() => setSelectedLead(null)} className="p-1.5 rounded hover:bg-surface-secondary text-text-tertiary">
                  <X size={16} />
                </button>
              </div>

              <div className="p-5 space-y-5">
                {/* Actions */}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setIsEditingLead((prev) => !prev)}
                    className="glass-button inline-flex items-center gap-1.5"
                  >
                    <Edit2 size={13} />
                    {isEditingLead ? t.common.cancel : t.common.edit}
                  </button>
                  <button
                    onClick={(e) => deleteLead(selectedLead.id, e)}
                    className="glass-button-danger inline-flex items-center gap-1.5"
                  >
                    <Trash2 size={13} />
                    {t.common.delete}
                  </button>
                  <button
                    onClick={handleConvertLead}
                    disabled={isConverting || !!selectedLead.converted_to_client_id}
                    className="glass-button inline-flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {selectedLead.converted_to_client_id ? t.leads.converted : isConverting ? t.leads.converting : t.leads.convert}
                  </button>
                  <button
                    onClick={() => void handleAutoConvert()}
                    disabled={isAutoConverting || !!selectedLead.converted_to_client_id}
                    className="glass-button-primary inline-flex items-center gap-1.5 disabled:opacity-50"
                    title={t.leads.autoConvertTitle}
                  >
                    {isAutoConverting ? t.leads.converting : t.leads.autoDealJob}
                  </button>
                  <button
                    onClick={() => setIsQuoteCreateOpen(true)}
                    className="glass-button inline-flex items-center gap-1.5 text-primary border-primary/20 hover:bg-primary/5"
                  >
                    <FileText size={13} />
                    {t.leads.sendQuote}
                  </button>
                </div>

                {!isEditingLead && (
                  <>
                    {/* Stats */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="section-card p-4">
                        <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1">{t.common.value}</p>
                        <p className="text-lg font-bold text-text-primary tabular-nums">{formatCurrency(selectedLead.value || 0)}</p>
                      </div>
                      <div className="section-card p-4">
                        <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1">{t.common.status}</p>
                        <select
                          value={selectedLead.status}
                          onChange={async (e) => {
                            const newStatus = e.target.value;
                            const dbStatus = Object.entries(LEAD_STATUS_LABELS).find(([, v]) => v === newStatus)?.[0] || newStatus.toLowerCase().replace(/[\s-]+/g, '_');
                            try {
                              await updateLeadStatus(selectedLead.id, dbStatus as LeadStatus);
                              const updated = { ...selectedLead, status: newStatus };
                              setSelectedLead(updated);
                              setLeads((prev) => prev.map((l) => l.id === selectedLead.id ? updated : l));
                              toast.success(`Status updated to ${newStatus}`);
                            } catch (err: any) {
                              toast.error(err.message);
                            }
                          }}
                          className="text-xs font-medium rounded-lg border border-outline bg-surface px-2 py-1 cursor-pointer hover:border-primary/40 transition-colors"
                        >
                          {STATUS_OPTIONS.filter((s) => s !== 'All').map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Contact + Quick Actions */}
                    <div className="section-card p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">{t.leads.contactInfo}</h3>
                        <QuickActions phone={selectedLead.phone} email={selectedLead.email} size="sm" />
                      </div>
                      <div className="flex items-center gap-3 text-[13px] text-text-secondary">
                        <Mail size={14} className="text-text-tertiary shrink-0" />
                        {selectedLead.email || t.common.noEmail}
                      </div>
                    </div>

                    {/* Quotes for this lead */}
                    <div className="section-card p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">
                          {t.clientDetails.quotes} ({leadQuotes.length})
                        </h3>
                        <button
                          onClick={() => setIsQuoteCreateOpen(true)}
                          className="glass-button-primary text-[11px] inline-flex items-center gap-1 px-2 py-0.5"
                        >
                          <Plus size={11} /> {t.leads.new}
                        </button>
                      </div>
                      {loadingQuotes ? (
                        <p className="text-[12px] text-text-tertiary">Loading...</p>
                      ) : leadQuotes.length === 0 ? (
                        <p className="text-[12px] text-text-tertiary italic">
                          {t.leads.noQuotesYet}
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {leadQuotes.map((q) => (
                            <button
                              key={q.id}
                              type="button"
                              onClick={async () => {
                                try {
                                  const detail = await getQuoteById(q.id);
                                  if (detail) { setQuoteDetail(detail); setIsQuoteDetailsOpen(true); }
                                } catch { toast.error('Failed to load quote'); }
                              }}
                              className="w-full text-left rounded-lg border border-outline p-3 hover:bg-surface-secondary transition-colors"
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <FileText size={13} className="text-text-tertiary" />
                                  <span className="text-[13px] font-medium text-text-primary">
                                    {t.agent.quote} #{q.quote_number}
                                  </span>
                                </div>
                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                                  QUOTE_STATUS_COLORS[q.status] || 'bg-neutral-100 text-neutral-600'
                                }`}>
                                  {QUOTE_STATUS_LABELS[q.status] || q.status}
                                </span>
                              </div>
                              {q.title && (
                                <p className="text-[11px] text-text-tertiary mt-1 truncate">{q.title}</p>
                              )}
                              <div className="flex items-center justify-between mt-1.5 text-[11px]">
                                <span className="text-text-tertiary">
                                  {new Date(q.created_at).toLocaleDateString()}
                                </span>
                                <span className="font-semibold text-text-primary">
                                  {formatQuoteMoney(q.total_cents, q.currency)}
                                </span>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {isEditingLead && (
                  <div className="section-card p-4 space-y-3">
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">{t.leads.editLead}</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.common.firstName}</label>
                        <input value={editFirstName} onChange={(e) => setEditFirstName(e.target.value)} className="glass-input w-full mt-1" />
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.common.lastName}</label>
                        <input value={editLastName} onChange={(e) => setEditLastName(e.target.value)} className="glass-input w-full mt-1" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.common.company}</label>
                      <input value={editCompany} onChange={(e) => setEditCompany(e.target.value)} className="glass-input w-full mt-1" />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.common.email}</label>
                      <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="glass-input w-full mt-1" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.common.status}</label>
                        <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)} className="glass-input w-full mt-1">
                          {STATUS_OPTIONS.filter((s) => s !== 'All').map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.common.assignedTo}</label>
                        <input value={editAssignedTo} onChange={(e) => setEditAssignedTo(e.target.value)} className="glass-input w-full mt-1" placeholder="User ID" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.common.value}</label>
                      <input type="number" min="0" value={editValue} onChange={(e) => setEditValue(e.target.value)} className="glass-input w-full mt-1" />
                    </div>
                    {editError && <p className="text-[13px] text-danger">{editError}</p>}
                    <button onClick={handleUpdateLead} disabled={isUpdatingLead} className="glass-button-primary w-full">
                      {isUpdatingLead ? t.common.saving : t.common.save}
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Quote Create Modal */}
      <AnimatePresence>
        {isQuoteCreateOpen && (
          <QuoteCreateModal
            isOpen={isQuoteCreateOpen}
            onClose={() => { setIsQuoteCreateOpen(false); setQuoteLeadOverride(null); }}
            lead={quoteLeadOverride || selectedLead}
            onCreated={(detail) => {
              setQuoteLeadOverride(null);
              setQuoteDetail(detail);
              setIsQuoteDetailsOpen(true);
            }}
          />
        )}
      </AnimatePresence>

      {/* Quote Details Modal */}
      <AnimatePresence>
        {isQuoteDetailsOpen && quoteDetail && (
          <QuoteDetailsModal
            isOpen={isQuoteDetailsOpen}
            onClose={() => { setIsQuoteDetailsOpen(false); setQuoteDetail(null); }}
            detail={quoteDetail}
            onRefresh={async () => {
              if (quoteDetail?.quote.id) {
                const { getQuoteById } = await import('../lib/quotesApi');
                const refreshed = await getQuoteById(quoteDetail.quote.id);
                if (refreshed) setQuoteDetail(refreshed);
              }
              void queryClient.invalidateQueries({ queryKey: ['all-quotes-page'] });
              void queryClient.invalidateQueries({ queryKey: ['pending-quotes-kpis'] });
              void queryClient.invalidateQueries({ queryKey: ['dashboard-quote-kpis'] });
            }}
            onConvertedToJob={(jobId) => {
              void queryClient.invalidateQueries({ queryKey: ['all-quotes-page'] });
              void queryClient.invalidateQueries({ queryKey: ['pending-quotes-kpis'] });
              void queryClient.invalidateQueries({ queryKey: ['dashboard-quote-kpis'] });
              navigate(`/jobs/${jobId}`);
            }}
            onDuplicated={(dup) => { setQuoteDetail(dup); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

