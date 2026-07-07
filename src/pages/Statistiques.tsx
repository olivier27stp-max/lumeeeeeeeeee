/**
 * Statistiques (/insights) — a faithful, monochrome port of the approved
 * prototype: same sections, same order, same look. Every card links to its
 * source page. Real data where a clean RPC exists (revenue trend, revenue by
 * service, top clients); the prototype's representative figures elsewhere
 * (payment mix, avg job value, MRR, reps, conversion, cash, profitability),
 * scaled by the selected period, until their aggregates are built.
 *
 * Gated to owner/admin — this dashboard aggregates company-wide financials.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import { useCompany } from '../contexts/CompanyContext';
import { fetchClientLifetimeValue } from '../lib/insightsApi';
import { periodRange, periodLabel, DEFAULT_INSIGHTS_PERIOD, type InsightsPeriod } from '../lib/insightsPeriod';
import PeriodSelector from '../components/insights/PeriodSelector';
import RevenueTrendCard from '../components/insights/RevenueTrendCard';
import ServiceMixCard from '../components/insights/ServiceMixCard';
import PaymentMixCard from '../components/insights/PaymentMixCard';
import MiniTrendCard, { type MiniSeries } from '../components/insights/MiniTrendCard';
import ZonesHeatmapCard from '../components/insights/ZonesHeatmapCard';

/* ── period scaling for the prototype figures ── */
const GF: Record<InsightsPeriod, number> = { '12m': 1, '2y': 2.4, '3y': 3.5, '12w': 0.26, ytd: 0.58 };
const M = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
const W12 = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12'];
const YTD = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil'];

const AJV: Record<InsightsPeriod, MiniSeries> = {
  '12m': { labels: M, vals: [352, 368, 375, 390, 405, 410, 398, 420, 435, 448, 462, 470] },
  '2y': { labels: M, vals: [300, 315, 320, 340, 360, 355, 370, 392, 410, 432, 455, 470] },
  '3y': { labels: M, vals: [262, 280, 295, 308, 300, 330, 352, 346, 380, 410, 440, 470] },
  '12w': { labels: W12, vals: [432, 440, 428, 455, 449, 461, 458, 470, 466, 478, 472, 486] },
  ytd: { labels: YTD, vals: [420, 438, 445, 452, 460, 468, 472] },
};
const MRR: Record<InsightsPeriod, MiniSeries> = {
  '12m': { labels: M, vals: [2100, 2300, 2600, 2800, 3100, 3400, 3600, 3900, 4200, 4550, 4900, 5300] },
  '2y': { labels: M, vals: [800, 950, 1150, 1400, 1750, 2050, 2400, 2800, 3300, 3950, 4600, 5300] },
  '3y': { labels: M, vals: [300, 450, 620, 880, 1200, 1700, 2300, 3000, 3800, 4400, 4900, 5300] },
  '12w': { labels: W12, vals: [4900, 4950, 5000, 5050, 5080, 5120, 5150, 5190, 5220, 5250, 5280, 5300] },
  ytd: { labels: YTD, vals: [4200, 4550, 4900, 5000, 5150, 5250, 5300] },
};
const REPS = [
  { n: 'Karim Benali', rev: 48200, jobs: 62, sent: 25, conv: 16 },
  { n: 'Sophie Tremblay', rev: 41500, jobs: 55, sent: 24, conv: 17 },
  { n: 'Marc-André Roy', rev: 33800, jobs: 48, sent: 22, conv: 12 },
  { n: 'Julie Nguyen', rev: 26400, jobs: 39, sent: 23, conv: 14 },
  { n: 'David Cloutier', rev: 18900, jobs: 31, sent: 21, conv: 10 },
];
const FID: Record<InsightsPeriod, { rec: number; ltv: number; ret: number }> = {
  '12m': { rec: 62, ltv: 1840, ret: 88 }, '2y': { rec: 66, ltv: 2210, ret: 85 }, '3y': { rec: 68, ltv: 2480, ret: 83 }, '12w': { rec: 58, ltv: 1520, ret: 90 }, ytd: { rec: 60, ltv: 1680, ret: 87 },
};
const FUN = [
  { fr: 'Nouveaux leads', en: 'New leads', v: 34 },
  { fr: 'Devis envoyés', en: 'Quotes sent', v: 22 },
  { fr: 'Devis convertis', en: 'Quotes won', v: 15 },
  { fr: 'Jobs créés', en: 'Jobs created', v: 13 },
];
const TX: Record<InsightsPeriod, string> = { '12m': '53', '2y': '49', '3y': '47', '12w': '58', ytd: '54' };
const DC: Record<InsightsPeriod, string> = { '12m': '2,4', '2y': '2,8', '3y': '3,1', '12w': '2,0', ytd: '2,3' };
const DA: Record<InsightsPeriod, string> = { '12m': '1,8', '2y': '2,1', '3y': '2,2', '12w': '1,5', ytd: '1,7' };
const VD = { sent: 42400, conv: 22100 };
const PL = [
  { c: 'Constructions ABC', j: '1030', rev: 3200, mo: 920, dep: 410 },
  { c: 'Toitures Rive-Sud', j: '1036', rev: 2245, mo: 640, dep: 320 },
  { c: 'Marcel Lafontaine', j: '1042', rev: 1250, mo: 380, dep: 90 },
  { c: 'Marie Lefebvre', j: '1039', rev: 980, mo: 210, dep: 40 },
  { c: 'Josée Mondar', j: '1033', rev: 640, mo: 180, dep: 30 },
];

function mean(a: number[]) { return a.reduce((x, y) => x + y, 0) / a.length; }

/* ── shared shell (boxless, underlined header) ── */
function SectionHead({ title, badge }: { title: string; badge?: string }) {
  return (
    <div className="flex items-center gap-2 mt-9 first:mt-0 mb-3 px-0.5">
      <span className="text-[12px] font-bold uppercase tracking-wide text-text-tertiary">{title}</span>
      {badge && <span className="text-[9.5px] font-semibold uppercase tracking-wide text-text-secondary bg-surface-secondary border border-border rounded-full px-2 py-0.5">{badge}</span>}
    </div>
  );
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

/* ── leaderboard (reps / clients) ── */
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

export default function Statistiques() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const locale = fr ? 'fr-CA' : 'en-CA';
  const navigate = useNavigate();
  const { currentRole } = useCompany();
  const isAdmin = currentRole === 'owner' || currentRole === 'admin';

  const [period, setPeriod] = useState<InsightsPeriod>(DEFAULT_INSIGHTS_PERIOD);
  const range = useMemo(() => periodRange(period), [period]);

  const k = (d: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD', notation: 'compact', maximumFractionDigits: 1 }).format(d || 0);
  const f = (d: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(d || 0);
  const kc = (cents: number) => k((cents || 0) / 100);

  const clientQ = useQuery({ queryKey: ['stats-clv'], queryFn: () => fetchClientLifetimeValue(6), staleTime: 60_000, enabled: isAdmin });

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

  const f2 = GF[period];
  const repsRev = REPS.map((r) => ({ n: r.n, rev: Math.round(r.rev * f2), jobs: Math.max(1, Math.round(r.jobs * f2)) })).sort((a, b) => b.rev - a.rev)
    .map((r) => ({ name: r.n, primary: k(r.rev), secondary: `${r.jobs} jobs · ${k(Math.round(r.rev / r.jobs))} ${fr ? 'moy.' : 'avg'}`, weight: r.rev }));
  const repsConv = REPS.map((r) => { const sent = Math.max(1, Math.round(r.sent * f2)); const conv = Math.round(r.conv * f2); return { n: r.n, sent, conv, pct: Math.round((conv / sent) * 100) }; }).sort((a, b) => b.pct - a.pct)
    .map((r) => ({ name: r.n, primary: `${r.pct} %`, secondary: `${r.conv}/${r.sent} ${fr ? 'devis' : 'quotes'}`, weight: r.pct }));
  const clientRows = (clientQ.data || []).slice(0, 5).map((c) => ({ name: c.client_name, primary: kc(c.total_revenue_cents), secondary: `${c.total_jobs} jobs`, weight: c.total_revenue_cents }));
  const fid = FID[period];

  const funnel = FUN.map((s) => ({ label: fr ? s.fr : s.en, v: Math.round(s.v * f2) }));
  const funnelMax = Math.max(1, ...funnel.map((s) => s.v));

  const ajvDerive = (vals: number[]) => { const avg = Math.round(mean(vals)); const p = vals[0] > 0 ? Math.round(((vals[vals.length - 1] - vals[0]) / vals[0]) * 100) : 0; return { hero: k(avg), delta: `${p >= 0 ? '↑' : '↓'} ${Math.abs(p)}% ${fr ? 'sur la période' : 'over period'}`, sub: `${fr ? 'moyenne par job' : 'avg per job'} · ${periodLabel(period, fr)}` }; };
  const mrrDerive = (vals: number[]) => { const last = vals[vals.length - 1]; const prev = vals[vals.length - 2] || last; const p = prev > 0 ? Math.round(((last - prev) / prev) * 100) : 0; return { hero: k(last), delta: `${p >= 0 ? '↑' : '↓'} ${Math.abs(p)}% ${fr ? 'ce mois' : 'this month'}`, sub: `≈ ${k(last * 12)} ${fr ? 'annualisé' : 'annualized'} · ${periodLabel(period, fr)}` }; };

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
        <LinkCard to="/payments"><PaymentMixCard period={period} onPeriod={setPeriod} /></LinkCard>
      </div>

      {/* Valeur & récurrence */}
      <SectionHead title={fr ? 'Valeur & récurrence' : 'Value & recurring'} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <LinkCard to="/jobs"><MiniTrendCard title={fr ? "Valeur moyenne d'un job" : 'Average job value'} data={AJV} period={period} onPeriod={setPeriod} derive={ajvDerive} fmt={k} /></LinkCard>
        <LinkCard to="/finances"><MiniTrendCard title={fr ? 'Revenu récurrent mensuel' : 'Monthly recurring revenue'} data={MRR} period={period} onPeriod={setPeriod} derive={mrrDerive} fmt={k} /></LinkCard>
      </div>

      {/* Représentants */}
      <SectionHead title={fr ? 'Représentants' : 'Reps'} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <LinkCard to="/leaderboard"><CardHead title={fr ? 'Classement par revenu' : 'Ranked by revenue'} right={<PeriodSelector value={period} onChange={setPeriod} />} /><Leaderboard rows={repsRev} emptyLabel={fr ? 'Aucune donnée' : 'No data'} /></LinkCard>
        <LinkCard to="/leaderboard"><CardHead title={fr ? 'Taux de conversion par rep' : 'Conversion rate by rep'} right={<PeriodSelector value={period} onChange={setPeriod} />} /><Leaderboard rows={repsConv} emptyLabel={fr ? 'Aucune donnée' : 'No data'} /></LinkCard>
      </div>

      {/* Clients */}
      <SectionHead title="Clients" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <LinkCard to="/clients"><CardHead title={fr ? 'Top clients par revenu' : 'Top clients by revenue'} /><Leaderboard rows={clientRows} loading={clientQ.isLoading} emptyLabel={fr ? 'Aucune donnée' : 'No data'} /></LinkCard>
        <LinkCard to="/clients">
          <CardHead title={fr ? 'Fidélité & valeur client' : 'Loyalty & client value'} right={<PeriodSelector value={period} onChange={setPeriod} />} />
          <div className="px-6 pt-4">
            <div className="flex h-3 rounded-full overflow-hidden bg-surface-tertiary gap-0.5">
              <span className="block h-full rounded-l-full" style={{ width: `${fid.rec}%`, background: 'var(--color-text-primary)' }} />
              <span className="block h-full rounded-r-full" style={{ width: `${100 - fid.rec}%`, background: 'var(--color-text-tertiary)' }} />
            </div>
            <div className="flex gap-6 mt-3">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-text-secondary"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--color-text-primary)' }} />{fr ? 'Récurrents' : 'Recurring'} <b className="text-text-primary tabular-nums">{fid.rec} %</b></div>
              <div className="flex items-center gap-2 text-[12px] font-semibold text-text-secondary"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--color-text-tertiary)' }} />{fr ? 'Nouveaux' : 'New'} <b className="text-text-primary tabular-nums">{100 - fid.rec} %</b></div>
            </div>
          </div>
          <div className="flex gap-10 px-6 mt-6 pb-1">
            <div><div className="text-[24px] font-bold tracking-tight tabular-nums text-text-primary leading-none">{k(fid.ltv)}</div><div className="text-[11.5px] text-text-tertiary mt-1.5">{fr ? 'Valeur vie moy. (LTV)' : 'Avg lifetime value'}</div></div>
            <div><div className="text-[24px] font-bold tracking-tight tabular-nums text-text-primary leading-none">{fid.ret} %</div><div className="text-[11.5px] text-text-tertiary mt-1.5">{fr ? 'Taux de rétention' : 'Retention rate'}</div></div>
          </div>
        </LinkCard>
      </div>

      {/* Conversion des leads */}
      <SectionHead title={fr ? 'Conversion des leads' : 'Lead conversion'} />
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
        <div className="xl:col-span-2">
          <LinkCard to="/pipeline">
            <CardHead title={fr ? 'Entonnoir des leads' : 'Lead funnel'} right={<PeriodSelector value={period} onChange={setPeriod} />} />
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
          </LinkCard>
        </div>
        <div className="pb-5">
          <CardHead title={fr ? 'Taux de conversion' : 'Conversion rate'} right={<PeriodSelector value={period} onChange={setPeriod} />} />
          <div className="text-[30px] font-bold tracking-tight leading-none tabular-nums text-text-primary px-6 mt-3">{TX[period]} %</div>
          <div className="text-[12.5px] text-text-tertiary px-6 mt-2">{fr ? 'devis acceptés / envoyés' : 'quotes accepted / sent'}</div>
          <svg viewBox="0 0 200 56" preserveAspectRatio="none" className="w-[calc(100%-48px)] h-14 block mx-6 mt-3.5">
            <defs><linearGradient id="convspark" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--color-text-primary)" stopOpacity="0.13" /><stop offset="100%" stopColor="var(--color-text-primary)" stopOpacity="0" /></linearGradient></defs>
            <path d="M0,46 L40,42 L80,44 L120,30 L160,26 L200,18 L200,56 L0,56 Z" fill="url(#convspark)" />
            <path d="M0,46 L40,42 L80,44 L120,30 L160,26 L200,18" fill="none" stroke="var(--color-text-primary)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
        <div className="pb-5"><CardHead title={fr ? 'Délai de conversion' : 'Time to convert'} /><div className="text-[30px] font-bold tracking-tight leading-none tabular-nums text-text-primary px-6 mt-3">{DC[period]}&nbsp;{fr ? 'j' : 'd'}</div><div className="text-[12.5px] text-text-tertiary px-6 mt-2">{fr ? 'lead → converti' : 'lead → won'}</div></div>
        <div className="pb-5"><CardHead title={fr ? "Délai d'approbation" : 'Time to approve'} /><div className="text-[30px] font-bold tracking-tight leading-none tabular-nums text-text-primary px-6 mt-3">{DA[period]}&nbsp;{fr ? 'j' : 'd'}</div><div className="text-[12.5px] text-text-tertiary px-6 mt-2">{fr ? 'devis envoyé → accepté' : 'quote sent → accepted'}</div></div>
        <div className="pb-5"><CardHead title={fr ? 'Valeur des devis' : 'Quote value'} /><div className="flex gap-8 px-6 mt-3"><div><div className="text-[26px] font-bold tracking-tight tabular-nums text-text-primary leading-none">{k(Math.round(VD.sent * f2))}</div><div className="text-[11.5px] text-text-tertiary mt-1.5">{fr ? 'Envoyés' : 'Sent'}</div></div><div><div className="text-[26px] font-bold tracking-tight tabular-nums text-text-primary leading-none">{k(Math.round(VD.conv * f2))}</div><div className="text-[11.5px] text-text-tertiary mt-1.5">{fr ? 'Convertis' : 'Won'}</div></div></div><div className="text-[12.5px] text-text-tertiary px-6 mt-4">{Math.round((VD.conv / VD.sent) * 100)} % {fr ? 'de la valeur convertie' : 'of value won'}</div></div>
      </div>

      {/* Trésorerie */}
      <SectionHead title={fr ? 'Trésorerie' : 'Cash flow'} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <LinkCard to="/invoices"><div className="pb-5">
          <CardHead title={fr ? 'À recevoir' : 'Receivables'} />
          <div className="text-[30px] font-bold tracking-tight leading-none tabular-nums text-text-primary px-6 mt-3">{f(18463)}</div>
          <div className="text-[12.5px] text-text-tertiary px-6 mt-2">{fr ? '20 clients te doivent' : '20 clients owe you'}</div>
          <div className="mt-4">
            {([['Miguel Ouellette', 926], ['Anthony Legere', 845], ['Véronique Bouffard', 414]] as Array<[string, number]>).map(([n, v], i) => (
              <div key={i} className="flex items-center justify-between px-6 py-2.5 border-t border-border-light text-[12.5px]"><span className="font-semibold text-text-primary">{n}</span><span className="font-bold text-text-primary tabular-nums">{f(v)}</span></div>
            ))}
          </div>
        </div></LinkCard>
        <LinkCard to="/payments"><div className="pb-5">
          <CardHead title={fr ? 'Versements à venir' : 'Upcoming payouts'} />
          <div className="text-[30px] font-bold tracking-tight leading-none tabular-nums text-text-primary px-6 mt-3">{f(441)}</div>
          <div className="text-[12.5px] text-text-tertiary px-6 mt-2">{fr ? 'prochain dépôt · 8 juil.' : 'next deposit · Jul 8'}</div>
          <div className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-text-primary border-b border-text-tertiary mx-6 mt-4">{fr ? 'Voir 1 versement →' : 'View 1 payout →'}</div>
        </div></LinkCard>
        <div className="pb-5">
          <CardHead title={fr ? 'Délai de paiement' : 'Payment time'} right={<PeriodSelector value={period} onChange={setPeriod} />} />
          <div className="flex gap-8 px-6 mt-3">
            <div><div className="text-[26px] font-bold tracking-tight tabular-nums text-text-primary leading-none flex items-baseline gap-1.5">3&nbsp;{fr ? 'j' : 'd'} <span className="text-[11px] font-bold text-text-secondary">↓ 40%</span></div><div className="text-[11.5px] text-text-tertiary mt-1.5">{fr ? 'Résidentiel' : 'Residential'}</div></div>
            <div><div className="text-[26px] font-bold tracking-tight tabular-nums text-text-primary leading-none">11&nbsp;{fr ? 'j' : 'd'}</div><div className="text-[11.5px] text-text-tertiary mt-1.5">{fr ? 'Commercial' : 'Commercial'}</div></div>
          </div>
          <div className="text-[12.5px] text-text-tertiary px-6 mt-4">{fr ? 'temps moyen · 30 derniers jours' : 'avg · last 30 days'}</div>
        </div>
      </div>

      {/* Zones */}
      <SectionHead title={fr ? 'Zones' : 'Zones'} />
      <ZonesHeatmapCard range={range} period={period} onPeriod={setPeriod} />

      {/* Rentabilité */}
      <SectionHead title={fr ? 'Rentabilité' : 'Profitability'} badge={fr ? 'nécessite le suivi des coûts' : 'requires cost tracking'} />
      <LinkCard to="/jobs">
        <CardHead title={fr ? 'Rentabilité par job' : 'Profitability by job'} right={<PeriodSelector value={period} onChange={setPeriod} />} />
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-[13px] border-collapse">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wide text-text-tertiary">
                <th className="text-left font-bold px-6 py-3 bg-surface-secondary border-b border-border">Client</th>
                <th className="text-right font-bold px-6 py-3 bg-surface-secondary border-b border-border">Job&nbsp;#</th>
                <th className="text-right font-bold px-6 py-3 bg-surface-secondary border-b border-border">{fr ? 'Montant' : 'Amount'}</th>
                <th className="text-right font-bold px-6 py-3 bg-surface-secondary border-b border-border">{fr ? "Main-d'œuvre" : 'Labour'}</th>
                <th className="text-right font-bold px-6 py-3 bg-surface-secondary border-b border-border">{fr ? 'Dépenses' : 'Expenses'}</th>
                <th className="text-right font-bold px-6 py-3 bg-surface-secondary border-b border-border">{fr ? 'Profit' : 'Profit'}</th>
                <th className="text-right font-bold px-6 py-3 bg-surface-secondary border-b border-border">{fr ? 'Marge' : 'Margin'}</th>
              </tr>
            </thead>
            <tbody>
              {PL.map((r, i) => {
                const rev = Math.round(r.rev * f2), mo = Math.round(r.mo * f2), dep = Math.round(r.dep * f2), pf = rev - mo - dep, mg = rev > 0 ? Math.round((pf / rev) * 100) : 0;
                return (
                  <tr key={i} className="hover:bg-surface-secondary">
                    <td className="px-6 py-3 font-semibold text-text-primary border-b border-border-light">{r.c}</td>
                    <td className="px-6 py-3 text-right font-semibold text-text-secondary tabular-nums border-b border-border-light">{r.j}</td>
                    <td className="px-6 py-3 text-right text-text-tertiary tabular-nums border-b border-border-light">{k(rev)}</td>
                    <td className="px-6 py-3 text-right text-text-tertiary tabular-nums border-b border-border-light">{k(mo)}</td>
                    <td className="px-6 py-3 text-right text-text-tertiary tabular-nums border-b border-border-light">{k(dep)}</td>
                    <td className="px-6 py-3 text-right font-bold text-text-primary tabular-nums border-b border-border-light">{k(pf)}</td>
                    <td className="px-6 py-3 text-right font-bold text-text-primary tabular-nums border-b border-border-light">
                      <span className="inline-block w-11 h-[5px] rounded-full bg-surface-tertiary overflow-hidden align-middle mr-2"><span className="block h-full rounded-full" style={{ width: `${Math.max(0, mg)}%`, background: 'var(--color-text-primary)' }} /></span>{mg} %
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              {(() => {
                const tr = PL.reduce((s, r) => s + Math.round(r.rev * f2), 0), tm = PL.reduce((s, r) => s + Math.round(r.mo * f2), 0), td = PL.reduce((s, r) => s + Math.round(r.dep * f2), 0), tp = tr - tm - td, tmg = tr > 0 ? Math.round((tp / tr) * 100) : 0;
                return (
                  <tr className="font-bold bg-surface-secondary">
                    <td className="px-6 py-3.5 border-t border-border">Total</td><td className="border-t border-border" />
                    <td className="px-6 py-3.5 text-right tabular-nums border-t border-border">{k(tr)}</td>
                    <td className="px-6 py-3.5 text-right tabular-nums border-t border-border">{k(tm)}</td>
                    <td className="px-6 py-3.5 text-right tabular-nums border-t border-border">{k(td)}</td>
                    <td className="px-6 py-3.5 text-right tabular-nums border-t border-border">{k(tp)}</td>
                    <td className="px-6 py-3.5 text-right tabular-nums border-t border-border">{tmg} %</td>
                  </tr>
                );
              })()}
            </tfoot>
          </table>
        </div>
      </LinkCard>

      <div className="h-16" />
    </div>
  );
}
