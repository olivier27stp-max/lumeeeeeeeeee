/**
 * Statistiques (/insights) — the business-overview dashboard, monochrome, every
 * card wired to real data over the selected period and linking to its source
 * page. Gated to owner/admin (company-wide financials).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import { useCompany } from '../contexts/CompanyContext';
import {
  fetchClientLifetimeValue,
  fetchInsightsInvoicesSummary,
  fetchInsightsLeadConversion,
  fetchTeamPerformance,
  fetchPipelineVelocity,
} from '../lib/insightsApi';
import { fetchQuoteKpis } from '../lib/quotesApi';
import { fetchPayoutSummary } from '../lib/paymentsApi';
import { fetchAvgJobValueSeries, fetchLoyalty } from '../lib/statsExtraApi';
import { periodRange, periodLabel, DEFAULT_INSIGHTS_PERIOD, type InsightsPeriod } from '../lib/insightsPeriod';
import PeriodSelector from '../components/insights/PeriodSelector';
import RevenueTrendCard from '../components/insights/RevenueTrendCard';
import ServiceMixCard from '../components/insights/ServiceMixCard';
import PaymentMixCard from '../components/insights/PaymentMixCard';
import MiniTrendCard from '../components/insights/MiniTrendCard';
import ZonesHeatmapCard from '../components/insights/ZonesHeatmapCard';
import ProfitabilityCard from '../components/insights/ProfitabilityCard';

const EMPTY_SERIES = { labels: [] as string[], vals: [] as number[] };
function mean(a: number[]) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
/** 0–1 fraction OR already-scaled percent → rounded percent. */
function ratePct(v: number | null | undefined): number { const n = v ?? 0; return Math.round(Math.abs(n) <= 1 && n !== 0 ? n * 100 : n); }

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
  return <div onClick={() => navigate(to)} className="cursor-pointer rounded-xl transition-colors hover:bg-surface-secondary/40">{children}</div>;
}

/* ── leaderboard (teams / clients) ── */
function Leaderboard({ rows, loading, emptyLabel }: { rows: Array<{ name: string; primary: string; secondary?: string; weight: number }>; loading?: boolean; emptyLabel: string }) {
  if (loading) return <div className="px-6 py-5 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-8 rounded bg-surface-secondary/50 animate-pulse" />)}</div>;
  if (rows.length === 0) return <div className="h-[120px] flex items-center justify-center text-[12.5px] text-text-tertiary">{emptyLabel}</div>;
  const max = Math.max(1, ...rows.map((r) => r.weight));
  const ini = (n: string) => n.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="flex flex-col px-6 pt-1.5 pb-4">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[16px_34px_1fr_auto] items-center gap-3.5 py-3 border-b border-border-light last:border-0">
          <span className={cn('text-[12px] font-bold text-center tabular-nums', i === 0 ? 'text-text-primary' : 'text-text-tertiary')}>{i + 1}</span>
          <span className={cn('w-[34px] h-[34px] rounded-full grid place-items-center text-[12px] font-bold', i === 0 ? '' : 'bg-surface-secondary border border-border text-text-secondary')} style={i === 0 ? { background: 'var(--color-text-primary)', color: 'var(--color-surface)' } : undefined}>{ini(r.name)}</span>
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

function Tile({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="pb-5">
      <div className="text-[30px] font-bold tracking-tight leading-none tabular-nums text-text-primary px-6 mt-3">{value}</div>
      <div className="text-[12.5px] text-text-tertiary px-6 mt-2">{label}</div>
      {sub && <div className="text-[11.5px] text-text-tertiary px-6 mt-1">{sub}</div>}
    </div>
  );
}

export default function Statistiques() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const navigate = useNavigate();
  const { currentRole, currentOrgId } = useCompany();
  const isAdmin = currentRole === 'owner' || currentRole === 'admin';

  const [period, setPeriod] = useState<InsightsPeriod>(DEFAULT_INSIGHTS_PERIOD);
  const range = useMemo(() => periodRange(period), [period]);
  const { from, to } = range;

  const kc = (cents: number) => new Intl.NumberFormat(fr ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD', notation: 'compact', maximumFractionDigits: 1 }).format((cents || 0) / 100);

  const clientQ = useQuery({ queryKey: ['stats-clv'], queryFn: () => fetchClientLifetimeValue(6), staleTime: 60_000, enabled: isAdmin });
  const invQ = useQuery({ queryKey: ['stats-inv', from, to], queryFn: () => fetchInsightsInvoicesSummary({ from, to }), staleTime: 60_000, enabled: isAdmin });
  const convQ = useQuery({ queryKey: ['stats-conv', from, to], queryFn: () => fetchInsightsLeadConversion({ from, to }), staleTime: 60_000, enabled: isAdmin });
  const teamQ = useQuery({ queryKey: ['stats-team', from, to], queryFn: () => fetchTeamPerformance({ from, to }), staleTime: 60_000, enabled: isAdmin });
  const veloQ = useQuery({ queryKey: ['stats-velo', from, to], queryFn: () => fetchPipelineVelocity({ from, to }), staleTime: 60_000, enabled: isAdmin });
  const quoteQ = useQuery({ queryKey: ['stats-quote', from, to], queryFn: () => fetchQuoteKpis({ from, to }), staleTime: 60_000, enabled: isAdmin });
  const payoutQ = useQuery({ queryKey: ['stats-payout', currentOrgId], queryFn: () => fetchPayoutSummary({ orgId: currentOrgId as string, provider: 'stripe' }), enabled: isAdmin && !!currentOrgId, retry: false, staleTime: 60_000 });
  const avgQ = useQuery({ queryKey: ['stats-ajv', from, to, fr], queryFn: () => fetchAvgJobValueSeries({ from, to, fr }), staleTime: 60_000, enabled: isAdmin });
  const loyQ = useQuery({ queryKey: ['stats-loy', from, to], queryFn: () => fetchLoyalty({ from, to }), staleTime: 60_000, enabled: isAdmin });

  if (!isAdmin) {
    return (
      <div>
        <h1 className="text-[28px] font-bold text-text-primary leading-tight tracking-tight">{fr ? 'Statistiques' : 'Statistics'}</h1>
        <div className="mt-12 flex flex-col items-center gap-3 py-16 text-center">
          <div className="text-[13.5px] font-semibold text-text-secondary">{fr ? "Vue d'ensemble réservée aux gestionnaires" : 'Business overview is available to managers'}</div>
          <p className="text-[12.5px] text-text-tertiary max-w-[340px]">{fr ? 'Ce tableau agrège les chiffres de toute la compagnie. Consulte ta performance dans le classement.' : 'This dashboard aggregates company-wide figures. See your performance in the leaderboard.'}</p>
          <button type="button" onClick={() => navigate('/leaderboard')} className="mt-1 text-[12.5px] font-semibold text-text-primary border-b border-text-tertiary hover:opacity-70 transition-opacity">{fr ? 'Voir le classement →' : 'View leaderboard →'}</button>
        </div>
      </div>
    );
  }

  // Teams (used for both the revenue ranking and the completion ranking).
  const teams = (teamQ.data || []).slice();
  const teamsByRev = teams.slice().sort((a, b) => b.revenue_cents - a.revenue_cents).slice(0, 5)
    .map((t) => ({ name: t.team_name, primary: kc(t.revenue_cents), secondary: `${t.jobs_count} jobs · ${kc(t.avg_job_value_cents)} ${fr ? 'moy.' : 'avg'}`, weight: t.revenue_cents }));
  const teamsByCompletion = teams.slice().sort((a, b) => ratePct(b.completion_rate) - ratePct(a.completion_rate)).slice(0, 5)
    .map((t) => ({ name: t.team_name, primary: `${ratePct(t.completion_rate)} %`, secondary: `${t.jobs_completed}/${t.jobs_count} jobs`, weight: ratePct(t.completion_rate) }));
  const clientRows = (clientQ.data || []).slice().sort((a, b) => b.total_revenue_cents - a.total_revenue_cents).slice(0, 5).map((c) => ({ name: c.client_name, primary: kc(c.total_revenue_cents), secondary: `${c.total_jobs} jobs`, weight: c.total_revenue_cents }));

  const loy = loyQ.data || { recurringPct: 0, ltvAvgCents: 0, retentionPct: 0 };
  const conv = convQ.data;
  const velo = veloQ.data;
  const quote = quoteQ.data;
  const inv = invQ.data;
  const payout = payoutQ.data;

  const funnel = [
    { label: fr ? 'Nouveaux leads' : 'New leads', v: conv?.leads_created ?? 0 },
    { label: fr ? 'Devis approuvés' : 'Quotes approved', v: quote?.approved_count ?? 0 },
    { label: fr ? 'Leads convertis' : 'Leads converted', v: conv?.leads_closed ?? 0 },
  ];
  const funnelMax = Math.max(1, ...funnel.map((s) => s.v));

  const ajvDerive = (vals: number[]) => {
    const nz = vals.filter((v) => v > 0);
    if (!nz.length) return { hero: '—', delta: '', sub: `${fr ? 'moyenne par job' : 'avg per job'} · ${periodLabel(period, fr)}` };
    const first = nz[0]; const last = nz[nz.length - 1];
    const p = first > 0 ? Math.round(((last - first) / first) * 100) : 0;
    return { hero: kc(Math.round(mean(nz))), delta: nz.length > 1 ? `${p >= 0 ? '↑' : '↓'} ${Math.abs(p)}% ${fr ? 'sur la période' : 'over period'}` : '', sub: `${fr ? 'moyenne par job' : 'avg per job'} · ${periodLabel(period, fr)}` };
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold text-text-primary leading-tight tracking-tight">{fr ? 'Statistiques' : 'Statistics'}</h1>
          <p className="text-[13px] text-text-tertiary mt-1">{fr ? "Analytiques et rapports d'affaires" : 'Business analytics & reports'}</p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* Revenu */}
      <SectionHead title={fr ? 'Revenu' : 'Revenue'} />
      <LinkCard to="/finances"><RevenueTrendCard range={range} period={period} onPeriod={setPeriod} /></LinkCard>

      {/* Répartition */}
      <SectionHead title={fr ? 'Répartition' : 'Breakdown'} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <LinkCard to="/finances"><ServiceMixCard range={range} period={period} onPeriod={setPeriod} /></LinkCard>
        <LinkCard to="/payments"><PaymentMixCard range={range} period={period} onPeriod={setPeriod} /></LinkCard>
      </div>

      {/* Valeur & récurrence */}
      <SectionHead title={fr ? 'Valeur & récurrence' : 'Value & recurring'} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <LinkCard to="/jobs"><MiniTrendCard title={fr ? "Valeur moyenne d'un job" : 'Average job value'} series={avgQ.data || EMPTY_SERIES} loading={avgQ.isLoading} period={period} onPeriod={setPeriod} derive={ajvDerive} fmt={kc} /></LinkCard>
      </div>

      {/* Équipes */}
      <SectionHead title={fr ? 'Équipes' : 'Teams'} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <LinkCard to="/leaderboard"><CardHead title={fr ? 'Classement par revenu' : 'Ranked by revenue'} right={<PeriodSelector value={period} onChange={setPeriod} />} /><Leaderboard rows={teamsByRev} loading={teamQ.isLoading} emptyLabel={fr ? 'Aucune donnée' : 'No data'} /></LinkCard>
        <LinkCard to="/leaderboard"><CardHead title={fr ? 'Taux de complétion' : 'Completion rate'} right={<PeriodSelector value={period} onChange={setPeriod} />} /><Leaderboard rows={teamsByCompletion} loading={teamQ.isLoading} emptyLabel={fr ? 'Aucune donnée' : 'No data'} /></LinkCard>
      </div>

      {/* Clients */}
      <SectionHead title="Clients" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <LinkCard to="/clients"><CardHead title={fr ? 'Top clients par revenu' : 'Top clients by revenue'} /><Leaderboard rows={clientRows} loading={clientQ.isLoading} emptyLabel={fr ? 'Aucune donnée' : 'No data'} /></LinkCard>
        <LinkCard to="/clients">
          <CardHead title={fr ? 'Fidélité & valeur client' : 'Loyalty & client value'} right={<PeriodSelector value={period} onChange={setPeriod} />} />
          <div className="px-6 pt-4">
            <div className="flex h-3 rounded-full overflow-hidden bg-surface-tertiary gap-0.5">
              <span className="block h-full rounded-l-full" style={{ width: `${loy.recurringPct}%`, background: 'var(--color-text-primary)' }} />
              <span className="block h-full rounded-r-full" style={{ width: `${100 - loy.recurringPct}%`, background: 'var(--color-text-tertiary)' }} />
            </div>
            <div className="flex gap-6 mt-3">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-text-secondary"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--color-text-primary)' }} />{fr ? 'Récurrent' : 'Recurring'} <b className="text-text-primary tabular-nums">{loy.recurringPct} %</b></div>
              <div className="flex items-center gap-2 text-[12px] font-semibold text-text-secondary"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--color-text-tertiary)' }} />{fr ? 'Ponctuel' : 'One-off'} <b className="text-text-primary tabular-nums">{100 - loy.recurringPct} %</b></div>
            </div>
          </div>
          <div className="flex gap-10 px-6 mt-6 pb-1">
            <div><div className="text-[24px] font-bold tracking-tight tabular-nums text-text-primary leading-none">{kc(loy.ltvAvgCents)}</div><div className="text-[11.5px] text-text-tertiary mt-1.5">{fr ? 'Valeur vie moy. (LTV)' : 'Avg lifetime value'}</div></div>
            <div><div className="text-[24px] font-bold tracking-tight tabular-nums text-text-primary leading-none">{loy.retentionPct} %</div><div className="text-[11.5px] text-text-tertiary mt-1.5">{fr ? 'Taux de rétention' : 'Retention rate'}</div></div>
          </div>
        </LinkCard>
      </div>

      {/* Conversion des leads */}
      <SectionHead title={fr ? 'Conversion des leads' : 'Lead conversion'} />
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
        <div className="xl:col-span-2">
          <LinkCard to="/pipeline">
            <CardHead title={fr ? 'Entonnoir des leads' : 'Lead funnel'} right={<PeriodSelector value={period} onChange={setPeriod} />} />
            {convQ.isLoading ? <div className="h-[196px] mx-6 mt-4 rounded-lg bg-surface-secondary/40 animate-pulse" /> : (
              <div className="flex items-end gap-3 h-[196px] px-6 pt-4 pb-5">
                {funnel.map((s, i) => {
                  const convPct = i > 0 && funnel[i - 1].v > 0 ? Math.round((s.v / funnel[i - 1].v) * 100) : null;
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end h-full gap-2.5">
                      <div className="w-3/4 max-w-[96px] rounded-t-md flex items-start justify-center font-extrabold text-[15px] pt-2 tabular-nums" style={{ height: `${Math.max(8, (s.v / funnelMax) * 100)}%`, background: 'var(--color-text-primary)', color: 'var(--color-surface)' }}>{s.v}</div>
                      <span className="text-[11px] text-text-tertiary font-semibold text-center leading-snug">{s.label}{convPct != null && <><br /><b className="text-text-secondary">{convPct}%</b></>}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </LinkCard>
        </div>
        <div className="pb-5">
          <CardHead title={fr ? 'Taux de conversion' : 'Conversion rate'} right={<PeriodSelector value={period} onChange={setPeriod} />} />
          <div className="text-[30px] font-bold tracking-tight leading-none tabular-nums text-text-primary px-6 mt-3">{ratePct(conv?.conversion_rate)} %</div>
          <div className="text-[12.5px] text-text-tertiary px-6 mt-2">{fr ? 'leads convertis / créés' : 'leads converted / created'}</div>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
        <Tile value={velo && velo.avg_days_to_close != null ? `${Math.round(velo.avg_days_to_close)} ${fr ? 'j' : 'd'}` : '—'} label={fr ? 'Délai de conversion' : 'Time to convert'} sub={fr ? 'lead → gagné' : 'lead → won'} />
        <Tile value={`${ratePct(velo?.win_rate)} %`} label={fr ? 'Taux de réussite' : 'Win rate'} sub={fr ? 'deals gagnés / total' : 'deals won / total'} />
        <div className="pb-5"><CardHead title={fr ? 'Valeur des devis' : 'Quote value'} /><div className="flex gap-8 px-6 mt-3"><div><div className="text-[26px] font-bold tracking-tight tabular-nums text-text-primary leading-none">{kc(quote?.total_value_cents ?? 0)}</div><div className="text-[11.5px] text-text-tertiary mt-1.5">{fr ? 'Total' : 'Total'}</div></div><div><div className="text-[26px] font-bold tracking-tight tabular-nums text-text-primary leading-none">{kc(quote?.approved_value_cents ?? 0)}</div><div className="text-[11.5px] text-text-tertiary mt-1.5">{fr ? 'Approuvés' : 'Approved'}</div></div></div><div className="text-[12.5px] text-text-tertiary px-6 mt-4">{quote && quote.total_value_cents > 0 ? Math.round((quote.approved_value_cents / quote.total_value_cents) * 100) : 0} % {fr ? 'de la valeur approuvée' : 'of value approved'}</div></div>
      </div>

      {/* Trésorerie */}
      <SectionHead title={fr ? 'Trésorerie' : 'Cash flow'} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <LinkCard to="/invoices"><Tile value={kc(inv?.total_outstanding_cents ?? 0)} label={fr ? 'À recevoir' : 'Receivables'} sub={`${inv?.count_past_due ?? 0} ${fr ? 'en retard' : 'past due'}`} /></LinkCard>
        <LinkCard to="/payments"><Tile value={payoutQ.isError || !payout ? '—' : kc(payout.on_the_way || 0)} label={fr ? 'Versements à venir' : 'Upcoming payouts'} sub={payoutQ.isError || !payout ? (fr ? 'aucun compte connecté' : 'no account connected') : (fr ? 'en transit' : 'in transit')} /></LinkCard>
        <Tile value={inv && inv.avg_payment_time_days != null ? `${Math.round(inv.avg_payment_time_days)} ${fr ? 'j' : 'd'}` : '—'} label={fr ? 'Délai de paiement' : 'Payment time'} sub={fr ? 'facture → payée' : 'invoice → paid'} />
      </div>

      {/* Zones */}
      <SectionHead title={fr ? 'Zones' : 'Zones'} />
      <ZonesHeatmapCard range={range} period={period} onPeriod={setPeriod} />

      {/* Rentabilité */}
      <SectionHead title={fr ? 'Rentabilité' : 'Profitability'} />
      <ProfitabilityCard range={range} period={period} onPeriod={setPeriod} />

      <div className="h-16" />
    </div>
  );
}
