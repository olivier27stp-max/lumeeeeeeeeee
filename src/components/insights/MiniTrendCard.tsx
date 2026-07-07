/**
 * Compact area trend (valeur moyenne d'un job, MRR) — ported from the approved
 * prototype's mini chart. Monochrome (text-primary ink), hero + delta, crosshair
 * tooltip, borderless header with the shared period selector.
 */
import { useMemo, useState } from 'react';
import PeriodSelector from './PeriodSelector';
import { type InsightsPeriod } from '../../lib/insightsPeriod';

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

export interface MiniSeries {
  labels: string[];
  vals: number[];
}

export default function MiniTrendCard({
  title,
  data,
  period,
  onPeriod,
  derive,
  fmt,
}: {
  title: string;
  data: Record<InsightsPeriod, MiniSeries>;
  period: InsightsPeriod;
  onPeriod: (p: InsightsPeriod) => void;
  derive: (vals: number[]) => { hero: string; delta: string; sub: string };
  fmt: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const model = useMemo(() => {
    const s = data[period];
    const vals = s.vals;
    const max = niceMax(Math.max(1, ...vals));
    const n = vals.length;
    const co = vals.map((v, i) => ({ x: n > 1 ? (i / (n - 1)) * W : W / 2, y: TOP + (H - TOP) * (1 - v / max) }));
    const line = co.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const area = co.length ? `${line} L${co[co.length - 1].x.toFixed(1)},${H} L${co[0].x.toFixed(1)},${H} Z` : '';
    return { labels: s.labels, vals, co, line, area, n, ...derive(vals) };
  }, [data, period, derive]);

  const grid = [0, 1, 2, 3].map((s) => TOP + (H - TOP) * (s / 3));
  const hIdx = hover != null && hover >= 0 && hover < model.n ? hover : null;

  return (
    <div className="flex flex-col">
      <div className="flex items-end justify-between gap-3 px-6 pb-3 border-b border-border">
        <div>
          <div className="text-[13px] font-semibold uppercase tracking-wide text-text-tertiary leading-none">{title}</div>
          <div className="flex items-baseline gap-3 mt-3">
            <span className="text-[30px] font-bold tracking-tight leading-none tabular-nums text-text-primary">{model.hero}</span>
            {model.delta && <span className="text-[13px] font-bold text-text-secondary">{model.delta}</span>}
          </div>
          <div className="text-[12px] text-text-tertiary font-medium mt-2">{model.sub}</div>
        </div>
        <PeriodSelector value={period} onChange={onPeriod} />
      </div>

      <div className="relative h-[172px] mx-6 mt-4 mb-1">
        <div className="absolute inset-x-0 top-0 bottom-5">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full block overflow-visible">
            {grid.map((y, i) => (
              <line key={i} x1={0} y1={y} x2={W} y2={y} stroke={i === 3 ? 'var(--color-border)' : 'var(--color-border-light)'} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            <defs>
              <linearGradient id={`mfill-${title}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-text-primary)" stopOpacity="0.09" />
                <stop offset="100%" stopColor="var(--color-text-primary)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {model.area && <path d={model.area} fill={`url(#mfill-${title})`} />}
            <path d={model.line} fill="none" stroke="var(--color-text-primary)" strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>

        {hIdx != null && (
          <>
            <div className="absolute top-0 bottom-5 w-px bg-border" style={{ left: `${(model.co[hIdx].x / W) * 100}%` }} />
            <div className="absolute w-[9px] h-[9px] rounded-full -translate-x-1/2 -translate-y-1/2 border-2 border-surface-card" style={{ left: `${(model.co[hIdx].x / W) * 100}%`, top: `${(model.co[hIdx].y / H) * 100}%`, background: 'var(--color-text-primary)' }} />
            <div className="absolute z-10 -translate-x-1/2 -translate-y-full -mt-3 rounded-xl border border-border bg-surface-card shadow-xl px-3 py-2.5 pointer-events-none whitespace-nowrap" style={{ left: `${Math.min(86, Math.max(14, (model.co[hIdx].x / W) * 100))}%`, top: `${(model.co[hIdx].y / H) * 100}%` }}>
              <div className="text-[9.5px] uppercase tracking-wide text-text-tertiary font-bold mb-1.5">{model.labels[hIdx]}</div>
              <div className="flex items-center gap-2 text-[12px] text-text-secondary">
                <span className="w-3 h-[2.5px] rounded" style={{ background: 'var(--color-text-primary)' }} />
                {title}
                <b className="ml-5 text-text-primary tabular-nums">{fmt(model.vals[hIdx])}</b>
              </div>
            </div>
          </>
        )}

        <div className="absolute inset-x-0 bottom-0 flex text-[10px] font-semibold text-text-tertiary">
          {model.labels.map((l, i) => {
            const step = Math.ceil(model.n / 6);
            return <span key={i} className="flex-1 text-center" style={{ visibility: i % step ? 'hidden' : 'visible' }}>{l}</span>;
          })}
        </div>

        <div
          className="absolute inset-x-0 top-0 bottom-5 cursor-crosshair"
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
            setHover(Math.round(frac * (model.n - 1)));
          }}
          onMouseLeave={() => setHover(null)}
        />
      </div>
    </div>
  );
}
