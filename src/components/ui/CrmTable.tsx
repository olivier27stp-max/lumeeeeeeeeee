/**
 * EXACT clone of the shadcn "Users" table page.
 * Every color, spacing, font size, border, radius matched pixel-perfect.
 */
import React, { useState } from 'react';
import { MoreHorizontal, ArrowUpDown, CirclePlus, SlidersHorizontal } from 'lucide-react';
import { cn } from '../../lib/utils';

/* ════════════════════════════════════
   AVATAR — must show illustrated character
   Uses DiceBear "avataaars" style (same as reference)
   Deterministic: same id = same face forever
   ════════════════════════════════════ */
const INITIALS_BG = ['#e2e8f0','#fbbf24','#6ee7b7','#fca5a5','#7dd3fc','#f9a8d4','#fdba74','#5eead4'];
const INITIALS_FG = ['#334155','#92400e','#065f46','#991b1b','#0c4a6e','#9d174d','#9a3412','#115e59'];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return Math.abs(h);
}

export function CrmAvatar({ id, name, size = 40 }: { id: string; name: string; size?: number }) {
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState(false);
  const seed = id || name || 'x';
  const idx = hash(seed) % INITIALS_BG.length;
  const initials = name.split(' ').map(w => w?.[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';

  // DiceBear avataaars — the exact illustrated character style from the reference
  const url = `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(seed)}&radius=50&size=80&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;

  return (
    <div className="relative rounded-full shrink-0 overflow-hidden"
      style={{ width: size, height: size }}>
      {/* Always render initials as base layer */}
      <div className="absolute inset-0 rounded-full flex items-center justify-center font-bold"
        style={{ fontSize: size * 0.35, backgroundColor: INITIALS_BG[idx], color: INITIALS_FG[idx] }}>
        {initials}
      </div>
      {/* Overlay illustrated avatar once loaded */}
      {!err && (
        <img
          src={url}
          alt={initials}
          width={size}
          height={size}
          loading="lazy"
          className="absolute inset-0 rounded-full"
          style={{ width: size, height: size, opacity: loaded ? 1 : 0, transition: 'opacity 0.15s' }}
          onLoad={() => setLoaded(true)}
          onError={() => setErr(true)}
        />
      )}
    </div>
  );
}

/* ════════════════════════════════════
   BADGE — exact reference: rounded-full, border, specific colors
   Active = green border, green text, green-tinted bg
   Pending = orange
   Inactive = red filled bg
   ════════════════════════════════════ */
export function CrmBadge({ label, color }: { label: string; color: 'green' | 'orange' | 'red' | 'gray' | 'blue' }) {
  const styles: Record<string, string> = {
    green:  'text-[#15803d] border-[#86efac] bg-[#f0fdf4]',
    orange: 'text-[#c2410c] border-[#fdba74] bg-[#fff7ed]',
    red:    'text-white border-[#f87171] bg-[#f87171]',
    gray:   'text-[#6b7280] border-[#d1d5db] bg-[#f9fafb]',
    blue:   'text-[#1d4ed8] border-[#93c5fd] bg-[#eff6ff]',
  };
  return (
    <span className={cn('inline-block rounded-full border px-2.5 py-[2px] text-[12px] font-medium leading-[18px]', styles[color])}>
      {label}
    </span>
  );
}

/* ════════════════════════════════════
   PAGE HEADER — "Users" left, "⊕ Add New User" right
   ════════════════════════════════════ */
export function CrmPageHeader({ title, onAdd, addLabel }: { title: string; onAdd?: () => void; addLabel?: string }) {
  return (
    <div className="flex items-center justify-between">
      <h1 className="text-[28px] font-bold text-text-primary leading-tight">{title}</h1>
      {onAdd && (
        <button onClick={onAdd}
          className="inline-flex items-center gap-2 h-10 px-5 bg-primary text-white rounded-md text-[14px] font-medium hover:bg-primary-hover active:scale-[0.98] transition-all">
          <CirclePlus size={16} strokeWidth={1.5} />
          {addLabel || 'Add New'}
        </button>
      )}
    </div>
  );
}

/* ════════════════════════════════════
   FILTER BUTTON — ⊕ Status / ⊕ Plan / ⊕ Role
   ════════════════════════════════════ */
export function CrmFilterBtn({ label, onClick, active }: { label: string; onClick?: () => void; active?: boolean }) {
  return (
    <button onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 h-9 px-3 border rounded-md text-[14px] font-normal transition-colors',
        active ? 'bg-primary text-white border-primary' : 'bg-surface text-text-primary border-outline hover:bg-surface-secondary'
      )}>
      <CirclePlus size={15} strokeWidth={1.5} className={active ? 'text-white' : 'text-[#64748b]'} />
      {label}
    </button>
  );
}

/* ════════════════════════════════════
   COLUMN DEF
   ════════════════════════════════════ */
export interface CrmColumn<T> {
  key: string;
  label: string;
  sortable?: boolean;
  align?: 'left' | 'right';
  render: (row: T) => React.ReactNode;
}

/* ════════════════════════════════════
   FULL TABLE — exact Users page clone
   No wrapper card. Structure:
     search + filter pills          [Columns]
     ─────────────────────────────────
     □  Name     Role ↕  Plan ↕  ...  Status ↕  ···
     ─────────────────────────────────
     □  avatar  data   data  ...  badge   ···
     ─────────────────────────────────
     0 of 40 row(s) selected.     Previous  Next
   ════════════════════════════════════ */
export function CrmTableCard<T extends { id: string }>({
  columns, rows, loading, emptyMessage, onRowClick,
  page, pageCount, total, onPageChange,
  search, onSearch, searchPlaceholder,
  filters,
}: {
  columns: CrmColumn<T>[];
  rows: T[];
  loading?: boolean;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  page: number;
  pageCount: number;
  total: number;
  onPageChange: (p: number) => void;
  search: string;
  onSearch: (v: string) => void;
  searchPlaceholder?: string;
  filters?: React.ReactNode;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const allSel = rows.length > 0 && sel.size === rows.length;
  const toggleAll = () => { allSel ? setSel(new Set()) : setSel(new Set(rows.map(r => r.id))); };
  const toggle = (id: string) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n); };

  return (
    <>
      {/* ── FILTERS ROW — 12px below header ── */}
      <div className="flex items-center gap-2 mt-5 mb-4">
        <input
          value={search} onChange={e => onSearch(e.target.value)}
          placeholder={searchPlaceholder || 'Search...'}
          className="h-9 w-[200px] px-3 text-[14px] bg-surface border border-outline rounded-md text-text-primary placeholder:text-text-tertiary outline-none focus:ring-1 focus:ring-text-tertiary focus:border-text-tertiary transition-all"
        />
        {filters}
        <div className="ml-auto">
          <button className="inline-flex items-center gap-2 h-9 px-3 bg-surface border border-outline rounded-md text-[14px] text-text-primary font-normal hover:bg-surface-secondary transition-colors">
            <SlidersHorizontal size={15} className="text-[#64748b]" />
            Columns
          </button>
        </div>
      </div>

      {/* ── TABLE ── */}
      <div className="border border-outline rounded-md overflow-hidden bg-surface">
        <table className="w-full text-left">
          {/* HEAD */}
          <thead>
            <tr className="border-b border-outline">
              <th className="w-[48px] pl-4 pr-1 py-3">
                <input type="checkbox" checked={allSel} onChange={toggleAll} className="rounded-[3px] border-outline w-[16px] h-[16px] accent-primary cursor-pointer" />
              </th>
              {columns.map(col => (
                <th key={col.key} className={cn('px-4 py-3 text-[14px] font-medium text-text-primary', col.align === 'right' && 'text-right')}>
                  <span className="inline-flex items-center gap-1 select-none">
                    {col.label}
                    {col.sortable !== false && <ArrowUpDown size={14} className="text-text-tertiary" />}
                  </span>
                </th>
              ))}
              <th className="w-[48px]" />
            </tr>
          </thead>
          {/* BODY */}
          <tbody>
            {loading && Array.from({ length: 10 }).map((_, i) => (
              <tr key={`sk-${i}`} className="border-b border-[#f1f5f9]">
                <td className="pl-4 pr-1 py-[13px]"><div className="w-4 h-4 bg-surface-tertiary rounded animate-pulse" /></td>
                {columns.map((_, j) => <td key={j} className="px-4 py-[13px]"><div className="h-[18px] w-28 bg-surface-tertiary rounded animate-pulse" /></td>)}
                <td />
              </tr>
            ))}

            {!loading && rows.length === 0 && (
              <tr><td colSpan={columns.length + 2} className="py-20 text-center text-[14px] text-text-tertiary">{emptyMessage || 'No results.'}</td></tr>
            )}

            {!loading && rows.map(row => (
              <tr key={row.id} onClick={() => onRowClick?.(row)}
                className={cn('border-b border-[#f1f5f9] transition-colors', onRowClick && 'cursor-pointer', sel.has(row.id) ? 'bg-[#f0f4ff]' : 'hover:bg-surface-secondary')}>
                <td className="pl-4 pr-1 py-[13px]" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={sel.has(row.id)} onChange={() => toggle(row.id)} className="rounded-[3px] border-outline w-[16px] h-[16px] accent-primary cursor-pointer" />
                </td>
                {columns.map(col => (
                  <td key={col.key} className={cn('px-4 py-[13px]', col.align === 'right' && 'text-right')}>
                    {col.render(row)}
                  </td>
                ))}
                <td className="pr-4 py-[13px] text-center">
                  <button className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors" onClick={e => e.stopPropagation()}>
                    <MoreHorizontal size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── FOOTER ── */}
      <div className="flex items-center justify-between mt-3">
        <span className="text-[14px] text-[#64748b]">
          {sel.size} of {total} row(s) selected.
        </span>
        <div className="flex items-center gap-2">
          <button disabled={page <= 1} onClick={() => onPageChange(page - 1)}
            className="h-9 px-4 bg-surface border border-outline rounded-md text-[14px] text-text-primary font-normal disabled:opacity-40 disabled:cursor-default hover:bg-surface-secondary transition-colors cursor-pointer">
            Previous
          </button>
          <button disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}
            className="h-9 px-4 bg-surface border border-outline rounded-md text-[14px] text-text-primary font-normal disabled:opacity-40 disabled:cursor-default hover:bg-surface-secondary transition-colors cursor-pointer">
            Next
          </button>
        </div>
      </div>
    </>
  );
}
