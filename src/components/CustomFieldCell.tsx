import React, { useState, useRef, useEffect } from 'react';
import {
  Check, ChevronDown, Star, X, Mail, Phone, ExternalLink, Calendar,
  Type, Hash, CheckSquare, Link, DollarSign, Tag, List,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { setValue, type CustomColumn, type ColumnType } from '../lib/customFieldsApi';

// ─── Column type icon map (for table headers) ──────────────────
const COL_TYPE_ICON: Record<ColumnType, typeof Type> = {
  text: Type, number: Hash, status: List, dropdown: ChevronDown,
  date: Calendar, checkbox: CheckSquare, email: Mail, phone: Phone,
  url: Link, currency: DollarSign, rating: Star, label: Tag,
};

/** Renders a custom column header with type icon — Attio style */
export function CustomColumnHeader({ column }: { column: CustomColumn }) {
  const Icon = COL_TYPE_ICON[column.col_type as ColumnType] || Type;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon size={12} className="text-text-tertiary/70 shrink-0" />
      {column.name}
    </span>
  );
}

export interface CellProps {
  column: CustomColumn;
  recordId: string;
  value: any;
  onChange?: (newValue: any) => void;
}

const CustomFieldCell: React.FC<CellProps> = ({ column, recordId, value, onChange }) => {
  switch (column.col_type as ColumnType) {
    case 'text':
      return <TextCell column={column} recordId={recordId} value={value} onChange={onChange} />;
    case 'email':
      return <EmailCell column={column} recordId={recordId} value={value} onChange={onChange} />;
    case 'phone':
      return <PhoneCell column={column} recordId={recordId} value={value} onChange={onChange} />;
    case 'url':
      return <UrlCell column={column} recordId={recordId} value={value} onChange={onChange} />;
    case 'number':
      return <NumberCell column={column} recordId={recordId} value={value} onChange={onChange} />;
    case 'currency':
      return <CurrencyCell column={column} recordId={recordId} value={value} onChange={onChange} />;
    case 'checkbox':
      return <CheckboxCell column={column} recordId={recordId} value={value} onChange={onChange} />;
    case 'date':
      return <DateCell column={column} recordId={recordId} value={value} onChange={onChange} />;
    case 'status':
      return <StatusCell column={column} recordId={recordId} value={value} onChange={onChange} />;
    case 'dropdown':
      return <DropdownCell column={column} recordId={recordId} value={value} onChange={onChange} />;
    case 'label':
      return <LabelCell column={column} recordId={recordId} value={value} onChange={onChange} />;
    case 'rating':
      return <RatingCell column={column} recordId={recordId} value={value} onChange={onChange} />;
    default:
      return <span className="text-[13px] text-text-tertiary">{String(value ?? '')}</span>;
  }
};

export default CustomFieldCell;

// ─── Shared save helper ─────────────────────────────────────────
async function saveValue(column: CustomColumn, recordId: string, val: any, onChange?: (v: any) => void) {
  try {
    await setValue(column.id, recordId, val, column.col_type as ColumnType);
    onChange?.(val);
  } catch (e) {
    console.error('Failed to save custom field value:', e);
  }
}

// ─── Shared outside-click hook ──────────────────────────────────
function useClickOutside(ref: React.RefObject<HTMLElement | null>, handler: () => void) {
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) handler();
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);
}

// ─── Placeholder ────────────────────────────────────────────────
const Placeholder = () => <span className="text-text-tertiary/60 select-none">—</span>;

// ─── Text Cell ──────────────────────────────────────────────────
function TextCell({ column, recordId, value, onChange }: CellProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setText(value ?? ''); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = () => {
    setEditing(false);
    if (text !== (value ?? '')) saveValue(column, recordId, text, onChange);
  };

  if (!editing) {
    return (
      <div
        onClick={() => setEditing(true)}
        className="group/cell text-[13px] text-text-primary cursor-text min-h-[28px] flex items-center truncate max-w-[200px] rounded-md px-1.5 -mx-1.5 hover:bg-surface-secondary/80 transition-colors"
        title={text}
      >
        {text || <Placeholder />}
      </div>
    );
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setText(value ?? ''); setEditing(false); } }}
      className="w-full text-[13px] bg-surface border border-primary/40 rounded-md outline-none px-1.5 py-1 text-text-primary shadow-sm ring-2 ring-primary/10"
    />
  );
}

// ─── Email Cell ─────────────────────────────────────────────────
function EmailCell({ column, recordId, value, onChange }: CellProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setText(value ?? ''); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = () => {
    setEditing(false);
    if (text !== (value ?? '')) saveValue(column, recordId, text, onChange);
  };

  if (!editing) {
    return (
      <div
        onClick={() => setEditing(true)}
        className="group/cell flex items-center gap-1.5 text-[13px] min-h-[28px] cursor-text rounded-md px-1.5 -mx-1.5 hover:bg-surface-secondary/80 transition-colors"
      >
        {text ? (
          <>
            <Mail size={12} className="text-text-tertiary shrink-0" />
            <span className="text-primary truncate max-w-[160px]">{text}</span>
          </>
        ) : <Placeholder />}
      </div>
    );
  }

  return (
    <input
      ref={inputRef}
      type="email"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setText(value ?? ''); setEditing(false); } }}
      className="w-full text-[13px] bg-surface border border-primary/40 rounded-md outline-none px-1.5 py-1 text-text-primary shadow-sm ring-2 ring-primary/10"
    />
  );
}

// ─── Phone Cell ─────────────────────────────────────────────────
function PhoneCell({ column, recordId, value, onChange }: CellProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setText(value ?? ''); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = () => {
    setEditing(false);
    if (text !== (value ?? '')) saveValue(column, recordId, text, onChange);
  };

  if (!editing) {
    return (
      <div
        onClick={() => setEditing(true)}
        className="group/cell flex items-center gap-1.5 text-[13px] min-h-[28px] cursor-text rounded-md px-1.5 -mx-1.5 hover:bg-surface-secondary/80 transition-colors"
      >
        {text ? (
          <>
            <Phone size={12} className="text-text-tertiary shrink-0" />
            <span className="text-text-primary tabular-nums">{text}</span>
          </>
        ) : <Placeholder />}
      </div>
    );
  }

  return (
    <input
      ref={inputRef}
      type="tel"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setText(value ?? ''); setEditing(false); } }}
      className="w-full text-[13px] bg-surface border border-primary/40 rounded-md outline-none px-1.5 py-1 text-text-primary shadow-sm ring-2 ring-primary/10"
    />
  );
}

// ─── URL Cell ───────────────────────────────────────────────────
function UrlCell({ column, recordId, value, onChange }: CellProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setText(value ?? ''); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = () => {
    setEditing(false);
    if (text !== (value ?? '')) saveValue(column, recordId, text, onChange);
  };

  if (!editing) {
    return (
      <div
        onClick={() => setEditing(true)}
        className="group/cell flex items-center gap-1.5 text-[13px] min-h-[28px] cursor-text rounded-md px-1.5 -mx-1.5 hover:bg-surface-secondary/80 transition-colors"
      >
        {text ? (
          <>
            <ExternalLink size={12} className="text-text-tertiary shrink-0" />
            <span className="text-primary truncate max-w-[140px] underline underline-offset-2 decoration-primary/30">{text.replace(/^https?:\/\//, '')}</span>
          </>
        ) : <Placeholder />}
      </div>
    );
  }

  return (
    <input
      ref={inputRef}
      type="url"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setText(value ?? ''); setEditing(false); } }}
      className="w-full text-[13px] bg-surface border border-primary/40 rounded-md outline-none px-1.5 py-1 text-text-primary shadow-sm ring-2 ring-primary/10"
      placeholder="https://"
    />
  );
}

// ─── Number Cell ────────────────────────────────────────────────
function NumberCell({ column, recordId, value, onChange }: CellProps) {
  const [editing, setEditing] = useState(false);
  const [num, setNum] = useState(value ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setNum(value ?? ''); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = () => {
    setEditing(false);
    const parsed = num === '' ? null : Number(num);
    if (parsed !== value) saveValue(column, recordId, parsed, onChange);
  };

  if (!editing) {
    return (
      <div
        onClick={() => setEditing(true)}
        className="text-[13px] text-text-primary cursor-text min-h-[28px] flex items-center tabular-nums rounded-md px-1.5 -mx-1.5 hover:bg-surface-secondary/80 transition-colors"
      >
        {value != null ? (
          <span className="font-medium">{Number(value).toLocaleString()}</span>
        ) : <Placeholder />}
      </div>
    );
  }

  return (
    <input
      ref={inputRef}
      type="number"
      step="any"
      value={num}
      onChange={(e) => setNum(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setNum(value ?? ''); setEditing(false); } }}
      className="w-24 text-[13px] bg-surface border border-primary/40 rounded-md outline-none px-1.5 py-1 text-text-primary tabular-nums shadow-sm ring-2 ring-primary/10"
    />
  );
}

// ─── Currency Cell ──────────────────────────────────────────────
function CurrencyCell({ column, recordId, value, onChange }: CellProps) {
  const [editing, setEditing] = useState(false);
  const [num, setNum] = useState(value ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const currencyCode = column.config?.currency_code || 'CAD';

  useEffect(() => { setNum(value ?? ''); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = () => {
    setEditing(false);
    const parsed = num === '' ? null : Number(num);
    if (parsed !== value) saveValue(column, recordId, parsed, onChange);
  };

  const format = (v: number) =>
    new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(v);

  if (!editing) {
    return (
      <div
        onClick={() => setEditing(true)}
        className="text-[13px] text-text-primary cursor-text min-h-[28px] flex items-center tabular-nums font-medium rounded-md px-1.5 -mx-1.5 hover:bg-surface-secondary/80 transition-colors"
      >
        {value != null ? format(Number(value)) : <Placeholder />}
      </div>
    );
  }

  return (
    <input
      ref={inputRef}
      type="number"
      step="0.01"
      value={num}
      onChange={(e) => setNum(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setNum(value ?? ''); setEditing(false); } }}
      className="w-28 text-[13px] bg-surface border border-primary/40 rounded-md outline-none px-1.5 py-1 text-text-primary tabular-nums shadow-sm ring-2 ring-primary/10"
    />
  );
}

// ─── Checkbox Cell ──────────────────────────────────────────────
function CheckboxCell({ column, recordId, value, onChange }: CellProps) {
  const checked = Boolean(value);

  return (
    <button
      onClick={() => saveValue(column, recordId, !checked, onChange)}
      className={cn(
        'flex h-[18px] w-[18px] items-center justify-center rounded-[4px] border-[1.5px] transition-all duration-150',
        checked
          ? 'border-primary bg-primary text-white shadow-sm shadow-primary/20'
          : 'border-border-strong/40 hover:border-primary/50 hover:bg-primary/5'
      )}
    >
      {checked && <Check size={11} strokeWidth={3} />}
    </button>
  );
}

// ─── Date Cell ──────────────────────────────────────────────────
function DateCell({ column, recordId, value, onChange }: CellProps) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value || null;
    saveValue(column, recordId, newVal, onChange);
    setEditing(false);
  };

  if (!editing) {
    return (
      <div
        onClick={() => setEditing(true)}
        className="group/cell flex items-center gap-1.5 text-[13px] min-h-[28px] cursor-pointer rounded-md px-1.5 -mx-1.5 hover:bg-surface-secondary/80 transition-colors"
      >
        {value ? (
          <>
            <Calendar size={12} className="text-text-tertiary shrink-0" />
            <span className="text-text-primary tabular-nums">
              {new Date(value + 'T00:00:00').toLocaleDateString('fr-CA', { year: 'numeric', month: 'short', day: 'numeric' })}
            </span>
          </>
        ) : <Placeholder />}
      </div>
    );
  }

  return (
    <input
      ref={inputRef}
      type="date"
      value={value || ''}
      onChange={handleChange}
      onBlur={() => setEditing(false)}
      className="text-[13px] bg-surface border border-primary/40 rounded-md outline-none px-1.5 py-1 text-text-primary shadow-sm ring-2 ring-primary/10"
    />
  );
}

// ─── Attio-style color palette for pills ────────────────────────
const PILL_PALETTE = [
  { bg: '#dbeafe', text: '#1d4ed8', border: '#93c5fd' },  // blue
  { bg: '#dcfce7', text: '#15803d', border: '#86efac' },  // green
  { bg: '#fef3c7', text: '#a16207', border: '#fcd34d' },  // amber
  { bg: '#fce7f3', text: '#be185d', border: '#f9a8d4' },  // pink
  { bg: '#e0e7ff', text: '#4338ca', border: '#a5b4fc' },  // indigo
  { bg: '#ffedd5', text: '#c2410c', border: '#fdba74' },  // orange
  { bg: '#f1f5f9', text: '#475569', border: '#94a3b8' },  // neutral
  { bg: '#ccfbf1', text: '#0f766e', border: '#5eead4' },  // teal
  { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' },  // slate
  { bg: '#fef2f2', text: '#dc2626', border: '#fca5a5' },  // red
];

function getPillColor(idx: number) {
  return PILL_PALETTE[idx % PILL_PALETTE.length];
}

// ─── Status Cell (Attio-style colored pills) ────────────────────
function StatusCell({ column, recordId, value, onChange }: CellProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const statuses = column.config?.statuses || [];
  const current = statuses.find((s) => s.value === value);

  useClickOutside(ref, () => setOpen(false));

  const select = (val: string) => {
    setOpen(false);
    saveValue(column, recordId, val, onChange);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[12px] font-semibold transition-all',
          !value && 'text-text-tertiary/60'
        )}
        style={current ? {
          backgroundColor: `${current.color}18`,
          color: current.color,
          border: `1px solid ${current.color}30`,
        } : {
          backgroundColor: '#f1f5f9',
          color: '#94a3b8',
          border: '1px solid #e2e8f0',
        }}
      >
        {value || <Placeholder />}
        <ChevronDown size={11} className="opacity-60" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 bg-surface rounded-xl border border-border shadow-xl py-1.5 min-w-[160px] animate-in fade-in slide-in-from-top-1 duration-150">
          {value && (
            <button
              onClick={() => select('')}
              className="w-full text-left px-3 py-1.5 text-[12px] text-text-tertiary hover:bg-surface-secondary transition-colors"
            >
              Clear
            </button>
          )}
          {statuses.map((status) => {
            const isActive = value === status.value;
            return (
              <button
                key={status.value}
                onClick={() => select(status.value)}
                className={cn(
                  'w-full text-left flex items-center gap-2.5 px-3 py-1.5 text-[12px] hover:bg-surface-secondary transition-colors',
                  isActive && 'bg-surface-secondary'
                )}
              >
                <span
                  className="inline-flex items-center rounded-full px-2 py-[1px] text-xs font-medium"
                  style={{
                    backgroundColor: `${status.color}18`,
                    color: status.color,
                    border: `1px solid ${status.color}30`,
                  }}
                >
                  {status.value}
                </span>
                {isActive && <Check size={12} className="ml-auto text-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Dropdown Cell (clean Attio-style) ──────────────────────────
function DropdownCell({ column, recordId, value, onChange }: CellProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const options = column.config?.options || [];

  useClickOutside(ref, () => setOpen(false));

  const select = (val: string) => {
    setOpen(false);
    saveValue(column, recordId, val, onChange);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex items-center gap-1 rounded-md px-2 py-[3px] text-[12px] font-medium transition-all border',
          value
            ? 'border-outline/60 text-text-primary bg-surface hover:bg-surface-secondary'
            : 'border-transparent text-text-tertiary/60 hover:bg-surface-secondary hover:border-outline/40'
        )}
      >
        {value || <Placeholder />}
        <ChevronDown size={11} className="text-text-tertiary/60" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 bg-surface rounded-xl border border-border shadow-xl py-1.5 min-w-[150px] animate-in fade-in slide-in-from-top-1 duration-150">
          {value && (
            <button
              onClick={() => select('')}
              className="w-full text-left px-3 py-1.5 text-[12px] text-text-tertiary hover:bg-surface-secondary transition-colors"
            >
              Clear
            </button>
          )}
          {options.map((opt) => {
            const isActive = value === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => select(opt.value)}
                className={cn(
                  'w-full text-left flex items-center gap-2 px-3 py-1.5 text-[12px] text-text-primary hover:bg-surface-secondary transition-colors',
                  isActive && 'bg-surface-secondary font-semibold'
                )}
              >
                {opt.value}
                {isActive && <Check size={12} className="ml-auto text-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Label Cell (Attio-style colored tag pills) ─────────────────
function LabelCell({ column, recordId, value, onChange }: CellProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const options = column.config?.options || [];

  useClickOutside(ref, () => setOpen(false));

  const select = (val: string) => {
    setOpen(false);
    saveValue(column, recordId, val, onChange);
  };

  const currentIdx = options.findIndex((o) => o.value === value);
  const currentColor = currentIdx >= 0 ? getPillColor(currentIdx) : null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 rounded-full px-2.5 py-[2px] text-[11px] font-bold tracking-wide transition-all"
        style={currentColor ? {
          backgroundColor: currentColor.bg,
          color: currentColor.text,
          border: `1px solid ${currentColor.border}`,
        } : {
          backgroundColor: '#f8fafc',
          color: '#94a3b8',
          border: '1px solid #e2e8f0',
        }}
      >
        {value || <span className="font-normal">—</span>}
        <ChevronDown size={9} className="opacity-60" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 bg-surface rounded-xl border border-border shadow-xl py-1.5 min-w-[140px] animate-in fade-in slide-in-from-top-1 duration-150">
          {value && (
            <button
              onClick={() => select('')}
              className="w-full text-left px-3 py-1.5 text-[12px] text-text-tertiary hover:bg-surface-secondary transition-colors"
            >
              Clear
            </button>
          )}
          {options.map((opt, idx) => {
            const color = getPillColor(idx);
            const isActive = value === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => select(opt.value)}
                className={cn(
                  'w-full text-left flex items-center gap-2 px-3 py-1.5 hover:bg-surface-secondary transition-colors',
                  isActive && 'bg-surface-secondary'
                )}
              >
                <span
                  className="inline-block rounded-full px-2 py-[1px] text-[10px] font-bold tracking-wide"
                  style={{ backgroundColor: color.bg, color: color.text, border: `1px solid ${color.border}` }}
                >
                  {opt.value}
                </span>
                {isActive && <Check size={12} className="ml-auto text-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Rating Cell (polished stars) ───────────────────────────────
function RatingCell({ column, recordId, value, onChange }: CellProps) {
  const max = column.config?.max_rating || 5;
  const current = Number(value) || 0;
  const [hover, setHover] = useState<number | null>(null);

  const click = (n: number) => {
    const newVal = n === current ? 0 : n;
    saveValue(column, recordId, newVal, onChange);
  };

  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: max }, (_, i) => {
        const n = i + 1;
        const filled = n <= (hover ?? current);
        return (
          <button
            key={n}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(null)}
            onClick={() => click(n)}
            className="p-0 transition-all duration-100 hover:scale-110"
          >
            <Star
              size={15}
              className={cn(
                'transition-colors duration-100',
                filled ? 'text-amber-400 fill-amber-400 drop-shadow-sm' : 'text-border/60'
              )}
            />
          </button>
        );
      })}
      {current > 0 && (
        <span className="text-[10px] text-text-tertiary ml-1 tabular-nums font-medium">{current}/{max}</span>
      )}
    </div>
  );
}
