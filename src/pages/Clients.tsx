import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, X } from 'lucide-react';
import BatchMessageModal from '../components/BatchMessageModal';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { cn, formatCurrency, formatDate } from '../lib/utils';
import { displayEmail, displayPhone } from '../lib/piiSanitizer';
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
import { getCurrentOrgIdOrThrow } from '../lib/orgApi';
import { useTranslation } from '../i18n';
import { useEscapeKey } from '../hooks/useEscapeKey';
import UnifiedAvatar from '../components/ui/UnifiedAvatar';

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
  const { t, language } = useTranslation();
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
  const [showBatchMessage, setShowBatchMessage] = useState(false);
  const [addressDuplicateWarning, setAddressDuplicateWarning] = useState<string | null>(null);


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

  async function computeClientStatus(clientId: string): Promise<'active' | 'lead' | 'inactive'> {
    const orgId = await getCurrentOrgIdOrThrow();
    // Check jobs for this client
    const { data: jobs } = await supabase
      .from('jobs')
      .select('id,status')
      .eq('org_id', orgId)
      .eq('client_id', clientId)
      .is('deleted_at', null)
      .limit(5);

    if (jobs && jobs.length > 0) {
      return 'active';
    }

    // Check quotes for this client
    const { data: quotes } = await supabase
      .from('quotes')
      .select('id')
      .eq('org_id', orgId)
      .eq('client_id', clientId)
      .is('deleted_at', null)
      .limit(1);

    if (quotes && quotes.length > 0) {
      return 'lead';
    }

    return 'inactive';
  }

  async function loadClients() {
    setLoading(true);
    setError(null);
    try {
      // Fetch without status filter first if we need to compute statuses
      const fetchStatus = statusFilter !== 'All' ? undefined : undefined;
      const res = await listClients({
        page,
        pageSize,
        status: 'All',
        q: debouncedSearch,
        sort: sortBy,
      });

      // Compute status for each client based on quotes/jobs
      const clientIds = res.items.map(c => c.id);

      // Batch fetch: all jobs and quotes for these clients (scoped to current org)
      const orgId = await getCurrentOrgIdOrThrow();
      const [jobsRes, quotesRes] = await Promise.all([
        supabase.from('jobs').select('client_id').eq('org_id', orgId).in('client_id', clientIds).is('deleted_at', null),
        supabase.from('quotes').select('client_id').eq('org_id', orgId).in('client_id', clientIds).is('deleted_at', null),
      ]);

      const clientsWithJobs = new Set((jobsRes.data || []).map(j => j.client_id));
      const clientsWithQuotes = new Set((quotesRes.data || []).map(q => q.client_id));

      const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const enriched = res.items.map(c => {
        let computed: string;
        if (clientsWithJobs.has(c.id)) {
          computed = 'active';
        } else if (clientsWithQuotes.has(c.id)) {
          computed = 'lead';
        } else {
          // Grace period: clients created within the last 7 days default to active
          const createdAtMs = c.created_at ? new Date(c.created_at).getTime() : 0;
          const isRecent = createdAtMs > 0 && (now - createdAtMs) < SEVEN_DAYS_MS;
          computed = isRecent ? 'active' : 'inactive';
        }

        // Update DB if status changed (best-effort — log failures but don't block UI)
        if (c.status !== computed) {
          supabase
            .from('clients')
            .update({ status: computed })
            .eq('id', c.id)
            .eq('org_id', orgId)
            .then(({ error }) => {
              if (error) console.warn('[clients] Failed to sync computed status:', error.message);
            });
        }

        return { ...c, status: computed };
      });

      // Apply status filter client-side
      const filtered = statusFilter === 'All'
        ? enriched
        : enriched.filter(c => c.status === statusFilter);

      setItems(filtered);
      setTotal(statusFilter === 'All' ? res.total : filtered.length);
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
      toast.success(t.clients.clientCreated, { action: { label: 'Create Job', onClick: () => window.dispatchEvent(new CustomEvent('crm:open-new-job')) } });
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
    const inactive = items.filter((item) => item.status === 'inactive').length;
    return { active, leads, inactive, total: items.length };
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
        const failures: Array<{ line: number; reason: string }> = [];
        const pending = toast.loading(
          (t.clients.importCsvImporting || 'Importing {count} rows…').replace('{count}', String(lines.length - 1))
        );
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
          const firstName = cols[fnIdx] || '';
          const lastName = cols[lnIdx] || '';
          if (!firstName && !lastName) continue;
          try {
            await createClient({
              first_name: firstName,
              last_name: lastName,
              email: emailIdx >= 0 ? cols[emailIdx] || undefined : undefined,
              phone: phoneIdx >= 0 ? cols[phoneIdx] || undefined : undefined,
              address: addressIdx >= 0 ? cols[addressIdx] || undefined : undefined,
              company: companyIdx >= 0 ? cols[companyIdx] || undefined : undefined,
            });
            imported++;
          } catch (rowErr: any) {
            failures.push({ line: i + 1, reason: rowErr?.message || 'unknown' });
          }
        }
        toast.dismiss(pending);
        if (imported > 0) {
          toast.success(t.clients.importCsvSuccess.replace('{count}', String(imported)));
        }
        if (failures.length > 0) {
          console.warn('[clients] CSV import failures:', failures);
          toast.error(
            (t.clients.importCsvPartialFailure || '{count} row(s) failed (see console).')
              .replace('{count}', String(failures.length))
          );
        }
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

  const fr = language === 'fr';


  /* ═══════════════════════════════════════════════════════
     ENTIRE VISUAL LAYER — built from scratch to match
     the shadcnuikit "Users" reference pixel-for-pixel.
     Only data bindings come from the existing logic above.
     ═══════════════════════════════════════════════════════ */

  const allSelected = items.length > 0 && selectedIds.size === items.length;


  // ── Status badge ──
  function Badge({ status }: { status: string }) {
    const s = status || 'inactive';
    const map: Record<string, { label: string; badge: string }> = {
      active:   { label: fr ? 'Actif' : 'Active',     badge: 'badge-success' },
      lead:     { label: fr ? 'Lead' : 'Lead',         badge: 'badge-info' },
      inactive: { label: fr ? 'Inactif' : 'Inactive',  badge: 'badge-neutral' },
    };
    const v = map[s] || map.inactive;
    return <span className={v.badge}>{v.label}</span>;
  }

  // ── Status dropdown state ──
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const statusBtnRef = useRef<HTMLButtonElement>(null);

  // ── City filter state ──
  const [cityFilter, setCityFilter] = useState('');
  const [cityDropdownOpen, setCityDropdownOpen] = useState(false);
  const cityBtnRef = useRef<HTMLButtonElement>(null);
  const availableCities = useMemo(() => {
    const cities = items.map(i => i.city).filter(Boolean) as string[];
    return [...new Set(cities)].sort((a, b) => a.localeCompare(b));
  }, [items]);

  // ── Row actions menu state ──
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (statusDropdownOpen && statusBtnRef.current && !statusBtnRef.current.parentElement?.contains(e.target as Node)) setStatusDropdownOpen(false);
      if (cityDropdownOpen && cityBtnRef.current && !cityBtnRef.current.parentElement?.contains(e.target as Node)) setCityDropdownOpen(false);
      // Don't close action menu here — it closes itself via its own click handlers
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [statusDropdownOpen, cityDropdownOpen]);

  // ── Filter items by city ──
  const displayItems = useMemo(() => {
    if (!cityFilter) return items;
    return items.filter(i => i.city === cityFilter);
  }, [items, cityFilter]);

  const IconSort = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>;
  const IconPlus = (c: string) => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>;

  return (
    <>
      {/* ── PAGE HEADER ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-[28px] font-bold text-[var(--color-text-primary)] leading-tight">Clients</h1>
        <button
          onClick={() => { setForm(EMPTY_FORM); setSaveError(null); setAddressDuplicateWarning(null); setIsCreateOpen(true); }}
          className="inline-flex items-center gap-2 h-10 px-5 bg-primary text-white rounded-lg text-[14px] font-medium hover:bg-primary-hover active:scale-[0.98] transition-all"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>
          {fr ? 'Nouveau client' : 'Add New Client'}
        </button>
      </div>

      {/* ── TOOLBAR ── */}
      <div className="flex items-center gap-2 mt-5 mb-4">
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder={fr ? 'Rechercher clients...' : 'Search clients...'}
          className="h-9 w-[200px] px-3 text-[14px] bg-surface border border-[var(--color-outline)] rounded-md text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none focus:ring-1 focus:ring-[var(--color-text-tertiary)] focus:border-[var(--color-text-tertiary)] transition-all" />

        {/* Status filter with dropdown */}
        <div className="relative">
          <button ref={statusBtnRef} onClick={() => setStatusDropdownOpen(!statusDropdownOpen)}
            className={`inline-flex items-center gap-1.5 h-9 px-3 border rounded-md text-[14px] font-normal transition-colors ${statusFilter !== 'All' ? 'bg-[var(--color-text-primary)] text-white border-[var(--color-text-primary)]' : 'bg-surface text-[var(--color-text-primary)] border-[var(--color-outline)] hover:bg-[var(--color-surface-secondary)]'}`}>
            {IconPlus(statusFilter !== 'All' ? '#fff' : 'var(--color-text-secondary)')} Status
          </button>
          {statusDropdownOpen && (
            <div className="absolute top-full left-0 mt-1 w-48 bg-surface border border-[var(--color-outline)] rounded-md shadow-lg z-50 py-1">
              {['All', 'active', 'lead', 'inactive'].map(s => (
                <button key={s} onClick={() => { setStatusFilter(s); setStatusDropdownOpen(false); setPage(1); }}
                  className={`w-full text-left px-3 py-2 text-[13px] transition-colors ${statusFilter === s ? 'bg-[var(--color-surface-tertiary)] font-medium text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)]'}`}>
                  {s === 'All' ? (fr ? 'Tous' : 'All') : s === 'active' ? (fr ? 'Actif' : 'Active') : s === 'lead' ? (fr ? 'Lead' : 'Lead') : (fr ? 'Inactif' : 'Inactive')}
                </button>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* ── TABLE ── */}
      <div className="border border-[var(--color-outline)] rounded-md bg-surface">
        <div className="grid" style={{ gridTemplateColumns: '40px 1.2fr 1fr 1fr 1.2fr 120px 48px' }}>
          {/* HEADER */}
          <div className="py-3 pl-4 border-b border-[var(--color-outline)] flex items-center"><input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="rounded-[3px] border-[var(--color-outline)] w-4 h-4 accent-[var(--color-text-primary)] cursor-pointer" /></div>
          <div className="py-3 px-4 border-b border-[var(--color-outline)] flex items-center text-[14px] font-medium text-[var(--color-text-primary)]"><span className="inline-flex items-center gap-1">{fr ? 'Nom' : 'Name'} {IconSort}</span></div>
          <div className="py-3 px-4 border-b border-[var(--color-outline)] flex items-center text-[14px] font-medium text-[var(--color-text-primary)]"><span className="inline-flex items-center gap-1">{fr ? 'Entreprise' : 'Company'} {IconSort}</span></div>
          <div className="py-3 px-4 border-b border-[var(--color-outline)] flex items-center text-[14px] font-medium text-[var(--color-text-primary)]"><span className="inline-flex items-center gap-1">{fr ? 'Téléphone' : 'Phone'} {IconSort}</span></div>
          <div className="py-3 px-4 border-b border-[var(--color-outline)] flex items-center text-[14px] font-medium text-[var(--color-text-primary)]"><span className="inline-flex items-center gap-1">{t.common.email} {IconSort}</span></div>
          <div className="py-3 px-4 border-b border-[var(--color-outline)] flex items-center text-[14px] font-medium text-[var(--color-text-primary)]"><span className="inline-flex items-center gap-1">{fr ? 'Statut' : 'Status'} {IconSort}</span></div>
          <div className="py-3 border-b border-[var(--color-outline)]" />

          {/* LOADING */}
          {loading && Array.from({ length: 10 }).map((_, i) => (
            <React.Fragment key={`sk-${i}`}>
              <div className="py-3 pl-4 border-b border-[var(--color-surface-tertiary)] flex items-center"><div className="w-4 h-4 bg-[var(--color-surface-tertiary)] rounded animate-pulse" /></div>
              <div className="py-3 px-4 border-b border-[var(--color-surface-tertiary)]"><div className="h-5 w-24 bg-[var(--color-surface-tertiary)] rounded animate-pulse" /></div>
              <div className="py-3 px-4 border-b border-[var(--color-surface-tertiary)]"><div className="h-5 w-20 bg-[var(--color-surface-tertiary)] rounded animate-pulse" /></div>
              <div className="py-3 px-4 border-b border-[var(--color-surface-tertiary)]"><div className="h-5 w-20 bg-[var(--color-surface-tertiary)] rounded animate-pulse" /></div>
              <div className="py-3 px-4 border-b border-[var(--color-surface-tertiary)]"><div className="h-5 w-28 bg-[var(--color-surface-tertiary)] rounded animate-pulse" /></div>
              <div className="py-3 px-4 border-b border-[var(--color-surface-tertiary)]"><div className="h-5 w-14 bg-[var(--color-surface-tertiary)] rounded animate-pulse" /></div>
              <div className="py-3 border-b border-[var(--color-surface-tertiary)]" />
            </React.Fragment>
          ))}

          {/* EMPTY */}
          {!loading && displayItems.length === 0 && (
            <div className="col-span-7 py-20 text-center text-[14px] text-[var(--color-text-tertiary)]">{t.clients.noClientsFound}</div>
          )}

          {/* ROWS */}
          {!loading && displayItems.map(item => {
            const rowCls = `border-b border-[var(--color-surface-tertiary)] transition-colors ${selectedIds.has(item.id) ? 'bg-[var(--color-primary-light)]' : 'hover:bg-[var(--color-surface-secondary)]'}`;
            const click = () => navigate(`/clients/${item.id}`);
            return (
              <React.Fragment key={item.id}>
                <div className={`py-3 pl-4 flex items-center ${rowCls}`} onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)} className="rounded-[3px] border-[var(--color-outline)] w-4 h-4 accent-[var(--color-text-primary)] cursor-pointer" />
                </div>
                <div className={`py-3 px-4 flex items-center min-w-0 cursor-pointer ${rowCls}`} onClick={click}>
                  <div className="flex items-center gap-3 min-w-0">
                    <UnifiedAvatar id={item.id} name={`${item.first_name || ''} ${item.last_name || ''}`.trim()} />
                    <span className="text-[14px] text-[var(--color-text-primary)] truncate">{item.first_name} {item.last_name}</span>
                  </div>
                </div>
                <div className={`py-3 px-4 flex items-center overflow-hidden cursor-pointer ${rowCls}`} onClick={click}><span className="text-[14px] text-[var(--color-text-primary)] truncate">{item.company || '—'}</span></div>
                <div className={`py-3 px-4 flex items-center overflow-hidden cursor-pointer ${rowCls}`} onClick={click}><span className="text-[14px] text-[var(--color-text-primary)] tabular-nums truncate">{displayPhone(item.phone)}</span></div>
                <div className={`py-3 px-4 flex items-center overflow-hidden cursor-pointer ${rowCls}`} onClick={click}><span className="text-[14px] text-[var(--color-text-primary)] truncate">{displayEmail(item.email)}</span></div>
                <div className={`py-3 px-4 flex items-center cursor-pointer ${rowCls}`} onClick={click}><Badge status={item.status} /></div>
                <div className={`py-3 pr-4 flex items-center justify-center relative ${rowCls}`}>
                  <button className="p-1 rounded text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-tertiary)] transition-colors" onClick={e => { e.stopPropagation(); setActionMenuId(actionMenuId === item.id ? null : item.id); }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
                  </button>
                  {actionMenuId === item.id && (
                    <div className="absolute right-0 top-full mt-1 w-40 bg-surface border border-[var(--color-outline)] rounded-md shadow-lg z-50 py-1" onClick={e => e.stopPropagation()}>
                      <button className="w-full text-left px-3 py-2 text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)] transition-colors flex items-center gap-2"
                        onClick={() => { setActionMenuId(null); navigate(`/clients/${item.id}`); }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                        {fr ? 'Modifier' : 'Edit client'}
                      </button>
                      <button className="w-full text-left px-3 py-2 text-[13px] text-[var(--color-danger)] hover:bg-[var(--color-danger-light)] transition-colors flex items-center gap-2"
                        onClick={() => { setActionMenuId(null); setClientToDelete(item); }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                        {fr ? 'Supprimer' : 'Delete client'}
                      </button>
                    </div>
                  )}
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* ── FOOTER: selection count + pagination ── */}
      <div className="flex items-center justify-between mt-3">
        <span className="text-[14px] text-[var(--color-text-secondary)]">
          {selectedIds.size} of {total} row(s) selected.
        </span>
        <div className="flex items-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}
            className="h-9 px-4 bg-surface border border-[var(--color-outline)] rounded-md text-[14px] text-[var(--color-text-primary)] font-normal disabled:opacity-40 disabled:cursor-default hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer">
            Previous
          </button>
          <button disabled={page >= pageCount} onClick={() => setPage(p => Math.min(pageCount, p + 1))}
            className="h-9 px-4 bg-surface border border-[var(--color-outline)] rounded-md text-[14px] text-[var(--color-text-primary)] font-normal disabled:opacity-40 disabled:cursor-default hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer">
            Next
          </button>
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
              <div className="flex items-center justify-between px-6 pt-6">
                <h3 className="text-lg font-bold text-text-primary">{t.clients.newClient}</h3>
                <button onClick={() => setIsCreateOpen(false)} className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-secondary transition-colors">
                  <X size={16} />
                </button>
              </div>
              <div className="px-6 py-5">
                <ClientForm form={form} setForm={setForm} t={t} onAddressSelect={(addr) => void handleAddressSelect(addr)} addressDuplicateWarning={addressDuplicateWarning} />
                {saveError && <p className="text-[13px] text-danger mt-3">{saveError}</p>}
              </div>
              <div className="flex justify-end gap-3 px-6 pb-6">
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
              className="fixed right-0 top-0 h-screen w-full max-w-lg bg-surface z-[90] shadow-2xl overflow-y-auto border-l border-outline/60"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            >
              <div className="sticky top-0 bg-surface/95 backdrop-blur-sm z-10 flex items-center justify-between px-6 py-5 border-b border-outline/40">
                <div className="flex items-center gap-3">
                  <UnifiedAvatar id={selected.id} name={`${selected.first_name || ''} ${selected.last_name || ''}`.trim()} size={36} />
                  <div>
                    <h3 className="text-[16px] font-extrabold text-text-primary">
                      {selected.first_name} {selected.last_name}
                    </h3>
                    <p className="text-[13px] text-text-muted">{selected.company || t.common.noCompany}</p>
                  </div>
                </div>
                <button onClick={() => navigate('/clients')} className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-secondary transition-colors">
                  <X size={16} />
                </button>
              </div>

              <div className="p-6 space-y-6">
                <ClientForm form={form} setForm={setForm} t={t} onAddressSelect={(addr) => void handleAddressSelect(addr)} addressDuplicateWarning={addressDuplicateWarning} isEdit />
                {saveError && <p className="text-[13px] text-danger mt-2">{saveError}</p>}
                <div className="flex items-center justify-between pt-3">
                  <button onClick={() => setClientToDelete(selected)} className="glass-button-danger">
                    {t.common.delete}
                  </button>
                  <button onClick={() => void onSaveSelected()} disabled={isSaving} className="glass-button-primary">
                    {isSaving ? t.common.saving : t.common.save}
                  </button>
                </div>

                {/* Jobs section */}
                <div className="border-t border-outline/40 pt-6">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-3">{t.clients.jobs} ({selectedJobs.length})</h4>
                  {selectedJobs.length === 0 ? (
                    <p className="text-[13px] text-text-muted">{t.clients.noJobsLinked}</p>
                  ) : (
                    <div className="space-y-2.5">
                      {selectedJobs.map((job) => (
                        <button
                          key={job.id}
                          type="button"
                          onClick={() => navigate(`/jobs/${job.id}`)}
                          className="w-full rounded-2xl border border-outline-subtle bg-surface-secondary/60 p-4 flex items-center justify-between text-left hover:border-primary/30 hover:shadow-sm transition-all"
                        >
                          <div>
                            <p className="text-[13px] font-semibold text-text-primary">{job.title}</p>
                            <p className="text-xs text-text-muted mt-0.5">
                              {job.scheduled_at ? formatDate(job.scheduled_at) : t.clients.unscheduled}
                            </p>
                          </div>
                          <span className="text-[14px] font-bold text-text-primary tabular-nums">
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
              <div className="p-6">
                <h3 className="text-[1.1rem] font-extrabold text-text-primary">{t.clients.deleteClient}</h3>
                <p className="text-[13px] text-text-secondary mt-2">
                  {t.clients.deleteClientMsg.replace('{name}', `${clientToDelete.first_name} ${clientToDelete.last_name}`)}
                </p>
                <p className="mt-4 inline-flex items-center gap-2 rounded-xl bg-warning-light px-4 py-2.5 text-[13px] text-warning">
                  <AlertTriangle size={14} />
                  {t.clients.irreversible}
                </p>
                <div className="mt-6 flex justify-end gap-3">
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
              <div className="p-6">
                <h3 className="text-[1.1rem] font-extrabold text-text-primary">{t.clients.emailExists}</h3>
                <p className="text-[13px] text-text-secondary mt-2">
                  {t.clients.foundClients.replace('{count}', String(duplicateCandidates.length))}
                </p>
                <div className="mt-4 max-h-40 space-y-2 overflow-auto rounded-2xl border border-outline-subtle p-3">
                  {duplicateCandidates.map((client) => (
                    <div key={client.id} className="rounded-xl bg-surface-secondary px-4 py-2.5">
                      <p className="text-[13px] font-semibold text-text-primary">
                        {client.first_name} {client.last_name}
                      </p>
                      <p className="text-xs text-text-muted">{displayEmail(client.email) === '—' ? t.common.noEmail : displayEmail(client.email)} — {formatDate(client.created_at)}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-6 flex justify-end gap-3">
                  <button className="glass-button" onClick={() => setIsDuplicateModalOpen(false)} disabled={isSaving}>{t.common.cancel}</button>
                  <button className="glass-button-secondary" onClick={() => void onResolveDuplicate('add')} disabled={isSaving}>
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

      {/* Batch Message Modal */}
      <BatchMessageModal
        isOpen={showBatchMessage}
        onClose={() => setShowBatchMessage(false)}
        clients={items.filter((i: any) => selectedIds.has(i.id))}
        language={language}
      />
    </>
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
    <div className="space-y-4">
      {/* Essential fields — always shown */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{t.common.firstName}</label>
          <input value={form.first_name} onChange={(e) => patch('first_name', e.target.value)} className="glass-input w-full mt-1.5" placeholder="John" />
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{t.common.lastName}</label>
          <input value={form.last_name} onChange={(e) => patch('last_name', e.target.value)} className="glass-input w-full mt-1.5" placeholder="Doe" />
        </div>
      </div>
      <div>
        <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{t.common.company}</label>
        <input value={form.company} onChange={(e) => patch('company', e.target.value)} className="glass-input w-full mt-1.5" placeholder="Acme Inc." />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{t.common.email}</label>
          <input type="email" value={form.email} onChange={(e) => patch('email', e.target.value)} className="glass-input w-full mt-1.5" placeholder="john@example.com" />
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{t.common.phone}</label>
          <input type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => patch('phone', e.target.value)} className="glass-input w-full mt-1.5" placeholder="(555) 123-4567" />
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
            <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{t.common.address}</label>
            <div className="mt-1.5">
              <AddressAutocomplete
                value={form.address}
                onChange={(v) => patch('address', v)}
                onSelect={onAddressSelect}
                duplicateWarning={addressDuplicateWarning}
              />
            </div>
          </div>
          {form.city && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{t.address.city}</label>
                <input value={form.city} readOnly className="glass-input w-full mt-1.5 bg-surface-secondary text-text-secondary cursor-default" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{t.address.province}</label>
                <input value={form.province} readOnly className="glass-input w-full mt-1.5 bg-surface-secondary text-text-secondary cursor-default" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{t.address.postalCode}</label>
                <input value={form.postal_code} readOnly className="glass-input w-full mt-1.5 bg-surface-secondary text-text-secondary cursor-default" />
              </div>
            </div>
          )}
        </>
      )}

      {/* Status — only show on edit, defaults to "active" on create */}
      {isEdit && (
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{t.common.status}</label>
          <select value={form.status} onChange={(e) => patch('status', e.target.value)} className="glass-input w-full mt-1.5">
            <option value="active">{t.clients.statusActive}</option>
            <option value="lead">Lead</option>
            <option value="inactive">{t.clients.statusInactive}</option>
          </select>
        </div>
      )}

    </div>
  );
}
