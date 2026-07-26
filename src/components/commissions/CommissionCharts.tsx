import { useTranslation } from '../../i18n';
import UnifiedAvatar from '../ui/UnifiedAvatar';

/** $ formatter — compact for axis, full for values. */
export function fmtMoney(n: number): string {
  return '$' + Math.round(Number(n || 0)).toLocaleString('en-US');
}
function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1000) return '$' + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
  return '$' + Math.round(n);
}

/* ── Hero: big number + trend vs previous period + area sparkline ─────────── */

export function CommissionHero({
  label, value, deltaPct, deltaAbs, series, prevSeries, xLabels, note,
}: {
  label: string;
  value: number;
  deltaPct: number | null;   // % change vs previous period (null = no comparison)
  deltaAbs?: string;         // e.g. "+$1,130 vs $9,120"
  series: number[];          // cumulative this period
  prevSeries?: number[];     // cumulative previous period (dashed)
  xLabels: string[];
  note?: string;
}) {
  const up = (deltaPct ?? 0) >= 0;
  return (
    <div className="rounded-2xl border border-border bg-surface-card shadow-card">
      <div className="flex items-center justify-between px-5 pb-1 pt-4">
        <span className="text-[14px] font-bold tracking-tight text-text-primary">{label}</span>
        {note && <span className="text-[11px] text-text-tertiary">{note}</span>}
      </div>
      <div className="px-5 pb-5">
        <div className="text-[34px] font-extrabold leading-none tracking-tight text-success tabular-nums">{fmtMoney(value)}</div>
        {deltaPct != null && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
            <span className={'inline-flex items-center gap-1 rounded-pill px-2 py-0.5 font-bold tabular-nums ' + (up ? 'bg-success/10 text-success' : 'bg-error/10 text-error')}>
              {up ? '▲' : '▼'} {Math.abs(deltaPct).toFixed(1)}%
            </span>
            {deltaAbs && <span className="text-text-tertiary">{deltaAbs}</span>}
          </div>
        )}
        <div className="mt-4">
          <AreaChart series={series} prevSeries={prevSeries} xLabels={xLabels} />
        </div>
      </div>
    </div>
  );
}

/* ── Area chart (neutral fill, emphasized endpoint, optional comparison) ──── */

export function AreaChart({
  series, prevSeries, xLabels, height = 150,
}: { series: number[]; prevSeries?: number[]; xLabels: string[]; height?: number }) {
  const { language } = useTranslation();
  const W = 560, H = height;
  const all = [...series, ...(prevSeries ?? [])];
  const max = Math.max(...all, 1) * 1.15;
  const n = Math.max(series.length, 1);
  const x = (i: number) => (i / Math.max(n - 1, 1)) * W;
  const y = (v: number) => 8 + (1 - v / max) * (H - 8);
  // Courbe lissée (Catmull-Rom → Bézier) au lieu de segments en escalier.
  const smooth = (d: number[]) => {
    if (d.length < 2) return d.length ? `M ${x(0).toFixed(1)} ${y(d[0]).toFixed(1)}` : '';
    const pts = d.map((v, i) => [x(i), y(v)] as const);
    let p = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      p += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return p;
  };
  const toPath = smooth;
  const line = toPath(series);
  const areaPath = `${line} L ${W} ${H} L 0 ${H} Z`;
  const gid = 'car' + n + (series[0] | 0);
  const ex = x(n - 1), ey = y(series[series.length - 1] ?? 0);

  return (
    <div className="relative">
      <div className="absolute left-0 top-1.5 bottom-6 flex flex-col justify-between text-[9.5px] tabular-nums text-text-tertiary">
        <span>{fmtCompact(max)}</span><span>{fmtCompact(max / 2)}</span><span>$0</span>
      </div>
      <div className="ml-9">
        <svg viewBox={`0 0 ${W} ${H + 2}`} width="100%" height={height + 10} preserveAspectRatio="none" style={{ overflow: 'visible' }}>
          <defs>
            <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--color-success)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--color-success)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <line x1="0" y1={y(max / 2).toFixed(1)} x2={W} y2={y(max / 2).toFixed(1)} stroke="var(--color-border-light)" />
          <path d={areaPath} fill={`url(#${gid})`} />
          {prevSeries && (
            <path d={toPath(prevSeries)} fill="none" stroke="var(--color-text-tertiary)" strokeWidth="1.6" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          )}
          <path d={line} fill="none" stroke="var(--color-success)" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <circle cx={ex.toFixed(1)} cy={ey.toFixed(1)} r="3.5" fill="var(--color-success)" stroke="var(--color-surface-card)" strokeWidth="2" />
        </svg>
        <div className="mt-1 flex justify-between text-[9.5px] text-text-tertiary">
          {xLabels.map((l, i) => <span key={i}>{l}</span>)}
        </div>
        {prevSeries && (
          <div className="mt-1.5 flex gap-4">
            <span className="flex items-center gap-1.5 text-[11px] text-text-secondary"><span className="inline-block h-0.5 w-3.5 rounded" style={{ background: 'var(--color-primary)' }} />{language === 'fr' ? 'Cette période' : 'This period'}</span>
            <span className="flex items-center gap-1.5 text-[11px] text-text-secondary"><span className="inline-block h-0.5 w-3.5 rounded" style={{ background: 'var(--color-text-tertiary)' }} />{language === 'fr' ? 'Précédente' : 'Previous'}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Leaderboard: ranked reps with avatar + proportional bar ──────────────── */

export interface LeaderRep {
  userId: string;
  name: string;
  amount: number;
  deals: number;
}

export function RepLeaderboard({ reps, onSelect }: { reps: LeaderRep[]; onSelect?: (userId: string) => void }) {
  const { language } = useTranslation();
  const max = Math.max(...reps.map((r) => r.amount), 1);
  if (reps.length === 0) {
    return <p className="py-8 text-center text-[12px] text-text-tertiary">{language === 'fr' ? 'Aucune donnée' : 'No data'}</p>;
  }
  return (
    <div>
      {reps.map((r, i) => (
        <button
          key={r.userId}
          onClick={() => onSelect?.(r.userId)}
          className="flex w-full items-center gap-3 border-b border-border-light py-2.5 text-left last:border-b-0 hover:bg-surface-secondary"
        >
          <span className={'w-4 text-center text-[12px] font-extrabold tabular-nums ' + (i === 0 ? 'text-warning' : 'text-text-tertiary')}>{i + 1}</span>
          <UnifiedAvatar id={r.userId} name={r.name} size={32} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-semibold text-text-primary">{r.name}</span>
            <span className="mt-1.5 block h-1.5 overflow-hidden rounded-pill bg-surface-tertiary/60">
              <span className="block h-full rounded-pill" style={{ width: `${(r.amount / max) * 100}%`, background: i === 0 ? 'var(--color-success)' : 'color-mix(in srgb, var(--color-success) 55%, var(--color-text-tertiary))' }} />
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block text-[13px] font-bold text-success tabular-nums">{fmtMoney(r.amount)}</span>
            <span className="block text-[10px] text-text-tertiary">{r.deals} {language === 'fr' ? 'ventes' : 'deals'}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/* ── Donut: status breakdown (paid / pending / reversed) ──────────────────── */

export interface DonutSeg { label: string; value: number; color: string; }

export function StatusDonut({ segments, centerLabel }: { segments: DonutSeg[]; centerLabel: string }) {
  const R = 52, C = 2 * Math.PI * R;
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  let off = 0;
  return (
    <div className="flex items-center gap-5">
      <div className="relative h-[120px] w-[120px] flex-none">
        <svg width="120" height="120" viewBox="0 0 120 120">
          {segments.map((s, i) => {
            const len = (s.value / total) * C;
            const el = (
              <circle key={i} cx="60" cy="60" r={R} fill="none" stroke={s.color} strokeWidth="14"
                strokeDasharray={`${len.toFixed(1)} ${(C - len).toFixed(1)}`} strokeDashoffset={(-off).toFixed(1)}
                transform="rotate(-90 60 60)" />
            );
            off += len;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <b className="text-[17px] font-extrabold tracking-tight tabular-nums text-text-primary">{fmtMoney(total)}</b>
          <span className="text-[9px] uppercase tracking-wider text-text-tertiary">{centerLabel}</span>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2.5">
        {segments.map((s, i) => (
          <div key={i} className="flex items-center justify-between text-[12px]">
            <span className="flex items-center gap-2 text-text-secondary">
              <span className="h-2.5 w-2.5 rounded" style={{ background: s.color }} />{s.label}
            </span>
            <span className="font-bold tabular-nums text-text-primary">{fmtMoney(s.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── KPI card with trend chip ─────────────────────────────────────────────── */

export function KpiCard({ label, value, money, trend, note }: {
  label: string; value: string; money?: boolean;
  trend?: { dir: 'up' | 'down' | 'flat'; text: string }; note?: string;
}) {
  const arrow = trend?.dir === 'up' ? '▲' : trend?.dir === 'down' ? '▼' : '—';
  const trendCls = trend?.dir === 'up' ? 'text-success' : trend?.dir === 'down' ? 'text-error' : 'text-text-tertiary';
  return (
    <div className="rounded-xl border border-border bg-surface-card p-4 shadow-card">
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-text-tertiary">{label}</div>
      <div className={'mt-1.5 text-[20px] font-bold tracking-tight tabular-nums ' + (money ? 'text-success' : 'text-text-primary')}>{value}</div>
      <div className="mt-2 flex items-center justify-between">
        {trend && <span className={'text-[10.5px] font-bold tabular-nums ' + trendCls}>{arrow} {trend.text}</span>}
        {note && <span className="text-[10.5px] text-text-tertiary">{note}</span>}
      </div>
    </div>
  );
}
