/**
 * Pipeline de ventes — onglet « Statistiques ».
 *
 * Tout vient des fonctions Postgres `pipeline_*` (SECURITY INVOKER : elles ne
 * voient que ce que l'utilisateur connecté peut voir, `org_id` n'est jamais un
 * paramètre). Aucun calcul métier n'est refait ici — la base est la seule à
 * décider, l'écran se contente de présenter.
 *
 * Deux formules de conversion cohabitent, et c'est VOULU :
 *  - le taux de closing ne regarde que les deals FERMÉS (gagnés + perdus) ;
 *  - la cohorte du formulaire rapporte les gagnés à TOUS les inscrits du mois,
 *    les deals encore ouverts compris. Chaque tuile le dit dans son infobulle.
 *
 * Les taux rendus par la base sont déjà en pourcentage (0–100), jamais en
 * fraction : les convertir une seconde fois donnerait « 0,42 % » pour 42 %.
 */
import { useId, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Info, Loader2, Target } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import EmptyState from '../ui/EmptyState';
import PeriodSelector from '../insights/PeriodSelector';
import {
  DEFAULT_INSIGHTS_PERIOD,
  periodRange,
  type InsightsPeriod,
} from '../../lib/insightsPeriod';
import {
  fetchATraiter,
  fetchCohortes,
  fetchEntonnoir,
  fetchKpis,
  fetchParSource,
  fetchTendance,
  fetchRaisonsPerte,
  fetchParVendeur,
  fetchVitesse,
  type ATraiterRow,
} from '../../lib/pipelineVentesApi';

// ---------------------------------------------------------------------------
// Petits utilitaires locaux
// ---------------------------------------------------------------------------

/** Taux rendu par la base : déjà 0–100. `null` = « rien à mesurer ». */
function pourcentDb(valeur: number | null, fr: boolean): string {
  if (valeur === null) return '—';
  return `${new Intl.NumberFormat(fr ? 'fr-CA' : 'en-CA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(valeur)} %`;
}

function nombre(n: number, fr: boolean, decimales = 1): string {
  return new Intl.NumberFormat(fr ? 'fr-CA' : 'en-CA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimales,
  }).format(n);
}

/** Montant en cents → « 1 250 $ ». Les cents sont la source de vérité. */
function montant(cents: number | null, fr: boolean): string {
  if (cents === null) return '—';
  return new Intl.NumberFormat(fr ? 'fr-CA' : 'en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/** « 3,2 h » ou « 1,4 j » selon l'échelle — jamais un nombre nu. */
function heures(h: number | null, fr: boolean): string {
  if (h === null) return '—';
  if (h < 48) return `${nombre(h, fr)} h`;
  return `${nombre(h / 24, fr)} ${fr ? 'j' : 'd'}`;
}

/** Date ISO d'un début de mois → « août 2026 ». */
function libelleMois(mois: string, fr: boolean): string {
  const d = new Date(`${mois.slice(0, 10)}T00:00:00Z`);
  return new Intl.DateTimeFormat(fr ? 'fr-CA' : 'en-CA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

/** Étiquette courte d'une semaine (lundi) pour l'axe du graphique. */
function libelleSemaine(jour: string, fr: boolean): string {
  const d = new Date(`${jour.slice(0, 10)}T00:00:00Z`);
  return new Intl.DateTimeFormat(fr ? 'fr-CA' : 'en-CA', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(d);
}

const LIBELLE_SOURCE: Record<string, { fr: string; en: string }> = {
  form_web: { fr: 'Formulaire web', en: 'Web form' },
  meta: { fr: 'Meta', en: 'Meta' },
  manual: { fr: 'Manuel', en: 'Manual' },
};

function libelleSource(source: string, fr: boolean): string {
  const l = LIBELLE_SOURCE[source];
  if (!l) return source;
  return fr ? l.fr : l.en;
}

/** Palette douce du kanban, dérivée du rang — jamais du nom de l'étape. */
// Mêmes teintes que le board (src/lib/d2d-pipeline-stages.ts) : une étape
// doit avoir la même couleur dans les colonnes et dans l'entonnoir.
const TEINTES_OUVERTES = ['#58A6FF', '#D29922', '#9CA3AF', '#06B6D4'] as const;

function teinteRang(i: number): string {
  return TEINTES_OUVERTES[i % TEINTES_OUVERTES.length] ?? TEINTES_OUVERTES[0];
}

// ---------------------------------------------------------------------------
// Sous-composants locaux (rien n'est exporté : c'est un onglet)
// ---------------------------------------------------------------------------

function SectionHead({ titre, aide }: { titre: string; aide: string }) {
  return (
    <div className="mt-10 first:mt-0 mb-3 flex items-center gap-1.5 px-0.5">
      <h3 className="text-[12px] font-bold uppercase tracking-wide text-text-tertiary">{titre}</h3>
      <Info className="w-3 h-3 text-text-muted shrink-0" aria-label={aide} role="img" />
      <span className="sr-only">{aide}</span>
    </div>
  );
}

/** Tuile de stat : chiffre héros + libellé + infobulle expliquant le calcul. */
function Tuile({
  valeur,
  libelle,
  detail,
  calcul,
  ecart,
  chargement,
}: {
  valeur: string;
  libelle: string;
  detail?: string;
  calcul: string;
  ecart?: { signe: 1 | -1 | 0; texte: string } | null;
  chargement?: boolean;
}) {
  return (
    <div className="rounded-xl border border-outline bg-surface-card px-5 py-4" title={calcul}>
      <div className="flex items-center gap-1.5">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">{libelle}</span>
        <Info className="w-3 h-3 text-text-muted shrink-0" aria-label={calcul} role="img" />
      </div>
      {chargement ? (
        <div className="mt-3 h-[28px] flex items-center">
          <Loader2 className="w-4 h-4 text-text-muted animate-spin" aria-hidden="true" />
        </div>
      ) : (
        <div className="mt-3 flex items-baseline gap-2.5 flex-wrap">
          <span className="text-[28px] font-bold leading-none tracking-tight tabular-nums text-text-primary">{valeur}</span>
          {ecart && (
            <span
              className={cn(
                'text-[12.5px] font-bold tabular-nums',
                ecart.signe === 0 ? 'text-text-tertiary' : 'text-text-secondary',
              )}
            >
              {ecart.signe === 1 ? '↑' : ecart.signe === -1 ? '↓' : '→'} {ecart.texte}
            </span>
          )}
        </div>
      )}
      {detail && !chargement && <div className="mt-2 text-[12px] text-text-tertiary">{detail}</div>}
    </div>
  );
}

/** Barre horizontale en CSS pur — aucune librairie de graphique. */
function BarreHorizontale({
  libelle,
  valeur,
  fraction,
  teinte,
  accent,
  note,
}: {
  libelle: string;
  valeur: string;
  fraction: number;
  teinte?: string;
  accent?: boolean;
  note?: string;
}) {
  const largeur = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div
      className={cn(
        'rounded-lg px-3 py-2.5',
        accent ? 'border border-amber-500/60 bg-amber-500/5' : 'border border-transparent',
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold tracking-tight text-text-primary truncate">{libelle}</span>
        <span className="text-[13px] font-bold tabular-nums text-text-primary shrink-0">{valeur}</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-surface-tertiary overflow-hidden">
        <span
          className="block h-full rounded-full"
          style={{ width: `${largeur}%`, background: teinte ?? 'var(--color-text-primary)' }}
        />
      </div>
      {note && (
        <div className={cn('mt-1.5 text-[11.5px] font-semibold', accent ? 'text-amber-600 dark:text-amber-400' : 'text-text-tertiary')}>
          {note}
        </div>
      )}
    </div>
  );
}

/** Ligne cliquable d'une liste « à traiter ». */
function LigneDeal({
  nom,
  secondaire,
  dealId,
  onOuvrir,
}: {
  nom: string;
  secondaire: string;
  dealId: string;
  onOuvrir?: (dealId: string) => void;
}) {
  const interactif = typeof onOuvrir === 'function';
  return (
    <button
      type="button"
      disabled={!interactif}
      onClick={() => onOuvrir?.(dealId)}
      className={cn(
        'w-full text-left rounded-lg px-3 py-2.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-text-tertiary',
        interactif ? 'hover:bg-surface-secondary cursor-pointer' : 'cursor-default',
      )}
    >
      <div className="text-[13px] font-semibold tracking-tight text-text-primary truncate">{nom}</div>
      <div className="text-[11.5px] text-text-tertiary mt-0.5 truncate">{secondaire}</div>
    </button>
  );
}

function Vide({ texte }: { texte: string }) {
  return <div className="px-3 py-6 text-center text-[12.5px] text-text-tertiary">{texte}</div>;
}

function Chargement({ etiquette }: { etiquette: string }) {
  return (
    <div className="px-3 py-8 flex items-center justify-center gap-2 text-[12.5px] text-text-tertiary">
      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
      <span>{etiquette}</span>
    </div>
  );
}

/** Encart d'erreur sobre : on dit ce qui a échoué, on ne vide pas l'écran. */
function Echec({ titre, message }: { titre: string; message: string }) {
  return (
    <div className="px-4 py-6 text-center">
      <div className="text-[13px] font-semibold text-text-primary">{titre}</div>
      <div className="mt-1 text-[12px] text-text-tertiary break-words">{message}</div>
    </div>
  );
}

function messageErreur(e: unknown, fr: boolean): string {
  if (e instanceof Error && e.message) return e.message;
  return fr ? 'Erreur inconnue.' : 'Unknown error.';
}

// ---------------------------------------------------------------------------
// Graphique de tendance — SVG maison, deux séries, style RevenueTrendCard
// ---------------------------------------------------------------------------

const W = 1000;
const H = 300;
const TOP = 14;

function cheminSerie(vals: number[], max: number): string {
  const n = vals.length;
  return vals
    .map((v, i) => {
      const x = n > 1 ? (i / (n - 1)) * W : W / 2;
      const y = TOP + (H - TOP) * (1 - v / max);
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function TendanceDeuxSeries({
  labels,
  leads,
  gagnes,
  libelleLeads,
  libelleGagnes,
  fr,
}: {
  labels: string[];
  leads: number[];
  gagnes: number[];
  libelleLeads: string;
  libelleGagnes: string;
  fr: boolean;
}) {
  const idGradient = useId();
  const max = Math.max(1, ...leads, ...gagnes);
  const grille = [0, 1, 2, 3].map((s) => TOP + (H - TOP) * (s / 3));
  const cheminLeads = cheminSerie(leads, max);
  const aireLeads = leads.length ? `${cheminLeads} L${W},${H} L0,${H} Z` : '';

  if (leads.length === 0) {
    return <Vide texte={fr ? 'Aucune donnée sur la période.' : 'No data for this period.'} />;
  }

  return (
    <div className="px-5 pt-4 pb-4">
      <div className="flex items-center gap-4 mb-3">
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-text-secondary">
          <span className="w-4 h-[2.5px] rounded" style={{ background: 'var(--color-text-primary)' }} aria-hidden="true" />
          {libelleLeads}
        </span>
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-text-secondary">
          <span
            className="w-4 h-[2.5px] rounded"
            style={{ background: 'var(--color-text-primary)', opacity: 0.45 }}
            aria-hidden="true"
          />
          {libelleGagnes}
        </span>
      </div>

      <div className="h-[190px]">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="w-full h-full block"
          role="img"
          aria-label={
            fr
              ? `Tendance sur 12 semaines : ${libelleLeads} et ${libelleGagnes}`
              : `12-week trend: ${libelleLeads} and ${libelleGagnes}`
          }
        >
          {grille.map((y, i) => (
            <line
              key={y}
              x1={0}
              y1={y}
              x2={W}
              y2={y}
              stroke={i === 3 ? 'var(--color-outline-strong)' : 'var(--color-outline-subtle)'}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <defs>
            <linearGradient id={`grad-${idGradient}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-text-primary)" stopOpacity="0.13" />
              <stop offset="100%" stopColor="var(--color-text-primary)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {aireLeads && <path d={aireLeads} fill={`url(#grad-${idGradient})`} />}
          <path
            d={cheminSerie(gagnes, max)}
            fill="none"
            stroke="var(--color-text-primary)"
            strokeOpacity={0.45}
            strokeWidth={2.2}
            strokeDasharray="5 4"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={cheminLeads}
            fill="none"
            stroke="var(--color-text-primary)"
            strokeWidth={2.4}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>

      <div className="mt-2 flex text-[10px] font-semibold text-text-tertiary">
        {labels.map((l, i) => (
          <span key={l} className="flex-1 text-center" style={{ visibility: i % 2 === 0 ? 'visible' : 'hidden' }}>
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composant principal
// ---------------------------------------------------------------------------

export default function PipelineStats({ onOuvrirDeal }: { onOuvrirDeal?: (dealId: string) => void }) {
  const { language } = useTranslation();
  const fr = language === 'fr';

  const idPeriode = useId();
  const [periode, setPeriode] = useState<InsightsPeriod>(DEFAULT_INSIGHTS_PERIOD);
  const plage = useMemo(() => periodRange(periode), [periode]);
  const { from, to } = plage;

  const kpisQ = useQuery({
    queryKey: ['pipeline-kpis', from, to],
    queryFn: () => fetchKpis(from, to),
    staleTime: 60_000,
  });
  const sourcesQ = useQuery({
    queryKey: ['pipeline-par-source', from, to],
    queryFn: () => fetchParSource(from, to),
    staleTime: 60_000,
  });
  const cohortesQ = useQuery({
    queryKey: ['pipeline-cohortes', 6],
    queryFn: () => fetchCohortes(6),
    staleTime: 60_000,
  });
  const vitesseQ = useQuery({
    queryKey: ['pipeline-vitesse', from, to],
    queryFn: () => fetchVitesse(from, to),
    staleTime: 60_000,
  });
  const entonnoirQ = useQuery({
    queryKey: ['pipeline-entonnoir', from, to],
    queryFn: () => fetchEntonnoir(from, to),
    staleTime: 60_000,
  });
  const aTraiterQ = useQuery({
    queryKey: ['pipeline-a-traiter', 7],
    queryFn: () => fetchATraiter(7),
    staleTime: 60_000,
  });
  const tendanceQ = useQuery({
    queryKey: ['pipeline-tendance', 12],
    queryFn: () => fetchTendance(12),
    staleTime: 60_000,
  });
  const pertesQ = useQuery({
    queryKey: ['pipeline-raisons-perte', from, to],
    queryFn: () => fetchRaisonsPerte(from, to),
    staleTime: 60_000,
  });
  const vendeursQ = useQuery({
    queryKey: ['pipeline-par-vendeur', from, to],
    queryFn: () => fetchParVendeur(from, to),
    staleTime: 60_000,
  });

  const kpis = kpisQ.data ?? null;
  const vitesse = vitesseQ.data ?? null;
  const sources = sourcesQ.data ?? [];
  const cohortes = cohortesQ.data ?? [];
  const entonnoir = entonnoirQ.data ?? [];
  const tendance = tendanceQ.data ?? [];
  const pertes = pertesQ.data ?? [];
  const vendeurs = vendeursQ.data ?? [];

  // Les barres se comparent à la raison la plus fréquente, pas au total :
  // avec cinq raisons équivalentes, toutes les barres seraient minuscules.
  const pertesMax = useMemo(
    () => pertes.reduce((m, r) => Math.max(m, r.perdus), 0),
    [pertes],
  );

  // ── 1. Écart de leads contre la fenêtre précédente ──────────────────────
  const ecartLeads = useMemo(() => {
    if (!kpis) return null;
    const { leads_entrants: courant, leads_precedents: precedent } = kpis;
    if (precedent === 0) {
      return courant === 0
        ? { signe: 0 as const, texte: fr ? 'stable' : 'flat' }
        : { signe: 1 as const, texte: fr ? 'nouveau' : 'new' };
    }
    const delta = (courant - precedent) / precedent;
    const signe = delta > 0 ? (1 as const) : delta < 0 ? (-1 as const) : (0 as const);
    return { signe, texte: pourcentDb(Math.abs(delta) * 100, fr) };
  }, [kpis, fr]);

  // ── 6. Tranches de délai — `null` ≠ 0 % ─────────────────────────────────
  const tranches = useMemo(() => {
    if (!vitesse) return [];
    return [
      {
        cle: 'lt1h',
        libelle: fr ? 'Moins de 1 h' : 'Under 1 h',
        taux: vitesse.closing_moins_1h,
        deals: vitesse.n_moins_1h,
      },
      {
        cle: 'lt24h',
        libelle: fr ? 'Moins de 24 h' : 'Under 24 h',
        taux: vitesse.closing_moins_24h,
        deals: vitesse.n_moins_24h,
      },
      {
        cle: 'gt24h',
        libelle: fr ? 'Plus de 24 h' : 'Over 24 h',
        taux: vitesse.closing_plus_24h,
        deals: vitesse.n_plus_24h,
      },
    ];
  }, [vitesse, fr]);

  // ── 7. Entonnoir : le plus gros décrochage, `taux_passage` vient de la base ──
  const maxEntonnoir = Math.max(1, ...entonnoir.map((m) => m.atteints));
  const decrochage = useMemo(() => {
    let pire: string | null = null;
    let perteMax = 0;
    for (let i = 1; i < entonnoir.length; i += 1) {
      const precedente = entonnoir[i - 1];
      const courante = entonnoir[i];
      if (!precedente || !courante) continue;
      const perte = precedente.atteints - courante.atteints;
      if (perte > perteMax) {
        perteMax = perte;
        pire = courante.stage_id;
      }
    }
    return { stageId: pire, perte: perteMax };
  }, [entonnoir]);

  // ── 11. À traiter : une liste plate → les trois colonnes de l'écran ─────
  const traiter = useMemo(() => {
    const lignes: ATraiterRow[] = aTraiterQ.data ?? [];
    return {
      nonAssignes: lignes.filter((l) => l.raison === 'non_assigne'),
      sansActivite: lignes.filter((l) => l.raison === 'sans_activite'),
      jobACreer: lignes.filter((l) => l.raison === 'job_a_creer'),
    };
  }, [aTraiterQ.data]);

  // ── États globaux ───────────────────────────────────────────────────────
  if (kpisQ.isLoading) {
    return (
      <div className="pb-10">
        <div className="rounded-xl border border-outline bg-surface-card">
          <Chargement etiquette={fr ? 'Chargement des statistiques…' : 'Loading statistics…'} />
        </div>
      </div>
    );
  }

  if (kpisQ.isError) {
    return (
      <div className="pb-10">
        <div className="rounded-xl border border-outline bg-surface-card">
          <Echec
            titre={fr ? 'Statistiques indisponibles' : 'Statistics unavailable'}
            message={messageErreur(kpisQ.error, fr)}
          />
        </div>
      </div>
    );
  }

  const aucunLead = !kpis || kpis.leads_entrants === 0;

  const classeEtiquette = 'block text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-1.5';

  const barrePeriode = (
    <div className="rounded-xl border border-outline bg-surface-card p-4">
      <div className="max-w-xs">
        <span id={idPeriode} className={classeEtiquette}>
          {fr ? 'Période' : 'Period'}
        </span>
        <div
          role="group"
          aria-labelledby={idPeriode}
          className="h-9 flex items-center rounded-lg border border-outline bg-surface-card px-2.5"
        >
          <PeriodSelector value={periode} onChange={setPeriode} align="left" />
        </div>
      </div>
      <div className="mt-3 text-[11.5px] text-text-tertiary">
        {fr
          ? `${kpis?.leads_entrants ?? 0} deal${(kpis?.leads_entrants ?? 0) > 1 ? 's' : ''} entré${(kpis?.leads_entrants ?? 0) > 1 ? 's' : ''} entre le ${from} et le ${to}.`
          : `${kpis?.leads_entrants ?? 0} deal${(kpis?.leads_entrants ?? 0) > 1 ? 's' : ''} created between ${from} and ${to}.`}
      </div>
    </div>
  );

  if (aucunLead) {
    return (
      <div className="pb-10">
        {barrePeriode}
        <div className="mt-4 rounded-xl border border-outline bg-surface-card">
          <EmptyState
            icon={Target}
            title={fr ? 'Aucun lead sur la période' : 'No leads for this period'}
            description={
              fr
                ? "Les statistiques se calculent sur les deals entrés dans la période. Crée un premier lead, ou élargis la période, et les douze blocs se remplissent tout seuls."
                : 'Statistics are computed on deals created within the period. Create a first lead, or widen the period, and the twelve blocks fill in on their own.'
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="pb-10">
      {barrePeriode}

      {/* ── 1-3. Les trois chiffres du haut ── */}
      <SectionHead
        titre={fr ? "Vue d'ensemble" : 'Overview'}
        aide={
          fr
            ? 'Trois chiffres calculés par la base sur les deals entrés dans la période sélectionnée.'
            : 'Three figures computed by the database on deals created within the selected period.'
        }
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        <Tuile
          libelle={fr ? 'Leads entrants' : 'Incoming leads'}
          valeur={String(kpis?.leads_entrants ?? 0)}
          ecart={ecartLeads}
          detail={
            fr
              ? `Période précédente : ${kpis?.leads_precedents ?? 0}`
              : `Previous period: ${kpis?.leads_precedents ?? 0}`
          }
          calcul={
            fr
              ? "Nombre de deals dont la date de création tombe dans la période. L'écart compare à la fenêtre précédente de même longueur."
              : 'Number of deals created within the period. The delta compares to the preceding window of equal length.'
          }
        />
        <Tuile
          libelle={fr ? 'Taux de closing' : 'Close rate'}
          valeur={
            (kpis?.gagnes ?? 0) + (kpis?.perdus ?? 0) === 0 ? '—' : pourcentDb(kpis?.taux_closing ?? 0, fr)
          }
          detail={
            fr
              ? `${kpis?.gagnes ?? 0} gagné${(kpis?.gagnes ?? 0) > 1 ? 's' : ''} / ${(kpis?.gagnes ?? 0) + (kpis?.perdus ?? 0)} fermé${(kpis?.gagnes ?? 0) + (kpis?.perdus ?? 0) > 1 ? 's' : ''}`
              : `${kpis?.gagnes ?? 0} won / ${(kpis?.gagnes ?? 0) + (kpis?.perdus ?? 0)} closed`
          }
          calcul={
            fr
              ? 'Gagnés ÷ (gagnés + perdus), sur les deals fermés seulement. Les deals encore ouverts sont exclus du dénominateur.'
              : 'Won ÷ (won + lost), on closed deals only. Still-open deals are excluded from the denominator.'
          }
        />
        <Tuile
          libelle={fr ? 'Revenus générés' : 'Revenue generated'}
          valeur={montant(kpis?.revenus_cents ?? 0, fr)}
          detail={
            fr
              ? `${kpis?.jobs_liees ?? 0} deal${(kpis?.jobs_liees ?? 0) > 1 ? 's' : ''} avec une job créée`
              : `${kpis?.jobs_liees ?? 0} deal${(kpis?.jobs_liees ?? 0) > 1 ? 's' : ''} with a job created`
          }
          calcul={
            fr
              ? "Somme des montants des jobs liées aux deals de la période. Un deal gagné sans job compte pour 0 $."
              : 'Sum of the amounts of jobs linked to the period’s deals. A won deal with no job counts as $0.'
          }
        />
      </div>

      {/* ── 4. Par source ── */}
      <SectionHead
        titre={fr ? 'Par source' : 'By source'}
        aide={
          fr
            ? "Une ligne par source et par campagne UTM. Le revenu moyen par lead divise le revenu du groupe par TOUS ses leads, gagnés ou non."
            : 'One row per source and UTM campaign. Revenue per lead divides the group revenue by ALL its leads, won or not.'
        }
      />
      <div className="rounded-xl border border-outline bg-surface-card overflow-hidden">
        {sourcesQ.isLoading ? (
          <Chargement etiquette={fr ? 'Chargement…' : 'Loading…'} />
        ) : sourcesQ.isError ? (
          <Echec
            titre={fr ? 'Répartition indisponible' : 'Breakdown unavailable'}
            message={messageErreur(sourcesQ.error, fr)}
          />
        ) : sources.length === 0 ? (
          <Vide texte={fr ? 'Aucun lead sur la période.' : 'No leads for this period.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[12.5px]">
              <thead>
                <tr className="border-b border-outline">
                  <th scope="col" className="text-left font-semibold text-text-tertiary uppercase tracking-wide text-[11px] px-4 py-2.5">{fr ? 'Source' : 'Source'}</th>
                  <th scope="col" className="text-left font-semibold text-text-tertiary uppercase tracking-wide text-[11px] px-4 py-2.5">{fr ? 'Campagne' : 'Campaign'}</th>
                  <th scope="col" className="text-right font-semibold text-text-tertiary uppercase tracking-wide text-[11px] px-4 py-2.5">{fr ? 'Leads' : 'Leads'}</th>
                  <th scope="col" className="text-right font-semibold text-text-tertiary uppercase tracking-wide text-[11px] px-4 py-2.5">{fr ? 'Closing' : 'Close rate'}</th>
                  <th scope="col" className="text-right font-semibold text-text-tertiary uppercase tracking-wide text-[11px] px-4 py-2.5">{fr ? 'Revenus' : 'Revenue'}</th>
                  <th scope="col" className="text-right font-semibold text-text-tertiary uppercase tracking-wide text-[11px] px-4 py-2.5">{fr ? 'Rev. / lead' : 'Rev. / lead'}</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((r) => (
                  <tr key={`${r.source}|${r.campagne ?? ''}`} className="border-b border-border-subtle last:border-0">
                    <td className="px-4 py-3 font-semibold text-text-primary whitespace-nowrap">
                      {libelleSource(r.source, fr)}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{r.campagne ?? '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-primary">{r.leads}</td>
                    <td
                      className="px-4 py-3 text-right tabular-nums text-text-primary"
                      title={
                        fr
                          ? `${r.gagnes} gagné(s) ÷ ${r.gagnes + r.perdus} fermé(s)`
                          : `${r.gagnes} won ÷ ${r.gagnes + r.perdus} closed`
                      }
                    >
                      {r.gagnes + r.perdus === 0 ? '—' : pourcentDb(r.taux_closing, fr)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-primary">{montant(r.revenus_cents, fr)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-secondary">{montant(r.revenu_moyen_par_lead, fr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── 5. Cohorte du formulaire ── */}
      <SectionHead
        titre={fr ? 'Cohorte du formulaire web' : 'Web form cohort'}
        aide={
          fr
            ? "ATTENTION : formule différente du taux de closing. Le dénominateur ici, ce sont TOUS les leads du mois — les deals encore ouverts compris."
            : 'NOTE: different formula from the close rate. The denominator here is ALL leads of the month — still-open deals included.'
        }
      />
      <div className="rounded-xl border border-outline bg-surface-card p-5">
        {cohortesQ.isLoading ? (
          <Chargement etiquette={fr ? 'Chargement…' : 'Loading…'} />
        ) : cohortesQ.isError ? (
          <Echec
            titre={fr ? 'Cohortes indisponibles' : 'Cohorts unavailable'}
            message={messageErreur(cohortesQ.error, fr)}
          />
        ) : cohortes.length === 0 ? (
          <Vide texte={fr ? 'Aucun lead du formulaire web sur les derniers mois.' : 'No web form leads over the last months.'} />
        ) : (
          <ul className="space-y-3">
            {cohortes.map((c) => (
              <li
                key={c.mois}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border-subtle last:border-0 pb-3 last:pb-0"
                title={
                  fr
                    ? 'Gagnés ÷ TOUS les inscrits du mois. Les deals encore ouverts comptent au dénominateur : ce taux ne peut que monter avec le temps.'
                    : 'Won ÷ ALL sign-ups of the month. Still-open deals count in the denominator: this rate can only go up over time.'
                }
              >
                <span className="text-[13px] text-text-secondary">
                  {fr
                    ? `${c.inscrits} personne${c.inscrits > 1 ? 's' : ''} ont rempli le formulaire en ${libelleMois(c.mois, fr)} → ${c.gagnes} gagnée${c.gagnes > 1 ? 's' : ''} à date, ${c.encore_ouvert} encore ouverte${c.encore_ouvert > 1 ? 's' : ''}`
                    : `${c.inscrits} people filled the form in ${libelleMois(c.mois, fr)} → ${c.gagnes} won to date, ${c.encore_ouvert} still open`}
                </span>
                <span className="inline-flex items-center gap-1.5 shrink-0">
                  <span className="text-[15px] font-bold tabular-nums text-text-primary">{pourcentDb(c.taux_gagne, fr)}</span>
                  <Info
                    className="w-3 h-3 text-text-muted"
                    role="img"
                    aria-label={
                      fr
                        ? 'Gagnés ÷ tous les inscrits du mois, deals ouverts inclus au dénominateur.'
                        : 'Won ÷ all sign-ups of the month, open deals included in the denominator.'
                    }
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── 6. Speed-to-lead ── */}
      <SectionHead
        titre={fr ? 'Vitesse de premier contact' : 'Speed to lead'}
        aide={
          fr
            ? "Délai entre la création du deal et le premier contact. Les deals jamais contactés sont exclus de la moyenne, et comptés à part."
            : 'Delay between deal creation and first contact. Never-contacted deals are excluded from the average and counted separately.'
        }
      />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Tuile
          chargement={vitesseQ.isLoading}
          libelle={fr ? 'Délai moyen' : 'Average delay'}
          valeur={heures(vitesse ? vitesse.delai_contact_moyen_h : null, fr)}
          detail={
            vitesse
              ? fr
                ? `${vitesse.jamais_contactes} jamais contacté${vitesse.jamais_contactes > 1 ? 's' : ''}`
                : `${vitesse.jamais_contactes} never contacted`
              : undefined
          }
          calcul={
            fr
              ? "Moyenne de (premier contact − création), en heures, sur les deals effectivement contactés. Un deal jamais contacté n'a pas de délai : il est exclu."
              : 'Average of (first contact − creation), in hours, over deals actually contacted. A never-contacted deal has no delay and is excluded.'
          }
        />
        <div className="lg:col-span-2 rounded-xl border border-outline bg-surface-card p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
              {fr ? 'Closing par tranche de délai' : 'Close rate by delay bracket'}
            </span>
            <Info
              className="w-3 h-3 text-text-muted"
              role="img"
              aria-label={
                fr
                  ? "Chaque tranche regroupe les deals selon leur délai de premier contact, puis applique gagnés ÷ (gagnés + perdus) à ce sous-groupe. Une tranche sans deal fermé n'a pas de taux du tout."
                  : 'Each bracket groups deals by first-contact delay, then applies won ÷ (won + lost) within that subgroup. A bracket with no closed deal has no rate at all.'
              }
            />
          </div>
          {vitesseQ.isLoading ? (
            <Chargement etiquette={fr ? 'Chargement…' : 'Loading…'} />
          ) : vitesseQ.isError ? (
            <Echec
              titre={fr ? 'Vitesse indisponible' : 'Speed unavailable'}
              message={messageErreur(vitesseQ.error, fr)}
            />
          ) : (
            <div className="space-y-1">
              {tranches.map((t) => (
                <BarreHorizontale
                  key={t.cle}
                  libelle={t.libelle}
                  valeur={t.taux === null ? (fr ? 'aucun fermé' : 'none closed') : pourcentDb(t.taux, fr)}
                  fraction={t.taux === null ? 0 : t.taux / 100}
                  note={
                    fr
                      ? `${t.deals} deal${t.deals > 1 ? 's' : ''} dans la tranche`
                      : `${t.deals} deal${t.deals > 1 ? 's' : ''} in this bracket`
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 7. Entonnoir ── */}
      <SectionHead
        titre={fr ? 'Entonnoir' : 'Funnel'}
        aide={
          fr
            ? "Calculé sur l'historique d'étapes : un deal passé par une étape y compte, même s'il l'a quittée depuis. Le taux de passage vient de la base."
            : 'Computed on stage history: a deal that went through a stage counts there, even if it has since left. The pass-through rate comes from the database.'
        }
      />
      <div className="rounded-xl border border-outline bg-surface-card p-4">
        {entonnoirQ.isLoading ? (
          <Chargement etiquette={fr ? 'Chargement…' : 'Loading…'} />
        ) : entonnoirQ.isError ? (
          <Echec
            titre={fr ? 'Entonnoir indisponible' : 'Funnel unavailable'}
            message={messageErreur(entonnoirQ.error, fr)}
          />
        ) : entonnoir.length === 0 ? (
          <Vide texte={fr ? 'Aucune étape à afficher.' : 'No stage to display.'} />
        ) : (
          <div className="space-y-1">
            {entonnoir.map((m, i) => {
              const accent = decrochage.stageId === m.stage_id && decrochage.perte > 0;
              return (
                <BarreHorizontale
                  key={m.stage_id}
                  libelle={fr ? m.nom_fr : m.nom_en}
                  valeur={String(m.atteints)}
                  fraction={m.atteints / maxEntonnoir}
                  teinte={teinteRang(i)}
                  accent={accent}
                  note={
                    accent
                      ? fr
                        ? `Plus gros décrochage — ${decrochage.perte} deal${decrochage.perte > 1 ? 's' : ''} perdu${decrochage.perte > 1 ? 's' : ''} à cette marche (${pourcentDb(m.taux_passage, fr)} de passage)`
                        : `Biggest drop-off — ${decrochage.perte} deal${decrochage.perte > 1 ? 's' : ''} lost at this step (${pourcentDb(m.taux_passage, fr)} pass-through)`
                      : i === 0
                        ? fr
                          ? 'Point de départ'
                          : 'Starting point'
                        : fr
                          ? `${pourcentDb(m.taux_passage, fr)} de passage depuis l'étape précédente`
                          : `${pourcentDb(m.taux_passage, fr)} pass-through from the previous stage`
                  }
                />
              );
            })}
          </div>
        )}
      </div>

      {/* ── 8. Durée du cycle ── */}
      <SectionHead
        titre={fr ? 'Durée du cycle' : 'Cycle time'}
        aide={
          fr
            ? 'Le cycle va de la création du deal à sa victoire, en jours, calculé par la base sur les deals gagnés.'
            : 'The cycle runs from deal creation to the win, in days, computed by the database over won deals.'
        }
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        <Tuile
          chargement={vitesseQ.isLoading}
          libelle={fr ? 'Cycle moyen' : 'Average cycle'}
          valeur={vitesse === null ? '—' : `${nombre(vitesse.cycle_moyen_jours, fr)} ${fr ? 'j' : 'd'}`}
          detail={
            fr
              ? `Sur ${kpis?.gagnes ?? 0} deal${(kpis?.gagnes ?? 0) > 1 ? 's' : ''} gagné${(kpis?.gagnes ?? 0) > 1 ? 's' : ''}`
              : `Over ${kpis?.gagnes ?? 0} won deal${(kpis?.gagnes ?? 0) > 1 ? 's' : ''}`
          }
          calcul={
            fr
              ? 'Moyenne de (date de victoire − date de création), en jours, sur les deals gagnés de la période.'
              : 'Average of (win date − creation date), in days, over the period’s won deals.'
          }
        />
        <Tuile
          chargement={kpisQ.isFetching && !kpis}
          libelle={fr ? 'Encore ouverts' : 'Still open'}
          valeur={String(kpis?.ouverts ?? 0)}
          detail={
            fr
              ? `${kpis?.perdus ?? 0} perdu${(kpis?.perdus ?? 0) > 1 ? 's' : ''}`
              : `${kpis?.perdus ?? 0} lost`
          }
          calcul={
            fr
              ? "Deals de la période encore à une étape ouverte : ils n'ont pas de durée de cycle, puisqu'ils ne sont pas fermés."
              : 'Deals of the period still at an open stage: they have no cycle time, since they are not closed.'
          }
        />
        <Tuile
          chargement={kpisQ.isFetching && !kpis}
          libelle={fr ? 'Job à créer' : 'Job to create'}
          valeur={String(kpis?.job_a_creer ?? 0)}
          detail={fr ? 'Gagnés sans job liée' : 'Won with no linked job'}
          calcul={
            fr
              ? "Badge dérivé, jamais stocké : un deal à une étape gagnée sans job créée, c'est du revenu qui n'existe pas encore."
              : 'Derived badge, never stored: a deal at a won stage with no job is revenue that does not exist yet.'
          }
        />
      </div>

      {/* ── 9. Raisons de perte ── */}
      <SectionHead
        titre={fr ? 'Raisons de perte' : 'Loss reasons'}
        aide={
          fr
            ? "Classé par raison, avec l'étape d'où le deal a été perdu — c'est là qu'il faut agir. Les deals abandonnés (client injoignable) sont exclus : ce ne sont pas des défaites commerciales."
            : 'Ranked by reason, with the stage the deal was lost from — that is where to act. Abandoned deals (unreachable client) are excluded: they are not commercial losses.'
        }
      />
      {pertesQ.isLoading && <Chargement etiquette={fr ? 'Chargement…' : 'Loading…'} />}
      {pertesQ.isError && (
        <Echec
          titre={fr ? 'Raisons de perte' : 'Loss reasons'}
          message={messageErreur(pertesQ.error, fr)}
        />
      )}
      {!pertesQ.isLoading && !pertesQ.isError && pertes.length === 0 && (
        <Vide texte={fr ? 'Aucun deal perdu sur la période.' : 'No deal lost over the period.'} />
      )}
      {!pertesQ.isLoading && !pertesQ.isError && pertes.length > 0 && (
        <div className="space-y-1">
          {pertes.map((r, i) => (
            <BarreHorizontale
              key={`${r.raison}-${r.etape_perdue}-${i}`}
              libelle={r.raison}
              valeur={`${nombre(r.perdus, fr, 0)} · ${pourcentDb(r.part, fr)}`}
              fraction={pertesMax > 0 ? r.perdus / pertesMax : 0}
              teinte={teinteRang(i)}
              // L'étape dit OÙ agir : « trop cher » à la qualification et
              // « trop cher » après la visite ne se corrigent pas au même endroit.
              note={
                fr
                  ? `perdu depuis « ${r.etape_perdue} »`
                  : `lost from “${r.etape_perdue_en}”`
              }
            />
          ))}
        </div>
      )}

      {/* ── 10. Par vendeur ── */}
      <SectionHead
        titre={fr ? 'Par vendeur' : 'By rep'}
        aide={
          fr
            ? "Par membre : deals pris, gagnés, perdus, abandonnés, taux de closing (deals fermés seuls) et délai moyen de premier contact. Les deals que personne n'a pris ont leur propre ligne."
            : 'Per member: deals taken, won, lost, abandoned, close rate (closed deals only) and average first-contact delay. Deals nobody took have their own row.'
        }
      />
      {vendeursQ.isLoading && <Chargement etiquette={fr ? 'Chargement…' : 'Loading…'} />}
      {vendeursQ.isError && (
        <Echec titre={fr ? 'Par vendeur' : 'By rep'} message={messageErreur(vendeursQ.error, fr)} />
      )}
      {!vendeursQ.isLoading && !vendeursQ.isError && vendeurs.length === 0 && (
        <Vide texte={fr ? 'Aucun deal sur la période.' : 'No deal over the period.'} />
      )}
      {!vendeursQ.isLoading && !vendeursQ.isError && vendeurs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-text-tertiary">
                <th scope="col" className="py-2 pr-3 font-semibold">{fr ? 'Membre' : 'Member'}</th>
                <th scope="col" className="py-2 px-2 text-right font-semibold">{fr ? 'Pris' : 'Taken'}</th>
                <th scope="col" className="py-2 px-2 text-right font-semibold">{fr ? 'Gagnés' : 'Won'}</th>
                <th scope="col" className="py-2 px-2 text-right font-semibold">{fr ? 'Perdus' : 'Lost'}</th>
                <th scope="col" className="py-2 px-2 text-right font-semibold">{fr ? 'Abandonnés' : 'Abandoned'}</th>
                <th scope="col" className="py-2 px-2 text-right font-semibold">{fr ? 'Closing' : 'Close rate'}</th>
                <th scope="col" className="py-2 px-2 text-right font-semibold">{fr ? '1er contact' : 'First contact'}</th>
                <th scope="col" className="py-2 pl-2 text-right font-semibold">{fr ? 'Revenus' : 'Revenue'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {vendeurs.map((v) => (
                <tr
                  key={v.membre_id ?? 'non-assigne'}
                  // Les non-assignés ne sont pas un vendeur : c'est une alerte.
                  className={cn(v.membre_id === null && 'bg-amber-500/5')}
                >
                  <td className="py-2 pr-3 text-text-primary">
                    {v.membre_id === null ? (fr ? 'Non assignés' : 'Unassigned') : v.nom}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums text-text-secondary">{nombre(v.deals_pris, fr, 0)}</td>
                  <td className="py-2 px-2 text-right tabular-nums font-semibold text-text-primary">{nombre(v.gagnes, fr, 0)}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-text-secondary">{nombre(v.perdus, fr, 0)}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-text-tertiary">{nombre(v.abandonnes, fr, 0)}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-text-primary">
                    {v.gagnes + v.perdus > 0 ? pourcentDb(v.taux_closing, fr) : '—'}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums text-text-secondary">
                    {heures(v.delai_premier_contact_h, fr)}
                  </td>
                  <td className="py-2 pl-2 text-right tabular-nums text-text-primary">{montant(v.revenus_cents, fr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-text-tertiary">
            {fr
              ? "Le taux de closing ne porte que sur les deals fermés ; les abandonnés (client injoignable) en sont exclus pour ne pénaliser personne."
              : 'Close rate covers closed deals only; abandoned ones (unreachable client) are excluded so nobody is penalised.'}
          </p>
        </div>
      )}

      {/* ── 11. À traiter ── */}
      <SectionHead
        titre={fr ? 'À traiter' : 'Needs action'}
        aide={
          fr
            ? "Trois listes d'action, pas un graphique : chaque ligne ouvre le deal. Cette liste ignore la période — c'est ce qui dort aujourd'hui."
            : 'Three action lists, not a chart: each row opens the deal. This list ignores the period — it is what is stale today.'
        }
      />
      {aTraiterQ.isError ? (
        <div className="rounded-xl border border-outline bg-surface-card">
          <Echec
            titre={fr ? 'Liste indisponible' : 'List unavailable'}
            message={messageErreur(aTraiterQ.error, fr)}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          <div className="rounded-xl border border-outline bg-surface-card p-3">
            <div className="flex items-center justify-between gap-2 px-2 pb-2 border-b border-border-subtle">
              <span className="text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
                {fr ? 'Leads non assignés' : 'Unassigned leads'}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="text-[13px] font-bold tabular-nums text-text-primary">{traiter.nonAssignes.length}</span>
                <Info
                  className="w-3 h-3 text-text-muted"
                  role="img"
                  aria-label={
                    fr
                      ? 'Deals à une étape ouverte sans personne assignée.'
                      : 'Deals at an open stage with nobody assigned.'
                  }
                />
              </span>
            </div>
            <div className="mt-1.5 space-y-0.5">
              {aTraiterQ.isLoading ? (
                <Chargement etiquette={fr ? 'Chargement…' : 'Loading…'} />
              ) : traiter.nonAssignes.length === 0 ? (
                <Vide texte={fr ? 'Tout est assigné.' : 'Everything is assigned.'} />
              ) : (
                traiter.nonAssignes.map((l) => (
                  <LigneDeal
                    key={l.deal_id}
                    dealId={l.deal_id}
                    nom={l.client_nom || (fr ? 'Sans nom' : 'Unnamed')}
                    onOuvrir={onOuvrirDeal}
                    secondaire={l.stage_nom_fr}
                  />
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-outline bg-surface-card p-3">
            <div className="flex items-center justify-between gap-2 px-2 pb-2 border-b border-border-subtle">
              <span className="text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
                {fr ? 'Sans activité 7 j +' : 'No activity 7+ days'}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="text-[13px] font-bold tabular-nums text-text-primary">{traiter.sansActivite.length}</span>
                <Info
                  className="w-3 h-3 text-text-muted"
                  role="img"
                  aria-label={
                    fr
                      ? "Deals ouverts dont la dernière activité remonte à plus de 7 jours."
                      : 'Open deals whose last activity is more than 7 days old.'
                  }
                />
              </span>
            </div>
            <div className="mt-1.5 space-y-0.5">
              {aTraiterQ.isLoading ? (
                <Chargement etiquette={fr ? 'Chargement…' : 'Loading…'} />
              ) : traiter.sansActivite.length === 0 ? (
                <Vide texte={fr ? 'Rien ne dort.' : 'Nothing is stale.'} />
              ) : (
                traiter.sansActivite.map((l) => (
                  <LigneDeal
                    key={l.deal_id}
                    dealId={l.deal_id}
                    nom={l.client_nom || (fr ? 'Sans nom' : 'Unnamed')}
                    onOuvrir={onOuvrirDeal}
                    secondaire={
                      fr
                        ? `${l.stage_nom_fr} · ${l.depuis_jours} j sans activité`
                        : `${l.stage_nom_fr} · ${l.depuis_jours}d without activity`
                    }
                  />
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-outline bg-surface-card p-3">
            <div className="flex items-center justify-between gap-2 px-2 pb-2 border-b border-border-subtle">
              <span className="text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
                {fr ? 'Job à créer' : 'Job to create'}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="text-[13px] font-bold tabular-nums text-text-primary">{traiter.jobACreer.length}</span>
                <Info
                  className="w-3 h-3 text-text-muted"
                  role="img"
                  aria-label={
                    fr
                      ? "Badge dérivé : deal à une étape gagnée, sans job créée. Jamais stocké sur le deal."
                      : 'Derived badge: deal at a won stage with no job created. Never stored on the deal.'
                  }
                />
              </span>
            </div>
            <div className="mt-1.5 space-y-0.5">
              {aTraiterQ.isLoading ? (
                <Chargement etiquette={fr ? 'Chargement…' : 'Loading…'} />
              ) : traiter.jobACreer.length === 0 ? (
                <Vide texte={fr ? 'Toutes les jobs sont créées.' : 'All jobs are created.'} />
              ) : (
                traiter.jobACreer.map((l) => (
                  <LigneDeal
                    key={l.deal_id}
                    dealId={l.deal_id}
                    nom={l.client_nom || (fr ? 'Sans nom' : 'Unnamed')}
                    onOuvrir={onOuvrirDeal}
                    secondaire={fr ? `Gagné · ${l.stage_nom_fr}` : `Won · ${l.stage_nom_fr}`}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 12. Tendance ── */}
      <SectionHead
        titre={fr ? 'Tendance sur 12 semaines' : '12-week trend'}
        aide={
          fr
            ? "Les leads sont comptés à la semaine de leur création, les gagnés à la semaine de leur passage en « Gagné » — ce n'est pas la même semaine."
            : 'Leads are counted in their creation week, wins in the week they moved to “Won” — not the same week.'
        }
      />
      <div className="rounded-xl border border-outline bg-surface-card">
        {tendanceQ.isLoading ? (
          <Chargement etiquette={fr ? 'Chargement…' : 'Loading…'} />
        ) : tendanceQ.isError ? (
          <Echec
            titre={fr ? 'Tendance indisponible' : 'Trend unavailable'}
            message={messageErreur(tendanceQ.error, fr)}
          />
        ) : (
          <TendanceDeuxSeries
            fr={fr}
            labels={tendance.map((s) => libelleSemaine(s.semaine, fr))}
            leads={tendance.map((s) => s.leads)}
            gagnes={tendance.map((s) => s.gagnes)}
            libelleLeads={fr ? 'Leads entrants' : 'Incoming leads'}
            libelleGagnes={fr ? 'Gagnés' : 'Won'}
          />
        )}
      </div>
    </div>
  );
}
