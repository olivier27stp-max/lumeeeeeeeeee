import React, { CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import {
  Contact,
  Download,
  Upload,
  Plus,
  Mail,
  Building2,
  Trash2,
  Edit2,
  Users,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { Lead } from '../types';
import { formatCurrency, formatDate, cn } from '../lib/utils';
import Papa from 'papaparse';
import { EmailConflictRecord, convertLeadToClient, createLeadScoped, deleteLeadScoped, exportAllLeadsCsv, fetchLeadsScoped, findEmailConflict, updateLeadScoped, updateLeadStatus, LEAD_STATUS_LABELS, type LeadStatus } from '../lib/leadsApi';
import { supabase } from '../lib/supabase';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader, StatCard, EmptyState } from '../components/ui';
import { FilterSelect } from '../components/ui/FilterBar';
import StatusBadge from '../components/ui/StatusBadge';
import { useTranslation } from '../i18n';
import { useEscapeKey } from '../hooks/useEscapeKey';
import QuickActions from '../components/QuickActions';
import BulkActionBar, { type BulkAction } from '../components/BulkActionBar';
import { Trash2 as TrashBulk, Send as SendBulk, Archive, FileText } from 'lucide-react';
import QuoteCreateModal from '../components/quotes/QuoteCreateModal';
import QuoteDetailsModal from '../components/quotes/QuoteDetailsModal';
import { type QuoteDetail, type Quote, listQuotesForLead, getQuoteById, formatQuoteMoney, QUOTE_STATUS_LABELS, QUOTE_STATUS_COLORS, fetchPendingQuotes, fetchQuoteKpis } from '../lib/quotesApi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DollarSign, Clock, FileText as FileTextIcon } from 'lucide-react';

type SortBy = 'recent' | 'oldest';

const STATUS_OPTIONS = ['All', 'New', 'Follow-up 1', 'Follow-up 2', 'Follow-up 3', 'Closed', 'Lost'];

type LeadsTab = 'leads' | 'pending_quotes';

export default function Leads() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t, language } = useTranslation();
  const queryClient = useQueryClient();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedLeads, setSelectedLeads] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
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
  const [isExporting, setIsExporting] = useState(false);

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

  // Tab management
  const activeTab: LeadsTab = searchParams.get('tab') === 'pending_quotes' ? 'pending_quotes' : 'leads';
  const setActiveTab = (tab: LeadsTab) => {
    const next = new URLSearchParams(searchParams);
    if (tab === 'leads') {
      next.delete('tab');
    } else {
      next.set('tab', tab);
    }
    setSearchParams(next, { replace: true });
  };

  // Pending quotes query
  const pendingQuotesQuery = useQuery({
    queryKey: ['pending-quotes-leads-page'],
    queryFn: fetchPendingQuotes,
    enabled: activeTab === 'pending_quotes',
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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    Papa.parse(file, {
      header: true,
      complete: async (results) => {
        try {
          const parsedRows = results.data as Record<string, string>[];
          const seenEmails = new Set<string>();
          let skipped = 0;
          for (const row of parsedRows) {
            const firstName = row.first_name || row.FirstName || '';
            const lastName = row.last_name || row.LastName || '';
            const company = row.company || row.Company || 'Imported lead';
            if (!firstName || !lastName) continue;
            const email = (row.email || row.Email || '').trim().toLowerCase();
            // Skip duplicates within CSV and against existing leads
            if (email && seenEmails.has(email)) { skipped++; continue; }
            if (email) {
              const conflict = await findEmailConflict(email).catch(() => null);
              if (conflict) { skipped++; seenEmails.add(email); continue; }
              seenEmails.add(email);
            }
            await createLeadScoped({
              first_name: firstName,
              last_name: lastName,
              email: email || '',
              company,
              value: Number(row.value || row.Value || 0),
              status: 'Lead',
              tags: row.tags ? row.tags.split(',').map((tag) => tag.trim()) : [],
            });
          }
          await fetchLeads();
          if (skipped > 0) {
            toast.info(`${skipped} duplicate${skipped > 1 ? 's' : ''} skipped`);
          }
        } catch (error: any) {
          console.error('Error importing leads:', error);
          toast.error(error?.message || 'Import failed');
        } finally {
          setIsImporting(false);
        }
      },
    });
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
      void queryClient.invalidateQueries({ queryKey: ['pending-quotes-leads-page'] });
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
      void queryClient.invalidateQueries({ queryKey: ['pending-quotes-leads-page'] });
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

  const noResults = !loading && leads.length === 0;
  const sourceOptions = useMemo(() => ['All', ...Array.from(new Set(leads.map((lead) => lead.source).filter(Boolean) as string[]))], [leads]);
  const assignedOptions = useMemo(() => ['All', ...Array.from(new Set(leads.map((lead) => lead.assigned_to).filter(Boolean) as string[]))], [leads]);

  const handleExport = async () => {
    setListError(null);
    setIsExporting(true);
    try {
      const csv = await exportAllLeadsCsv();
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success(t.leads.leadsExported);
    } catch (error: any) {
      setListError(error?.message || t.leads.failedExport);
      toast.error(error?.message || t.leads.failedExport);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t.leads.title} subtitle={`${leads.length} ${t.leads.prospects}`} icon={Contact} iconColor="pink">
        <div className="flex items-center gap-2">
          <label className="glass-button inline-flex items-center gap-1.5 cursor-pointer">
            <Upload size={14} />
            {isImporting ? t.common.importing : t.common.import}
            <input type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
          </label>
          <button onClick={() => void handleExport()} disabled={isExporting} className="glass-button inline-flex items-center gap-1.5">
            <Download size={14} />
            {isExporting ? t.common.exporting : t.common.export}
          </button>
          <button onClick={() => setIsNewLeadModalOpen(true)} className="glass-button-primary inline-flex items-center gap-1.5">
            <Plus size={14} />
            {t.leads.addLead}
          </button>
        </div>
      </PageHeader>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label={t.leads.totalLeads} value={leads.length} iconColor="pink" />
        <StatCard label={t.leads.qualified} value={leads.filter((l) => l.status === 'Qualified').length} iconColor="green" />
        <StatCard label={t.leads.totalValue} value={formatCurrency(leads.reduce((s, l) => s + (l.value || 0), 0))} iconColor="amber" />
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-border">
        <button
          type="button"
          onClick={() => setActiveTab('leads')}
          className={cn(
            'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
            activeTab === 'leads'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          )}
        >
          {t.leads.title}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('pending_quotes')}
          className={cn(
            'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px inline-flex items-center gap-2',
            activeTab === 'pending_quotes'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          )}
        >
          <FileTextIcon size={14} />
          {language === 'fr' ? 'Devis en attente' : 'Pending Quotes'}
          {(pendingQuoteKpis.data?.pending_count ?? 0) > 0 && (
            <span className="rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-bold text-text-primary">
              {pendingQuoteKpis.data?.pending_count}
            </span>
          )}
        </button>
      </div>

      {activeTab === 'pending_quotes' ? (
        <PendingQuotesView
          quotes={pendingQuotesQuery.data || []}
          loading={pendingQuotesQuery.isLoading}
          totalValue={pendingQuoteKpis.data?.pending_value_cents || 0}
          language={language}
          onOpenQuote={async (quoteId: string) => {
            try {
              const detail = await getQuoteById(quoteId);
              setQuoteDetail(detail);
              setIsQuoteDetailsOpen(true);
            } catch {}
          }}
          onRefresh={() => {
            void queryClient.invalidateQueries({ queryKey: ['pending-quotes-leads-page'] });
            void queryClient.invalidateQueries({ queryKey: ['pending-quotes-kpis'] });
            void queryClient.invalidateQueries({ queryKey: ['dashboard-quote-kpis'] });
          }}
        />
      ) : (
      <>
      {saveSuccess && (
        <div className="rounded-md bg-success-light border border-success/20 px-4 py-2.5 text-[13px] text-success">
          {saveSuccess}
        </div>
      )}
      {listError && (
        <div className="rounded-md bg-danger-light border border-danger/20 px-4 py-2.5 text-[13px] text-danger">
          {listError}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            value={statusFilter}
            onChange={setStatusFilter}
            options={STATUS_OPTIONS.map((s) => ({ value: s, label: s }))}
          />
          <FilterSelect
            value={sourceFilter}
            onChange={setSourceFilter}
            options={sourceOptions.map((s) => ({ value: s, label: s }))}
          />
          <FilterSelect
            value={assignedFilter}
            onChange={setAssignedFilter}
            options={assignedOptions.map((s) => ({ value: s, label: s }))}
          />
          <FilterSelect
            value={sortBy}
            onChange={(v) => setSortBy(v as SortBy)}
            options={[
              { value: 'recent', label: t.common.mostRecent },
              { value: 'oldest', label: t.common.oldestFirst },
            ]}
          />
        </div>
        <div className="relative w-full max-w-xs">
          <input
            type="text"
            placeholder={t.leads.searchLeads}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="glass-input w-full"
          />
        </div>
      </div>

      {/* Batch actions */}
      <AnimatePresence>
        {selectedLeads.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-3 rounded-md bg-primary/5 border border-primary/10 px-4 py-2"
          >
            <span className="text-[13px] font-medium text-primary">{selectedLeads.length} {t.common.selected}</span>
            <button onClick={deleteSelected} className="glass-button-danger inline-flex items-center gap-1.5 text-xs">
              <Trash2 size={13} />
              {t.common.delete}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table */}
      <div className="section-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={selectedLeads.length === leads.length && leads.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-border"
                  />
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{t.common.name}</th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{t.common.company}</th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{language === 'fr' ? 'Telephone' : 'Phone'}</th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{t.common.status}</th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{language === 'fr' ? 'Devis' : 'Quote'}</th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{t.common.value}</th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{t.common.dateAdded}</th>
                <th className="px-4 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 6 }).map((_, idx) => (
                  <tr key={`sk-${idx}`} className="border-b border-border">
                    <td className="px-4 py-3" colSpan={8}>
                      <div className="skeleton h-4 w-full" />
                    </td>
                  </tr>
                ))}
              {!loading &&
                leads.map((lead) => (
                  <tr
                    key={lead.id}
                    onClick={() => setSelectedLead(lead)}
                    className={cn(
                      'table-row-hover cursor-pointer',
                      selectedLeads.includes(lead.id) && 'bg-primary/[0.03]'
                    )}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedLeads.includes(lead.id)}
                        onChange={() => toggleSelectLead(lead.id)}
                        className="rounded border-border"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="avatar-sm">
                          {lead.first_name?.[0]}
                          {lead.last_name?.[0]}
                        </div>
                        <div>
                          <p className="text-[13px] font-medium text-text-primary">
                            {lead.first_name} {lead.last_name}
                          </p>
                          <p className="text-xs text-text-tertiary flex items-center gap-1">
                            <Mail size={10} />
                            {lead.email}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[13px] text-text-secondary flex items-center gap-1.5">
                        <Building2 size={13} className="text-text-tertiary" />
                        {lead.company}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {lead.phone ? (
                        <a href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()} className="text-[13px] text-primary hover:underline">{lead.phone}</a>
                      ) : (
                        <span className="text-[13px] text-text-tertiary">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={lead.status}
                        onClick={(e) => e.stopPropagation()}
                        onChange={async (e) => {
                          e.stopPropagation();
                          const newStatus = e.target.value as LeadStatus;
                          const dbStatus = Object.entries(LEAD_STATUS_LABELS).find(([, v]) => v === newStatus)?.[0] || newStatus.toLowerCase().replace(/[\s-]+/g, '_');
                          const previousStatus = lead.status;
                          // Optimistic update
                          setLeads((prev) => prev.map((l) => l.id === lead.id ? { ...l, status: newStatus } : l));
                          try {
                            await updateLeadStatus(lead.id, dbStatus as LeadStatus);
                            toast.success(`Status updated to ${newStatus}`);
                          } catch (err: any) {
                            // Revert on failure
                            setLeads((prev) => prev.map((l) => l.id === lead.id ? { ...l, status: previousStatus } : l));
                            toast.error(err.message);
                          }
                        }}
                        className="text-xs font-medium rounded-lg border border-outline bg-surface px-2 py-1 cursor-pointer hover:border-primary/40 transition-colors"
                      >
                        {STATUS_OPTIONS.filter((s) => s !== 'All').map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const quotes = quotesByLeadId.get(lead.id) || [];
                        if (quotes.length === 0) return <span className="text-[12px] text-text-tertiary">—</span>;
                        const latest = quotes[0];
                        return (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              getQuoteById(latest.id).then(d => { if (d) { setQuoteDetail(d); setIsQuoteDetailsOpen(true); } }).catch(() => toast.error('Failed to load quote'));
                            }}
                            className="text-left rounded-lg border border-outline px-2.5 py-1.5 hover:bg-surface-secondary hover:border-primary/30 transition-all w-full"
                          >
                            <div className="flex items-center gap-1.5">
                              <FileText size={12} className="text-primary shrink-0" />
                              <span className="text-[12px] font-medium text-text-primary">#{latest.quote_number}</span>
                              <span className={`text-[9px] font-semibold px-1 py-0.5 rounded-full ${QUOTE_STATUS_COLORS[latest.status] || 'bg-neutral-100 text-neutral-600'}`}>
                                {QUOTE_STATUS_LABELS[latest.status] || latest.status}
                              </span>
                            </div>
                            <p className="text-[12px] font-semibold text-text-primary tabular-nums mt-0.5">{formatQuoteMoney(latest.total_cents, latest.currency)}</p>
                            {quotes.length > 1 && <p className="text-[10px] text-primary mt-0.5">+{quotes.length - 1} {language === 'fr' ? 'autres' : 'more'}</p>}
                          </button>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[13px] font-medium text-text-primary tabular-nums">{formatCurrency(lead.value || 0)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[13px] text-text-tertiary">{formatDate(lead.created_at)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {(quotesByLeadId.get(lead.id) || []).length > 0 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const quotes = quotesByLeadId.get(lead.id) || [];
                              if (quotes.length > 0) {
                                getQuoteById(quotes[0].id).then(d => {
                                  if (d) { setQuoteDetail(d); setIsQuoteDetailsOpen(true); }
                                }).catch(() => toast.error('Failed to load quote'));
                              }
                            }}
                            className="p-1.5 text-text-tertiary hover:text-primary hover:bg-primary/10 rounded transition-all"
                            title={language === 'fr' ? 'Voir devis' : 'View quote'}
                          >
                            <FileText size={14} />
                          </button>
                        )}
                        <button
                          onClick={(e) => deleteLead(lead.id, e)}
                          className="p-1.5 text-text-tertiary hover:text-danger hover:bg-danger-light rounded transition-all"
                          title={t.common.delete}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              {noResults && (
                <tr>
                  <td colSpan={8} className="px-4 py-10">
                    <EmptyState
                      icon={Users}
                      title={t.leads.noLeadsFound}
                      description={leads.length === 0 ? (language === 'fr' ? 'Commencez par creer votre premier lead.' : 'Get started by creating your first lead.') : t.leads.tryAdjusting}
                      action={leads.length === 0 ? (
                        <button onClick={() => setIsNewLeadModalOpen(true)} className="glass-button-primary mt-3 inline-flex items-center gap-1.5 text-[13px]">
                          <Plus size={14} /> {t.leads.newLead}
                        </button>
                      ) : undefined}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Lead = QuoteCreateModal with inline lead creation */}
      <AnimatePresence>
        {isNewLeadModalOpen && (
          <QuoteCreateModal
            isOpen={isNewLeadModalOpen}
            onClose={() => { setIsNewLeadModalOpen(false); setCreateError(null); }}
            createLeadInline
            onCreated={(detail) => {
              setIsNewLeadModalOpen(false);
              fetchLeads();
              setSaveSuccess(language === 'fr' ? 'Lead et devis crees avec succes' : 'Lead and quote created successfully');
              // Ask user if they want to view the quote
              const goToQuote = window.confirm(
                language === 'fr'
                  ? `Devis #${detail.quote.quote_number} cree. Voulez-vous le voir maintenant?`
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
                    Send Quote
                  </button>
                </div>

                {!isEditingLead && (
                  <>
                    {/* Stats */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="section-card p-4">
                        <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider mb-1">{t.common.value}</p>
                        <p className="text-lg font-bold text-text-primary tabular-nums">{formatCurrency(selectedLead.value || 0)}</p>
                      </div>
                      <div className="section-card p-4">
                        <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider mb-1">{t.common.status}</p>
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
                          {language === 'fr' ? 'Devis' : 'Quotes'} ({leadQuotes.length})
                        </h3>
                        <button
                          onClick={() => setIsQuoteCreateOpen(true)}
                          className="glass-button-primary text-[11px] inline-flex items-center gap-1 px-2 py-0.5"
                        >
                          <Plus size={11} /> {language === 'fr' ? 'Nouveau' : 'New'}
                        </button>
                      </div>
                      {loadingQuotes ? (
                        <p className="text-[12px] text-text-tertiary">Loading...</p>
                      ) : leadQuotes.length === 0 ? (
                        <p className="text-[12px] text-text-tertiary italic">
                          {language === 'fr' ? 'Aucun devis pour ce lead' : 'No quotes for this lead'}
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
                                    {language === 'fr' ? 'Devis' : 'Quote'} #{q.quote_number}
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

      {/* Bulk actions bar */}
      <AnimatePresence>
        {selectedLeads.length > 0 && (
          <BulkActionBar
            count={selectedLeads.length}
            actions={[
              { id: 'delete', label: language === 'fr' ? 'Supprimer' : 'Delete', icon: TrashBulk, variant: 'danger' },
            ]}
            onAction={async (actionId) => {
              if (actionId === 'delete') {
                if (!window.confirm(language === 'fr' ? `Supprimer ${selectedLeads.length} leads ?` : `Delete ${selectedLeads.length} leads?`)) return;
                await deleteSelected();
              }
            }}
            onClear={() => setSelectedLeads([])}
            language={language}
          />
        )}
      </AnimatePresence>
      </>
      )}

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
              // Invalidate KPIs so pending counts stay in sync
              void queryClient.invalidateQueries({ queryKey: ['pending-quotes-leads-page'] });
              void queryClient.invalidateQueries({ queryKey: ['pending-quotes-kpis'] });
              void queryClient.invalidateQueries({ queryKey: ['dashboard-quote-kpis'] });
            }}
            onConvertedToJob={(jobId) => {
              // Invalidate KPIs after conversion
              void queryClient.invalidateQueries({ queryKey: ['pending-quotes-leads-page'] });
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

/** Pending quotes sub-view shown in the Leads page */
function PendingQuotesView({
  quotes,
  loading,
  totalValue,
  language,
  onOpenQuote,
  onRefresh,
}: {
  quotes: Array<Quote & { lead_name?: string; client_name?: string }>;
  loading: boolean;
  totalValue: number;
  language: string;
  onOpenQuote: (quoteId: string) => void;
  onRefresh: () => void;
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (quotes.length === 0) {
    return (
      <div className="section-card flex flex-col items-center justify-center py-16 text-center">
        <FileTextIcon size={32} className="mb-3 text-text-tertiary" />
        <p className="text-sm font-medium text-text-primary">
          {language === 'fr' ? 'Aucun devis en attente' : 'No pending quotes'}
        </p>
        <p className="mt-1 text-xs text-text-secondary">
          {language === 'fr' ? 'Tous les devis ont été traités.' : 'All quotes have been processed.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center gap-4 rounded-xl border border-outline-subtle bg-surface-secondary px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-black/5 p-1.5 text-text-secondary">
            <FileTextIcon size={14} />
          </div>
          <div>
            <p className="text-sm font-bold text-text-primary">
              {quotes.length} {language === 'fr' ? 'devis en attente' : 'pending quotes'}
            </p>
            <p className="text-xs text-text-secondary">
              {formatQuoteMoney(totalValue)} {language === 'fr' ? 'valeur totale' : 'total value'}
            </p>
          </div>
        </div>
      </div>

      {/* Quotes table */}
      <div className="section-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  {language === 'fr' ? 'Devis' : 'Quote'}
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  {language === 'fr' ? 'Client / Lead' : 'Client / Lead'}
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  {language === 'fr' ? 'Statut' : 'Status'}
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  {language === 'fr' ? 'Montant' : 'Amount'}
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  {language === 'fr' ? 'Créé le' : 'Created'}
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  {language === 'fr' ? 'Valide jusqu\'au' : 'Valid until'}
                </th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((quote) => {
                const statusLabel = QUOTE_STATUS_LABELS[quote.status as keyof typeof QUOTE_STATUS_LABELS] || quote.status;
                const statusColor = QUOTE_STATUS_COLORS[quote.status as keyof typeof QUOTE_STATUS_COLORS] || 'bg-neutral-100 text-neutral-700';
                const contactName = quote.client_name || quote.lead_name || '—';

                return (
                  <tr
                    key={quote.id}
                    className="border-b border-border hover:bg-black/[0.02] cursor-pointer transition-colors"
                    onClick={() => onOpenQuote(quote.id)}
                  >
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-text-primary">{quote.title || quote.quote_number}</p>
                      <p className="text-[10px] text-text-tertiary">{quote.quote_number}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-text-primary">{contactName}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold', statusColor)}>
                        {statusLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-semibold text-text-primary tabular-nums">
                        {formatQuoteMoney(quote.total_cents)}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-text-secondary">
                        {new Date(quote.created_at).toLocaleDateString(language === 'fr' ? 'fr-CA' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-text-secondary">
                        {quote.valid_until
                          ? new Date(quote.valid_until).toLocaleDateString(language === 'fr' ? 'fr-CA' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                          : '—'}
                      </p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
