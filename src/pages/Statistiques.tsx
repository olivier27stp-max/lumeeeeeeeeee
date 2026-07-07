/**
 * Statistiques (/insights) — the business-overview dashboard, rebuilt to the
 * approved monochrome/boxless prototype. A single shared period drives every
 * card (each card's selector writes the same state, so the whole page stays
 * consistent). Role-gated: owner/admin see everything; sales_rep sees the
 * non-sensitive cards; technician gets a limited view.
 *
 * Everything here is wired to real RPCs. Known gaps intentionally deferred:
 * payment-method mix donut, monthly-recurring-revenue (no monthly-contract
 * source yet), average-job-value time series, the real Google heatmap, and the
 * cost-entry UI that makes the profitability margin non-zero.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import { useCompany } from '../contexts/CompanyContext';
import {
  fetchInsightsOverview,
  fetchPeriodComparison,
  fetchInsightsLeadConversion,
  fetchTeamPerformance,
  fetchClientLifetimeValue,
  fetchInsightsInvoicesSummary,
  fetchJobProfitability,
} from '../lib/insightsApi';
import { fetchPayoutSummary } from '../lib/paymentsApi';
import {
  periodRange,
  DEFAULT_INSIGHTS_PERIOD,
  periodLabel,
  type InsightsPeriod,
} from '../lib/insightsPeriod';
import PeriodSelector from '../components/insights/PeriodSelector';
import RevenueTrendCard from '../components/insights/RevenueTrendCard';
import ServiceMixCard from '../components/insights/ServiceMixCard';

/* ── formatting ── */
function useMoney() {
  const { language } = useTranslation();
  const locale = language === 'fr' ? 'fr-CA' : 'en-CA';
  return {
    money: (cents: number) =>
      new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD', notation: 'compact', maximumFractionDigits: 1 }).format((cents || 0) / 100),
    fr: language === 'fr',
  };
}
/** Normalize a 0–1 fraction OR an already-scaled percent to a rounded percent. */
function ratePct(v: number | null | undefined): number {
  const n = v ?? 0;
  return Math.round(Math.abs(n) <= 1 && n !== 0 ? n * 100 : n);
}

/* ── shared shell (boxless, underlined header) ── */
function SectionHead({ title }: { title: string }) {
  return <div className="text-[12px] font-bold uppercase tracking-wide text-text-tertiary mt-9 first:mt-0 mb-3 px-0.5">{title}</div>;
}
function CardHead({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3 px-6 pb-3 border-b border-border">
      <div className="text-[13px] font-semibold uppercase tracking-wide text-text-tertiary leading-none">{title}</div>
      {right}
    </div>
  );
}
function LinkCard({ to, children }: { to: string; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div onClick={() => navigate(to)} className="cursor-pointer rounded-xl transition-colors hover:bg-surface-secondary/40">
      {children}
    </div>
  );
}
function Empty({ label }: { label: string }) {
  return <div className="h-[120px] flex items-center justify-center text-[12.5px] text-text-tertiary">{label}</div>;
}

/* ── Overview strip ── */
function DeltaPill({ pct }: { pct?: number | null }) {
  if (pct == null || Number.isNaN(pct)) return <span className="text-[10.5px] font-bold text-text-tertiary">—</span>;
  const down = pct < 0;
  return (
    <span className={cn('text-[10.5px] font-bold whitespace-nowrap', down ? 'text-danger' : 'text-text-secondary')}>
      {down ? '↓' : '↑'} {Math.abs(Math.round(pct))}%
    </span>
  );
}
function OverviewStrip({ items }: { items: Array<{ label: string; value: string; pct?: number | null; to?: string }> }) {
  const navigate = useNavigate();
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-x-6 gap-y-5">
      {items.map((k) => (
        <button key={k.label} type="button" onClick={() => k.to && navigate(k.to)} className="text-left group focus:outline-none">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-text-tertiary">
            <span className="truncate">{k.label}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"><path d="M7 17L17 7M17 7H8M17 7v9" /></svg>
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-[24px] font-bold text-text-primary tabular-nums tracking-tight leading-none">{k.value}</span>
            <DeltaPill pct={k.pct} />
          </div>
        </button>
      ))}
    </div>
  );
}

/* ── Leaderboard (teams / clients) ── */
function Leaderboard({
  rows,
  loading,
  emptyLabel,
}: {
  rows: Array<{ name: string; primary: string; secondary?: string; weight: number }>;
  loading?: boolean;
  emptyLabel: string;
}) {
  if (loading) return <div className="px-6 py-5 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-8 rounded bg-surface-secondary/50 animate-pulse" />)}</div>;
  if (rows.length === 0) return <Empty label={emptyLabel} />;
  const max = Math.max(1, ...rows.map((r) => r.weight));
  const ini = (n: string) => n.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="flex flex-col px-6 pt-1.5 pb-4">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[16px_34px_1fr_auto] items-center gap-3.5 py-3 border-b border-border-light last:border-0">
          <span className="text-[12px] font-bold text-text-tertiary text-center tabular-nums">{i + 1}</span>
          <span className={cn('w-[34px] h-[34px] rounded-full grid place-items-center text-[12px] font-bold', i === 0 ? 'text-surface-card' : 'bg-surface-secondary border border-border text-text-secondary')} style={i === 0 ? { background: 'var(--color-text-primary)' } : undefined}>{ini(r.name)}</span>
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold tracking-tight truncate text-text-primary">{r.name}</div>
            <div className="h-1.5 rounded-full bg-surface-tertiary overflow-hidden mt-2"><span className="block h-full rounded-full" style={{ width: `${Math.round((r.weight / max) * 100)}%`, background: 'var(--color-text-primary)' }} /></div>
          </div>
          <div className="text-right">
            <div className="text-[15px] font-bold tracking-tight tabular-nums text-text-primary">{r.primary}</div>
            {r.secondary && <div className="text-[11px] font-semibold text-text-tertiary mt-0.5">{r.secondary}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Big stat tile ── */
function Stat({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div>
      <div className="text-[30px] font-bold tracking-tight leading-none tabular-nums text-text-primary">{value}</div>
      <div className="text-[12.5px] font-medium text-text-tertiary mt-2">{label}</div>
      {sub && <div className="text-[11.5px] text-text-tertiary mt-1">{sub}</div>}
    </div>
  );
}

export default function Statistiques() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const locale = fr ? 'fr-CA' : 'en-CA';
  const { money } = useMoney();
  const navigate = useNavigate();
  const { currentRole, currentOrgId } = useCompany();
  const isAdmin = currentRole === 'owner' || currentRole === 'admin';

  const [period, setPeriod] = useState<InsightsPeriod>(DEFAULT_INSIGHTS_PERIOD);
  const range = useMemo(() => periodRange(period), [period]);
  const { from, to } = range;

  const overviewQ = useQuery({ queryKey: ['stats-overview', from, to], queryFn: () => fetchInsightsOverview({ from, to }), staleTime: 60_000 });
  const comparisonQ = useQuery({ queryKey: ['stats-comparison', from, to], queryFn: () => fetchPeriodComparison({ from, to }), staleTime: 60_000 });
  const convQ = useQuery({ queryKey: ['stats-conv', from, to], queryFn: () => fetchInsightsLeadConversion({ from, to }), staleTime: 60_000 });
  const teamQ = useQuery({ queryKey: ['stats-team', from, to], queryFn: () => fetchTeamPerformance({ from, to }), staleTime: 60_000, enabled: isAdmin });
  const clientQ = useQuery({ queryKey: ['stats-clv'], queryFn: () => fetchClientLifetimeValue(8), staleTime: 60_000, enabled: isAdmin });
  const invQ = useQuery({ queryKey: ['stats-inv', from, to], queryFn: () => fetchInsightsInvoicesSummary({ from, to }), staleTime: 60_000 });
  const payoutQ = useQuery({ queryKey: ['stats-payout', currentOrgId], queryFn: () => fetchPayoutSummary({ orgId: currentOrgId as string, provider: 'stripe' }), enabled: !!currentOrgId, retry: false, staleTime: 60_000 });
  const profitQ = useQuery({ queryKey: ['stats-profit', from, to], queryFn: () => fetchJobProfitability({ from, to }), staleTime: 60_000, enabled: isAdmin });

  const overview = overviewQ.data;
  const comparisons = comparisonQ.data || [];
  const cmp = (metric: string): number | null => comparisons.find((c) => c.metric === metric)?.change_pct ?? null;

  if (!isAdmin) {
    return (
      <div>
        <h1 className="text-[28px] font-bold text-text-primary leading-tight tracking-tight">{fr ? 'Statistiques' : 'Statistics'}</h1>
        <div className="mt-12 flex flex-col items-center gap-3 py-16 text-center">
          <div className="text-[13.5px] font-semibold text-text-secondary">{fr ? "Vue d'ensemble réservée aux gestionnaires" : 'Business overview is available to managers'}</div>
          <p className="text-[12.5px] text-text-tertiary max-w-[340px]">{fr ? 'Ce tableau agrège les chiffres de toute la compagnie. Consulte ta performance personnelle dans le classement.' : 'This dashboard aggregates company-wide figures. See your personal performance in the leaderboard.'}</p>
          <button type="button" onClick={() => navigate('/leaderboard')} className="mt-1 text-[12.5px] font-semibold text-text-primary border-b border-text-tertiary hover:opacity-70 transition-opacity">{fr ? 'Voir le classement →' : 'View leaderboard →'}</button>
        </div>
      </div>
    );
  }

  const teamRows = (teamQ.data || [])
    .slice()
    .sort((a, b) => b.revenue_cents - a.revenue_cents)
    .slice(0, 5)
    .map((t) => ({ name: t.team_name, primary: money(t.revenue_cents), secondary: `${t.jobs_count} jobs · ${ratePct(t.completion_rate)}% ${fr ? 'complétés' : 'done'}`, weight: t.revenue_cents }));

  const clientRows = (clientQ.data || [])
    .slice(0, 5)
    .map((c) => ({ name: c.client_name, primary: money(c.total_revenue_cents), secondary: `${c.total_jobs} jobs`, weight: c.total_revenue_cents }));

  const conv = convQ.data;
  const inv = invQ.data;
  const payout = payoutQ.data;
  const profit = profitQ.data;

  const funnelStages = [
    { label: fr ? 'Nouveaux leads' : 'New leads', value: conv?.leads_created ?? 0 },
    { label: fr ? 'Leads convertis' : 'Converted leads', value: conv?.leads_closed ?? 0 },
    { label: fr ? 'Jobs ponctuels' : 'One-off jobs', value: overview?.new_oneoff_jobs_count ?? 0 },
  ];
  const funnelMax = Math.max(1, ...funnelStages.map((s) => s.value));

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold text-text-primary leading-tight tracking-tight">{fr ? 'Statistiques' : 'Statistics'}</h1>
          <p className="text-[13px] text-text-tertiary mt-1">{fr ? "Analytiques et rapports d'affaires" : 'Business analytics & reports'} · {periodLabel(period, fr)}</p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* Vue d'ensemble */}
      <SectionHead title={fr ? "Vue d'ensemble" : 'Overview'} />
      <OverviewStrip
        items={[
          { label: fr ? 'Nouveaux leads' : 'New leads', value: String(overview?.new_leads_count ?? 0), pct: cmp('new_leads'), to: '/leads' },
          { label: fr ? 'Demandes' : 'Requests', value: String(overview?.requests_count ?? 0), pct: cmp('requests'), to: '/requests' },
          { label: fr ? 'Devis convertis' : 'Converted quotes', value: String(overview?.converted_quotes_count ?? 0), pct: cmp('converted_quotes'), to: '/quotes' },
          { label: fr ? 'Jobs ponctuels' : 'One-off jobs', value: String(overview?.new_oneoff_jobs_count ?? 0), pct: cmp('new_oneoff_jobs'), to: '/jobs' },
          { label: fr ? 'Revenu' : 'Revenue', value: money(overview?.revenue_cents ?? 0), pct: cmp('revenue'), to: '/finances' },
          { label: fr ? 'Valeur facturée' : 'Invoiced', value: money(overview?.invoiced_value_cents ?? 0), pct: cmp('invoiced_value'), to: '/finances' },
        ]}
      />

      {/* Revenu */}
      <SectionHead title={fr ? 'Revenu' : 'Revenue'} />
      <RevenueTrendCard range={range} period={period} onPeriod={setPeriod} deltaPct={cmp('revenue')} />

      {/* Répartition */}
      <SectionHead title={fr ? 'Répartition' : 'Breakdown'} />
      <ServiceMixCard range={range} period={period} onPeriod={setPeriod} />

      {/* Conversion des leads */}
      <SectionHead title={fr ? 'Conversion des leads' : 'Lead conversion'} />
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
        <div className="xl:col-span-2">
          <CardHead title={fr ? 'Entonnoir des leads' : 'Lead funnel'} right={<PeriodSelector value={period} onChange={setPeriod} />} />
          {convQ.isLoading ? <div className="h-[180px] mx-6 mt-4 rounded-lg bg-surface-secondary/40 animate-pulse" /> : (
            <div className="flex items-end gap-3 h-[196px] px-6 pt-4 pb-5">
              {funnelStages.map((s, i) => {
                const convPct = i > 0 && funnelStages[i - 1].value > 0 ? Math.round((s.value / funnelStages[i - 1].value) * 100) : null;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center justify-end h-full gap-2.5">
                    <div className="w-3/4 max-w-[96px] rounded-t-md flex items-start justify-center text-surface-card font-extrabold text-[15px] pt-2 tabular-nums" style={{ height: `${Math.max(8, (s.value / funnelMax) * 100)}%`, background: 'var(--color-text-primary)' }}>{s.value}</div>
                    <span className="text-[11px] text-text-tertiary font-semibold text-center leading-snug">{s.label}{convPct != null && <><br /><b className="text-text-secondary">{convPct}%</b></>}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="pb-5">
          <CardHead title={fr ? 'Taux de conversion' : 'Conversion rate'} />
          <div className="text-[30px] font-bold tracking-tight leading-none tabular-nums text-text-primary px-6 mt-3">{ratePct(conv?.conversion_rate)}%</div>
          <div className="text-[12.5px] text-text-tertiary px-6 mt-2">{fr ? 'leads convertis / créés' : 'leads converted / created'}</div>
        </div>
      </div>

      {/* Représentants / équipes — sensible: admin only */}
      {isAdmin && (
        <>
          <SectionHead title={fr ? 'Performance des équipes' : 'Team performance'} />
          <LinkCard to="/leaderboard">
            <CardHead title={fr ? 'Classement par revenu' : 'Ranked by revenue'} />
            <Leaderboard rows={teamRows} loading={teamQ.isLoading} emptyLabel={fr ? 'Aucune donnée' : 'No data'} />
          </LinkCard>
        </>
      )}

      {/* Clients — sensible: admin only */}
      {isAdmin && (
        <>
          <SectionHead title={fr ? 'Clients' : 'Clients'} />
          <LinkCard to="/clients">
            <CardHead title={fr ? 'Top clients par valeur vie' : 'Top clients by lifetime value'} />
            <Leaderboard rows={clientRows} loading={clientQ.isLoading} emptyLabel={fr ? 'Aucune donnée' : 'No data'} />
          </LinkCard>
        </>
      )}

      {/* Trésorerie */}
      <SectionHead title={fr ? 'Trésorerie' : 'Cash flow'} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <LinkCard to="/invoices">
          <CardHead title={fr ? 'À recevoir' : 'Receivables'} />
          <div className="px-6 pt-4">{invQ.isLoading ? <Empty label="…" /> : <Stat value={money((inv?.total_outstanding_cents ?? 0))} label={fr ? 'total en souffrance' : 'total outstanding'} sub={`${inv?.count_past_due ?? 0} ${fr ? 'en retard' : 'past due'}`} />}</div>
        </LinkCard>
        <LinkCard to="/payments">
          <CardHead title={fr ? 'Versements à venir' : 'Upcoming payouts'} />
          <div className="px-6 pt-4">{payoutQ.isLoading ? <Empty label="…" /> : payoutQ.isError || !payout ? <Stat value="—" label={fr ? 'aucun compte de paiement connecté' : 'no payout account connected'} /> : <Stat value={money(payout.on_the_way || 0)} label={fr ? 'en transit' : 'in transit'} />}</div>
        </LinkCard>
        <div>
          <CardHead title={fr ? 'Délai de paiement' : 'Payment time'} />
          <div className="px-6 pt-4">{invQ.isLoading ? <Empty label="…" /> : <Stat value={inv?.avg_payment_time_days != null ? `${Math.round(inv.avg_payment_time_days)} ${fr ? 'j' : 'd'}` : '—'} label={fr ? 'moyenne facture → paiement' : 'avg invoice → paid'} />}</div>
        </div>
      </div>

      {/* Rentabilité — sensible: admin only */}
      {isAdmin && (
        <>
          <SectionHead title={fr ? 'Rentabilité' : 'Profitability'} />
          <LinkCard to="/jobs">
            <CardHead title={fr ? 'Marge par job' : 'Margin per job'} />
            {profitQ.isLoading ? <div className="h-[110px] mx-6 mt-4 rounded-lg bg-surface-secondary/40 animate-pulse" /> : !profit || profit.total_jobs === 0 ? <Empty label={fr ? 'Aucune donnée' : 'No data'} /> : (
              <div className="px-6 pt-4 grid grid-cols-2 md:grid-cols-4 gap-6">
                <Stat value={`${ratePct(profit.margin_pct)}%`} label={fr ? 'marge brute' : 'gross margin'} />
                <Stat value={money(profit.total_revenue_cents)} label={fr ? 'revenu' : 'revenue'} />
                <Stat value={money(profit.total_cost_cents)} label={fr ? 'coûts' : 'costs'} />
                <Stat value={money(profit.gross_margin_cents)} label={fr ? 'profit brut' : 'gross profit'} />
              </div>
            )}
            {profit && profit.total_cost_cents === 0 && profit.total_jobs > 0 && (
              <div className="px-6 mt-4 text-[11.5px] text-text-tertiary">{fr ? '⚠︎ Coûts à 0 : saisis les taux horaires et dépenses pour une marge réelle.' : '⚠︎ Costs are 0: enter hourly rates and expenses for a real margin.'}</div>
            )}
          </LinkCard>
        </>
      )}

      <div className="h-16" />
    </div>
  );
}
