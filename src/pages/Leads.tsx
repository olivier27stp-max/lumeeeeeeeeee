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
import NewLeadModal from '../components/NewLeadModal';
import { EmailConflictRecord, convertLeadToClient, createLeadScoped, deleteLeadScoped, exportAllLeadsCsv, fetchLeadsScoped, findEmailConflict, updateLeadScoped } from '../lib/leadsApi';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { PageHeader, StatCard, EmptyState } from '../components/ui';
import { FilterSelect } from '../components/ui/FilterBar';
import StatusBadge from '../components/ui/StatusBadge';

type SortBy = 'recent' | 'oldest';

const STATUS_OPTIONS = ['All', 'Lead', 'Qualified', 'Proposal', 'Negotiation', 'Closed'];

export default function Leads() {
  const navigate = useNavigate();
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

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    fetchLeads();
  }, [sortBy, statusFilter, sourceFilter, assignedFilter, debouncedSearch]);

  useEffect(() => {
    if (!selectedLead) return;
    setEditFirstName(selectedLead.first_name || '');
    setEditLastName(selectedLead.last_name || '');
    setEditEmail(selectedLead.email || '');
    setEditCompany(selectedLead.company || '');
    setEditStatus(selectedLead.status || 'Lead');
    setEditAssignedTo(selectedLead.assigned_to || '');
    setEditValue(String(selectedLead.value || 0));
    setEditError(null);
    setIsEditingLead(false);
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
    } catch (error: any) {
      setListError(error?.message || 'Failed to load leads.');
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
          setCreateError('Un lead avec ce email existe deja. Choisis Ajouter, Remplacer ou Annuler.');
          throw new Error('EMAIL_CONFLICT');
        }
      }

      const created = await createLeadFromPayload(leadData);
      if (!created?.id) {
        throw new Error('Lead save failed: no lead id returned.');
      }

      setIsNewLeadModalOpen(false);
      setLeads((prev) => [created, ...prev]);
      setSaveSuccess('Lead saved successfully.');
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
        setCreateError('Email deja utilise. Choisis Ajouter, Remplacer ou Annuler.');
      } else {
        setCreateError(message || 'Failed to save lead.');
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
      setSaveSuccess('Lead added without duplicate email.');
      window.dispatchEvent(new CustomEvent('crm:lead-created', { detail: { leadId: created.id } }));
      resolveConflictCancel();
      await fetchLeads();
    } catch (error: any) {
      setCreateError(error?.message || 'Failed to add lead.');
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
      setSaveSuccess('Existing lead replaced.');
      setIsNewLeadModalOpen(false);
      resolveConflictCancel();
      await fetchLeads();
    } catch (error: any) {
      setCreateError(error?.message || 'Failed to replace existing record.');
    } finally {
      setIsResolvingConflict(false);
    }
  };

  const handleUpdateLead = async () => {
    if (!selectedLead) return;
    setEditError(null);

    if (!editFirstName.trim() || !editLastName.trim() || !editCompany.trim()) {
      setEditError('First name, last name and lead title are required.');
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
      setEditError(error?.message || 'Failed to update lead.');
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
          for (const row of parsedRows) {
            const firstName = row.first_name || row.FirstName || '';
            const lastName = row.last_name || row.LastName || '';
            const company = row.company || row.Company || 'Imported lead';
            if (!firstName || !lastName) continue;
            await createLeadScoped({
              first_name: firstName,
              last_name: lastName,
              email: row.email || row.Email || '',
              company,
              value: Number(row.value || row.Value || 0),
              status: 'Lead',
              tags: row.tags ? row.tags.split(',').map((tag) => tag.trim()) : [],
            });
          }
          await fetchLeads();
        } catch (error) {
          console.error('Error importing leads:', error);
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
    if (!window.confirm('Are you sure you want to delete this lead?')) return;

    const previousLeads = leads;
    const previousSelected = selectedLead;
    const previousSelectedIds = selectedLeads;
    setLeads((prev) => prev.filter((lead) => lead.id !== id));
    setSelectedLeads((prev) => prev.filter((leadId) => leadId !== id));
    if (selectedLead?.id === id) setSelectedLead(null);

    try {
      await deleteLeadScoped(id);
      window.dispatchEvent(new CustomEvent('crm:lead-deleted', { detail: { leadId: id } }));
      toast.success('Lead deleted.');
    } catch (error: any) {
      console.error('Error deleting lead:', error);
      setLeads(previousLeads);
      setSelectedLead(previousSelected);
      setSelectedLeads(previousSelectedIds);
      setListError(error?.message || 'Failed to delete lead.');
      toast.error(error?.message || 'Failed to delete lead.');
    }
  };

  const deleteSelected = async () => {
    if (!selectedLeads.length) return;
    if (!window.confirm(`Are you sure you want to delete ${selectedLeads.length} leads?`)) return;

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
      toast.success(`${idsToDelete.length} lead(s) deleted.`);
    } catch (error: any) {
      setLeads(previousLeads);
      setSelectedLead(previousSelected);
      setSelectedLeads(idsToDelete);
      setListError(error?.message || 'Failed to delete selected leads.');
      toast.error(error?.message || 'Failed to delete selected leads.');
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
      setSaveSuccess('Lead converted to client successfully.');
    } catch (error: any) {
      setEditError(error?.message || 'Failed to convert lead.');
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
      toast.success('Lead auto-converted to client + deal + job.');
      setSelectedLead(null);
      await fetchLeads();
      if (result?.job_id) {
        navigate(`/jobs/${result.job_id}`);
      }
    } catch (error: any) {
      setEditError(error?.message || 'Failed to auto-convert lead.');
      toast.error(error?.message || 'Failed to auto-convert lead.');
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
      toast.success('Leads exported.');
    } catch (error: any) {
      setListError(error?.message || 'Failed to export leads.');
      toast.error(error?.message || 'Failed to export leads.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Leads" subtitle={`${leads.length} prospects`} icon={Contact} iconColor="pink">
        <div className="flex items-center gap-2">
          <label className="glass-button inline-flex items-center gap-1.5 cursor-pointer">
            <Upload size={14} />
            {isImporting ? 'Importing...' : 'Import'}
            <input type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
          </label>
          <button onClick={() => void handleExport()} disabled={isExporting} className="glass-button inline-flex items-center gap-1.5">
            <Download size={14} />
            {isExporting ? 'Exporting...' : 'Export'}
          </button>
          <button onClick={() => setIsNewLeadModalOpen(true)} className="glass-button-primary inline-flex items-center gap-1.5">
            <Plus size={14} />
            Add Lead
          </button>
        </div>
      </PageHeader>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Total Leads" value={leads.length} iconColor="pink" />
        <StatCard label="Qualified" value={leads.filter((l) => l.status === 'Qualified').length} iconColor="green" />
        <StatCard label="Total Value" value={formatCurrency(leads.reduce((s, l) => s + (l.value || 0), 0))} iconColor="amber" />
      </div>

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
              { value: 'recent', label: 'Most recent' },
              { value: 'oldest', label: 'Oldest first' },
            ]}
          />
        </div>
        <div className="relative w-full max-w-xs">
          <input
            type="text"
            placeholder="Search leads..."
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
            <span className="text-[13px] font-medium text-primary">{selectedLeads.length} selected</span>
            <button onClick={deleteSelected} className="glass-button-danger inline-flex items-center gap-1.5 text-xs">
              <Trash2 size={13} />
              Delete
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
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Name</th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Company</th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Status</th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Value</th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Date Added</th>
                <th className="px-4 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 6 }).map((_, idx) => (
                  <tr key={`sk-${idx}`} className="border-b border-border">
                    <td className="px-4 py-3" colSpan={7}>
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
                      <StatusBadge status={lead.status} />
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[13px] font-medium text-text-primary tabular-nums">{formatCurrency(lead.value || 0)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[13px] text-text-tertiary">{formatDate(lead.created_at)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={(e) => deleteLead(lead.id, e)}
                        className="p-1.5 text-text-tertiary hover:text-danger hover:bg-danger-light rounded transition-all"
                        title="Delete Lead"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              {noResults && (
                <tr>
                  <td colSpan={7} className="px-4 py-10">
                    <EmptyState icon={Users} title="No leads found" description="Try adjusting search or filters." />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <NewLeadModal
        isOpen={isNewLeadModalOpen}
        onClose={() => {
          setCreateError(null);
          resolveConflictCancel();
          setIsNewLeadModalOpen(false);
        }}
        onSave={handleCreateLead}
        isSaving={isCreatingLead}
        errorMessage={createError}
        mode="lead"
      />

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
                <h3 className="text-[15px] font-semibold text-text-primary">Email deja existant</h3>
                <p className="mt-2 text-[13px] text-text-secondary">
                  Un lead existe deja avec <span className="font-medium text-text-primary">{emailConflict.email}</span>.
                </p>
                <p className="mt-1 text-xs text-text-tertiary">
                  {emailConflict.first_name || ''} {emailConflict.last_name || ''}
                </p>
                <div className="mt-5 flex items-center justify-end gap-2">
                  <button onClick={resolveConflictCancel} disabled={isResolvingConflict} className="glass-button">
                    Annuler
                  </button>
                  <button onClick={() => void resolveConflictAdd()} disabled={isResolvingConflict} className="glass-button">
                    Ajouter
                  </button>
                  <button onClick={() => void resolveConflictReplace()} disabled={isResolvingConflict} className="glass-button-primary">
                    Remplacer
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
                    {isEditingLead ? 'Cancel' : 'Edit'}
                  </button>
                  <button
                    onClick={(e) => deleteLead(selectedLead.id, e)}
                    className="glass-button-danger inline-flex items-center gap-1.5"
                  >
                    <Trash2 size={13} />
                    Delete
                  </button>
                  <button
                    onClick={handleConvertLead}
                    disabled={isConverting || !!selectedLead.converted_to_client_id}
                    className="glass-button inline-flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {selectedLead.converted_to_client_id ? 'Converted' : isConverting ? 'Converting...' : 'Convert'}
                  </button>
                  <button
                    onClick={() => void handleAutoConvert()}
                    disabled={isAutoConverting || !!selectedLead.converted_to_client_id}
                    className="glass-button-primary inline-flex items-center gap-1.5 disabled:opacity-50"
                    title="Auto-convert: creates client + deal + job in one click"
                  >
                    {isAutoConverting ? 'Converting...' : 'Auto Deal+Job'}
                  </button>
                </div>

                {!isEditingLead && (
                  <>
                    {/* Stats */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="section-card p-4">
                        <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider mb-1">Value</p>
                        <p className="text-lg font-bold text-text-primary tabular-nums">{formatCurrency(selectedLead.value || 0)}</p>
                      </div>
                      <div className="section-card p-4">
                        <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider mb-1">Status</p>
                        <StatusBadge status={selectedLead.status} />
                      </div>
                    </div>

                    {/* Contact */}
                    <div className="section-card p-4 space-y-3">
                      <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">Contact Information</h3>
                      <div className="flex items-center gap-3 text-[13px] text-text-secondary">
                        <Mail size={14} className="text-text-tertiary shrink-0" />
                        {selectedLead.email || 'No email'}
                      </div>
                    </div>
                  </>
                )}

                {isEditingLead && (
                  <div className="section-card p-4 space-y-3">
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">Edit Lead</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">First name</label>
                        <input value={editFirstName} onChange={(e) => setEditFirstName(e.target.value)} className="glass-input w-full mt-1" />
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Last name</label>
                        <input value={editLastName} onChange={(e) => setEditLastName(e.target.value)} className="glass-input w-full mt-1" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Company</label>
                      <input value={editCompany} onChange={(e) => setEditCompany(e.target.value)} className="glass-input w-full mt-1" />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Email</label>
                      <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="glass-input w-full mt-1" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Status</label>
                        <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)} className="glass-input w-full mt-1">
                          {STATUS_OPTIONS.filter((s) => s !== 'All').map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Assigned to</label>
                        <input value={editAssignedTo} onChange={(e) => setEditAssignedTo(e.target.value)} className="glass-input w-full mt-1" placeholder="User ID" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Value</label>
                      <input type="number" min="0" value={editValue} onChange={(e) => setEditValue(e.target.value)} className="glass-input w-full mt-1" />
                    </div>
                    {editError && <p className="text-[13px] text-danger">{editError}</p>}
                    <button onClick={handleUpdateLead} disabled={isUpdatingLead} className="glass-button-primary w-full">
                      {isUpdatingLead ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
