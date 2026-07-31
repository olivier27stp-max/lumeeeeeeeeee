/* ═══════════════════════════════════════════════════════════════
   Page — Quotes (Devis) — Modernised with new design tokens
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { StatusBadge, FilterPill, statusDotColor } from '../components/ui';
import {
  listAllQuotes,
  fetchQuoteStatusCounts,
  formatQuoteMoney,
  deleteQuote,
  updateQuoteStatus,
  unarchiveQuote,
  QUOTE_STATUS_LABELS,
  type QuoteStatus,
} from '../lib/quotesApi';
import { listSalespeople } from '../lib/jobsApi';
import { clientDisplayName } from '../lib/clientsApi';
import { formatDate, cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import PresetSelectModal from '../components/quotes/PresetSelectModal';
import UnifiedAvatar from '../components/ui/UnifiedAvatar';
import type { QuotePreset } from '../types';
import { CirclePlus, ArrowUpDown, Ruler } from 'lucide-react';

const PAGE_SIZE = 20;
type StatusTab = 'all' | QuoteStatus;
type QuoteSort = 'recent' | 'oldest' | 'total_desc' | 'total_asc';
const STATUS_TABS: StatusTab[] = ['all', 'draft', 'awaiting_response', 'changes_requested', 'approved', 'converted', 'archived', 'declined', 'expired'];

const STATUS_BADGE: Record<string, string> = {
  draft: 'badge-neutral',
  awaiting_response: 'badge-info',
  changes_requested: 'badge-warning',
  approved: 'badge-success',
  declined: 'badge-danger',
  expired: 'badge-neutral',
  converted: 'badge-teal',
  archived: 'badge-neutral',
};


function sLabel(s: StatusTab, fr: boolean): string {
  if (s === 'all') return fr ? 'Tous' : 'All';
  const map: Record<string, string> = {
    draft: 'Brouillon', awaiting_response: 'En attente', changes_requested: 'Changements demandés',
    approved: 'Approuvé', converted: 'Converti', archived: 'Archivé',
    declined: 'Décliné', expired: 'Expiré',
  };
  return fr ? (map[s] || s) : (QUOTE_STATUS_LABELS[s as QuoteStatus] || s);
}

function QuoteFilterDropdown({ label, options, value, onChange, icon }: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  icon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isActive = value !== 'all';

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex items-center gap-1.5 h-9 px-3 border rounded-md text-[14px] font-normal transition-colors',
          isActive
            ? 'bg-primary text-white border-primary'
            : 'bg-surface-card text-text-primary border-outline hover:bg-surface-secondary'
        )}
      >
        {icon || <CirclePlus size={15} strokeWidth={1.5} className={isActive ? 'text-white' : 'text-[#64748b]'} />}
        {label}
        {isActive && (
          <span className="ml-0.5 text-[11px] opacity-80">
            ({options.find(o => o.value === value)?.label})
          </span>
        )}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1.5 w-44 bg-surface-elevated border border-outline rounded-md shadow-dropdown z-50 py-1">
          {options.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={cn(
                'w-full text-left px-3 py-1.5 text-[13px] transition-colors',
                value === opt.value
                  ? 'bg-primary-light text-text-primary font-medium'
                  : 'text-text-secondary hover:bg-surface-secondary'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Quotes() {
  const { t, language: lang } = useTranslation();
  const fr = lang === 'fr';
  const nav = useNavigate();
  const qc = useQueryClient();

  const [tab, setTab] = useState<StatusTab>('all');
  const [salespersonFilter, setSalespersonFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<QuoteSort>('recent');
  const [presetSelectOpen, setPresetSelectOpen] = useState(false);
  const location = useLocation();

  // Handle navigation with createWithPreset state → full-page creation form
  useEffect(() => {
    const state = location.state as { createWithPreset?: QuotePreset } | null;
    if (state?.createWithPreset) {
      window.history.replaceState({}, document.title);
      nav('/quotes/new', { state: { preset: state.createWithPreset } });
    }
  }, [location.state]);

  useEffect(() => {
    const handler = () => handleNewQuote();
    window.addEventListener('crm:open-new-quote', handler);
    return () => window.removeEventListener('crm:open-new-quote', handler);
  }, []);

  const handleNewQuote = () => setPresetSelectOpen(true);
  // Popup de presets → page complète /quotes/new (le preset voyage en state)
  const handleSelectPreset = (preset: QuotePreset) => {
    setPresetSelectOpen(false);
    nav('/quotes/new', { state: { preset } });
  };
  const handleStartFromScratch = () => {
    setPresetSelectOpen(false);
    nav('/quotes/new');
  };

  React.useEffect(() => {
    const id = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const { data: res, isLoading } = useQuery({
    queryKey: ['quotes-list', tab, salespersonFilter, debounced, page],
    queryFn: () => listAllQuotes({ status: tab, salespersonId: salespersonFilter, search: debounced, page, pageSize: PAGE_SIZE }),
  });

  // Org-wide per-status counts + salespeople for the filter pills.
  const { data: statusCounts } = useQuery({
    queryKey: ['quotes-status-counts'],
    queryFn: fetchQuoteStatusCounts,
    staleTime: 30_000,
  });
  const { data: salespeople } = useQuery({
    queryKey: ['salespeople'],
    queryFn: listSalespeople,
    staleTime: 300_000,
  });

  const rows = res?.data || [];
  const total = res?.total || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const sorted = React.useMemo(() => {
    const l = [...rows];
    if (sort === 'oldest') return l.reverse();
    if (sort === 'total_desc') return l.sort((a, b) => b.total_cents - a.total_cents);
    if (sort === 'total_asc') return l.sort((a, b) => a.total_cents - b.total_cents);
    return l;
  }, [rows, sort]);

  function clientRecord(q: any) {
    const c = q.clients as any, l = q.leads as any;
    if (c && !c.deleted_at) return c;
    if (l && !l.deleted_at) return l;
    return null;
  }

  function name(q: any): string {
    return clientDisplayName(clientRecord(q)) || '—';
  }

  // Same secondary-line rule as the Jobs/Clients pages: company under the
  // name, or the person's name when the client is displayed as a company.
  function secondaryName(q: any): string | null {
    const r = clientRecord(q);
    if (!r) return null;
    return r.display_as_company && r.company
      ? `${r.first_name || ''} ${r.last_name || ''}`.trim() || null
      : (r.company || '').trim() || null;
  }

  // Address of the assigned property. A custom property name is a useful
  // fallback, but the auto-created defaults ('Adresse principale'/'Adresse
  // inconnue', see 20260707000000_properties_feature.sql) are noise — show '—'.
  function propertyLabel(q: any): string {
    const p = q.properties as any;
    if (p?.address) return p.address;
    if (p?.name && !['Adresse principale', 'Adresse inconnue'].includes(p.name)) return p.name;
    return '—';
  }

  async function onDel(id: string) {
    if (!confirm(t.quotes.deleteThisQuote)) return;
    try { await deleteQuote(id); qc.invalidateQueries({ queryKey: ['quotes-list'] }); qc.invalidateQueries({ queryKey: ['quote-kpis'] }); toast.success(t.quotes.quoteDeleted); }
    catch { toast.error(fr ? 'Échec' : 'Failed'); }
  }

  async function onArchive(q: { id: string; status: string }) {
    try {
      if (q.status === 'archived') await unarchiveQuote(q.id);
      else await updateQuoteStatus(q.id, 'archived');
      qc.invalidateQueries({ queryKey: ['quotes-list'] });
      qc.invalidateQueries({ queryKey: ['quote-kpis'] });
      toast.success(q.status === 'archived' ? (fr ? 'Devis désarchivé' : 'Quote unarchived') : (fr ? 'Devis archivé' : 'Quote archived'));
    } catch (e: any) { toast.error(e?.message || (fr ? 'Échec' : 'Failed')); }
  }

  const badgeColor = (s: string): 'green' | 'orange' | 'red' | 'gray' | 'blue' => {
    if (s === 'approved' || s === 'converted') return 'green';
    if (s === 'awaiting_response' || s === 'changes_requested') return 'orange';
    if (s === 'declined' || s === 'expired') return 'red';
    return 'gray';
  };

  /* ═══ Shared helpers — identical to Clients page ═══ */
  const [sel, setSel] = useState<Set<string>>(new Set());
  const allSel = sorted.length > 0 && sel.size === sorted.length;
  const toggleAll = () => { allSel ? setSel(new Set()) : setSel(new Set(sorted.map(r => r.id))); };
  const toggle = (id: string) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n); };

  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);


  function Badge({ status }: { status: string }) {
    return <StatusBadge status={status || 'draft'} />;
  }

  const IconSort = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>;
  const IconDots = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>;

  return (
    <>
      {/* ── PAGE HEADER ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-[28px] font-bold text-text-primary leading-tight">{fr ? 'Devis' : 'Quotes'}{!isLoading && <span className="ml-2 text-[15px] font-normal text-text-tertiary tabular-nums">{total}</span>}</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => nav('/quotes/presets')}
            className="inline-flex items-center gap-2 h-10 px-4 bg-surface-card border border-outline text-text-secondary rounded-md text-[13px] font-medium hover:bg-surface-secondary transition-all">
            {fr ? 'Modèles' : 'Presets'}
          </button>
          <button onClick={() => nav('/quotes/measure')}
            className="inline-flex items-center gap-2 h-10 px-4 bg-surface-card border border-outline text-text-secondary rounded-md text-[13px] font-medium hover:bg-surface-secondary transition-all">
            <Ruler size={15} />
            {fr ? 'Mesure' : 'Measure'}
          </button>
          <button onClick={handleNewQuote}
            className="inline-flex items-center gap-2 h-10 px-5 bg-[#d8d0c2] text-[#000] hover:bg-[#cabfad] rounded-md text-[14px] font-medium active:scale-[0.98] transition-all">
            {fr ? 'Nouveau devis' : 'New Quote'}
          </button>
        </div>
      </div>

      {/* ── TOOLBAR ── */}
      <div className="flex items-center gap-2 mt-5 mb-4">
        <FilterPill
          label={fr ? 'Statut' : 'Status'}
          value={tab}
          onChange={(v) => { setTab(v as StatusTab); setPage(1); }}
          options={STATUS_TABS.map(s => ({
            value: s,
            label: sLabel(s, fr),
            dotColor: s === 'all' ? undefined : statusDotColor(s),
            count: statusCounts?.[s],
          }))}
        />
        <FilterPill
          label={fr ? 'Vendeur' : 'Salesperson'}
          value={salespersonFilter}
          onChange={(v) => { setSalespersonFilter(v); setPage(1); }}
          options={[
            { value: 'All', label: fr ? 'Tous' : 'All' },
            ...(salespeople || []).map((p) => ({ value: p.id, label: p.label })),
          ]}
        />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder={fr ? 'Rechercher devis...' : 'Search quotes...'}
          className="h-9 w-[200px] px-3 text-[14px] bg-surface-card border border-outline rounded-md text-text-primary placeholder:text-text-tertiary outline-none focus:ring-1 focus:ring-[#94a3b8] focus:border-[#94a3b8] transition-all" />
        <QuoteFilterDropdown
          label={fr ? 'Montant' : 'Amount'}
          value={sort === 'total_asc' ? 'total_asc' : sort === 'total_desc' ? 'total_desc' : 'all'}
          onChange={(v) => {
            if (v === 'total_asc') setSort('total_asc');
            else if (v === 'total_desc') setSort('total_desc');
            else setSort('recent');
          }}
          options={[
            { value: 'all', label: fr ? 'Tous' : 'Default' },
            { value: 'total_asc', label: fr ? 'Croissant' : 'Low to High' },
            { value: 'total_desc', label: fr ? 'Décroissant' : 'High to Low' },
          ]}
          icon={<ArrowUpDown size={14} />}
        />
      </div>

      {/* ── TABLE ── */}
      <div className="border border-outline rounded-md overflow-hidden bg-white dark:bg-[#0e0e11]">
        <div className="grid" style={{ gridTemplateColumns: '40px 1.2fr 0.7fr 1.2fr 1fr 200px 0.9fr 48px' }} onMouseLeave={() => setHoveredId(null)}>
          {/* HEADER */}
          <div className="py-3 pl-4 border-b border-outline flex items-center"><input type="checkbox" checked={allSel} onChange={toggleAll} className="rounded-[3px] border-outline w-4 h-4 accent-primary cursor-pointer" /></div>
          <div className="py-3 px-4 border-b border-outline flex items-center text-[14px] font-medium text-text-primary"><span className="inline-flex items-center gap-1">Client {IconSort}</span></div>
          <div className="py-3 px-4 border-b border-outline flex items-center text-[14px] font-medium text-text-primary"><span className="inline-flex items-center gap-1">{fr ? '# Devis' : 'Quote #'} {IconSort}</span></div>
          <div className="py-3 px-4 border-b border-outline flex items-center text-[14px] font-medium text-text-primary"><span className="inline-flex items-center gap-1">{fr ? 'Propriété' : 'Property'} {IconSort}</span></div>
          <div className="py-3 px-4 border-b border-outline flex items-center text-[14px] font-medium text-text-primary"><span className="inline-flex items-center gap-1">{fr ? 'Créé le' : 'Created'} {IconSort}</span></div>
          <div className="py-3 px-4 border-b border-outline flex items-center text-[14px] font-medium text-text-primary"><span className="inline-flex items-center gap-1">{fr ? 'Statut' : 'Status'} {IconSort}</span></div>
          <div className="py-3 px-4 border-b border-outline flex items-center text-[14px] font-medium text-text-primary"><span className="inline-flex items-center gap-1">Total {IconSort}</span></div>
          <div className="py-3 border-b border-outline" />

          {/* LOADING */}
          {isLoading && Array.from({ length: 10 }).map((_, i) => (
            <React.Fragment key={`sk-${i}`}>
              <div className="py-3 pl-4 border-b border-outline/30 flex items-center"><div className="w-4 h-4 bg-surface-tertiary rounded animate-pulse" /></div>
              <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-24 bg-surface-tertiary rounded animate-pulse" /></div>
              <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-16 bg-surface-tertiary rounded animate-pulse" /></div>
              <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-24 bg-surface-tertiary rounded animate-pulse" /></div>
              <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-20 bg-surface-tertiary rounded animate-pulse" /></div>
              <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-14 bg-surface-tertiary rounded animate-pulse" /></div>
              <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-16 bg-surface-tertiary rounded animate-pulse" /></div>
              <div className="py-3 border-b border-outline/30" />
            </React.Fragment>
          ))}

          {/* EMPTY */}
          {!isLoading && sorted.length === 0 && (
            <div className="col-span-8 py-20 text-center text-[14px] text-text-tertiary">{fr ? 'Aucun devis trouvé' : 'No quotes found'}</div>
          )}

          {/* ROWS */}
          {!isLoading && sorted.map(q => {
            const isHovered = hoveredId === q.id;
            const rowCls = `border-b border-outline/30 transition-colors duration-150 ${sel.has(q.id) ? 'bg-primary-light' : isHovered ? 'crm-row-hover' : ''}`;
            const click = () => nav(`/quotes/${q.id}`);
            const hover = () => setHoveredId(q.id);
            return (
              <React.Fragment key={q.id}>
                <div className={`py-3 pl-4 flex items-center ${rowCls}`} onClick={e => e.stopPropagation()} onMouseEnter={hover}>
                  <input type="checkbox" checked={sel.has(q.id)} onChange={() => toggle(q.id)} className="rounded-[3px] border-outline w-4 h-4 accent-primary cursor-pointer" />
                </div>
                <div className={`py-3 px-4 flex items-center min-w-0 cursor-pointer ${rowCls}`} onClick={click} onMouseEnter={hover}>
                  <div className="flex items-center gap-3 min-w-0">
                    <UnifiedAvatar id={clientRecord(q)?.id || (q as any).client_id || q.id} name={name(q)} />
                    <div className="min-w-0">
                      <p className="text-[14px] font-bold text-text-primary truncate leading-tight">{name(q)}</p>
                      {secondaryName(q) && (
                        <p className="text-[12px] font-normal text-text-tertiary truncate leading-tight mt-0.5">{secondaryName(q)}</p>
                      )}
                    </div>
                  </div>
                </div>
                <div className={`py-3 px-4 flex items-center overflow-hidden cursor-pointer ${rowCls}`} onClick={click} onMouseEnter={hover}><span className="text-[14px] text-text-primary tabular-nums truncate">{q.quote_number}</span></div>
                <div className={`py-3 px-4 flex items-center overflow-hidden cursor-pointer ${rowCls}`} onClick={click} onMouseEnter={hover}><span className="text-[14px] text-text-primary truncate">{propertyLabel(q)}</span></div>
                <div className={`py-3 px-4 flex items-center overflow-hidden cursor-pointer ${rowCls}`} onClick={click} onMouseEnter={hover}><span className="text-[14px] text-text-primary tabular-nums truncate">{formatDate(q.created_at)}</span></div>
                <div className={`py-3 px-4 flex items-center cursor-pointer ${rowCls}`} onClick={click} onMouseEnter={hover}><Badge status={q.status} /></div>
                <div className={`py-3 px-4 flex items-center overflow-hidden cursor-pointer ${rowCls}`} onClick={click} onMouseEnter={hover}><span className="text-[14px] font-bold text-text-primary tabular-nums truncate">{formatQuoteMoney(q.total_cents, q.currency)}</span></div>
                <div className={`py-3 pr-4 flex items-center justify-center relative ${rowCls}`} onClick={e => e.stopPropagation()} onMouseEnter={hover}>
                  <button
                    className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors"
                    onClick={e => { e.stopPropagation(); setMenuOpen(menuOpen === q.id ? null : q.id); }}
                  >
                    {IconDots}
                  </button>
                  {menuOpen === q.id && (
                    <div ref={menuRef} className="absolute top-full right-2 mt-1 w-40 bg-surface-elevated border border-outline rounded-md shadow-dropdown z-50 py-1">
                      <button
                        onClick={() => { setMenuOpen(null); nav(`/quotes/${q.id}`); }}
                        className="w-full text-left px-3 py-1.5 text-[13px] text-text-secondary hover:bg-surface-secondary transition-colors"
                      >
                        {fr ? 'Modifier' : 'Edit'}
                      </button>
                      <button
                        onClick={() => { setMenuOpen(null); onArchive(q); }}
                        className="w-full text-left px-3 py-1.5 text-[13px] text-text-secondary hover:bg-surface-secondary transition-colors"
                      >
                        {q.status === 'archived' ? (fr ? 'Désarchiver' : 'Unarchive') : (fr ? 'Archiver' : 'Archive')}
                      </button>
                      <button
                        onClick={() => { setMenuOpen(null); onDel(q.id); }}
                        className="w-full text-left px-3 py-1.5 text-[13px] text-red-600 hover:bg-surface-secondary transition-colors"
                      >
                        {fr ? 'Supprimer' : 'Delete'}
                      </button>
                    </div>
                  )}
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* ── FOOTER ── */}
      <div className="flex items-center justify-between mt-3">
        <span className="text-[14px] text-text-secondary">{t.common.rowsSelected.replace('{selected}', String(sel.size)).replace('{total}', String(total))}</span>
        <div className="flex items-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}
            className="h-9 px-4 bg-surface-card border border-outline rounded-md text-[14px] text-text-primary font-normal disabled:opacity-40 disabled:cursor-default hover:bg-surface-secondary transition-colors cursor-pointer">{t.common.previous}</button>
          <button disabled={page >= pages} onClick={() => setPage(p => Math.min(pages, p + 1))}
            className="h-9 px-4 bg-surface-card border border-outline rounded-md text-[14px] text-text-primary font-normal disabled:opacity-40 disabled:cursor-default hover:bg-surface-secondary transition-colors cursor-pointer">{t.common.next}</button>
        </div>
      </div>

      <PresetSelectModal
        isOpen={presetSelectOpen}
        isFr={fr}
        onSelectPreset={handleSelectPreset}
        onStartFromScratch={handleStartFromScratch}
        onCreatePreset={() => { setPresetSelectOpen(false); nav('/quotes/presets'); }}
        onClose={() => setPresetSelectOpen(false)}
      />
    </>
  );
}
