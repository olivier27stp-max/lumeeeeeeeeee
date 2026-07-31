/**
 * Revenue by service — donut wired to fetchTopServices (sum of job total_cents
 * per title, top 3 + "Other"). One indigo hue at decreasing opacity (sequential,
 * monochrome-friendly). Hover a segment/row → the donut center shows its detail.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchTopServices } from '../../lib/insightsApi';
import { useTranslation } from '../../i18n';
import PeriodSelector from './PeriodSelector';
import { type InsightsPeriod, type InsightsRange } from '../../lib/insightsPeriod';

const R = 15.9;
const C = 2 * Math.PI * R;
const GAP = 1.2;
const OPACITY = [1, 0.6, 0.38, 0.22];

export default function ServiceMixCard({
  range,
  period,
  onPeriod,
}: {
  range: InsightsRange;
  period: InsightsPeriod;
  onPeriod: (p: InsightsPeriod) => void;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [active, setActive] = useState<number | null>(null);

  const q = useQuery({
    queryKey: ['svc-mix', range.from, range.to],
    queryFn: () => fetchTopServices({ from: range.from, to: range.to }),
    staleTime: 60_000,
  });

  const money = (cents: number) =>
    new Intl.NumberFormat(fr ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD', notation: 'compact', maximumFractionDigits: 1 }).format((cents || 0) / 100);

  const { segs, total } = useMemo(() => {
    const data = (q.data || []).slice(0, 4);
    const tot = data.reduce((a, s) => a + (s.value || 0), 0);
    let acc = 0;
    const segs = data.map((s, i) => {
      const pct = tot > 0 ? (s.value / tot) * 100 : 0;
      const seg = Math.max(0, (pct / 100) * C - GAP);
      const off = -(acc / 100) * C;
      acc += pct;
      const label = s.name === 'Other' ? (fr ? 'Autre' : 'Other') : s.name;
      return { name: label, value: s.value, pct, dash: seg, off, op: OPACITY[i] ?? 0.22 };
    });
    return { segs, total: tot };
  }, [q.data, fr]);

  const detail = active != null && segs[active] ? segs[active] : null;

  return (
    <div className="flex flex-col">
      <div className="flex items-end justify-between gap-3 px-6 pb-3 border-b border-border">
        <div className="text-[13px] font-semibold uppercase tracking-wide text-text-tertiary leading-none">{fr ? 'Revenu par service' : 'Revenue by service'}</div>
        <PeriodSelector value={period} onChange={onPeriod} />
      </div>

      {q.isLoading ? (
        <div className="h-[200px] mx-6 mt-4 rounded-lg bg-surface-secondary/40 animate-pulse" />
      ) : segs.length === 0 ? (
        <div className="h-[200px] flex items-center justify-center text-[12.5px] text-text-tertiary">{fr ? 'Aucune donnée' : 'No data'}</div>
      ) : (
        <div className="flex items-center gap-6 px-6 pt-4 pb-6">
          <div className="relative w-[168px] h-[168px] shrink-0">
            <svg width="168" height="168" viewBox="0 0 42 42" className="-rotate-90">
              <circle cx="21" cy="21" r={R} fill="none" stroke="var(--color-surface-tertiary, #ededea)" strokeWidth={5} />
              {segs.map((s, i) => (
                <circle
                  key={i}
                  cx="21"
                  cy="21"
                  r={R}
                  fill="none"
                  stroke="var(--color-text-primary)"
                  strokeOpacity={active == null || active === i ? s.op : s.op * 0.3}
                  strokeWidth={5}
                  strokeLinecap="round"
                  strokeDasharray={`${s.dash.toFixed(2)} ${(C - s.dash).toFixed(2)}`}
                  strokeDashoffset={s.off.toFixed(2)}
                  className="transition-opacity duration-150 cursor-pointer"
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                />
              ))}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-5 pointer-events-none">
              {detail ? (
                <>
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-text-secondary mb-1.5 max-w-full">
                    <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: 'var(--color-text-primary)', opacity: detail.op }} />
                    <span className="truncate">{detail.name}</span>
                  </div>
                  <div className="text-[23px] font-bold tracking-tight leading-none tabular-nums text-text-primary">{money(detail.value)}</div>
                  <div className="text-[10.5px] font-semibold uppercase tracking-wide text-text-tertiary mt-1.5">{Math.round(detail.pct)}% {fr ? 'du total' : 'of total'}</div>
                </>
              ) : (
                <>
                  <div className="text-[23px] font-bold tracking-tight leading-none tabular-nums text-text-primary">{money(total)}</div>
                  <div className="text-[10.5px] font-semibold uppercase tracking-wide text-text-tertiary mt-1.5">Total</div>
                </>
              )}
            </div>
          </div>

          <div className="flex-1 flex flex-col min-w-0">
            {segs.map((s, i) => (
              <div
                key={i}
                className="flex items-center gap-3 py-2.5 border-b border-border-light last:border-0 cursor-pointer rounded-md -mx-2 px-2 hover:bg-surface-secondary transition-colors"
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
              >
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: 'var(--color-text-primary)', opacity: s.op }} />
                <span className="text-[13px] font-semibold text-text-primary truncate">{s.name}</span>
                <span className="ml-auto text-[13px] font-bold text-text-primary tabular-nums">{money(s.value)}</span>
                <span className="text-[12px] text-text-tertiary font-semibold tabular-nums w-9 text-right">{Math.round(s.pct)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
