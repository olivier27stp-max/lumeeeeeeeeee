import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Archive, ChevronLeft, ChevronRight, Upload, MoreHorizontal, Plus, Trash2, X } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { cn, formatCurrency, formatDate } from '../lib/utils';
import {
  createClient,
  createClientWithDuplicateHandling,
  findClientsByEmail,
  findClientsByPlaceId,
  getClientById,
  hardDeleteClient,
  softDeleteClient,
  listClientJobs,
  listClients,
  updateClient,
} from '../lib/clientsApi';
import AddressAutocomplete from '../components/AddressAutocomplete';
import type { StructuredAddress } from '../components/AddressAutocomplete';
import { supabase } from '../lib/supabase';
import { PageHeader, StatusBadge, StatCard } from '../components/ui';
import FilterBar, { FilterSelect } from '../components/ui/FilterBar';
import { useTranslation } from '../i18n';
import { useEscapeKey } from '../hooks/useEscapeKey';

type ClientSort = 'recent' | 'oldest' | 'name_asc' | 'name_desc';

const STATUS_OPTIONS = ['All', 'active', 'lead', 'inactive'];

interface ClientFormState {
  first_name: string;
  last_name: string;
  company: string;
  email: string;
  phone: string;
  address: string;
  street_number: string;
  street_name: string;
  city: string;
  province: string;
  postal_code: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  place_id: string;
  status: string;
}

const EMPTY_FORM: ClientFormState = {
  first_name: '',
  last_name: '',
  company: '',
  email: '',
  phone: '',
  address: '',
  street_number: '',
  street_name: '',
  city: '',
  province: '',
  postal_code: '',
  country: '',
  latitude: null,
  longitude: null,
  place_id: '',
  status: 'active',
};

export default function Clients() {
  const navigate = useNavigate();
  const { id: clientIdFromRoute } = useParams();
  const { t } = useTranslation();
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState('All');
  const [sortBy, setSortBy] = useState<ClientSort>('recent');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isDuplicateModalOpen, setIsDuplicateModalOpen] = useState(false);
  const [duplicateCandidates, setDuplicateCandidates] = useState<any[]>([]);
  const [pendingCreatePayload, setPendingCreatePayload] = useState<ClientFormState | null>(null);
  const [selected, setSelected] = useState<any | null>(null);
  const [selectedJobs, setSelectedJobs] = useState<any[]>([]);
  const [form, setForm] = useState<ClientFormState>(EMPTY_FORM);
  const [clientToDelete, setClientToDelete] = useState<any | null>(null);
  const [isDeletingClient, setIsDeletingClient] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchArchiving, setIsBatchArchiving] = useState(false);
  const [addressDuplicateWarning, setAddressDuplicateWarning] = useState<string | null>(null);

  const totalColSpan = 7;

  // Escape key closes drawers/modals
  useEscapeKey(() => {
    if (clientToDelete) { setClientToDelete(null); return; }
    if (selected) { setSelected(null); return; }
    if (isCreateOpen) { setIsCreateOpen(false); return; }
  }, !!(selected || isCreateOpen || clientToDelete));

  const toggleSelectAll = () => {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((item) => item.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleBatchArchive = async () => {
    if (selectedIds.size === 0) return;
    setIsBatchArchiving(true);
    try {
      const { data: orgId, error: orgError } = await supabase.rpc('current_org_id');
      if (orgError) throw orgError;
      const { data, error } = await supabase.rpc('batch_soft_delete_clients', {
        p_org_id: orgId,
        p_client_ids: Array.from(selectedIds),
      });
      if (error) throw error;
      const count = (data as any)?.archived_clients || selectedIds.size;
      toast.success(t.clients.archived.replace('{count}', String(count)));
      setSelectedIds(new Set());
      await loadClients();
    } catch (err: any) {
      toast.error(err?.message || t.clients.failedArchive);
    } finally {
      setIsBatchArchiving(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    void loadClients();
  }, [page, pageSize, statusFilter, sortBy, debouncedSearch]);

  // Listen for command palette create event
  useEffect(() => {
    const handler = () => setIsCreateOpen(true);
    window.addEventListener('crm:open-new-client', handler);
    return () => window.removeEventListener('crm:open-new-client', handler);
  }, []);

  useEffect(() => {
    async function syncSelectedClientFromRoute() {
      if (!clientIdFromRoute) {
        setSelected(null);
        return;
      }

      const inMemory = items.find((client) => client.id === clientIdFromRoute);
      if (inMemory) {
        setSelected(inMemory);
        return;
      }

      try {
        const client = await getClientById(clientIdFromRoute);
        if (client) setSelected(client);
      } catch {
        setSelected(null);
      }
    }

    void syncSelectedClientFromRoute();
  }, [clientIdFromRoute, items]);

  useEffect(() => {
    if (!selected) return;
    setForm({
      first_name: selected.first_name || '',
      last_name: selected.last_name || '',
      company: selected.company || '',
      email: selected.email || '',
      phone: selected.phone || '',
      address: selected.address || '',
      street_number: selected.street_number || '',
      street_name: selected.street_name || '',
      city: selected.city || '',
      province: selected.province || '',
      postal_code: selected.postal_code || '',
      country: selected.country || '',
      latitude: selected.latitude ?? null,
      longitude: selected.longitude ?? null,
      place_id: selected.place_id || '',
      status: selected.status || 'active',
    });
    setAddressDuplicateWarning(null);
    void loadClientJobs(selected.id);
  }, [selected?.id]);

  async function loadClients() {
    setLoading(true);
    setError(null);
    try {
      const res = await listClients({
        page,
        pageSize,
        status: statusFilter,
        q: debouncedSearch,
        sort: sortBy,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (err: any) {
      setError(err?.message || t.clients.failedCreate);
    } finally {
      setLoading(false);
    }
  }

  async function loadClientJobs(clientId: string) {
    try {
      const jobs = await listClientJobs(clientId);
      setSelectedJobs(jobs);
    } catch {
      setSelectedJobs([]);
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const handleAddressSelect = async (addr: StructuredAddress) => {
    setForm((prev) => ({
      ...prev,
      address: addr.formatted_address,
      street_number: addr.street_number,
      street_name: addr.street_name,
      city: addr.city,
      province: addr.province,
      postal_code: addr.postal_code,
      country: addr.country,
      latitude: addr.latitude,
      longitude: addr.longitude,
      place_id: addr.place_id,
    }));
    setAddressDuplicateWarning(null);
    if (addr.place_id) {
      try {
        const dupes = await findClientsByPlaceId(addr.place_id, selected?.id);
        if (dupes.length > 0) {
          const names = dupes.map((c) => `${c.first_name} ${c.last_name}`).join(', ');
          setAddressDuplicateWarning(
            t.address.duplicateWarning.replace('{names}', names),
          );
        }
      } catch {
        // silently ignore lookup errors
      }
    }
  };

  const onCreate = async () => {
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setSaveError(t.clients.firstLastRequired);
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      const email = form.email.trim().toLowerCase();
      if (email) {
        const duplicates = await findClientsByEmail(email);
        if (duplicates.length > 0) {
          setPendingCreatePayload(form);
          setDuplicateCandidates(duplicates);
          setIsDuplicateModalOpen(true);
          return;
        }
      }
      await createClient(form);
      setIsCreateOpen(false);
      setForm(EMPTY_FORM);
      await loadClients();
      toast.success(t.clients.clientCreated);
    } catch (err: any) {
      setSaveError(err?.message || t.clients.failedCreate);
      toast.error(err?.message || t.clients.failedCreate);
    } finally {
      setIsSaving(false);
    }
  };

  const onResolveDuplicate = async (mode: 'add' | 'replace') => {
    if (!pendingCreatePayload) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await createClientWithDuplicateHandling(pendingCreatePayload, mode);
      setIsDuplicateModalOpen(false);
      setPendingCreatePayload(null);
      setDuplicateCandidates([]);
      setIsCreateOpen(false);
      setForm(EMPTY_FORM);
      await loadClients();
      toast.success(mode === 'replace' ? t.clients.existingReplaced : t.clients.newClientAdded);
    } catch (err: any) {
      setSaveError(err?.message || t.clients.failedResolveDuplicate);
      toast.error(err?.message || t.clients.failedResolveDuplicate);
    } finally {
      setIsSaving(false);
    }
  };

  const onSaveSelected = async () => {
    if (!selected) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const updated = await updateClient(selected.id, form);
      setSelected(updated);
      setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      toast.success(t.clients.clientUpdated);
    } catch (err: any) {
      setSaveError(err?.message || t.clients.failedSave);
      toast.error(err?.message || t.clients.failedSave);
    } finally {
      setIsSaving(false);
    }
  };

  const onDelete = async (id: string, closePanel = false) => {
    setIsDeletingClient(true);
    try {
      const result = await softDeleteClient(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
      toast.success(t.clients.clientDeleted
        .replace('{jobs}', String(result.jobs))
        .replace('{leads}', String(result.leads))
        .replace('{invoices}', String(result.pipeline_deals || 0))
      );
      if (closePanel || selected?.id === id) {
        setSelected(null);
        navigate('/clients');
      }
      setClientToDelete(null);
      await loadClients();
    } catch (err: any) {
      setError(err?.message || t.clients.failedDelete);
      toast.error(err?.message || t.clients.failedDelete);
    } finally {
      setIsDeletingClient(false);
    }
  };

  const kpis = useMemo(() => {
    const active = items.filter((item) => item.status === 'active').length;
    const leads = items.filter((item) => item.status === 'lead').length;
    return { active, leads, total: items.length };
  }, [items]);

  const handleImportCsv = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) { toast.error(t.clients.importCsvEmpty); return; }
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
        const fnIdx = headers.indexOf('first_name');
        const lnIdx = headers.indexOf('last_name');
        if (fnIdx === -1 || lnIdx === -1) { toast.error(t.clients.importCsvMissingColumns); return; }
        const emailIdx = headers.indexOf('email');
        const phoneIdx = headers.indexOf('phone');
        const addressIdx = headers.indexOf('address');
        const companyIdx = headers.indexOf('company');
        let imported = 0;
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
          const firstName = cols[fnIdx] || '';
          const lastName = cols[lnIdx] || '';
          if (!firstName && !lastName) continue;
          await createClient({
            first_name: firstName,
            last_name: lastName,
            email: emailIdx >= 0 ? cols[emailIdx] || undefined : undefined,
            phone: phoneIdx >= 0 ? cols[phoneIdx] || undefined : undefined,
            address: addressIdx >= 0 ? cols[addressIdx] || undefined : undefined,
            company: companyIdx >= 0 ? cols[companyIdx] || undefined : undefined,
          });
          imported++;
        }
        toast.success(t.clients.importCsvSuccess.replace('{count}', String(imported)));
        await loadClients();
      } catch (err: any) {
        toast.error(err?.message || t.clients.importCsvError);
      }
    };
    input.click();
  };

  function getInitials(first: string, last: string) {
    return ((first?.[0] || '') + (last?.[0] || '')).toUpperCase() || '?';
  }

  const statusFilterOptions = STATUS_OPTIONS.map((s) => ({
    value: s,
    label: s === 'All' ? t.common.allStatuses : s === 'active' ? t.clients.statusActive : s === 'lead' ? t.clients.statusLead : t.clients.statusInactive,
  }));

  return (
    <div className="space-y-5">
      <PageHeader title={t.clients.title} subtitle={`${total} ${t.common.total}`}>
        <div className="flex items-center gap-2">
          <button
            onClick={handleImportCsv}
            className="glass-button inline-flex items-center gap-1.5"
          >
            <Upload size={14} />
            {t.clients.importCsv}
          </button>
          <button
            onClick={() => {
              setForm(EMPTY_FORM);
              setSaveError(null);
              setAddressDuplicateWarning(null);
              setIsCreateOpen(true);
            }}
            className="glass-button-primary inline-flex items-center gap-1.5"
          >
            <Plus size={15} /> {t.clients.newClient}
          </button>
        </div>
      </PageHeader>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label={t.common.active} value={kpis.active} />
        <StatCard label={t.clients.statusLead + 's'} value={kpis.leads} />
        <StatCard label={t.clients.onPage} value={kpis.total} />
      </div>

      {/* Filters */}
      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t.clients.searchClients}
      >
        <FilterSelect
          value={statusFilter}
          onChange={(v) => { setStatusFilter(v); setPage(1); }}
          options={statusFilterOptions}
        />
        <FilterSelect
          value={sortBy}
          onChange={(v) => { setSortBy(v as ClientSort); setPage(1); }}
          options={[
            { value: 'recent', label: t.common.mostRecent },
            { value: 'oldest', label: t.common.oldest },
            { value: 'name_asc', label: t.common.nameAZ },
            { value: 'name_desc', label: t.common.nameZA },
          ]}
        />
      </FilterBar>

      {/* Batch action bar */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary-lighter px-4 py-2.5">
              <span className="text-[13px] font-medium text-primary">{selectedIds.size} {t.common.selected}</span>
              <button
                type="button"
                onClick={() => void handleBatchArchive()}
                disabled={isBatchArchiving}
                className="glass-button-ghost inline-flex items-center gap-1.5 text-primary !text-[13px]"
              >
                <Archive size={14} />
                {isBatchArchiving ? t.clients.archiving : t.clients.archive}
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="ml-auto text-[13px] text-text-tertiary hover:text-text-primary"
              >
                {t.common.clear}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table */}
      <div className="section-card">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className="px-3 py-2.5 w-10">
                  <input
                    type="checkbox"
                    checked={items.length > 0 && selectedIds.size === items.length}
                    onChange={toggleSelectAll}
                    className="rounded border-border accent-primary"
                  />
                </th>
                <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{t.common.name}</th>
                <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{t.common.company}</th>
                <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{t.clients.contact}</th>
                <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{t.common.status}</th>
                <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{t.common.createdAt}</th>
                <th className="px-3 py-2.5 w-10" />
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 6 }).map((_, idx) => (
                <tr key={`skel-${idx}`} className="border-b border-border-light">
                  <td className="px-3 py-3" colSpan={totalColSpan}><div className="skeleton h-4 w-full" /></td>
                </tr>
              ))}
              {!loading && error && (
                <tr><td className="px-3 py-8 text-[13px] text-danger" colSpan={totalColSpan}>{error}</td></tr>
              )}
              {!loading && !error && items.length === 0 && (
                <tr><td className="px-3 py-12 text-center text-[13px] text-text-tertiary" colSpan={totalColSpan}>{t.clients.noClientsFound}</td></tr>
              )}
              {!loading && !error && items.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => navigate(`/clients/${item.id}`)}
                  className="table-row-hover border-b border-border-light cursor-pointer group"
                >
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={() => toggleSelect(item.id)}
                      className="rounded border-border accent-primary"
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="avatar-sm">{getInitials(item.first_name, item.last_name)}</span>
                      <span className="text-[13px] font-semibold text-text-primary">
                        {item.first_name} {item.last_name}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-[13px] text-text-secondary">{item.company || '—'}</td>
                  <td className="px-3 py-2.5 text-[13px] text-text-secondary">{item.email || item.phone || '—'}</td>
                  <td className="px-3 py-2.5"><StatusBadge status={item.status} /></td>
                  <td className="px-3 py-2.5 text-[13px] text-text-tertiary tabular-nums">{formatDate(item.created_at)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setClientToDelete(item);
                      }}
                      className="p-1 rounded text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-danger hover:bg-danger-light transition-all"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-3 py-2.5 border-t border-border">
          <p className="text-[13px] text-text-tertiary tabular-nums">
            {t.common.page} {page} {t.common.of} {pageCount} — {total} {t.common.records}
          </p>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="glass-button !px-2 !py-1">
              <ChevronLeft size={14} />
            </button>
            <button onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page === pageCount} className="glass-button !px-2 !py-1">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Create modal */}
      <AnimatePresence>
        {isCreateOpen && (
          <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div
              className="modal-content max-w-xl"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 pt-5">
                <h3 className="text-[15px] font-bold text-text-primary">{t.clients.newClient}</h3>
                <button onClick={() => setIsCreateOpen(false)} className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors">
                  <X size={16} />
                </button>
              </div>
              <div className="px-5 py-4">
                <ClientForm form={form} setForm={setForm} t={t} onAddressSelect={(addr) => void handleAddressSelect(addr)} addressDuplicateWarning={addressDuplicateWarning} />
                {saveError && <p className="text-[13px] text-danger mt-3">{saveError}</p>}
              </div>
              <div className="flex justify-end gap-2 px-5 pb-5">
                <button onClick={() => setIsCreateOpen(false)} className="glass-button">{t.common.cancel}</button>
                <button onClick={() => void onCreate()} disabled={isSaving} className="glass-button-primary">
                  {isSaving ? t.common.saving : t.clients.createClient}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Detail drawer */}
      <AnimatePresence>
        {selected && (
          <>
            <motion.div
              className="fixed inset-0 z-[80] bg-black/30"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => navigate('/clients')}
            />
            <motion.div
              className="fixed right-0 top-0 h-screen w-full max-w-lg bg-surface z-[90] shadow-lg overflow-y-auto border-l border-outline"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            >
              <div className="sticky top-0 bg-surface z-10 flex items-center justify-between px-5 py-4 border-b border-outline">
                <div className="flex items-center gap-3">
                  <span className="avatar-md">{getInitials(selected.first_name, selected.last_name)}</span>
                  <div>
                    <h3 className="text-[15px] font-bold text-text-primary">
                      {selected.first_name} {selected.last_name}
                    </h3>
                    <p className="text-[13px] text-text-tertiary">{selected.company || t.common.noCompany}</p>
                  </div>
                </div>
                <button onClick={() => navigate('/clients')} className="p-1.5 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors">
                  <X size={16} />
                </button>
              </div>

              <div className="p-5 space-y-5">
                <ClientForm form={form} setForm={setForm} t={t} onAddressSelect={(addr) => void handleAddressSelect(addr)} addressDuplicateWarning={addressDuplicateWarning} isEdit />
                {saveError && <p className="text-[13px] text-danger mt-2">{saveError}</p>}
                <div className="flex items-center justify-between pt-2">
                  <button onClick={() => setClientToDelete(selected)} className="glass-button-danger">
                    {t.common.delete}
                  </button>
                  <button onClick={() => void onSaveSelected()} disabled={isSaving} className="glass-button-primary">
                    {isSaving ? t.common.saving : t.common.save}
                  </button>
                </div>

                {/* Jobs section */}
                <div className="border-t border-outline pt-5">
                  <h4 className="text-[13px] font-bold text-text-primary mb-3">{t.clients.jobs} ({selectedJobs.length})</h4>
                  {selectedJobs.length === 0 ? (
                    <p className="text-[13px] text-text-tertiary">{t.clients.noJobsLinked}</p>
                  ) : (
                    <div className="space-y-2">
                      {selectedJobs.map((job) => (
                        <button
                          key={job.id}
                          type="button"
                          onClick={() => navigate(`/jobs/${job.id}`)}
                          className="w-full rounded-xl border border-outline-subtle bg-surface-secondary p-3 flex items-center justify-between text-left hover:border-primary/30 transition-colors"
                        >
                          <div>
                            <p className="text-[13px] font-semibold text-text-primary">{job.title}</p>
                            <p className="text-xs text-text-tertiary mt-0.5">
                              {job.scheduled_at ? formatDate(job.scheduled_at) : t.clients.unscheduled}
                            </p>
                          </div>
                          <span className="text-[13px] font-medium text-text-primary tabular-nums">
                            {formatCurrency(Math.round(Number(job.total_amount || 0)))}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Delete confirmation */}
      <AnimatePresence>
        {clientToDelete && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !isDeletingClient && setClientToDelete(null)}
          >
            <motion.div
              className="modal-content max-w-md"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-5">
                <h3 className="text-[15px] font-bold text-text-primary">{t.clients.deleteClient}</h3>
                <p className="text-[13px] text-text-secondary mt-2">
                  {t.clients.deleteClientMsg.replace('{name}', `${clientToDelete.first_name} ${clientToDelete.last_name}`)}
                </p>
                <p className="mt-3 inline-flex items-center gap-2 rounded-md bg-warning-light px-3 py-2 text-[13px] text-warning">
                  <AlertTriangle size={14} />
                  {t.clients.irreversible}
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button className="glass-button" onClick={() => setClientToDelete(null)} disabled={isDeletingClient}>{t.common.cancel}</button>
                  <button
                    className="glass-button-danger"
                    disabled={isDeletingClient}
                    onClick={() => void onDelete(clientToDelete.id, selected?.id === clientToDelete.id)}
                  >
                    {isDeletingClient ? t.common.deleting : t.common.delete}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Duplicate email modal */}
      <AnimatePresence>
        {isDuplicateModalOpen && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="modal-content max-w-lg"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-5">
                <h3 className="text-[15px] font-bold text-text-primary">{t.clients.emailExists}</h3>
                <p className="text-[13px] text-text-secondary mt-2">
                  {t.clients.foundClients.replace('{count}', String(duplicateCandidates.length))}
                </p>
                <div className="mt-3 max-h-40 space-y-2 overflow-auto rounded-xl border border-outline-subtle p-2">
                  {duplicateCandidates.map((client) => (
                    <div key={client.id} className="rounded-md bg-surface-secondary px-3 py-2">
                      <p className="text-[13px] font-medium text-text-primary">
                        {client.first_name} {client.last_name}
                      </p>
                      <p className="text-xs text-text-tertiary">{client.email || t.common.noEmail} — {formatDate(client.created_at)}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <button className="glass-button" onClick={() => setIsDuplicateModalOpen(false)} disabled={isSaving}>{t.common.cancel}</button>
                  <button className="glass-button" onClick={() => void onResolveDuplicate('add')} disabled={isSaving}>
                    {isSaving ? t.common.saving : t.common.addAnyway}
                  </button>
                  <button className="glass-button-primary" onClick={() => void onResolveDuplicate('replace')} disabled={isSaving}>
                    {isSaving ? t.common.saving : t.common.replace}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ClientForm({
  form,
  setForm,
  t,
  onAddressSelect,
  addressDuplicateWarning,
  isEdit = false,
}: {
  form: ClientFormState;
  setForm: React.Dispatch<React.SetStateAction<ClientFormState>>;
  t: ReturnType<typeof useTranslation>['t'];
  onAddressSelect: (addr: StructuredAddress) => void;
  addressDuplicateWarning?: string | null;
  isEdit?: boolean;
}) {
  const [showAddress, setShowAddress] = useState(isEdit || !!form.address);
  const patch = (key: keyof ClientFormState, value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  return (
    <div className="space-y-3">
      {/* Essential fields — always shown */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.common.firstName}</label>
          <input value={form.first_name} onChange={(e) => patch('first_name', e.target.value)} className="glass-input w-full mt-1" placeholder="John" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.common.lastName}</label>
          <input value={form.last_name} onChange={(e) => patch('last_name', e.target.value)} className="glass-input w-full mt-1" placeholder="Doe" />
        </div>
      </div>
      <div>
        <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.common.company}</label>
        <input value={form.company} onChange={(e) => patch('company', e.target.value)} className="glass-input w-full mt-1" placeholder="Acme Inc." />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.common.email}</label>
          <input type="email" value={form.email} onChange={(e) => patch('email', e.target.value)} className="glass-input w-full mt-1" placeholder="john@example.com" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.common.phone}</label>
          <input value={form.phone} onChange={(e) => patch('phone', e.target.value)} className="glass-input w-full mt-1" placeholder="(555) 123-4567" />
        </div>
      </div>

      {/* Address — collapsed on create, expanded on edit or when user clicks */}
      {!showAddress ? (
        <button
          type="button"
          onClick={() => setShowAddress(true)}
          className="text-[12px] text-primary hover:text-primary/80 font-medium transition-colors"
        >
          + {t.common.address}
        </button>
      ) : (
        <>
          <div>
            <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.common.address}</label>
            <div className="mt-1">
              <AddressAutocomplete
                value={form.address}
                onChange={(v) => patch('address', v)}
                onSelect={onAddressSelect}
                duplicateWarning={addressDuplicateWarning}
              />
            </div>
          </div>
          {form.city && (
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.address.city}</label>
                <input value={form.city} readOnly className="glass-input w-full mt-1 bg-surface-secondary text-text-secondary cursor-default" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.address.province}</label>
                <input value={form.province} readOnly className="glass-input w-full mt-1 bg-surface-secondary text-text-secondary cursor-default" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.address.postalCode}</label>
                <input value={form.postal_code} readOnly className="glass-input w-full mt-1 bg-surface-secondary text-text-secondary cursor-default" />
              </div>
            </div>
          )}
        </>
      )}

      {/* Status — only show on edit, defaults to "active" on create */}
      {isEdit && (
        <div>
          <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.common.status}</label>
          <select value={form.status} onChange={(e) => patch('status', e.target.value)} className="glass-input w-full mt-1">
            <option value="active">{t.clients.statusActive}</option>
            <option value="lead">{t.clients.statusLead}</option>
            <option value="inactive">{t.clients.statusInactive}</option>
          </select>
        </div>
      )}
    </div>
  );
}
