import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Champ de date maison : même look que les glass-inputs, mais le calendrier
 * qui s'ouvre est un popover stylé CRM (le popup natif de <input type="date">
 * n'est pas stylable). Semaine Lun→Dim, bornes min/max respectées.
 */
interface DatePickerInputProps {
  /** YYYY-MM-DD, ou '' (aucune date). */
  value: string;
  onChange: (date: string) => void;
  /** YYYY-MM-DD inclusif. */
  min?: string;
  /** YYYY-MM-DD inclusif. */
  max?: string;
  language?: 'en' | 'fr';
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}

const WEEKDAYS: Record<'en' | 'fr', string[]> = {
  en: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
  fr: ['L', 'M', 'M', 'J', 'V', 'S', 'D'],
};

function parseYmd(date: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || '');
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export default function DatePickerInput({
  value,
  onChange,
  min,
  max,
  language = 'en',
  className,
  placeholder,
  disabled,
}: DatePickerInputProps) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const locale = language === 'fr' ? 'fr-CA' : 'en-CA';

  // Month shown in the popover (defaults to the value, else min, else today).
  const initial = parseYmd(value) || parseYmd(min || '') || (() => {
    const now = new Date();
    return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
  })();
  const [viewYear, setViewYear] = useState(initial.y);
  const [viewMonth, setViewMonth] = useState(initial.m); // 1..12

  // Re-anchor the view on the current value each time the popover opens.
  const openPicker = () => {
    if (disabled) return;
    const anchor = parseYmd(value) || parseYmd(min || '') || initial;
    setViewYear(anchor.y);
    setViewMonth(anchor.m);
    // Open above when the popover would be clipped at the bottom of the screen.
    const rect = triggerRef.current?.getBoundingClientRect();
    setOpenUp(Boolean(rect && window.innerHeight - rect.bottom < 340 && rect.top > 340));
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = parseYmd(value);
  const today = new Date();
  const todayYmd = ymd(today.getFullYear(), today.getMonth() + 1, today.getDate());

  const inRange = (date: string) => (!min || date >= min) && (!max || date <= max);
  const monthLabel = useMemo(
    () => new Date(viewYear, viewMonth - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' }),
    [viewYear, viewMonth, locale]
  );
  // Grid cells: leading blanks (Monday-first week) + the month's days.
  const cells = useMemo(() => {
    const firstDow = (new Date(viewYear, viewMonth - 1, 1).getDay() + 6) % 7; // 0 = Monday
    const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
    return [
      ...Array.from({ length: firstDow }, () => null as number | null),
      ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
    ];
  }, [viewYear, viewMonth]);

  const shiftMonth = (delta: number) => {
    const idx = viewYear * 12 + (viewMonth - 1) + delta;
    setViewYear(Math.floor(idx / 12));
    setViewMonth((idx % 12) + 1);
  };
  // A neighbor month is reachable if any of its days can fall inside [min, max].
  const canShift = (delta: number) => {
    const idx = viewYear * 12 + (viewMonth - 1) + delta;
    const y = Math.floor(idx / 12);
    const m = (idx % 12) + 1;
    const first = ymd(y, m, 1);
    const last = ymd(y, m, new Date(y, m, 0).getDate());
    return (!max || first <= max) && (!min || last >= min);
  };

  const display = selected
    ? new Date(selected.y, selected.m - 1, selected.d).toLocaleDateString(locale, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : (placeholder || (language === 'fr' ? 'Choisir une date' : 'Pick a date'));

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openPicker())}
        className={cn(
          'glass-input w-full pl-10 text-left tabular-nums cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
          !selected && 'text-text-muted'
        )}
      >
        <CalendarDays
          size={15}
          className={cn(
            'absolute left-3 top-1/2 -translate-y-1/2 transition-colors',
            open ? 'text-primary' : 'text-text-tertiary'
          )}
        />
        <span className="capitalize">{display}</span>
      </button>

      {open && (
        <div
          className={cn(
            'absolute left-0 z-50 w-[280px] rounded-xl border border-outline bg-surface shadow-xl p-3',
            openUp ? 'bottom-full mb-2' : 'top-full mt-2'
          )}
        >
          {/* Month header + navigation */}
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              disabled={!canShift(-1)}
              className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors disabled:opacity-30 disabled:pointer-events-none"
              aria-label={language === 'fr' ? 'Mois précédent' : 'Previous month'}
            >
              <ChevronLeft size={15} />
            </button>
            <p className="text-[13px] font-semibold text-text-primary capitalize tabular-nums">{monthLabel}</p>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              disabled={!canShift(1)}
              className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors disabled:opacity-30 disabled:pointer-events-none"
              aria-label={language === 'fr' ? 'Mois suivant' : 'Next month'}
            >
              <ChevronRight size={15} />
            </button>
          </div>

          {/* Weekday initials, Monday-first */}
          <div className="grid grid-cols-7 mb-1">
            {WEEKDAYS[language].map((wd, i) => (
              <span key={i} className="h-7 flex items-center justify-center text-[10px] font-semibold uppercase text-text-tertiary">
                {wd}
              </span>
            ))}
          </div>

          {/* Days grid */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((day, i) => {
              if (day === null) return <span key={`b-${i}`} />;
              const date = ymd(viewYear, viewMonth, day);
              const isSelected = Boolean(selected && date === ymd(selected.y, selected.m, selected.d));
              const isToday = date === todayYmd;
              const enabled = inRange(date);
              return (
                <button
                  key={date}
                  type="button"
                  disabled={!enabled}
                  onClick={() => {
                    onChange(date);
                    setOpen(false);
                  }}
                  className={cn(
                    'h-8 w-8 mx-auto rounded-lg text-[12.5px] tabular-nums flex items-center justify-center transition-colors',
                    isSelected
                      ? 'bg-primary text-white font-semibold'
                      : enabled
                        ? 'text-text-primary hover:bg-surface-secondary'
                        : 'text-text-muted opacity-40 cursor-not-allowed',
                    isToday && !isSelected && 'font-semibold ring-1 ring-inset ring-outline-strong'
                  )}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
