/**
 * Revenue trend — area chart over the selected period, wired to the real
 * fetchInsightsRevenueSeries RPC. Hero total + delta, crosshair tooltip.
 * Monochrome shell, one indigo data hue (var(--color-text-primary)).
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchInsightsRevenueSeries } from '../../lib/insightsApi';
import { useTranslation } from '../../i18n';
import PeriodSelector from './PeriodSelector';
import { type InsightsPeriod, type InsightsRange } from '../../lib/insightsPeriod';

const W = 1000;
const H = 320;
const TOP = 16;

function niceMax(m: number): number {
  if (m <= 0) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(m)));
  const f = m / e;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return n * e;
}

export default function RevenueTrendCard({
  range,
  period,
  onPeriod,
  deltaPct,
}: {
  range: InsightsRange;
  period: InsightsPeriod;
  onPeriod: (p: InsightsPeriod) => void;
  deltaPct?: number | null;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const locale = fr ? 'fr-CA' : 'en-CA';
  const [hover, setHover] = useState<number | null>(null);

  const q = useQuery({
    queryKey: ['rev-trend', range.from, range.to, range.granularity],
    queryFn: () => fetchInsightsRevenueSeries({ from: range.from, to: range.to, granularity: range.granularity }),
    staleTime: 60_000,
  });

  const money = (cents: number) =>
    new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', notation: 'compact', maximumFractionDigits: 1 }).format((cents || 0) / 100);
  const moneyFull = (cents: number) =>
    new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format((cents || 0) / 100);

  const model = useMemo(() => {
    const pts = q.data || [];
    const vals = pts.map((p) => p.revenue_cents || 0);
    const total = vals.reduce((a, b) => a + b, 0);
    const max = niceMax(Math.max(1, ...vals));
    const n = vals.length;
    const co = vals.map((v, i) => ({
      x: n > 1 ? (i / (n - 1)) * W : W / 2,
      y: TOP + (H - TOP) * (1 - v / max),
    }));
    const line = co.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const area = co.length ? `${line} L${co[co.length - 1].x.toFixed(1)},${H} L${co[0].x.toFixed(1)},${H} Z` : '';
    const labels = pts.map((p) => {
      const d = new Date(p.bucket_start);
      return range.granularity === 'week'
        ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(d)
        : new Intl.DateTimeFormat(locale, { month: 'short' }).format(d);
    });
    return { pts, vals, total, max, co, line, area, labels, n };
  }, [q.data, range.granularity, locale]);

  const grid = [0, 1, 2, 3].map((s) => TOP + (H - TOP) * (s / 3));
  const hIdx = hover != null && hover >= 0 && hover < model.n ? hover : null;

  return (
    <div className="flex flex-col">
      <div className="flex items-end justify-between gap-3 px-6 pb-3 border-b border-border">
        <div>
          <div className="text-[13px] font-semibold uppercase tracking-wide text-text-tertiary leading-none">{fr ? 'Revenu' : 'Revenue'}</div>
          <div className="flex items-baseline gap-3 mt-3">
            <span className="text-[34px] font-bold tracking-tight leading-none tabular-nums text-text-primary">{money(model.total)}</span>
            {deltaPct != null && !Number.isNaN(deltaPct) && (
              <span className="text-[13px] font-bold text-text-secondary">
                {deltaPct >= 0 ? '↑' : '↓'} {Math.abs(Math.round(deltaPct))}%
              </span>
            )}
          </div>
        </div>
        <PeriodSelector value={period} onChange={onPeriod} />
      </div>

      {q.isLoading ? (
        <div className="h-[250px] mx-6 mt-4 rounded-lg bg-surface-secondary/40 animate-pulse" />
      ) : model.n === 0 ? (
        <div className="h-[250px] flex items-center justify-center text-[12.5px] text-text-tertiary">{fr ? 'Aucune donnée sur la période' : 'No data for this period'}</div>
      ) : (
        <div className="flex gap-3 px-6 pt-4 pb-1">
          <div className="flex flex-col justify-between text-right min-w-[42px] h-[230px] pb-[22px]">
            {[4, 3, 2, 1, 0].map((s) => (
              <span key={s} className="text-[10px] font-semibold text-text-tertiary leading-none tabular-nums">{money((model.max * s) / 4)}</span>
            ))}
          </div>
          <div className="relative flex-1 h-[230px]">
            <div className="absolute inset-x-0 top-0 bottom-[22px]">
              <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full block overflow-visible">
                {grid.map((y, i) => (
                  <line key={i} x1={0} y1={y} x2={W} y2={y} stroke={i === 3 ? 'var(--color-border)' : 'var(--color-border-light)'} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                ))}
                <defs>
                  <linearGradient id="revfill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-text-primary)" stopOpacity="0.14" />
                    <stop offset="100%" stopColor="var(--color-text-primary)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {model.area && <path d={model.area} fill="url(#revfill)" />}
                <path d={model.line} fill="none" stroke="var(--color-text-primary)" strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              </svg>
            </div>

            {hIdx != null && (
              <>
                <div className="absolute top-0 bottom-[22px] w-px bg-border" style={{ left: `${(model.co[hIdx].x / W) * 100}%` }} />
                <div
                  className="absolute w-[9px] h-[9px] rounded-full -translate-x-1/2 -translate-y-1/2 border-2 border-surface-card"
                  style={{ left: `${(model.co[hIdx].x / W) * 100}%`, top: `${(model.co[hIdx].y / H) * 100}%`, background: 'var(--color-text-primary)' }}
                />
                <div
                  className="absolute z-10 -translate-x-1/2 -translate-y-full -mt-3.5 rounded-xl border border-border bg-surface-card shadow-xl px-3 py-2.5 pointer-events-none whitespace-nowrap"
                  style={{ left: `${Math.min(86, Math.max(14, (model.co[hIdx].x / W) * 100))}%`, top: `${(model.co[hIdx].y / H) * 100}%` }}
                >
                  <div className="text-[9.5px] uppercase tracking-wide text-text-tertiary font-bold mb-1.5">{model.labels[hIdx]}</div>
                  <div className="flex items-center gap-2 text-[12px] text-text-secondary">
                    <span className="w-3 h-[2.5px] rounded" style={{ background: 'var(--color-text-primary)' }} />
                    {fr ? 'Revenu' : 'Revenue'}
                    <b className="ml-5 text-text-primary tabular-nums">{moneyFull(model.vals[hIdx])}</b>
                  </div>
                </div>
              </>
            )}

            <div className="absolute inset-x-0 bottom-0 flex justify-between text-[10px] font-semibold text-text-tertiary">
              {model.labels.map((l, i) => {
                const step = Math.ceil(model.n / 7);
                return (
                  <span key={i} className="flex-1 text-center" style={{ visibility: i % step ? 'hidden' : 'visible' }}>{l}</span>
                );
              })}
            </div>

            <div
              className="absolute inset-x-0 top-0 bottom-[22px] cursor-crosshair"
              onMouseMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
                setHover(Math.round(frac * (model.n - 1)));
              }}
              onMouseLeave={() => setHover(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
