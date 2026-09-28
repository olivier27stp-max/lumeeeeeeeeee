import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, X } from 'lucide-react';
import InfiniteScrollSentinel from '../components/InfiniteScrollSentinel';
import StatusBadge from '../components/ui/status-badge';
import { statusDotColor } from '../components/ui/StatusBadge';
import FilterPill from '../components/ui/FilterPill';
import BatchMessageModal from '../components/BatchMessageModal';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { cn, formatCurrency, formatDate } from '../lib/utils';
import {
  clientDisplayName,
  type ClientRecord,
  createClient,
  getClientById,
  softDeleteClient,
  listClientJobs,
  listClients,
  updateClient,
} from '../lib/clientsApi';
import { supabase } from '../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../lib/orgApi';
import { useTranslation } from '../i18n';
import { useEscapeKey } from '../hooks/useEscapeKey';
import UnifiedAvatar from '../components/ui/UnifiedAvatar';
import { useChampsListe, useValeursPage } from '../components/champs/liste';
import { useColonnesTableau, type ColonneStandard, type TriChamp } from '../components/champs/colonnes';
import { correspondancesImport, ecrireValeurs } from '../lib/champsPersoApi';
import { valeurDepuisTexte } from '../lib/champs/valeurs';
import { messageChamps } from '../lib/champs/messages';
import { BoutonFiltreEtiquettes } from '../components/etiquettes/FiltreEtiquettes';
import { EtiquettesCompactes } from '../components/etiquettes/SelecteurEtiquettes';
import { FILTRE_ETIQUETTES_VIDE, etiquettesDepuisUrl, type FiltreEtiquettes } from '../lib/etiquettesFiltre';

type ClientSort = 'recent' | 'oldest' | 'name_asc' | 'name_desc' | 'activity_desc' | 'activity_asc';
type ClientSortColumn = 'name' | 'activity';
/** Une ligne de la liste : le client + ce que la page calcule (activité, étiquettes). */
type LigneClient = ClientRecord & { last_activity?: string | null; tags?: string[] };

const STATUS_OPTIONS = ['All', 'active', 'lead', 'inactive'];

interface ClientFormState {
  first_name: string;
  last_name: string;
  company: string;
  display_as_company: boolean;
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
  display_as_company: false,
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
  status: 'lead',
};

/** Last-activity label: <24h → time with am/pm; <1 week → 3-letter weekday (e.g. Thu); else → day + month. */
function formatLastActivity(iso: string, fr: boolean): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const H24 = 86_400_000;
  const WEEK = 7 * H24;
  const locale = fr ? 'fr-CA' : 'en-US';
  if (diffMs < H24) {
    return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  if (diffMs < WEEK) {
    const wd = d.toLocaleDateString(locale, { weekday: 'short' }).replace('.', '');
    return wd.charAt(0).toUpperCase() + wd.slice(1);
  }
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

export default function Clients() {
  const navigate = useNavigate();
  const { id: clientIdFromRoute } = useParams();
  const location = useLocation();
  const { t, language } = useTranslation();
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [loadingMore, setLoadingMore] = useState(false);
  // Total côté serveur (sans le filtre de statut client-side) → pilote « il reste des pages ».
  const [serverTotal, setServerTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('All');
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [sortBy, setSortBy] = useState<ClientSort>('recent');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);
  const [selectedJobs, setSelectedJobs] = useState<any[]>([]);
  const [form, setForm] = useState<ClientFormState>(EMPTY_FORM);
  const [clientToDelete, setClientToDelete] = useState<any | null>(null);
  const [isDeletingClient, setIsDeletingClient] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchArchiving, setIsBatchArchiving] = useState(false);
  const [showBatchMessage, setShowBatchMessage] = useState(false);
  // Filtre « Étiquettes », appliqué EN BASE (jointure client_tags) pour que la
  // pagination et le total restent justes. `?etiquette=VIP` (lien de
  // Réglages → Étiquettes) le pré-remplit ; le paramètre peut se répéter.
  const [filtreEtiquettes, setFiltreEtiquettesBrut] = useState<FiltreEtiquettes>(() => {
    const noms = etiquettesDepuisUrl(location.search);
    return noms.length ? { ...FILTRE_ETIQUETTES_VIDE, avec: noms } : FILTRE_ETIQUETTES_VIDE;
  });
  const setFiltreEtiquettes = (f: FiltreEtiquettes) => {
    setFiltreEtiquettesBrut(f);
    setPage(1);
    // Le lien d'arrivée ne doit pas « revenir » au rechargement une fois le filtre changé.
    if (etiquettesDepuisUrl(location.search).length) navigate({ pathname: location.pathname, search: '' }, { replace: true });
  };
  // Un nouveau lien `?etiquette=` pendant que la page est ouverte (autre onglet de réglages, historique).
  useEffect(() => {
    const noms = etiquettesDepuisUrl(location.search);
    if (noms.length) { setFiltreEtiquettesBrut({ ...FILTRE_ETIQUETTES_VIDE, avec: noms }); setPage(1); }
  }, [location.search]);
  const cleEtiquettes = filtreEtiquettes.avec.length ? `${filtreEtiquettes.mode}|${filtreEtiquettes.avec.join('\u0001')}` : '';


  // Escape key closes drawers/modals
  useEscapeKey(() => {
    if (clientToDelete) { setClientToDelete(null); return; }
    if (selected) { setSelected(null); return; }
  }, !!(selected || clientToDelete));

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
      const orgId = await getCurrentOrgIdOrThrow();
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

  // Champs personnalisés : filtre côté base ; les colonnes passent par « Gérer les champs ».
  const champsListe = useChampsListe('client', language === 'fr');
  // Tri par une colonne de champ personnalisé (tenu ici : le chargement en dépend).
  const [triChamp, setTriChampBrut] = useState<TriChamp | null>(null);
  const setTriChamp = (t: TriChamp | null) => { setTriChampBrut(t); setPage(1); };
  useEffect(() => { setPage(1); }, [champsListe.cle]);

  useEffect(() => {
    void loadClients(page > 1 ? 'append' : 'refresh');
  }, [page, statusFilter, sortBy, debouncedSearch, champsListe.cle, triChamp, cleEtiquettes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for command palette create event
  useEffect(() => {
    const handler = () => navigate('/clients/new');
    window.addEventListener('crm:open-new-client', handler);
    return () => window.removeEventListener('crm:open-new-client', handler);
  }, [navigate]);

  // Un identifiant de route doit être un UUID. Sans ce contrôle, un vieux
  // lien ou une faute de frappe (« /clients/identifiant-casse ») partait tel
  // quel vers la base : quatre requêtes échouaient en 22P02 et le message
  // brut de PostgreSQL — « invalid input syntax for type uuid » — s'affichait
  // à l'écran. On refuse en amont plutôt que d'exposer la tuyauterie.
  const estUuid = (v?: string) =>
    !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

  useEffect(() => {
    async function syncSelectedClientFromRoute() {
      if (!clientIdFromRoute) {
        setSelected(null);
        return;
      }

      if (!estUuid(clientIdFromRoute)) {
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
      display_as_company: !!selected.display_as_company,
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

  // Org-wide per-status counts for the filter dropdown (excludes archived clients).
  async function loadStatusCounts() {
    try {
      const orgId = await getCurrentOrgIdOrThrow();
      const countFor = (status?: string) => {
        let q = supabase.from('clients').select('id', { count: 'exact', head: true }).eq('org_id', orgId).is('deleted_at', null);
        if (status) q = q.eq('status', status);
        return q;
      };
      const [all, active, lead, inactive] = await Promise.all([countFor(), countFor('active'), countFor('lead'), countFor('inactive')]);
      setStatusCounts({
        All: all.count || 0,
        active: active.count || 0,
        lead: lead.count || 0,
        inactive: inactive.count || 0,
      });
    } catch {
      // Counts are cosmetic — leave the dropdown without numbers on failure.
    }
  }

  // Liste infinie : 'append' ajoute la page courante sous les lignes déjà
  // affichées ; 'refresh' recharge d'un coup toutes les pages déjà chargées.
  async function loadClients(mode: 'append' | 'refresh' = 'refresh') {
    const append = mode === 'append' && page > 1;
    if (append) setLoadingMore(true); else setLoading(true);
    setError(null);
    void loadStatusCounts();
    try {
      const res = await listClients({
        page: append ? page : 1,
        pageSize: append ? pageSize : pageSize * Math.max(1, page),
        status: 'All',
        q: debouncedSearch,
        sort: sortBy,
        champs: champsListe.filtre,
        triChamp: triChamp ? { ...triChamp, cle: champsListe.cle } : null,
        etiquettes: filtreEtiquettes.avec.length ? { noms: filtreEtiquettes.avec, mode: filtreEtiquettes.mode } : null,
      });

      // Statut dérivé des jobs : un client avec ≥1 job (non supprimé) est
      // 'active', sinon 'lead'. (Le trigger DB jobs_sync_client_status fait
      // autorité ; ce calcul garde la liste cohérente immédiatement.)
      const clientIds = res.items.map(c => c.id);

      const orgId = await getCurrentOrgIdOrThrow();
      const [jobsRes, tagsRes] = await Promise.all([
        supabase
          .from('jobs')
          .select('client_id, created_at, updated_at')
          .eq('org_id', orgId)
          .in('client_id', clientIds)
          .is('deleted_at', null),
        supabase
          .from('client_tags')
          .select('client_id, tag')
          .in('client_id', clientIds),
      ]);

      const clientsWithJobs = new Set((jobsRes.data || []).map(j => j.client_id));

      // Dernière activité = job le plus récent (created/updated) ; à défaut, la
      // date de création du client. (Comparaison lexicographique d'ISO 8601.)
      const lastActivityByClient = new Map<string, string>();
      for (const j of (jobsRes.data || []) as any[]) {
        const ts: string | null = j.updated_at || j.created_at || null;
        if (!ts) continue;
        const prev = lastActivityByClient.get(j.client_id);
        if (!prev || ts > prev) lastActivityByClient.set(j.client_id, ts);
      }

      // Étiquettes — table client_tags (scoping org assuré par les RLS).
      const tagsByClient = new Map<string, string[]>();
      for (const r of (tagsRes.data || []) as any[]) {
        const arr = tagsByClient.get(r.client_id) || [];
        arr.push(r.tag);
        tagsByClient.set(r.client_id, arr);
      }

      const enriched = res.items.map(c => {
        // Archivage manuel : on préserve un client 'inactive' tel quel.
        const computed: string = c.status === 'inactive'
          ? 'inactive'
          : (clientsWithJobs.has(c.id) ? 'active' : 'lead');

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

        // Dernière activité = la plus récente entre l'activité jobs, l'activité
        // côté client (ouverture portail/devis/facture) et la date de création.
        const activityCandidates = [
          lastActivityByClient.get(c.id),
          c.last_client_activity_at,
          c.created_at,
        ].filter(Boolean) as string[];
        const last_activity = activityCandidates.length
          ? activityCandidates.reduce((a, b) => (a > b ? a : b))
          : null;

        return {
          ...c,
          status: computed,
          tags: tagsByClient.get(c.id) || [],
          last_activity,
        };
      });

      // Apply status filter client-side
      const filtered = statusFilter === 'All'
        ? enriched
        : enriched.filter(c => c.status === statusFilter);

      setItems(prev => {
        if (!append) return filtered;
        const seen = new Set(prev.map(c => c.id));
        return [...prev, ...filtered.filter(c => !seen.has(c.id))];
      });
      setServerTotal(res.total);
      if (statusFilter === 'All') setTotal(res.total);
      else setTotal(prev => (append ? prev + filtered.length : filtered.length));
    } catch (err: any) {
      setError(err?.message || t.clients.failedCreate);
    } finally {
      if (append) setLoadingMore(false); else setLoading(false);
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

  const hasMore = !loading && page * pageSize < serverTotal;

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
        // Colonnes nommées comme un champ personnalisé client (libellé, clé ou variable).
        const colonnesChamps = await correspondancesImport(['client'], lines[0].split(',').map((h) => h.trim().replace(/"/g, '')),
          [fnIdx, lnIdx, emailIdx, phoneIdx, addressIdx, companyIdx].filter((x) => x >= 0));
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
            const cree = await createClient({
              first_name: firstName,
              last_name: lastName,
              email: emailIdx >= 0 ? cols[emailIdx] || undefined : undefined,
              phone: phoneIdx >= 0 ? cols[phoneIdx] || undefined : undefined,
              address: addressIdx >= 0 ? cols[addressIdx] || undefined : undefined,
              company: companyIdx >= 0 ? cols[companyIdx] || undefined : undefined,
            });
            imported++;
            const valeurs = colonnesChamps
              .map(({ index, champ }) => ({ field_id: champ.id, value: valeurDepuisTexte(champ, cols[index] ?? '') }))
              .filter((v) => v.value !== null);
            if (valeurs.length && cree?.id) {
              const refus = (await ecrireValeurs('client', cree.id, valeurs)).filter((r) => !r.ok);
              // Le client est créé ; une valeur refusée est signalée comme un échec de ligne.
              for (const r of refus) failures.push({ line: i + 1, reason: r.erreur || messageChamps('champ personnalisé refusé') });
            }
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

  const fr = language === 'fr';

  const statusLabel = (s: string) =>
    s === 'All' ? (fr ? 'Tous' : 'All') : s === 'active' ? t.clients.statusActive : s === 'lead' ? t.clients.statusLead : t.clients.statusInactive;


  /* ═══════════════════════════════════════════════════════
     ENTIRE VISUAL LAYER — built from scratch to match
     the shadcnuikit "Users" reference pixel-for-pixel.
     Only data bindings come from the existing logic above.
     ═══════════════════════════════════════════════════════ */

  const allSelected = items.length > 0 && selectedIds.size === items.length;


  // ── Status badge ── (premium SaaS status system)
  function Badge({ status }: { status: string }) {
    return <StatusBadge status={status || 'inactive'} />;
  }

  // ── City filter state ──
  const [cityFilter, setCityFilter] = useState('');
  const [cityDropdownOpen, setCityDropdownOpen] = useState(false);
  const cityBtnRef = useRef<HTMLButtonElement>(null);
  const availableCities = useMemo(() => {
    const cities = items.map(i => i.city).filter(Boolean) as string[];
    return [...new Set(cities)].sort((a, b) => a.localeCompare(b));
  }, [items]);

  // ── Row hover state ── (highlight the whole row wherever the mouse is)
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (cityDropdownOpen && cityBtnRef.current && !cityBtnRef.current.parentElement?.contains(e.target as Node)) setCityDropdownOpen(false);
      // Don't close action menu here — it closes itself via its own click handlers
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [cityDropdownOpen]);

  // ── Filter items by city ──
  const displayItems = useMemo(() => {
    if (!cityFilter) return items;
    return items.filter(i => i.city === cityFilter);
  }, [items, cityFilter]);

  // Tri par colonne : Nom (name_asc/name_desc) et Dernière activité
  // (activity_desc/activity_asc). Clic = trier, second clic = inverser.
  const sortColumn: ClientSortColumn | null = triChamp ? null : sortBy.startsWith('name_') ? 'name' : sortBy.startsWith('activity_') ? 'activity' : null;
  const sortAsc = sortBy === 'name_asc' || sortBy === 'activity_asc';
  const handleSort = (col: ClientSortColumn) => {
    setPage(1);
    setTriChampBrut(null);
    if (col === 'name') setSortBy(sortBy === 'name_asc' ? 'name_desc' : 'name_asc');
    else setSortBy(sortBy === 'activity_desc' ? 'activity_asc' : 'activity_desc');
  };
  const sortIcon = (col: ClientSortColumn) => {
    if (sortColumn !== col) {
      return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>;
    }
    return sortAsc
      ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m7 14 5-5 5 5"/></svg>
      : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m7 10 5 5 5-5"/></svg>;
  };
  // Le bouton de tri vit dans la cellule d'en-tête fournie par « Gérer les champs ».
  const TriEntete = ({ label, col }: { label: string; col: ClientSortColumn }) => (
    <button type="button" onClick={() => handleSort(col)}
      aria-sort={sortColumn === col ? (sortAsc ? 'ascending' : 'descending') : 'none'}
      className="inline-flex items-center gap-1 rounded px-1 -mx-1 hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer">
      {label} {sortIcon(col)}
    </button>
  );

  // Colonnes de la liste (« Gérer les champs ») : le nom est verrouillé ; les
  // cinq historiques sont affichées par défaut, les autres s'ajoutent.
  const vide = <span className="text-[14px] text-[var(--color-text-tertiary)]">—</span>;
  const texte = (v: string | null | undefined) => (v ? <span className="text-[14px] text-[var(--color-text-primary)] truncate" title={v}>{v}</span> : vide);
  const colonnesStandard: ColonneStandard<LigneClient>[] = [
    {
      id: 'nom', libelle: fr ? 'Nom' : 'Name', largeur: 'minmax(180px, 1.4fr)', verrouillee: true,
      entete: <TriEntete label={fr ? 'Nom' : 'Name'} col="name" />,
      cellule: (item) => {
        const secondary = item.display_as_company && item.company
          ? `${item.first_name || ''} ${item.last_name || ''}`.trim()
          : (item.company || '');
        return (
          <div className="flex items-center gap-3 min-w-0">
            <UnifiedAvatar id={item.id} name={clientDisplayName(item)} />
            <div className="min-w-0">
              <p className="text-[14px] font-bold text-[var(--color-text-primary)] truncate leading-tight">{clientDisplayName(item) || '—'}</p>
              {secondary && <p className="text-[12px] font-normal text-[var(--color-text-tertiary)] truncate leading-tight mt-0.5">{secondary}</p>}
            </div>
          </div>
        );
      },
    },
    {
      id: 'adresse', libelle: fr ? 'Adresse' : 'Address', largeur: 'minmax(160px, 1.6fr)', parDefaut: true,
      cellule: (item) => {
        const line1 = [item.street_number, item.street_name].filter(Boolean).join(' ').trim() || item.address || '';
        const line2 = [item.city, item.province, item.postal_code].filter(Boolean).join(', ').trim();
        if (!line1 && !line2) return <span className="text-[14px] text-[var(--color-text-primary)]">—</span>;
        return (
          <div className="flex min-w-0 flex-col">
            <span className="text-[14px] text-[var(--color-text-primary)] whitespace-normal break-words leading-tight">{line1 || '—'}</span>
            {line2 && <span className="text-[12px] text-[var(--color-text-tertiary)] whitespace-normal break-words leading-tight mt-0.5">{line2}</span>}
          </div>
        );
      },
    },
    {
      id: 'etiquettes', libelle: fr ? 'Étiquettes' : 'Tags', largeur: 'minmax(120px, 1.3fr)', parDefaut: true,
      // Pastilles aux couleurs de Réglages → Étiquettes, deux puis « +N ».
      cellule: (item) => (item.tags && item.tags.length > 0 ? (
        <div className="overflow-hidden"><EtiquettesCompactes noms={item.tags} fr={fr} /></div>
      ) : vide),
    },
    { id: 'statut', libelle: fr ? 'Statut' : 'Status', largeur: '200px', parDefaut: true, cellule: (item) => <Badge status={item.status} /> },
    {
      id: 'activite', libelle: fr ? 'Dernière activité' : 'Last activity', largeur: '130px', parDefaut: true,
      entete: <TriEntete label={fr ? 'Dernière activité' : 'Last activity'} col="activity" />,
      cellule: (item) => <span className="text-[14px] text-[var(--color-text-secondary)] truncate">{item.last_activity ? formatLastActivity(item.last_activity, fr) : '—'}</span>,
    },
    { id: 'courriel', libelle: fr ? 'Courriel' : 'Email', parDefaut: true, largeur: 'minmax(160px, 1.4fr)', cellule: (item) => texte(item.email) },
    { id: 'telephone', libelle: fr ? 'Téléphone' : 'Phone', parDefaut: true, largeur: '150px', cellule: (item) => texte(item.phone) },
    { id: 'entreprise', libelle: fr ? 'Entreprise' : 'Company', parDefaut: true, largeur: 'minmax(120px, 1.2fr)', cellule: (item) => texte(item.company) },
    { id: 'numero', libelle: fr ? 'N° de client' : 'Client #', parDefaut: true, largeur: '110px', cellule: (item) => texte(item.client_number) },
    { id: 'source', libelle: fr ? 'Source' : 'Lead source', parDefaut: true, largeur: 'minmax(110px, 1fr)', cellule: (item) => texte(item.lead_source) },
    { id: 'ville', libelle: fr ? 'Ville' : 'City', parDefaut: true, largeur: 'minmax(110px, 1fr)', cellule: (item) => texte(item.city) },
    { id: 'cree', libelle: fr ? 'Créé le' : 'Created', parDefaut: true, largeur: '120px', cellule: (item) => texte(item.created_at ? formatDate(item.created_at) : null) },
  ];
  const colonnes = useColonnesTableau<LigneClient>('client', colonnesStandard, fr, { tri: triChamp, setTri: setTriChamp });
  const valeursChamps = useValeursPage('client', items.map((c) => c.id as string), colonnes.avecChamps);

  return (
    <>
      {/* ── PAGE HEADER ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-[28px] font-bold text-[var(--color-text-primary)] leading-tight">Clients{!loading && <span className="ml-2 text-[15px] font-normal text-[var(--color-text-tertiary)] tabular-nums">{total}</span>}</h1>
        <button
          onClick={() => navigate('/clients/new')}
          className="inline-flex items-center gap-2 h-10 px-5 bg-[#d8d0c2] text-[#000] hover:bg-[#cabfad] rounded-lg text-[14px] font-medium active:scale-[0.98] transition-all"
        >
          {fr ? 'Nouveau client' : 'New Client'}
        </button>
      </div>

      {/* ── TOOLBAR ── */}
      <div className="flex flex-wrap items-center gap-2 mt-5 mb-4">
        {/* Status filter pill — "Status | All", dropdown lists statuses with colored dot + count */}
        <FilterPill
          label={fr ? 'Statut' : 'Status'}
          value={statusFilter}
          onChange={(v) => { setStatusFilter(v); setPage(1); }}
          options={STATUS_OPTIONS.map((s) => ({
            value: s,
            label: statusLabel(s),
            dotColor: s === 'All' ? undefined : statusDotColor(s),
            count: statusCounts[s],
          }))}
        />

        {/* Tri par date d'ajout. `oldest` etait deja porte par ClientSort et
            applique par clientsApi (order created_at ascending) — il manquait
            seulement le controle pour le choisir. */}
        <FilterPill
          label={fr ? 'Trier' : 'Sort'}
          value={sortBy === 'oldest' ? 'oldest' : 'recent'}
          onChange={(v) => { setSortBy(v === 'oldest' ? 'oldest' : 'recent'); setPage(1); }}
          options={[
            { value: 'recent', label: fr ? 'Le plus récent' : 'Newest first' },
            { value: 'oldest', label: fr ? 'Le plus ancien' : 'Oldest first' },
          ]}
        />

        <BoutonFiltreEtiquettes valeur={filtreEtiquettes} onChange={setFiltreEtiquettes} fr={fr} />

        {champsListe.bouton}
        {colonnes.bouton}

        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
          aria-label={fr ? 'Rechercher clients' : 'Search clients'}
          placeholder={fr ? 'Rechercher clients...' : 'Search clients...'}
          className="h-9 w-[200px] px-3 text-[14px] bg-surface-card border border-[var(--color-outline)] rounded-md text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none focus:ring-1 focus:ring-[var(--color-text-tertiary)] focus:border-[var(--color-text-tertiary)] transition-all" />

      </div>

      {/* ── TABLE ── */}
      <div className="border border-[var(--color-outline)] rounded-md bg-white dark:bg-[#0e0e11] overflow-x-auto">
        <div className="grid" style={{ gridTemplateColumns: colonnes.pistes }} onMouseLeave={() => setHoveredId(null)}>
          {/* HEADER */}
          {colonnes.visibles.map((c) => c.entete)}

          {/* LOADING */}
          {loading && Array.from({ length: 10 }).map((_, i) => (
            <React.Fragment key={`sk-${i}`}>
              {colonnes.visibles.map((c) => (
                <div key={c.id} className="py-3 px-4 border-b border-[var(--color-surface-tertiary)]"><div className="h-5 w-20 bg-[var(--color-surface-tertiary)] rounded animate-pulse" /></div>
              ))}
            </React.Fragment>
          ))}

          {/* EMPTY */}
          {!loading && displayItems.length === 0 && (
            <div className="py-20 text-center text-[14px] text-[var(--color-text-tertiary)]" style={{ gridColumn: '1 / -1' }}>{t.clients.noClientsFound}</div>
          )}

          {/* ROWS */}
          {!loading && (displayItems as LigneClient[]).map(item => {
            const isHovered = hoveredId === item.id;
            const rowCls = `border-b border-[var(--color-surface-tertiary)] transition-colors duration-150 cursor-pointer ${isHovered ? 'crm-row-hover' : ''}`;
            const click = () => navigate(`/clients/${item.id}`);
            const hover = () => setHoveredId(item.id);
            const keyNav = (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); click(); } };
            return (
              <React.Fragment key={item.id}>
                {colonnes.visibles.map((c, i) => (i === 0 ? (
                  <div key={c.id} className={`py-3 px-4 flex items-center min-w-0 ${rowCls}`} onClick={click} onMouseEnter={hover} role="button" tabIndex={0} onKeyDown={keyNav}>
                    {c.rendu(item, valeursChamps[item.id])}
                  </div>
                ) : (
                  <div key={c.id} className={`py-3 px-4 flex items-center min-w-0 overflow-hidden ${rowCls}`} onClick={click} onMouseEnter={hover} role="presentation" tabIndex={-1}>
                    {c.rendu(item, valeursChamps[item.id])}
                  </div>
                )))}
              </React.Fragment>
            );
          })}
        </div>
        {/* Liste infinie — charge la page suivante dans le même tableau */}
        {!loading && (displayItems.length > 0 || hasMore) && (
          <InfiniteScrollSentinel
            hasMore={hasMore}
            loading={loadingMore}
            onLoadMore={() => setPage(p => p + 1)}
            loaded={statusFilter === 'All' ? items.length : undefined}
            total={statusFilter === 'All' ? total : undefined}
            className="border-t border-[var(--color-outline)]/30"
          />
        )}
      </div>

      {/* ── FOOTER: selection count ── */}
      <div className="flex items-center justify-between mt-3">
        <span className="text-[14px] text-[var(--color-text-secondary)]">
          {total} {fr ? (total === 1 ? 'client' : 'clients') : (total === 1 ? 'client' : 'clients')}
        </span>
      </div>

      {colonnes.panneau}

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
                  <UnifiedAvatar id={selected.id} name={clientDisplayName(selected)} size={36} />
                  <div>
                    <h3 className="text-[16px] font-extrabold text-text-primary">
                      {clientDisplayName(selected) || '—'}
                    </h3>
                    <p className="text-[13px] text-text-muted">
                      {selected.display_as_company && selected.company
                        ? (`${selected.first_name || ''} ${selected.last_name || ''}`.trim() || t.common.noCompany)
                        : (selected.company || t.common.noCompany)}
                    </p>
                  </div>
                </div>
                <button onClick={() => navigate('/clients')} aria-label={t.common.close} className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-secondary transition-colors">
                  <X size={16} />
                </button>
              </div>

              <div className="p-6 space-y-6">
                <ClientForm form={form} setForm={setForm} t={t} isEdit />
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
                            {formatCurrency(Math.round(Number(job.total_cents || 0) / 100))}
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
  isEdit = false,
}: {
  form: ClientFormState;
  setForm: React.Dispatch<React.SetStateAction<ClientFormState>>;
  t: ReturnType<typeof useTranslation>['t'];
  isEdit?: boolean;
}) {
  // Addresses are managed as the client's Properties (see ClientDetails),
  // not on the client record itself.
  const id = useId();
  const patch = <K extends keyof ClientFormState>(key: K, value: ClientFormState[K]) => setForm((prev) => ({ ...prev, [key]: value }));
  return (
    <div className="space-y-4">
      {/* Essential fields — always shown */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor={`${id}-first_name`} className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{t.common.firstName}</label>
          <input id={`${id}-first_name`} value={form.first_name} onChange={(e) => patch('first_name', e.target.value)} className="glass-input w-full mt-1.5" placeholder="John" />
        </div>
        <div>
          <label htmlFor={`${id}-last_name`} className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{t.common.lastName}</label>
          <input id={`${id}-last_name`} value={form.last_name} onChange={(e) => patch('last_name', e.target.value)} className="glass-input w-full mt-1.5" placeholder="Doe" />
        </div>
      </div>
      <div>
        <label htmlFor={`${id}-company`} className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{t.common.company}</label>
        <input id={`${id}-company`} value={form.company} onChange={(e) => patch('company', e.target.value)} className="glass-input w-full mt-1.5" placeholder="Acme Inc." />
        <label className={`mt-2 flex items-center gap-2 text-[13px] text-text-secondary select-none ${form.company.trim() ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
          <input
            type="checkbox"
            checked={form.display_as_company && !!form.company.trim()}
            disabled={!form.company.trim()}
            onChange={(e) => patch('display_as_company', e.target.checked)}
            className="rounded-[3px] border-[var(--color-outline)] w-4 h-4 accent-[var(--color-text-primary)]"
          />
          {t.common.useCompanyAsName}
        </label>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor={`${id}-email`} className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{t.common.email}</label>
          <input id={`${id}-email`} type="email" value={form.email} onChange={(e) => patch('email', e.target.value)} className="glass-input w-full mt-1.5" placeholder="john@example.com" />
        </div>
        <div>
          <label htmlFor={`${id}-phone`} className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{t.common.phone}</label>
          <input id={`${id}-phone`} type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => patch('phone', e.target.value)} className="glass-input w-full mt-1.5" placeholder="(555) 123-4567" />
        </div>
      </div>

      {/* Status — only show on edit, defaults to "active" on create */}
      {isEdit && (
        <div>
          <label htmlFor={`${id}-status`} className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{t.common.status}</label>
          <select id={`${id}-status`} value={form.status} onChange={(e) => patch('status', e.target.value)} className="glass-input w-full mt-1.5">
            <option value="active">{t.clients.statusActive}</option>
            <option value="lead">{t.clients.statusLead}</option>
            <option value="inactive">{t.clients.statusInactive}</option>
          </select>
        </div>
      )}

    </div>
  );
}
