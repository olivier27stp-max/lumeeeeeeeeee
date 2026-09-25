import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Période en UNE case : « Du 1 sept. 2026 au 30 sept. 2026 ». Le calendrier
 * qui s'ouvre prend deux clics : la date de début, puis la date de fin (dans
 * n'importe quel ordre, on remet dans le bon sens). Même look que
 * DatePickerInput (glass-input + popover CRM, semaine Lun→Dim).
 */
interface DateRangeInputProps {
  /** YYYY-MM-DD ou '' */
  from: string;
  /** YYYY-MM-DD ou '' */
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  language?: 'en' | 'fr';
  className?: string;
  placeholder?: string;
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

export default function DateRangeInput({ from, to, onChange, language = 'en', className, placeholder }: DateRangeInputProps) {
  const fr = language === 'fr';
  const locale = fr ? 'fr-CA' : 'en-CA';
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  /** Premier clic en attente du second. */
  const [pending, setPending] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const now = new Date();
  const todayYmd = ymd(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const anchorOf = () => parseYmd(from) || parseYmd(to) || { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
  const [viewYear, setViewYear] = useState(anchorOf().y);
  const [viewMonth, setViewMonth] = useState(anchorOf().m);

  const openPicker = () => {
    const a = anchorOf();
    setViewYear(a.y);
    setViewMonth(a.m);
    setPending(null);
    const rect = triggerRef.current?.getBoundingClientRect();
    setOpenUp(Boolean(rect && window.innerHeight - rect.bottom < 360 && rect.top > 360));
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) { setOpen(false); setPending(null); }
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); setPending(null); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const fmt = (date: string) => {
    const p = parseYmd(date);
    return p ? new Date(p.y, p.m - 1, p.d).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  };
  const display = from || to
    ? (fr ? `Du ${fmt(from) || '…'} au ${fmt(to) || '…'}` : `${fmt(from) || '…'} to ${fmt(to) || '…'}`)
    : (placeholder || (fr ? 'Période' : 'Period'));

  const monthLabel = useMemo(
    () => new Date(viewYear, viewMonth - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' }),
    [viewYear, viewMonth, locale],
  );
  const cells = useMemo(() => {
    const firstDow = (new Date(viewYear, viewMonth - 1, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
    return [...Array.from({ length: firstDow }, () => null as number | null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  }, [viewYear, viewMonth]);

  const shiftMonth = (delta: number) => {
    const idx = viewYear * 12 + (viewMonth - 1) + delta;
    setViewYear(Math.floor(idx / 12));
    setViewMonth((idx % 12) + 1);
  };

  // Plage affichée : la vraie plage, ou l'aperçu premier clic → survol.
  const [lo, hi] = pending
    ? [pending, hover || pending].sort()
    : [from, to];
  const inShown = (date: string) => Boolean(lo && hi && date >= lo && date <= hi);

  const pick = (date: string) => {
    if (!pending) { setPending(date); setHover(date); return; }
    const [a, b] = [pending, date].sort();
    setPending(null);
    setOpen(false);
    onChange({ from: a, to: b });
  };

  const clear = (event: React.MouseEvent) => {
    event.stopPropagation();
    setPending(null);
    onChange({ from: '', to: '' });
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPicker())}
        aria-label={fr ? 'Choisir la période' : 'Pick the period'}
        className={cn('glass-input w-full pl-10 pr-8 text-left tabular-nums cursor-pointer whitespace-nowrap', !(from || to) && 'text-text-muted')}
      >
        <CalendarDays size={15} className={cn('absolute left-3 top-1/2 -translate-y-1/2 transition-colors', open ? 'text-primary' : 'text-text-tertiary')} />
        <span>{display}</span>
      </button>
      {(from || to) && (
        <button
          type="button"
          onClick={clear}
          aria-label={fr ? 'Effacer la période' : 'Clear the period'}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-text-tertiary hover:text-text-primary focus-visible:ring-1 focus-visible:ring-[#94a3b8]"
        >
          <X size={13} />
        </button>
      )}

      {open && (
        <div className={cn('absolute left-0 z-50 w-[280px] rounded-xl border border-outline bg-surface shadow-xl p-3', openUp ? 'bottom-full mb-2' : 'top-full mt-2')}>
          <p className="text-[11px] text-text-tertiary mb-2">
            {pending
              ? (fr ? `Début : ${fmt(pending)} — choisis la fin` : `Start: ${fmt(pending)} — pick the end`)
              : (fr ? 'Clique la date de début, puis la date de fin' : 'Click the start date, then the end date')}
          </p>
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => shiftMonth(-1)} aria-label={fr ? 'Mois précédent' : 'Previous month'}
              className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors">
              <ChevronLeft size={15} />
            </button>
            <p className="text-[13px] font-semibold text-text-primary capitalize tabular-nums">{monthLabel}</p>
            <button type="button" onClick={() => shiftMonth(1)} aria-label={fr ? 'Mois suivant' : 'Next month'}
              className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors">
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="grid grid-cols-7 mb-1">
            {WEEKDAYS[language].map((wd, i) => (
              <span key={i} className="h-7 flex items-center justify-center text-[10px] font-semibold uppercase text-text-tertiary">{wd}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5" onMouseLeave={() => setHover(null)}>
            {cells.map((day, i) => {
              if (day === null) return <span key={`b-${i}`} />;
              const date = ymd(viewYear, viewMonth, day);
              const isEdge = date === lo || date === hi;
              const isIn = inShown(date);
              const isToday = date === todayYmd;
              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => pick(date)}
                  onMouseEnter={() => { if (pending) setHover(date); }}
                  className={cn(
                    'h-8 w-full rounded-lg text-[12.5px] tabular-nums flex items-center justify-center transition-colors',
                    isEdge ? 'bg-primary text-white font-semibold'
                      : isIn ? 'bg-primary/15 text-text-primary'
                        : 'text-text-primary hover:bg-surface-secondary',
                    isToday && !isEdge && 'font-semibold ring-1 ring-inset ring-outline-strong',
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
