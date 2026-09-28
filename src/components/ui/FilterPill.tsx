import React, { useEffect, useRef, useState } from 'react';

export interface FilterPillOption {
  value: string;
  label: string;
  /** Small colored dot shown left of the label (e.g. the status color). */
  dotColor?: string;
  /** Count shown in parentheses after the label. */
  count?: number;
}

interface FilterPillProps {
  /** Fixed left label, e.g. "Status" or "Salesperson". */
  label: string;
  value: string;
  options: FilterPillOption[];
  onChange: (value: string) => void;
  className?: string;
  /** Adds a « × » at the right end of the pill that resets the filter. */
  onClear?: () => void;
  clearLabel?: string;
}

/**
 * Pale-grey rounded filter pill — "Label | Selection" — with a dropdown
 * listing the options. Options with a dotColor get a colored dot; options
 * with a count get it appended in parentheses. Shared by the Clients /
 * Jobs / Quotes / Invoices toolbars.
 */
export default function FilterPill({ label, value, options, onChange, className, onClear, clearLabel }: FilterPillProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selected = options.find(o => o.value === value);
  // Only draw the dot column when at least one option is colored (status
  // lists); plain lists (salespeople) stay dot-free.
  const hasDots = options.some(o => o.dotColor);

  return (
    <div ref={ref} className={`relative ${onClear ? 'inline-flex' : ''} ${className || ''}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center h-9 px-3.5 whitespace-nowrap bg-surface-secondary border border-outline text-[13px] hover:bg-surface-tertiary transition-colors ${onClear ? 'rounded-l-lg border-r-0 pr-2' : 'rounded-lg'}`}
      >
        <span className="font-medium text-text-secondary">{label}</span>
        <span aria-hidden className="w-px h-4 bg-outline mx-2.5" />
        <span className="inline-flex items-center gap-1.5 font-medium text-text-primary">
          {selected?.dotColor && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: selected.dotColor }} />}
          {selected?.label ?? value}
        </span>
      </button>
      {onClear && (
        <button
          type="button"
          onClick={() => { onClear(); setOpen(false); }}
          aria-label={clearLabel ?? `Reset ${label}`}
          className="inline-flex items-center h-9 pl-1 pr-2.5 rounded-r-lg bg-surface-secondary border border-l-0 border-outline text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      )}
      {open && (
        <div className="absolute top-full left-0 mt-1 w-56 max-h-72 overflow-y-auto bg-surface-card border border-outline rounded-md shadow-lg z-50 py-1">
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full flex items-center gap-2 text-left px-3 py-2 text-[13px] transition-colors ${
                value === opt.value
                  ? 'bg-surface-tertiary font-medium text-text-primary'
                  : 'text-text-secondary hover:bg-surface-secondary'
              }`}
            >
              {hasDots && (
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={opt.dotColor ? { background: opt.dotColor } : { border: '1px solid var(--color-text-tertiary)' }}
                />
              )}
              <span className="truncate">{opt.label}</span>
              {opt.count !== undefined && (
                <span className="text-text-tertiary tabular-nums">({opt.count})</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
