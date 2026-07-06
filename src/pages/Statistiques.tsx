/**
 * Statistiques (/insights) — rebuilt from the approved prototype.
 * Jobber-style sections (Overview · Revenue · Conversion · Jobs), monochrome
 * with one indigo data hue, wired to real data over the last 90 days.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import {
  fetchInsightsOverview,
  fetchPeriodComparison,
  fetchTeamPerformance,
  type TeamPerformance,
} from '../lib/insightsApi';

import RevenueYearCompareCard from '../components/insights/RevenueYearCompareCard';
import RecurringVsOneOffCard from '../components/insights/RecurringVsOneOffCard';
import QuoteConversionCard from '../components/insights/QuoteConversionCard';
import ClientLifetimeValueCard from '../components/insights/ClientLifetimeValueCard';
import AverageJobValueCard from '../components/insights/AverageJobValueCard';
import TopServicesByCountCard from '../components/insights/TopServicesByCountCard';
import JobsPerWeekdayCard from '../components/insights/JobsPerWeekdayCard';

function toIso(d: Date) {
  return d.toISOString().slice(0, 10);
}

function fmtMoney(cents: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD', notation: 'compact', maximumFractionDigits: 1 }).format((cents || 0) / 100);
}

/* ── Overview KPI strip (one card, six columns) ── */
function DeltaPill({ pct }: { pct?: number | null }) {
  if (pct === undefined || pct === null || Number.isNaN(pct)) {
    return <span className="text-[10.5px] font-bold text-text-tertiary bg-surface-secondary rounded-full px-2 py-0.5">0%</span>;
  }
  const down = pct < 0;
  return (
    <span className={cn('text-[10.5px] font-bold rounded-full px-2 py-0.5 bg-surface-secondary whitespace-nowrap', down ? 'text-danger' : 'text-text-secondary')}>
      {down ? '↓' : '↑'} {Math.abs(Math.round(pct))}%
    </span>
  );
}

function OverviewStrip({ items }: { items: Array<{ label: string; value: string; pct?: number | null }> }) {
  return (
    <div className="bg-surface-card border border-border rounded-xl grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 divide-x divide-y xl:divide-y-0 divide-border-light overflow-hidden">
      {items.map((k) => (
        <div key={k.label} className="p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold text-text-secondary leading-tight">{k.label}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5 text-text-tertiary shrink-0"><path d="M7 17L17 7M17 7H8M17 7v9" /></svg>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <span className="text-[24px] font-extrabold text-text-primary tabular-nums tracking-tight leading-none">{k.value}</span>
            <DeltaPill pct={k.pct} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Lead funnel (Overview counts) ── */
function LeadFunnelCard({ title, hint, stages }: { title: string; hint: string; stages: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  return (
    <div className="bg-surface-card border border-border rounded-xl flex flex-col overflow-hidden h-full">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border-light">
        <h3 className="text-[14px] font-bold text-text-primary">{title}</h3>
        <span className="text-[11.5px] text-text-tertiary font-medium">{hint}</span>
      </div>
      <div className="flex items-end gap-3 h-[180px] px-5 pb-5 pt-4">
        {stages.map((s, i) => (
          <div key={i} className="flex-1 flex flex-col items-center justify-end h-full gap-2">
            <div
              className="w-4/5 max-w-[90px] rounded-t-md flex items-start justify-center text-white font-extrabold text-[15px] pt-1.5 tabular-nums"
              style={{ height: `${Math.max(10, (s.value / max) * 100)}%`, background: 'var(--color-chart-primary)' }}
            >
              {s.value}
            </div>
            <span className="text-[11px] text-text-muted font-semibold text-center leading-tight">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Top teams table ── */
function TopTeamCard({ title, hint, teams, loading, fr }: { title: string; hint: string; teams: TeamPerformance[]; loading?: boolean; fr: boolean }) {
  const rows = [...teams].sort((a, b) => b.revenue_cents - a.revenue_cents).slice(0, 5);
  return (
    <div className="bg-surface-card border border-border rounded-xl flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border-light">
        <h3 className="text-[14px] font-bold text-text-primary">{title}</h3>
        <span className="text-[11.5px] text-text-tertiary font-medium">{hint}</span>
      </div>
      {loading ? (
        <div className="p-5 space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-8 bg-surface-tertiary/50 rounded animate-pulse" />)}</div>
      ) : rows.length === 0 ? (
        <div className="py-10 text-center text-[12.5px] text-text-tertiary">{fr ? 'Aucune donnée' : 'No data'}</div>
      ) : (
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wide text-text-tertiary">
              <th className="text-left font-bold px-5 py-2.5 bg-surface-secondary border-b border-border">{fr ? 'Équipe' : 'Team'}</th>
              <th className="text-right font-bold px-5 py-2.5 bg-surface-secondary border-b border-border">Jobs</th>
              <th className="text-right font-bold px-5 py-2.5 bg-surface-secondary border-b border-border">{fr ? 'Valeur totale' : 'Total value'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((tm) => (
              <tr key={tm.team_id} className="hover:bg-surface-secondary">
                <td className="px-5 py-3 font-semibold text-text-primary border-b border-border-light">{tm.team_name}</td>
                <td className="px-5 py-3 text-right text-text-muted tabular-nums border-b border-border-light">{tm.jobs_count}</td>
                <td className="px-5 py-3 text-right font-bold text-text-primary tabular-nums border-b border-border-light">{fmtMoney(tm.revenue_cents, fr ? 'fr-CA' : 'en-CA')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ── Section header ── */
function SectionHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-3 mb-3 mt-8 first:mt-0">
      <h2 className="text-[18px] font-bold text-text-primary tracking-tight">{title}</h2>
      {hint && <span className="text-[12px] text-text-tertiary font-semibold">{hint}</span>}
    </div>
  );
}

export default function Statistiques() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const locale = fr ? 'fr-CA' : 'en-CA';

  const { from, to } = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 90);
    return { from: toIso(start), to: toIso(now) };
  }, []);

  const overviewQ = useQuery({ queryKey: ['stats-overview', from, to], queryFn: () => fetchInsightsOverview({ from, to }), staleTime: 60_000 });
  const comparisonQ = useQuery({ queryKey: ['stats-comparison', from, to], queryFn: () => fetchPeriodComparison({ from, to }), staleTime: 60_000 });
  const teamPerfQ = useQuery({ queryKey: ['stats-teamperf', from, to], queryFn: () => fetchTeamPerformance({ from, to }), staleTime: 60_000 });

  const overview = overviewQ.data;
  const comparisons = comparisonQ.data || [];
  const cmp = (metric: string): number | null => {
    const row = comparisons.find((c) => c.metric === metric);
    return row ? row.change_pct : null;
  };

  const rangeLabel = fr ? '90 derniers jours' : 'Last 90 days';

  return (
    <div>
      <h1 className="text-[28px] font-bold text-text-primary leading-tight tracking-tight">{fr ? 'Statistiques' : 'Statistics'}</h1>
      <p className="text-[13px] text-text-tertiary mt-1">{fr ? "Analytiques et rapports d'affaires" : 'Business analytics & reports'}</p>

      {/* ── Vue d'ensemble ── */}
      <SectionHead title={fr ? "Vue d'ensemble" : 'Overview'} hint={rangeLabel} />
      <OverviewStrip
        items={[
          { label: fr ? 'Nouveaux leads' : 'New leads', value: String(overview?.new_leads_count || 0), pct: cmp('new_leads') },
          { label: fr ? 'Nouvelles demandes' : 'New requests', value: String(overview?.requests_count || 0), pct: cmp('requests') },
          { label: fr ? 'Devis convertis' : 'Converted quotes', value: String(overview?.converted_quotes_count || 0), pct: cmp('converted_quotes') },
          { label: fr ? 'Jobs ponctuels' : 'One-off jobs', value: String(overview?.new_oneoff_jobs_count || 0), pct: cmp('new_oneoff_jobs') },
          { label: fr ? 'Revenu' : 'Revenue', value: fmtMoney(overview?.revenue_cents || 0, locale), pct: cmp('revenue') },
          { label: fr ? 'Valeur facturée' : 'Invoiced value', value: fmtMoney(overview?.invoiced_value_cents || 0, locale), pct: cmp('invoiced_value') },
        ]}
      />

      {/* ── Revenu ── */}
      <SectionHead title={fr ? 'Revenu' : 'Revenue'} />
      <RevenueYearCompareCard />

      {/* ── Conversion ── */}
      <SectionHead title="Conversion" />
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4 items-stretch">
        <div className="xl:col-span-2">
          <LeadFunnelCard
            title={fr ? 'Entonnoir des leads' : 'Lead funnel'}
            hint={rangeLabel}
            stages={[
              { label: fr ? 'Nouveaux leads' : 'New leads', value: overview?.new_leads_count || 0 },
              { label: fr ? 'Devis convertis' : 'Converted quotes', value: overview?.converted_quotes_count || 0 },
              { label: fr ? 'Jobs créés' : 'Jobs created', value: overview?.new_oneoff_jobs_count || 0 },
            ]}
          />
        </div>
        <QuoteConversionCard />
      </div>
      <ClientLifetimeValueCard />

      {/* ── Jobs ── */}
      <SectionHead title="Jobs" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <RecurringVsOneOffCard from={from} to={to} />
        <AverageJobValueCard />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <TopServicesByCountCard />
        <JobsPerWeekdayCard />
      </div>
      <TopTeamCard
        title={fr ? 'Meilleures équipes' : 'Top teams'}
        hint={rangeLabel}
        teams={teamPerfQ.data || []}
        loading={teamPerfQ.isLoading}
        fr={fr}
      />
    </div>
  );
}
