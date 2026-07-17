import { useQuery } from '@tanstack/react-query';
import { fetchInsightsRevenueSeries } from '../../lib/insightsApi';
import { useTranslation } from '../../i18n';

function kMoney(cents: number) {
  const d = (cents || 0) / 100;
  if (Math.abs(d) >= 1000) return `$${(d / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `$${Math.round(d)}`;
}

/** Jobber-style Revenue card: current year vs previous year, by month. */
export default function RevenueYearCompareCard() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const now = new Date();
  const curYear = now.getFullYear();
  const prevYear = curYear - 1;
  const from = `${prevYear}-01-01`;
  const to = now.toISOString().slice(0, 10);

  const { data, isLoading } = useQuery({
    queryKey: ['revenue-year-compare', from, to],
    queryFn: () => fetchInsightsRevenueSeries({ from, to, granularity: 'month' }),
    staleTime: 60_000,
  });

  const series = data || [];
  const months = Array.from({ length: 12 }, () => ({ cur: 0, prev: 0 }));
  for (const row of series) {
    const d = new Date(`${(row as any).bucket_start}T00:00:00`);
    const m = d.getMonth();
    const y = d.getFullYear();
    const v = Number((row as any).revenue_cents || 0);
    if (y === curYear) months[m].cur += v;
    else if (y === prevYear) months[m].prev += v;
  }
  const totalCur = months.reduce((s, x) => s + x.cur, 0);
  const totalPrev = months.reduce((s, x) => s + x.prev, 0);
  const max = Math.max(1, ...months.flatMap((x) => [x.cur, x.prev]));
  const labels = fr
    ? ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc']
    : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return (
    <div className="rounded-xl border border-border bg-surface-card flex flex-col overflow-hidden">
      <div className="flex items-start justify-between px-5 pt-4 pb-2">
        <div className="flex gap-8">
          <div>
            <div className="text-[12px] font-medium text-text-secondary flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--color-text-tertiary)' }} />{prevYear}
            </div>
            <div className="text-[22px] font-extrabold text-text-primary tabular-nums tracking-tight mt-1">{kMoney(totalPrev)}</div>
          </div>
          <div>
            <div className="text-[12px] font-medium text-text-secondary flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--color-chart-primary)' }} />{curYear}
            </div>
            <div className="text-[22px] font-extrabold text-text-primary tabular-nums tracking-tight mt-1">{kMoney(totalCur)}</div>
          </div>
        </div>
        <span className="text-[11.5px] text-text-tertiary font-medium">{prevYear} – {curYear}</span>
      </div>

      {isLoading ? (
        <div className="px-5 pb-5"><div className="h-[220px] bg-surface-tertiary/50 rounded-lg animate-pulse" /></div>
      ) : (
        <div className="px-5 pb-4">
          <div className="flex items-end gap-2 h-[220px] pt-2">
            {months.map((x, i) => (
              <div key={i} className="flex-1 flex flex-col items-center justify-end h-full gap-1.5">
                <div className="flex items-end justify-center gap-[3px] w-full h-full">
                  <span className="w-2.5 rounded-t-[3px]" style={{ height: `${(x.prev / max) * 100}%`, background: 'var(--color-text-tertiary)' }} />
                  <span className="w-2.5 rounded-t-[3px]" style={{ height: `${(x.cur / max) * 100}%`, background: 'var(--color-chart-primary)' }} />
                </div>
                <span className="text-[10px] text-text-muted font-semibold">{labels[i]}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
