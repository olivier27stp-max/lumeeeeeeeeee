/**
 * Statistiques (/insights) — le tableau de bord de l'entreprise. Une période et des filtres pour
 * toute la page (BarreFiltres, reflétés dans l'URL), la comparaison à la période précédente,
 * l'export CSV, et pour chaque chiffre « Voir le détail » : les lignes exactes qui le composent.
 * Les calculs vivent en base (statistiquesApi → rpc_insights_*). Accès : permission
 * financial.view_analytics de la page Rôles (la même clé que la base vérifie).
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from '../i18n';
import { useCompany } from '../contexts/CompanyContext';
import { usePermissions } from '../hooks/usePermissions';
import { hasPermission } from '../lib/permissions';
import { fetchPayoutSummary } from '../lib/paymentsApi';
import { exportToCsv } from '../lib/exportCsv';
import * as S from '../lib/statistiquesApi';
import {
  ecrireUrl, filtresNonAppliques, lireUrl, plage, plagePrecedente, variation, type EtatStats, type Filtres,
} from '../lib/statsFiltres';
import { periodLabel } from '../lib/insightsPeriod';
import BarreFiltres from '../components/insights/BarreFiltres';
import RevenueTrendCard from '../components/insights/RevenueTrendCard';
import CarteBeignet from '../components/insights/CarteBeignet';
import MiniTrendCard from '../components/insights/MiniTrendCard';
import ZonesHeatmapCard from '../components/insights/ZonesHeatmapCard';
import ProfitabilityCard, { cleRentabilite, lireRentabilitePage } from '../components/insights/ProfitabilityCard';
import EnteteCarte, { PastilleVariation } from '../components/insights/EnteteCarte';
import ErreurCarte from '../components/insights/ErreurCarte';
import PanneauDetail, { type DemandeDetail } from '../components/insights/PanneauDetail';

const MODES: Record<string, { fr: string; en: string }> = {
  card: { fr: 'Carte', en: 'Card' },
  'e-transfer': { fr: 'Virement Interac', en: 'e-Transfer' },
  cash: { fr: 'Comptant', en: 'Cash' },
  check: { fr: 'Chèque', en: 'Cheque' },
  other: { fr: 'Autre', en: 'Other' },
};

function SectionHead({ title }: { title: string }) {
  return <h2 className="text-[12px] font-bold uppercase tracking-wide text-text-tertiary mt-9 first:mt-0 mb-3 px-0.5">{title}</h2>;
}

/** Classement (équipes, clients) : chaque ligne ouvre son détail. */
function Classement({ lignes, chargement, erreur, onRetry, vide, onLigne }: {
  lignes: Array<{ cle: string; nom: string; principal: string; secondaire?: string; poids: number }>;
  chargement: boolean; erreur: boolean; onRetry: () => void; vide: string; onLigne: (cle: string, nom: string) => void;
}) {
  if (erreur) return <ErreurCarte onRetry={onRetry} />;
  if (chargement) return <div className="px-6 py-5 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-8 rounded bg-surface-secondary/50 animate-pulse" />)}</div>;
  if (lignes.length === 0) return <div className="h-[120px] flex items-center justify-center text-[12.5px] text-text-tertiary">{vide}</div>;
  const max = Math.max(1, ...lignes.map((r) => r.poids));
  const ini = (n: string) => n.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <ul className="flex flex-col px-6 pt-1.5 pb-4">
      {lignes.map((r, i) => (
        <li key={r.cle}>
          <button type="button" onClick={() => onLigne(r.cle, r.nom)}
            className="grid w-full grid-cols-[16px_34px_1fr_auto] items-center gap-3.5 py-3 border-b border-border-light text-left rounded-md hover:bg-surface-secondary/60 focus-visible:outline-none focus-visible:bg-surface-secondary">
            <span className={`text-[12px] font-bold text-center tabular-nums ${i === 0 ? 'text-text-primary' : 'text-text-tertiary'}`}>{i + 1}</span>
            <span className={`w-[34px] h-[34px] rounded-full grid place-items-center text-[12px] font-bold ${i === 0 ? '' : 'bg-surface-secondary border border-border text-text-secondary'}`}
              style={i === 0 ? { background: 'var(--color-text-primary)', color: 'var(--color-surface)' } : undefined}>{ini(r.nom)}</span>
            <span className="min-w-0">
              <span className="block text-[13.5px] font-semibold tracking-tight truncate text-text-primary">{r.nom}</span>
              <span className="block h-1.5 rounded-full bg-surface-tertiary overflow-hidden mt-2"><span className="block h-full rounded-full" style={{ width: `${Math.round((r.poids / max) * 100)}%`, background: 'var(--color-text-primary)' }} /></span>
            </span>
            <span className="text-right">
              <span className="block text-[15px] font-bold tracking-tight tabular-nums text-text-primary">{r.principal}</span>
              {r.secondaire && <span className="block text-[11px] font-semibold text-text-tertiary mt-0.5">{r.secondaire}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Tuile chiffrée : valeur, libellé, définition, variation, détail. */
function Tuile({ valeur, libelle, sous, v, onDetail, cents }: {
  valeur: string; libelle: string; sous?: string; v?: ReturnType<typeof variation>; onDetail?: () => void; cents?: number;
}) {
  const { language } = useTranslation();
  const corps = (
    <>
      <span className="flex items-baseline gap-2.5 px-6 mt-3">
        <span className="text-[30px] font-bold tracking-tight leading-none tabular-nums text-text-primary" data-cents={cents}>{valeur}</span>
        <PastilleVariation v={v} />
      </span>
      <span className="block text-[12.5px] text-text-tertiary px-6 mt-2">{libelle}</span>
      {sous && <span className="block text-[11.5px] text-text-tertiary px-6 mt-1">{sous}</span>}
    </>
  );
  if (!onDetail) return <div className="pb-5">{corps}</div>;
  return (
    <button type="button" onClick={onDetail} title={language === 'fr' ? 'Voir le détail' : 'View details'}
      className="block w-full pb-5 text-left rounded-xl hover:bg-surface-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-tertiary">
      {corps}
    </button>
  );
}

/** Requête d'une carte pour la période et, si demandé, pour la période précédente. */
function usePaire<T>(nom: string, cle: string, fn: (p: S.Plage, f: Filtres) => Promise<T>, p: S.Plage, prec: S.Plage, f: Filtres, comparer: boolean, actif: boolean) {
  const opts = { staleTime: 60_000, refetchOnMount: 'always' as const };
  const q = useQuery({ queryKey: ['stats', nom, p.from, p.to, p.granularity, cle], queryFn: () => fn(p, f), enabled: actif, ...opts });
  const qp = useQuery({ queryKey: ['stats', nom, prec.from, prec.to, prec.granularity, cle], queryFn: () => fn(prec, f), enabled: actif && comparer, ...opts });
  return [q, qp] as const;
}

const Carte = ({ children }: { children: ReactNode }) => <div className="rounded-xl">{children}</div>;

export default function Statistiques() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const navigate = useNavigate();
  const { currentOrgId } = useCompany();
  const perms = usePermissions();
  const autorise = hasPermission(perms.permissions, 'financial.view_analytics', perms.role ?? undefined);

  const [params, setParams] = useSearchParams();
  const etat = useMemo(() => lireUrl(params), [params]);
  const changerEtat = useCallback((e: EtatStats) => setParams(ecrireUrl(e), { replace: true }), [setParams]);
  const p = useMemo(() => plage(etat), [etat]);
  const prec = useMemo(() => plagePrecedente(p), [p]);
  const f = etat.filtres;
  const fk = JSON.stringify(f);
  const cmp = etat.comparer;
  const [demande, setDemande] = useState<DemandeDetail | null>(null);

  const [revQ, revPQ] = usePaire('revenu', fk, S.serieRevenus, p, prec, f, cmp, autorise);
  const [svcQ, svcPQ] = usePaire('services', fk, S.revenuParService, p, prec, f, cmp, autorise);
  const [modQ, modPQ] = usePaire('modes', fk, S.modesPaiement, p, prec, f, cmp, autorise);
  const [jobQ, jobPQ] = usePaire('jobs', fk, S.jobsCompletes, p, prec, f, cmp, autorise);
  const [eqQ] = usePaire('equipes', fk, S.equipes, p, prec, f, false, autorise);
  const [cliQ] = usePaire('clients', fk, (pp, ff) => S.topClients(pp, ff, 5), p, prec, f, false, autorise);
  const [entQ, entPQ] = usePaire('entonnoir', fk, S.entonnoir, p, prec, f, cmp, autorise);
  const [pipQ, pipPQ] = usePaire('pipeline', fk, S.pipeline, p, prec, f, cmp, autorise);
  const [souQ, souPQ] = usePaire('soumissions', fk, S.soumissions, p, prec, f, cmp, autorise);
  const [treQ, trePQ] = usePaire('tresorerie', fk, S.tresorerie, p, prec, f, cmp, autorise);
  const [zonQ, zonPQ] = usePaire('zones', fk, S.zones, p, prec, f, cmp, autorise);
  const ltvQ = useQuery({ queryKey: ['stats', 'ltv', fk], queryFn: () => S.valeurVieMoyenne(f), enabled: autorise, staleTime: 60_000, refetchOnMount: 'always' });
  const retQ = useQuery({ queryKey: ['stats', 'retention'], queryFn: S.retentionPct, enabled: autorise, staleTime: 5 * 60_000 });
  const rentaQ = useQuery({ queryKey: cleRentabilite(p, f), queryFn: () => lireRentabilitePage(p, f), enabled: autorise, retry: false, staleTime: 30_000 });
  const payoutQ = useQuery({ queryKey: ['stats-payout', currentOrgId], queryFn: () => fetchPayoutSummary({ orgId: currentOrgId as string, provider: 'stripe' }), enabled: autorise && !!currentOrgId, retry: false, staleTime: 60_000 });

  const kc = useCallback((cents: number) => new Intl.NumberFormat(fr ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD', notation: 'compact', maximumFractionDigits: 1 }).format((cents || 0) / 100), [fr]);
  const jours = (j: number | null | undefined) => (j == null ? '—' : `${Math.round(j)} ${fr ? 'j' : 'd'}`);
  const nJobs = (n: number) => `${n} job${n > 1 ? 's' : ''}`;
  const nonAppl = (carte: string) => filtresNonAppliques(carte, f);
  const somme = (parts: S.Part[] | undefined) => (parts || []).reduce((s, x) => s + x.valeur, 0);
  const totalRev = (pts: S.PointRevenu[] | undefined) => (pts || []).reduce((s, x) => s + x.encaisseCents, 0);
  const totalZones = (z: S.ZoneAdresse[] | undefined) => (z || []).reduce((s, x) => s + x.revenuCents, 0);
  const libelleMode = useCallback((c: string) => (MODES[c] ? (fr ? MODES[c].fr : MODES[c].en) : c), [fr]);
  const libelleService = useCallback((c: string) => (c === 'other' ? (fr ? 'Autres' : 'Others') : c === '(sans détail)' ? (fr ? '(jobs sans lignes)' : '(jobs without lines)') : c), [fr]);
  const libellePeriode = etat.periode === 'custom' && etat.du && etat.au ? `${etat.du} → ${etat.au}` : periodLabel(etat.periode === 'custom' ? '12m' : etat.periode, fr);
  const ouvrir = (d: DemandeDetail) => setDemande({ ...d, titre: `${d.titre} · ${libellePeriode}` });

  /* ── Export CSV : tous les chiffres de la page, période et filtres en tête ── */
  const exporter = () => {
    const lignes: string[][] = [];
    const ajout = (section: string, indicateur: string, valeur: string | number, precedent?: string | number | null) =>
      lignes.push([section, indicateur, String(valeur), cmp ? String(precedent ?? '') : '']);
    const $ = (c: number) => (c / 100).toFixed(2);
    const V = fr ? 'Ventes' : 'Sales';
    ajout(fr ? 'Période' : 'Period', `${p.from} → ${p.to}`, libellePeriode, cmp ? `${prec.from} → ${prec.to}` : '');
    for (const [k, v] of Object.entries(f)) if (v) ajout(fr ? 'Filtre' : 'Filter', k, v);
    ajout(fr ? 'Revenu' : 'Revenue', fr ? 'Encaissé ($, taxes incluses)' : 'Collected ($, taxes incl.)', $(totalRev(revQ.data)), cmp ? $(totalRev(revPQ.data)) : '');
    for (const pt of revQ.data || []) ajout(fr ? 'Revenu par période' : 'Revenue by period', pt.debut, $(pt.encaisseCents));
    for (const s of svcQ.data || []) ajout(fr ? 'Revenu par service ($, avant taxes)' : 'Revenue by service ($, before taxes)', libelleService(s.cle), $(s.valeur));
    for (const m of modQ.data || []) ajout(fr ? 'Modes de paiement ($)' : 'Payment methods ($)', libelleMode(m.cle), $(m.valeur));
    ajout('Jobs', fr ? 'Valeur moyenne ($)' : 'Average value ($)', $(jobQ.data?.moyenneCents ?? 0), cmp ? $(jobPQ.data?.moyenneCents ?? 0) : '');
    ajout('Jobs', fr ? 'Jobs complétés' : 'Completed jobs', jobQ.data?.nombre ?? 0, cmp ? jobPQ.data?.nombre ?? 0 : '');
    ajout('Jobs', fr ? 'Part récurrente (%)' : 'Recurring share (%)', jobQ.data?.partRecurrentePct ?? 0, cmp ? jobPQ.data?.partRecurrentePct ?? 0 : '');
    for (const e of eqQ.data || []) {
      ajout(fr ? 'Équipes' : 'Teams', `${e.nom} — ${fr ? 'revenu des jobs complétés ($)' : 'completed jobs revenue ($)'}`, $(e.revenuCents));
      ajout(fr ? 'Équipes' : 'Teams', `${e.nom} — ${fr ? 'jobs complétés / créés' : 'jobs completed / created'}`, `${e.completes}/${e.jobs}`);
      ajout(fr ? 'Équipes' : 'Teams', `${e.nom} — ${fr ? 'taux de complétion (%)' : 'completion rate (%)'}`, e.tauxPct);
    }
    for (const c of cliQ.data || []) ajout(fr ? 'Top clients ($ encaissés)' : 'Top clients ($ collected)', c.nom, $(c.cents));
    ajout('Clients', fr ? 'Valeur vie moyenne ($)' : 'Average lifetime value ($)', $(ltvQ.data?.moyenneCents ?? 0));
    ajout('Clients', fr ? 'Rétention (%)' : 'Retention (%)', retQ.data ?? 0);
    ajout(V, fr ? 'Nouveaux leads' : 'New leads', entQ.data?.crees ?? 0, cmp ? entPQ.data?.crees ?? 0 : '');
    ajout(V, fr ? 'Leads avec soumission' : 'Leads with a quote', entQ.data?.avecSoumission ?? 0, cmp ? entPQ.data?.avecSoumission ?? 0 : '');
    ajout(V, fr ? 'Leads devenus clients' : 'Leads converted', entQ.data?.convertis ?? 0, cmp ? entPQ.data?.convertis ?? 0 : '');
    ajout(V, fr ? 'Taux de conversion (%)' : 'Conversion rate (%)', entQ.data?.tauxPct ?? 0, cmp ? entPQ.data?.tauxPct ?? 0 : '');
    ajout(V, fr ? 'Taux de réussite des deals (%)' : 'Deal win rate (%)', pipQ.data?.tauxPct ?? '', cmp ? pipPQ.data?.tauxPct ?? '' : '');
    ajout(V, fr ? 'Soumissions ($)' : 'Quotes ($)', $(souQ.data?.valeurCents ?? 0), cmp ? $(souPQ.data?.valeurCents ?? 0) : '');
    ajout(V, fr ? 'Soumissions approuvées ($)' : 'Approved quotes ($)', $(souQ.data?.valeurApprouveeCents ?? 0), cmp ? $(souPQ.data?.valeurApprouveeCents ?? 0) : '');
    ajout(fr ? 'Trésorerie' : 'Cash flow', fr ? 'À recevoir à ce jour ($)' : 'Receivables today ($)', $(treQ.data?.aRecevoirCents ?? 0));
    ajout(fr ? 'Trésorerie' : 'Cash flow', fr ? 'Factures en retard' : 'Past-due invoices', treQ.data?.enRetard ?? 0);
    ajout(fr ? 'Trésorerie' : 'Cash flow', fr ? 'Délai de paiement (jours)' : 'Payment time (days)', treQ.data?.delaiJours?.toFixed(1) ?? '', cmp ? trePQ.data?.delaiJours?.toFixed(1) ?? '' : '');
    ajout('Zones', fr ? 'Revenu réalisé ($)' : 'Revenue realized ($)', $(totalZones(zonQ.data)), cmp ? $(totalZones(zonPQ.data)) : '');
    if (rentaQ.data) {
      ajout(fr ? 'Rentabilité' : 'Profitability', fr ? 'Revenus ($, avant taxes)' : 'Revenue ($, before taxes)', $(rentaQ.data.total_revenue_cents));
      ajout(fr ? 'Rentabilité' : 'Profitability', 'Profit ($)', $(rentaQ.data.total_profit_cents));
    }
    exportToCsv(`statistiques_${p.from}_${p.to}.csv`, ['Section', fr ? 'Indicateur' : 'Metric', fr ? 'Valeur' : 'Value', cmp ? (fr ? 'Période précédente' : 'Previous period') : ''], lignes);
  };
  const exportPret = !revQ.isLoading && !svcQ.isLoading && !modQ.isLoading && !jobQ.isLoading && !entQ.isLoading && !treQ.isLoading;

  if (perms.loading) return null;
  if (!autorise) {
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

  const jc = jobQ.data;
  const ent = entQ.data;
  const pip = pipQ.data;
  const sou = souQ.data;
  const tre = treQ.data;
  const payout = payoutQ.data && payoutQ.data.meta?.source !== 'not_connected' ? payoutQ.data : undefined;
  const moisAjv = jc?.mois || [];
  const serieAjv = {
    labels: moisAjv.map((m) => new Intl.DateTimeFormat(fr ? 'fr-CA' : 'en-CA', { month: 'short' }).format(new Date(`${m.mois}-15T12:00:00`))),
    vals: moisAjv.map((m) => (m.nombre ? Math.round(m.totalCents / m.nombre) : 0)),
  };
  const deriveAjv = () => ({ hero: jc && jc.nombre ? kc(jc.moyenneCents) : '—', delta: '', sub: `${jc?.nombre ?? 0} ${fr ? 'jobs complétés' : 'completed jobs'} · ${libellePeriode}` });
  const etapes = [
    { cle: 'leads' as const, label: fr ? 'Nouveaux leads' : 'New leads', v: ent?.crees ?? 0 },
    { cle: 'leads_soumission' as const, label: fr ? 'Avec une soumission' : 'With a quote', v: ent?.avecSoumission ?? 0 },
    { cle: 'leads_convertis' as const, label: fr ? 'Devenus clients (job)' : 'Became clients (job)', v: ent?.convertis ?? 0 },
  ];
  const maxEtape = Math.max(1, etapes[0].v);

  return (
    <div>
      <div>
        <h1 className="text-[28px] font-bold text-text-primary leading-tight tracking-tight">{fr ? 'Statistiques' : 'Statistics'}</h1>
        <p className="text-[13px] text-text-tertiary mt-1">
          {fr ? "Analytiques et rapports d'affaires" : 'Business analytics & reports'} · {libellePeriode}
          {cmp ? (fr ? ` · comparé au ${prec.from} → ${prec.to}` : ` · vs ${prec.from} → ${prec.to}`) : ''}
        </p>
        <BarreFiltres etat={etat} onChange={changerEtat} onExporter={exporter} exportPret={exportPret} />
      </div>

      <SectionHead title={fr ? 'Revenu' : 'Revenue'} />
      <RevenueTrendCard points={revQ.data || []} granularite={p.granularity} chargement={revQ.isLoading} erreur={revQ.isError} onRetry={() => revQ.refetch()}
        variation={cmp && revPQ.data ? variation(totalRev(revQ.data), totalRev(revPQ.data), 'pct', fr) : null} nonAppliques={nonAppl('revenu')}
        onDetail={(mois, lib) => ouvrir({ carte: 'revenu', cle: mois, titre: mois ? `${fr ? 'Encaissé' : 'Collected'} — ${lib}` : (fr ? 'Encaissé' : 'Collected') })} />

      <SectionHead title={fr ? 'Répartition' : 'Breakdown'} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <CarteBeignet titre={fr ? 'Revenu par service' : 'Revenue by service'} definition={fr ? 'Lignes des jobs complétés, avant taxes' : 'Completed job lines, before taxes'}
          parts={S.top3EtAutres(svcQ.data || [])} libelle={libelleService} chargement={svcQ.isLoading} erreur={svcQ.isError} onRetry={() => svcQ.refetch()}
          variation={cmp && svcPQ.data ? variation(somme(svcQ.data), somme(svcPQ.data), 'pct', fr) : null} nonAppliques={nonAppl('services')}
          vide={fr ? 'Aucun job complété' : 'No completed jobs'}
          onDetail={(cle) => (cle && cle !== 'other' ? ouvrir({ carte: 'service', cle, titre: libelleService(cle) }) : ouvrir({ carte: 'valeur_moyenne', titre: fr ? 'Jobs complétés' : 'Completed jobs' }))} />
        <CarteBeignet titre={fr ? 'Modes de paiement' : 'Payment methods'} definition={fr ? 'Paiements encaissés, nets des remboursements' : 'Payments collected, net of refunds'}
          parts={S.top3EtAutres(modQ.data || [])} libelle={libelleMode} chargement={modQ.isLoading} erreur={modQ.isError} onRetry={() => modQ.refetch()}
          variation={cmp && modPQ.data ? variation(somme(modQ.data), somme(modPQ.data), 'pct', fr) : null} nonAppliques={nonAppl('modes')}
          vide={fr ? 'Aucun paiement sur la période' : 'No payments for this period'}
          onDetail={(cle) => (cle && cle !== 'other' ? ouvrir({ carte: 'mode', cle, titre: libelleMode(cle) }) : ouvrir({ carte: 'revenu', titre: fr ? 'Encaissé' : 'Collected' }))} />
      </div>

      <SectionHead title={fr ? 'Jobs & équipes' : 'Jobs & teams'} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Carte>
          <MiniTrendCard title={fr ? "Valeur moyenne d'un job" : 'Average job value'} definition={fr ? 'Jobs complétés dans la période, taxes incluses' : 'Jobs completed in the period, taxes included'}
            series={serieAjv} loading={jobQ.isLoading} erreur={jobQ.isError} onRetry={() => jobQ.refetch()} derive={deriveAjv} fmt={kc}
            variation={cmp && jobPQ.data ? variation(jc?.moyenneCents, jobPQ.data.moyenneCents, 'pct', fr) : null} nonAppliques={nonAppl('valeurMoyenne')}
            onDetail={() => ouvrir({ carte: 'valeur_moyenne', titre: fr ? 'Jobs complétés' : 'Completed jobs' })} />
        </Carte>
        <Carte>
          <EnteteCarte titre={fr ? 'Équipes' : 'Teams'} nonAppliques={nonAppl('equipes')}
            definition={fr ? 'Jobs créés dans la période : revenu des complétés (taxes incluses) et taux de complétion' : 'Jobs created in the period: completed revenue (taxes incl.) and completion rate'} />
          <Classement chargement={eqQ.isLoading} erreur={eqQ.isError} onRetry={() => eqQ.refetch()} vide={fr ? 'Aucune équipe active' : 'No active team'}
            lignes={(eqQ.data || []).slice(0, 6).map((t) => ({ cle: t.id, nom: t.nom, principal: kc(t.revenuCents), secondaire: `${t.completes}/${nJobs(t.jobs)} · ${Math.round(t.tauxPct)} %`, poids: t.revenuCents }))}
            onLigne={(cle, nom) => ouvrir({ carte: 'equipe', cle, titre: nom })} />
        </Carte>
      </div>

      <SectionHead title="Clients" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Carte>
          <EnteteCarte titre="Top clients" definition={fr ? 'Ceux qui ont le plus payé sur la période' : 'Those who paid the most in the period'} nonAppliques={nonAppl('topClients')} />
          <Classement chargement={cliQ.isLoading} erreur={cliQ.isError} onRetry={() => cliQ.refetch()} vide={fr ? 'Aucun paiement sur la période' : 'No payments for this period'}
            lignes={(cliQ.data || []).map((c) => ({ cle: c.id, nom: c.nom, principal: kc(c.cents), secondaire: `${c.paiements} ${fr ? (c.paiements > 1 ? 'paiements' : 'paiement') : c.paiements > 1 ? 'payments' : 'payment'}`, poids: c.cents }))}
            onLigne={(cle, nom) => ouvrir({ carte: 'client', cle, titre: nom })} />
        </Carte>
        <Carte>
          <EnteteCarte titre={fr ? 'Fidélité & valeur client' : 'Loyalty & client value'} nonAppliques={nonAppl('fidelite')}
            definition={fr ? 'Part récurrente : jobs complétés dans la période · valeur vie : à vie · rétention : 12 derniers mois' : 'Recurring share: jobs completed in the period · lifetime value: all-time · retention: last 12 months'} />
          {jobQ.isError || ltvQ.isError ? <ErreurCarte onRetry={() => { jobQ.refetch(); ltvQ.refetch(); }} /> : (
            <>
              <div className="px-6 pt-4">
                <div className="flex h-3 rounded-full overflow-hidden bg-surface-tertiary gap-0.5">
                  <span className="block h-full rounded-l-full" style={{ width: `${jc?.partRecurrentePct ?? 0}%`, background: 'var(--color-text-primary)' }} />
                  <span className="block h-full rounded-r-full" style={{ width: `${100 - (jc?.partRecurrentePct ?? 0)}%`, background: 'var(--color-text-tertiary)' }} />
                </div>
                <div className="flex flex-wrap gap-6 mt-3">
                  <div className="flex items-center gap-2 text-[12px] font-semibold text-text-secondary"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--color-text-primary)' }} />{fr ? 'Récurrent' : 'Recurring'} <b className="text-text-primary tabular-nums">{jc?.partRecurrentePct ?? 0} %</b>
                    <PastilleVariation v={cmp && jobPQ.data ? variation(jc?.partRecurrentePct, jobPQ.data.partRecurrentePct, 'points', fr) : null} /></div>
                  <div className="flex items-center gap-2 text-[12px] font-semibold text-text-secondary"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--color-text-tertiary)' }} />{fr ? 'Ponctuel' : 'One-off'} <b className="text-text-primary tabular-nums">{100 - (jc?.partRecurrentePct ?? 0)} %</b></div>
                </div>
              </div>
              <div className="flex gap-10 px-6 mt-6 pb-5">
                <div><div className="text-[24px] font-bold tracking-tight tabular-nums text-text-primary leading-none" data-cents={ltvQ.data?.moyenneCents}>{kc(ltvQ.data?.moyenneCents ?? 0)}</div><div className="text-[11.5px] text-text-tertiary mt-1.5">{fr ? 'Valeur vie moy.' : 'Avg lifetime value'} · {ltvQ.data?.clients ?? 0} clients</div></div>
                <div><div className="text-[24px] font-bold tracking-tight tabular-nums text-text-primary leading-none">{retQ.data ?? 0} %</div><div className="text-[11.5px] text-text-tertiary mt-1.5">{fr ? 'Rétention (sans filtres)' : 'Retention (unfiltered)'}</div></div>
              </div>
            </>
          )}
        </Carte>
      </div>

      <SectionHead title={fr ? 'Ventes' : 'Sales'} />
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
        <div className="xl:col-span-2">
          <EnteteCarte titre={fr ? 'Entonnoir des leads' : 'Lead funnel'} nonAppliques={nonAppl('entonnoir')}
            definition={fr ? 'Les leads créés dans la période, et ce qu’ils sont devenus depuis' : 'Leads created in the period, and what became of them since'} />
          {entQ.isError ? <ErreurCarte hauteur={196} onRetry={() => entQ.refetch()} /> : entQ.isLoading ? <div className="h-[196px] mx-6 mt-4 rounded-lg bg-surface-secondary/40 animate-pulse" /> : (
            <div className="flex items-end gap-3 h-[196px] px-6 pt-4 pb-5">
              {etapes.map((s, i) => {
                const pct = i > 0 && etapes[0].v > 0 ? Math.round((s.v / etapes[0].v) * 100) : null;
                return (
                  <button type="button" key={s.cle} onClick={() => ouvrir({ carte: s.cle, titre: s.label, unite: 'compte' })}
                    className="flex-1 flex flex-col items-center justify-end h-full gap-2.5 rounded-lg hover:bg-surface-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-tertiary">
                    <span className="w-3/4 max-w-[96px] rounded-t-md flex items-start justify-center font-extrabold text-[15px] pt-2 tabular-nums" style={{ height: `${Math.max(8, (s.v / maxEtape) * 100)}%`, background: 'var(--color-text-primary)', color: 'var(--color-surface)' }}>{s.v}</span>
                    <span className="text-[11px] text-text-tertiary font-semibold text-center leading-snug">{s.label}{pct != null && <><br /><b className="text-text-secondary">{pct} % {fr ? 'des leads' : 'of leads'}</b></>}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div>
          <EnteteCarte titre={fr ? 'Taux de conversion' : 'Conversion rate'} definition={fr ? 'Leads de la période devenus clients' : 'Leads of the period who became clients'} />
          <Tuile valeur={entQ.isError ? '—' : `${ent?.tauxPct ?? 0} %`} libelle={fr ? 'leads convertis / leads créés' : 'leads converted / leads created'}
            v={cmp && entPQ.data ? variation(ent?.tauxPct, entPQ.data.tauxPct, 'points', fr) : null}
            onDetail={() => ouvrir({ carte: 'leads_convertis', titre: fr ? 'Leads devenus clients' : 'Leads converted', unite: 'compte' })} />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
        <Tuile valeur={jours(ent?.joursMoyens)} libelle={fr ? 'Délai de conversion' : 'Time to convert'} sous={fr ? 'création du lead → premier job' : 'lead created → first job'}
          v={cmp && entPQ.data ? variation(ent?.joursMoyens, entPQ.data.joursMoyens, 'jours', fr) : null}
          onDetail={() => ouvrir({ carte: 'leads_convertis', titre: fr ? 'Leads devenus clients' : 'Leads converted', unite: 'compte' })} />
        <Tuile valeur={pipQ.isError || pip?.tauxPct == null ? '—' : `${Math.round(pip.tauxPct)} %`} libelle={fr ? 'Taux de réussite des deals' : 'Deal win rate'}
          sous={fr ? `gagnés / (gagnés + perdus) · ${pip?.gagnes ?? 0} gagnés, ${pip?.perdus ?? 0} perdus` : `won / (won + lost) · ${pip?.gagnes ?? 0} won, ${pip?.perdus ?? 0} lost`}
          v={cmp && pipPQ.data ? variation(pip?.tauxPct, pipPQ.data.tauxPct, 'points', fr) : null}
          onDetail={() => ouvrir({ carte: 'deals_gagnes', titre: fr ? 'Deals gagnés' : 'Deals won' })} />
        <Tuile valeur={kc(sou?.valeurCents ?? 0)} cents={sou?.valeurCents} libelle={fr ? 'Soumissions créées (taxes incluses)' : 'Quotes created (taxes incl.)'}
          sous={`${fr ? 'dont approuvées' : 'approved'} : ${kc(sou?.valeurApprouveeCents ?? 0)} (${sou && sou.valeurCents > 0 ? Math.round((sou.valeurApprouveeCents / sou.valeurCents) * 100) : 0} %)`}
          v={cmp && souPQ.data ? variation(sou?.valeurCents, souPQ.data.valeurCents, 'pct', fr) : null}
          onDetail={() => ouvrir({ carte: 'soumissions', titre: fr ? 'Soumissions' : 'Quotes' })} />
      </div>
      {nonAppl('soumissions').length > 0 && (
        <p className="mt-1 px-6 text-[11px] font-semibold text-text-secondary">{fr ? 'Soumissions, deals et entonnoir : les filtres équipe et technicien ne s’y appliquent pas.' : 'Quotes, deals and funnel: team and technician filters do not apply.'}</p>
      )}

      <SectionHead title={fr ? 'Trésorerie' : 'Cash flow'} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Tuile valeur={treQ.isError ? '—' : kc(tre?.aRecevoirCents ?? 0)} cents={tre?.aRecevoirCents} libelle={fr ? 'À recevoir, à ce jour' : 'Receivables, as of today'}
          sous={`${tre?.enRetard ?? 0} ${fr ? 'en retard' : 'past due'}`}
          onDetail={() => ouvrir({ carte: 'a_recevoir', titre: fr ? 'Factures à recevoir' : 'Receivables' })} />
        <Tuile valeur={payoutQ.isError ? '—' : payout ? kc(payout.on_the_way || 0) : '—'} libelle={fr ? 'Versements à venir' : 'Upcoming payouts'}
          sous={payoutQ.isError ? (fr ? 'lecture impossible — réessaie plus tard' : 'could not load — try again later') : payout ? (fr ? 'en transit chez Stripe' : 'in transit at Stripe') : (fr ? 'aucun compte connecté' : 'no account connected')} />
        <Tuile valeur={jours(tre?.delaiJours)} libelle={fr ? 'Délai de paiement' : 'Payment time'} sous={fr ? 'émission → paiement, factures payées dans la période' : 'issued → paid, invoices paid in the period'}
          v={cmp && trePQ.data ? variation(tre?.delaiJours, trePQ.data.delaiJours, 'jours', fr) : null}
          onDetail={() => ouvrir({ carte: 'delai', titre: fr ? 'Délai de paiement' : 'Payment time', unite: 'jours' })} />
      </div>
      {tre && tre.enRetard > 0 && (
        <button type="button" onClick={() => ouvrir({ carte: 'en_retard', titre: fr ? 'Factures en retard' : 'Past-due invoices' })}
          className="mt-1 px-6 text-[12px] font-semibold text-text-secondary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-tertiary rounded">
          {fr ? `Voir les ${tre.enRetard} factures en retard` : `View the ${tre.enRetard} past-due invoices`}
        </button>
      )}

      <SectionHead title="Zones" />
      <ZonesHeatmapCard lignes={zonQ.data} chargement={zonQ.isLoading} erreur={zonQ.isError} onRetry={() => zonQ.refetch()} nonAppliques={nonAppl('zones')}
        variation={cmp && zonPQ.data ? variation(totalZones(zonQ.data), totalZones(zonPQ.data), 'pct', fr) : null}
        onDetail={(ville, ids) => ouvrir({ carte: 'jobs', cle: JSON.stringify(ids), titre: ville ?? (fr ? 'Jobs réalisés' : 'Completed jobs') })} />

      <SectionHead title={fr ? 'Rentabilité' : 'Profitability'} />
      <ProfitabilityCard range={p} filtres={f} />

      <PanneauDetail demande={demande} plage={p} filtres={f} onFermer={() => setDemande(null)} />
      <div className="h-16" />
    </div>
  );
}
