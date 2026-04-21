/* ═══════════════════════════════════════════════════════════════
   Page — Quotes (Devis) — Modernised with new design tokens
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import {
  listAllQuotes,
  formatQuoteMoney,
  deleteQuote,
  QUOTE_STATUS_LABELS,
  type QuoteStatus,
} from '../lib/quotesApi';
import { formatDate, cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import QuoteCreateModal from '../components/quotes/QuoteCreateModal';
import PresetSelectModal from '../components/quotes/PresetSelectModal';
import UnifiedAvatar from '../components/ui/UnifiedAvatar';
import type { QuotePreset } from '../types';
import { CirclePlus, ArrowUpDown, Ruler } from 'lucide-react';

const PAGE_SIZE = 20;
type StatusTab = 'all' | QuoteStatus;
type QuoteSort = 'recent' | 'oldest' | 'total_desc' | 'total_asc';
const STATUS_TABS: StatusTab[] = ['all', 'draft', 'sent', 'awaiting_response', 'action_required', 'approved', 'declined', 'expired', 'converted'];

const STATUS_BADGE: Record<string, string> = {
  draft: 'badge-neutral',
  action_required: 'badge-warning',
  sent: 'badge-sky',
  awaiting_response: 'badge-info',
  approved: 'badge-success',
  declined: 'badge-danger',
  expired: 'badge-neutral',
  converted: 'badge-teal',
};


function sLabel(s: StatusTab, fr: boolean): string {
  if (s === 'all') return fr ? 'Tous' : 'All';
  const map: Record<string, string> = {
    draft: 'Brouillon', sent: 'Envoyé', awaiting_response: 'En attente', approved: 'Approuvé',
    declined: 'Décliné', expired: 'Expiré', converted: 'Converti',
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
            : 'bg-surface text-text-primary border-outline hover:bg-surface-secondary'
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
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<QuoteSort>('recent');
  const [createOpen, setCreateOpen] = useState(false);
  const [presetSelectOpen, setPresetSelectOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<QuotePreset | null>(null);
  const location = useLocation();

  // Handle navigation with createWithPreset state
  useEffect(() => {
    const state = location.state as { createWithPreset?: QuotePreset } | null;
    if (state?.createWithPreset) {
      setSelectedPreset(state.createWithPreset);
      setCreateOpen(true);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  useEffect(() => {
    const handler = () => handleNewQuote();
    window.addEventListener('crm:open-new-quote', handler);
    return () => window.removeEventListener('crm:open-new-quote', handler);
  }, []);

  const handleNewQuote = () => setPresetSelectOpen(true);
  const handleSelectPreset = (preset: QuotePreset) => {
    setSelectedPreset(preset);
    setPresetSelectOpen(false);
    setCreateOpen(true);
  };
  const handleStartFromScratch = () => {
    setSelectedPreset(null);
    setPresetSelectOpen(false);
    setCreateOpen(true);
  };

  React.useEffect(() => {
    const id = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const { data: res, isLoading } = useQuery({
    queryKey: ['quotes-list', tab, debounced, page],
    queryFn: () => listAllQuotes({ status: tab, search: debounced, page, pageSize: PAGE_SIZE }),
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

  function name(q: any): string {
    const c = q.clients as any, l = q.leads as any;
    if (c && !c.deleted_at) return `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.company || 'Client';
    if (l && !l.deleted_at) return `${l.first_name || ''} ${l.last_name || ''}`.trim() || l.company || 'Lead';
    return '—';
  }

  async function onDel(id: string) {
    if (!confirm(t.quotes.deleteThisQuote)) return;
    try { await deleteQuote(id); qc.invalidateQueries({ queryKey: ['quotes-list'] }); qc.invalidateQueries({ queryKey: ['quote-kpis'] }); toast.success(t.quotes.quoteDeleted); }
    catch { toast.error('Failed'); }
  }

  const badgeColor = (s: string): 'green' | 'orange' | 'red' | 'gray' | 'blue' => {
    if (s === 'approved' || s === 'converted') return 'green';
    if (s === 'sent' || s === 'awaiting_response' || s === 'action_required') return 'orange';
    if (s === 'declined' || s === 'expired') return 'red';
    return 'gray';
  };

  /* ═══ Shared helpers — identical to Clients page ═══ */
  const [sel, setSel] = useState<Set<string>>(new Set());
  const allSel = sorted.length > 0 && sel.size === sorted.length;
  const toggleAll = () => { allSel ? setSel(new Set()) : setSel(new Set(sorted.map(r => r.id))); };
  const toggle = (id: string) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n); };


  function Badge({ status }: { status: string }) {
    const s = status || 'draft';
    const label = (QUOTE_STATUS_LABELS[s as QuoteStatus] || s).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    if (s === 'approved' || s === 'converted') return <span className="badge-success">{label}</span>;
    if (s === 'sent' || s === 'awaiting_response' || s === 'action_required') return <span className="badge-warning">{label}</span>;
    if (s === 'declined' || s === 'expired') return <span className="badge-danger">{label}</span>;
    return <span className="badge-neutral">{label}</span>;
  }

  const IconPlus = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>;
  const IconSort = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>;
  const IconDots = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>;

  return (
    <>
      {/* ── PAGE HEADER ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-[28px] font-bold text-text-primary leading-tight">{fr ? 'Devis' : 'Quotes'}</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => nav('/quotes/presets')}
            className="inline-flex items-center gap-2 h-10 px-4 bg-surface border border-outline text-text-secondary rounded-md text-[13px] font-medium hover:bg-surface-secondary transition-all">
            Presets
          </button>
          <button onClick={() => nav('/quotes/measure')}
            className="inline-flex items-center gap-2 h-10 px-4 bg-surface border border-outline text-text-secondary rounded-md text-[13px] font-medium hover:bg-surface-secondary transition-all">
            <Ruler size={15} />
            Mesure
          </button>
          <button onClick={handleNewQuote}
            className="inline-flex items-center gap-2 h-10 px-5 bg-primary text-white rounded-md text-[14px] font-medium hover:bg-primary-hover active:scale-[0.98] transition-all">
            {IconPlus}
            {fr ? 'Nouveau devis' : 'Add New Quote'}
          </button>
        </div>
      </div>

      {/* ── TOOLBAR ── */}
      <div className="flex items-center gap-2 mt-5 mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder={fr ? 'Rechercher devis...' : 'Search quotes...'}
          className="h-9 w-[200px] px-3 text-[14px] bg-surface border border-outline rounded-md text-text-primary placeholder:text-text-tertiary outline-none focus:ring-1 focus:ring-[#94a3b8] focus:border-[#94a3b8] transition-all" />
        <QuoteFilterDropdown
          label={fr ? 'Statut' : 'Status'}
          value={tab}
          onChange={(v) => { setTab(v as StatusTab); setPage(1); }}
          options={STATUS_TABS.map(s => ({ value: s, label: sLabel(s, fr) }))}
        />
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
      <div className="border border-outline rounded-md overflow-hidden bg-surface">
        <div className="grid" style={{ gridTemplateColumns: '40px 1fr 1fr 1fr 100px 1fr 48px' }}>
          {/* HEADER */}
          <div className="py-3 pl-4 border-b border-outline flex items-center"><input type="checkbox" checked={allSel} onChange={toggleAll} className="rounded-[3px] border-outline w-4 h-4 accent-primary cursor-pointer" /></div>
          <div className="py-3 px-4 border-b border-outline flex items-center text-[14px] font-medium text-text-primary"><span className="inline-flex items-center gap-1">Client {IconSort}</span></div>
          <div className="py-3 px-4 border-b border-outline flex items-center text-[14px] font-medium text-text-primary"><span className="inline-flex items-center gap-1">{fr ? '# Devis' : 'Quote #'} {IconSort}</span></div>
          <div className="py-3 px-4 border-b border-outline flex items-center text-[14px] font-medium text-text-primary"><span className="inline-flex items-center gap-1">{fr ? 'Montant' : 'Amount'} {IconSort}</span></div>
          <div className="py-3 px-4 border-b border-outline flex items-center text-[14px] font-medium text-text-primary"><span className="inline-flex items-center gap-1">{fr ? 'Statut' : 'Status'} {IconSort}</span></div>
          <div className="py-3 px-4 border-b border-outline flex items-center text-[14px] font-medium text-text-primary"><span className="inline-flex items-center gap-1">Date {IconSort}</span></div>
          <div className="py-3 border-b border-outline" />

          {/* LOADING */}
          {isLoading && Array.from({ length: 10 }).map((_, i) => (
            <React.Fragment key={`sk-${i}`}>
              <div className="py-3 pl-4 border-b border-outline/30 flex items-center"><div className="w-4 h-4 bg-surface-tertiary rounded animate-pulse" /></div>
              <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-24 bg-surface-tertiary rounded animate-pulse" /></div>
              <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-16 bg-surface-tertiary rounded animate-pulse" /></div>
              <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-16 bg-surface-tertiary rounded animate-pulse" /></div>
              <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-14 bg-surface-tertiary rounded animate-pulse" /></div>
              <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-20 bg-surface-tertiary rounded animate-pulse" /></div>
              <div className="py-3 border-b border-outline/30" />
            </React.Fragment>
          ))}

          {/* EMPTY */}
          {!isLoading && sorted.length === 0 && (
            <div className="col-span-7 py-20 text-center text-[14px] text-text-tertiary">{fr ? 'Aucun devis trouvé' : 'No quotes found'}</div>
          )}

          {/* ROWS */}
          {!isLoading && sorted.map(q => {
            const rowCls = `border-b border-outline/30 transition-colors ${sel.has(q.id) ? 'bg-primary-light' : 'hover:bg-surface-secondary'}`;
            const click = () => nav(`/quotes/${q.id}`);
            return (
              <React.Fragment key={q.id}>
                <div className={`py-3 pl-4 flex items-center ${rowCls}`} onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={sel.has(q.id)} onChange={() => toggle(q.id)} className="rounded-[3px] border-outline w-4 h-4 accent-primary cursor-pointer" />
                </div>
                <div className={`py-3 px-4 flex items-center min-w-0 cursor-pointer ${rowCls}`} onClick={click}>
                  <div className="flex items-center gap-3 min-w-0">
                    <UnifiedAvatar id={(q as any).clients?.id || (q as any).client_id || q.id} name={name(q)} />
                    <span className="text-[14px] text-text-primary truncate">{name(q)}</span>
                  </div>
                </div>
                <div className={`py-3 px-4 flex items-center overflow-hidden cursor-pointer ${rowCls}`} onClick={click}><span className="text-[14px] text-text-primary tabular-nums truncate">{q.quote_number}</span></div>
                <div className={`py-3 px-4 flex items-center overflow-hidden cursor-pointer ${rowCls}`} onClick={click}><span className="text-[14px] font-semibold text-text-primary tabular-nums truncate">{formatQuoteMoney(q.total_cents, q.currency)}</span></div>
                <div className={`py-3 px-4 flex items-center cursor-pointer ${rowCls}`} onClick={click}><Badge status={q.status} /></div>
                <div className={`py-3 px-4 flex items-center overflow-hidden cursor-pointer ${rowCls}`} onClick={click}><span className="text-[14px] text-text-primary tabular-nums truncate">{formatDate(q.created_at)}</span></div>
                <div className={`py-3 pr-4 flex items-center justify-center ${rowCls}`}>
                  <button className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors" onClick={e => e.stopPropagation()}>
                    {IconDots}
                  </button>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* ── FOOTER ── */}
      <div className="flex items-center justify-between mt-3">
        <span className="text-[14px] text-text-secondary">{sel.size} of {total} row(s) selected.</span>
        <div className="flex items-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}
            className="h-9 px-4 bg-surface border border-outline rounded-md text-[14px] text-text-primary font-normal disabled:opacity-40 disabled:cursor-default hover:bg-surface-secondary transition-colors cursor-pointer">Previous</button>
          <button disabled={page >= pages} onClick={() => setPage(p => Math.min(pages, p + 1))}
            className="h-9 px-4 bg-surface border border-outline rounded-md text-[14px] text-text-primary font-normal disabled:opacity-40 disabled:cursor-default hover:bg-surface-secondary transition-colors cursor-pointer">Next</button>
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
      <QuoteCreateModal
        isOpen={createOpen}
        onClose={() => { setCreateOpen(false); setSelectedPreset(null); }}
        createLeadInline
        preset={selectedPreset}
        onCreated={(detail) => {
          setCreateOpen(false);
          setSelectedPreset(null);
          qc.invalidateQueries({ queryKey: ['quotes-list'] });
          qc.invalidateQueries({ queryKey: ['quote-kpis'] });
          nav(`/quotes/${detail.quote.id}`);
        }}
      />
    </>
  );
}
