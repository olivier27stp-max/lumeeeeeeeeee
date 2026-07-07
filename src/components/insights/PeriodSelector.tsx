/**
 * Borderless period dropdown shown on every Statistiques card — matches the
 * approved prototype: just the label + chevron (no box), with a popover menu of
 * the five windows. Controlled: parent owns the InsightsPeriod state.
 */
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import {
  INSIGHTS_PERIODS,
  periodLabel,
  type InsightsPeriod,
} from '../../lib/insightsPeriod';

export default function PeriodSelector({
  value,
  onChange,
  align = 'right',
}: {
  value: InsightsPeriod;
  onChange: (p: InsightsPeriod) => void;
  align?: 'left' | 'right';
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex items-center gap-1.5 py-1 text-[12.5px] font-semibold text-text-primary tracking-tight hover:opacity-70 transition-opacity focus:outline-none focus-visible:opacity-70"
      >
        <span>{periodLabel(value, fr)}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="w-3 h-3 text-text-tertiary">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'absolute top-[calc(100%+7px)] z-30 min-w-[220px] rounded-xl border border-border bg-surface-card p-1.5 shadow-xl',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {INSIGHTS_PERIODS.map((p) => {
            const sel = p === value;
            return (
              <button
                key={p}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(p);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[12.5px] tracking-tight transition-colors',
                  sel ? 'font-semibold text-text-primary' : 'font-medium text-text-secondary hover:bg-surface-secondary hover:text-text-primary',
                )}
              >
                <span>{periodLabel(p, fr)}</span>
                {sel && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} className="w-3.5 h-3.5">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
