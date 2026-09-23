/**
 * Pipeline de ventes — onglet « Statistiques ».
 *
 * Maquette 100 % locale : tout vient des helpers purs de `lib/pipeline/mockData`
 * et du vocabulaire visuel de `lib/pipeline/presentation`. Aucun appel réseau,
 * aucun style nouveau — uniquement les jetons du design system.
 *
 * Deux formules de conversion cohabitent ici, et c'est VOULU :
 *  - le taux de closing ne regarde que les deals FERMÉS (gagnés + perdus) ;
 *  - la cohorte du formulaire rapporte les gagnés à TOUS les inscrits du mois,
 *    les deals encore ouverts compris. Chaque tuile le dit dans son infobulle.
 */
import { useId, useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import PeriodSelector from '../insights/PeriodSelector';
import {
  DEFAULT_INSIGHTS_PERIOD,
  periodRange,
  type InsightsPeriod,
} from '../../lib/insightsPeriod';
import {
  MOCK_MEMBERS,
  MOCK_NOW,
  MOCK_STAGE_HISTORY,
  aTraiter,
  cohorteFormulaire,
  delaiPremierContactHeures,
  dureeMoyenneCycleJours,
  entonnoir,
  parVendeur,
  raisonsDePerte,
  repartitionParSource,
  revenusGeneres,
  tauxClosing,
  tempsMoyenParEtapeJours,
  tendanceHebdo,
  type DealSource,
  type MockDeal,
  type MockStage,
} from '../../lib/pipeline/mockData';
import { LIBELLE_SOURCE, montant, rangsOuverts, visuelEtape } from '../../lib/pipeline/presentation';

// ---------------------------------------------------------------------------
// Petits utilitaires locaux
// ---------------------------------------------------------------------------

const MS_PAR_JOUR = 86_400_000;

function ms(iso: string): number {
  return new Date(iso).getTime();
}

function pourcent(fraction: number, fr: boolean): string {
  return new Intl.NumberFormat(fr ? 'fr-CA' : 'en-CA', {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(fraction);
}

function nombre(n: number, fr: boolean, decimales = 1): string {
  return new Intl.NumberFormat(fr ? 'fr-CA' : 'en-CA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimales,
  }).format(n);
}

/** « 3,2 h » ou « 1,4 j » selon l'échelle — jamais un nombre nu. */
function heures(h: number | null, fr: boolean): string {
  if (h === null) return '—';
  if (h < 48) return `${nombre(h, fr)} h`;
  return `${nombre(h / 24, fr)} ${fr ? 'j' : 'd'}`;
}

/** Mois « AAAA-MM » → « août 2026 ». */
function libelleMois(mois: string, fr: boolean): string {
  const [annee, m] = mois.split('-');
  const d = new Date(Date.UTC(Number(annee), Number(m) - 1, 1));
  return new Intl.DateTimeFormat(fr ? 'fr-CA' : 'en-CA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

/** Étiquette courte d'une semaine (lundi ISO) pour l'axe du graphique. */
function libelleSemaine(jour: string, fr: boolean): string {
  const d = new Date(`${jour}T00:00:00Z`);
  return new Intl.DateTimeFormat(fr ? 'fr-CA' : 'en-CA', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(d);
}

const TOUTES = '__toutes__';
const NON_ASSIGNE = '__non_assigne__';

// ---------------------------------------------------------------------------
// Sous-composants locaux (rien n'est exporté : c'est la maquette d'un onglet)
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
}: {
  valeur: string;
  libelle: string;
  detail?: string;
  calcul: string;
  ecart?: { signe: 1 | -1 | 0; texte: string } | null;
}) {
  return (
    <div
      className="rounded-xl border border-outline bg-surface-card px-5 py-4"
      title={calcul}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">{libelle}</span>
        <Info className="w-3 h-3 text-text-muted shrink-0" aria-label={calcul} role="img" />
      </div>
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
      {detail && <div className="mt-2 text-[12px] text-text-tertiary">{detail}</div>}
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
  deal,
  secondaire,
  onOuvrir,
}: {
  deal: MockDeal;
  secondaire: string;
  onOuvrir?: (deal: MockDeal) => void;
}) {
  const interactif = typeof onOuvrir === 'function';
  return (
    <button
      type="button"
      disabled={!interactif}
      onClick={() => onOuvrir?.(deal)}
      className={cn(
        'w-full text-left rounded-lg px-3 py-2.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-text-tertiary',
        interactif ? 'hover:bg-surface-secondary cursor-pointer' : 'cursor-default',
      )}
    >
      <div className="text-[13px] font-semibold tracking-tight text-text-primary truncate">{deal.clientName}</div>
      <div className="text-[11.5px] text-text-tertiary mt-0.5 truncate">{secondaire}</div>
    </button>
  );
}

function Vide({ texte }: { texte: string }) {
  return <div className="px-3 py-6 text-center text-[12.5px] text-text-tertiary">{texte}</div>;
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
  const aireLeads = leads.length
    ? `${cheminLeads} L${W},${H} L0,${H} Z`
    : '';

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
          <span
            key={l}
            className="flex-1 text-center"
            style={{ visibility: i % 2 === 0 ? 'visible' : 'hidden' }}
          >
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

export default function PipelineStats({
  deals,
  etapes,
  onOuvrirDeal,
}: {
  deals: MockDeal[];
  etapes: MockStage[];
  onOuvrirDeal?: (deal: MockDeal) => void;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';

  const idSource = useId();
  const idCampagne = useId();
  const idAssigne = useId();

  const [periode, setPeriode] = useState<InsightsPeriod>(DEFAULT_INSIGHTS_PERIOD);
  const [source, setSource] = useState<string>(TOUTES);
  const [campagne, setCampagne] = useState<string>(TOUTES);
  const [assigne, setAssigne] = useState<string>(TOUTES);

  /** Campagnes Meta présentes dans les données — jamais une liste écrite en dur. */
  const campagnes = useMemo(() => {
    const set = new Set<string>();
    for (const d of deals) if (d.utmCampaign !== null) set.add(d.utmCampaign);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [deals]);

  /** Fenêtre courante + fenêtre précédente de même longueur, ancrées sur MOCK_NOW. */
  const fenetres = useMemo(() => {
    const plage = periodRange(periode, new Date(MOCK_NOW));
    const debut = ms(`${plage.from}T00:00:00Z`);
    const fin = ms(`${plage.to}T23:59:59Z`);
    const duree = Math.max(MS_PAR_JOUR, fin - debut);
    return { debut, fin, debutPrec: debut - duree, finPrec: debut };
  }, [periode]);

  /** Filtres autres que la période — appliqués aux deux fenêtres. */
  const passeFiltres = useMemo(() => {
    return (d: MockDeal): boolean => {
      if (source !== TOUTES && d.source !== source) return false;
      if (campagne !== TOUTES && d.utmCampaign !== campagne) return false;
      if (assigne === NON_ASSIGNE) {
        if (d.assignedUserId !== null) return false;
      } else if (assigne !== TOUTES && d.assignedUserId !== assigne) {
        return false;
      }
      return true;
    };
  }, [source, campagne, assigne]);

  const dealsFiltres = useMemo(
    () => deals.filter((d) => {
      const t = ms(d.createdAt);
      return t >= fenetres.debut && t <= fenetres.fin && passeFiltres(d);
    }),
    [deals, fenetres, passeFiltres],
  );

  const dealsPrecedents = useMemo(
    () => deals.filter((d) => {
      const t = ms(d.createdAt);
      return t >= fenetres.debutPrec && t < fenetres.finPrec && passeFiltres(d);
    }),
    [deals, fenetres, passeFiltres],
  );

  const idsFiltres = useMemo(() => new Set(dealsFiltres.map((d) => d.id)), [dealsFiltres]);
  const historiqueFiltre = useMemo(
    () => MOCK_STAGE_HISTORY.filter((h) => idsFiltres.has(h.dealId)),
    [idsFiltres],
  );

  const rangs = useMemo(() => rangsOuverts(etapes), [etapes]);
  const nomEtape = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of etapes) m.set(e.id, fr ? e.nameFr : e.nameEn);
    return m;
  }, [etapes, fr]);
  const kinds = useMemo(() => {
    const m = new Map<string, MockStage['kind']>();
    for (const e of etapes) m.set(e.id, e.kind);
    return m;
  }, [etapes]);

  // ── 1. Leads entrants ────────────────────────────────────────────────────
  const leads = dealsFiltres.length;
  const leadsPrec = dealsPrecedents.length;
  const ecartLeads = useMemo(() => {
    if (leadsPrec === 0) {
      return leads === 0
        ? { signe: 0 as const, texte: fr ? 'stable' : 'flat' }
        : { signe: 1 as const, texte: fr ? 'nouveau' : 'new' };
    }
    const delta = (leads - leadsPrec) / leadsPrec;
    const signe = delta > 0 ? (1 as const) : delta < 0 ? (-1 as const) : (0 as const);
    return { signe, texte: pourcent(Math.abs(delta), fr) };
  }, [leads, leadsPrec, fr]);

  // ── 2. Taux de closing ───────────────────────────────────────────────────
  const taux = useMemo(() => tauxClosing(dealsFiltres, etapes), [dealsFiltres, etapes]);
  const fermes = useMemo(() => {
    let gagnes = 0;
    let perdus = 0;
    for (const d of dealsFiltres) {
      const k = kinds.get(d.stageId);
      if (k === 'won') gagnes += 1;
      else if (k === 'lost') perdus += 1;
    }
    return { gagnes, perdus, total: gagnes + perdus };
  }, [dealsFiltres, kinds]);

  // ── 3. Revenus générés ───────────────────────────────────────────────────
  const revenus = useMemo(() => revenusGeneres(dealsFiltres), [dealsFiltres]);
  const avecJob = useMemo(() => dealsFiltres.filter((d) => d.jobId !== null).length, [dealsFiltres]);

  // ── 4. Par source ────────────────────────────────────────────────────────
  const parSource = useMemo(
    () => repartitionParSource(dealsFiltres, etapes),
    [dealsFiltres, etapes],
  );

  // ── 5. Cohorte du formulaire ─────────────────────────────────────────────
  const cohortes = useMemo(
    () => cohorteFormulaire(dealsFiltres, etapes),
    [dealsFiltres, etapes],
  );

  // ── 6. Speed-to-lead ─────────────────────────────────────────────────────
  const speed = useMemo(() => {
    let somme = 0;
    let n = 0;
    const moinsDUneHeure: MockDeal[] = [];
    const moinsDUnJour: MockDeal[] = [];
    const plusDUnJour: MockDeal[] = [];
    const jamais: MockDeal[] = [];

    for (const d of dealsFiltres) {
      const h = delaiPremierContactHeures(d);
      if (h === null) {
        jamais.push(d);
        continue;
      }
      somme += h;
      n += 1;
      if (h < 1) moinsDUneHeure.push(d);
      else if (h < 24) moinsDUnJour.push(d);
      else plusDUnJour.push(d);
    }

    const tranche = (liste: MockDeal[]) => {
      let gagnes = 0;
      let perdus = 0;
      for (const d of liste) {
        const k = kinds.get(d.stageId);
        if (k === 'won') gagnes += 1;
        else if (k === 'lost') perdus += 1;
      }
      return {
        deals: liste.length,
        fermes: gagnes + perdus,
        taux: tauxClosing(liste, etapes),
      };
    };

    return {
      moyenneHeures: n === 0 ? null : somme / n,
      contactes: n,
      jamais: jamais.length,
      tranches: [
        { cle: 'lt1h', libelle: fr ? 'Moins de 1 h' : 'Under 1 h', ...tranche(moinsDUneHeure) },
        { cle: 'lt24h', libelle: fr ? 'Moins de 24 h' : 'Under 24 h', ...tranche(moinsDUnJour) },
        { cle: 'gt24h', libelle: fr ? 'Plus de 24 h' : 'Over 24 h', ...tranche(plusDUnJour) },
      ],
    };
  }, [dealsFiltres, etapes, kinds, fr]);

  // ── 7. Entonnoir ─────────────────────────────────────────────────────────
  const marches = useMemo(
    () => entonnoir(dealsFiltres, etapes, historiqueFiltre),
    [dealsFiltres, etapes, historiqueFiltre],
  );
  const maxEntonnoir = Math.max(1, ...marches.map((m) => m.atteints));
  /** Le plus gros décrochage : la marche ouverte qui perd le plus de deals. */
  const idDecrochage = useMemo(() => {
    let pire: string | null = null;
    let perteMax = 0;
    for (let i = 1; i < marches.length; i += 1) {
      const precedente = marches[i - 1];
      const courante = marches[i];
      if (!precedente || !courante) continue;
      if (kinds.get(courante.stageId) !== 'open') continue;
      const perte = precedente.atteints - courante.atteints;
      if (perte > perteMax) {
        perteMax = perte;
        pire = courante.stageId;
      }
    }
    return { stageId: pire, perte: perteMax };
  }, [marches, kinds]);

  // ── 8. Durée du cycle ────────────────────────────────────────────────────
  const cycleJours = useMemo(
    () => dureeMoyenneCycleJours(dealsFiltres, etapes),
    [dealsFiltres, etapes],
  );
  const tempsEtapes = useMemo(
    () => tempsMoyenParEtapeJours(historiqueFiltre, etapes),
    [historiqueFiltre, etapes],
  );
  const maxTempsEtape = Math.max(0.01, ...tempsEtapes.map((t) => t.jours));

  // ── 9. Raisons de perte ──────────────────────────────────────────────────
  const raisons = useMemo(() => raisonsDePerte(dealsFiltres, etapes), [dealsFiltres, etapes]);
  const totalPertes = raisons.reduce((a, r) => a + r.nombre, 0);

  // ── 10. Par vendeur ──────────────────────────────────────────────────────
  const vendeurs = useMemo(() => parVendeur(dealsFiltres, etapes), [dealsFiltres, etapes]);

  // ── 11. À traiter ────────────────────────────────────────────────────────
  const traiter = useMemo(() => aTraiter(dealsFiltres, etapes), [dealsFiltres, etapes]);

  // ── 12. Tendance ─────────────────────────────────────────────────────────
  const tendance = useMemo(() => tendanceHebdo(dealsFiltres, etapes), [dealsFiltres, etapes]);

  const aucunDeal = dealsFiltres.length === 0;

  const classeChamp =
    'h-9 w-full rounded-lg border border-outline bg-surface-card px-2.5 text-[12.5px] font-medium text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-text-tertiary';
  const classeEtiquette = 'block text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-1.5';

  return (
    <div className="pb-10">
      {/* ── Barre de filtres ── */}
      <div className="rounded-xl border border-outline bg-surface-card p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <div>
            <span className={classeEtiquette}>{fr ? 'Période' : 'Period'}</span>
            <div className="h-9 flex items-center rounded-lg border border-outline bg-surface-card px-2.5">
              <PeriodSelector value={periode} onChange={setPeriode} align="left" />
            </div>
          </div>

          <div>
            <label htmlFor={idSource} className={classeEtiquette}>
              {fr ? 'Source' : 'Source'}
            </label>
            <select
              id={idSource}
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className={classeChamp}
            >
              <option value={TOUTES}>{fr ? 'Toutes les sources' : 'All sources'}</option>
              {(['form_web', 'meta', 'manual'] as DealSource[]).map((s) => (
                <option key={s} value={s}>
                  {fr ? LIBELLE_SOURCE[s].fr : LIBELLE_SOURCE[s].en}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={idCampagne} className={classeEtiquette}>
              {fr ? 'Campagne' : 'Campaign'}
            </label>
            <select
              id={idCampagne}
              value={campagne}
              onChange={(e) => setCampagne(e.target.value)}
              className={classeChamp}
            >
              <option value={TOUTES}>{fr ? 'Toutes les campagnes' : 'All campaigns'}</option>
              {campagnes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={idAssigne} className={classeEtiquette}>
              {fr ? 'Assigné à' : 'Assigned to'}
            </label>
            <select
              id={idAssigne}
              value={assigne}
              onChange={(e) => setAssigne(e.target.value)}
              className={classeChamp}
            >
              <option value={TOUTES}>{fr ? 'Tout le monde' : 'Everyone'}</option>
              {MOCK_MEMBERS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
              <option value={NON_ASSIGNE}>{fr ? 'Non assigné' : 'Unassigned'}</option>
            </select>
          </div>
        </div>

        <div className="mt-3 text-[11.5px] text-text-tertiary">
          {fr
            ? `${dealsFiltres.length} deal${dealsFiltres.length > 1 ? 's' : ''} sur la période, entrés entre le ${new Date(fenetres.debut).toISOString().slice(0, 10)} et le ${new Date(fenetres.fin).toISOString().slice(0, 10)}.`
            : `${dealsFiltres.length} deal${dealsFiltres.length > 1 ? 's' : ''} in range, created between ${new Date(fenetres.debut).toISOString().slice(0, 10)} and ${new Date(fenetres.fin).toISOString().slice(0, 10)}.`}
        </div>
      </div>

      {/* ── 1-3. Les trois chiffres du haut ── */}
      <SectionHead
        titre={fr ? "Vue d'ensemble" : 'Overview'}
        aide={
          fr
            ? "Trois chiffres calculés sur les deals entrés dans la période sélectionnée, après application des filtres."
            : 'Three figures computed on deals created within the selected period, after filters.'
        }
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        <Tuile
          libelle={fr ? 'Leads entrants' : 'Incoming leads'}
          valeur={String(leads)}
          ecart={ecartLeads}
          detail={
            fr
              ? `Période précédente : ${leadsPrec}`
              : `Previous period: ${leadsPrec}`
          }
          calcul={
            fr
              ? "Nombre de deals dont la date de création tombe dans la période. L'écart compare à la fenêtre précédente de même longueur."
              : 'Number of deals created within the period. The delta compares to the preceding window of equal length.'
          }
        />
        <Tuile
          libelle={fr ? 'Taux de closing' : 'Close rate'}
          valeur={fermes.total === 0 ? '—' : pourcent(taux, fr)}
          detail={
            fr
              ? `${fermes.gagnes} gagné${fermes.gagnes > 1 ? 's' : ''} / ${fermes.total} fermé${fermes.total > 1 ? 's' : ''}`
              : `${fermes.gagnes} won / ${fermes.total} closed`
          }
          calcul={
            fr
              ? 'Gagnés ÷ (gagnés + perdus), sur les deals fermés seulement. Les deals encore ouverts sont exclus du dénominateur.'
              : 'Won ÷ (won + lost), on closed deals only. Still-open deals are excluded from the denominator.'
          }
        />
        <Tuile
          libelle={fr ? 'Revenus générés' : 'Revenue generated'}
          valeur={montant(revenus, fr)}
          detail={
            fr
              ? `${avecJob} deal${avecJob > 1 ? 's' : ''} avec une job créée`
              : `${avecJob} deal${avecJob > 1 ? 's' : ''} with a job created`
          }
          calcul={
            fr
              ? "Somme des montants de job des deals qui ont effectivement une job créée. Un deal gagné sans job compte pour 0 $."
              : 'Sum of job amounts for deals that actually have a job. A won deal with no job counts as $0.'
          }
        />
      </div>

      {/* ── 4. Par source ── */}
      <SectionHead
        titre={fr ? 'Par source' : 'By source'}
        aide={
          fr
            ? "Une ligne par source ; les leads Meta sont éclatés par campagne UTM. Le revenu moyen par lead divise le revenu du groupe par TOUS ses leads, gagnés ou non."
            : 'One row per source; Meta leads are split by UTM campaign. Revenue per lead divides the group revenue by ALL its leads, won or not.'
        }
      />
      <div className="rounded-xl border border-outline bg-surface-card overflow-hidden">
        {parSource.length === 0 ? (
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
                {parSource.map((r) => (
                  <tr key={`${r.source}|${r.campagne ?? ''}`} className="border-b border-border-subtle last:border-0">
                    <td className="px-4 py-3 font-semibold text-text-primary whitespace-nowrap">
                      {fr ? LIBELLE_SOURCE[r.source].fr : LIBELLE_SOURCE[r.source].en}
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
                      {r.gagnes + r.perdus === 0 ? '—' : pourcent(r.tauxClosing, fr)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-primary">{montant(r.revenusCents, fr)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-secondary">{montant(r.revenuMoyenParLeadCents, fr)}</td>
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
        {cohortes.length === 0 ? (
          <Vide texte={fr ? 'Aucun lead du formulaire web sur la période.' : 'No web form leads for this period.'} />
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
                    ? `${c.inscrits} personne${c.inscrits > 1 ? 's' : ''} ont rempli le formulaire en ${libelleMois(c.mois, fr)} → ${c.gagnes} gagnée${c.gagnes > 1 ? 's' : ''} à date`
                    : `${c.inscrits} people filled the form in ${libelleMois(c.mois, fr)} → ${c.gagnes} won to date`}
                </span>
                <span className="inline-flex items-center gap-1.5 shrink-0">
                  <span className="text-[15px] font-bold tabular-nums text-text-primary">{pourcent(c.tauxGagne, fr)}</span>
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
          libelle={fr ? 'Délai moyen' : 'Average delay'}
          valeur={heures(speed.moyenneHeures, fr)}
          detail={
            fr
              ? `${speed.contactes} contacté${speed.contactes > 1 ? 's' : ''}, ${speed.jamais} jamais`
              : `${speed.contactes} contacted, ${speed.jamais} never`
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
                  ? 'Chaque tranche regroupe les deals selon leur délai de premier contact, puis applique gagnés ÷ (gagnés + perdus) à ce sous-groupe.'
                  : 'Each bracket groups deals by first-contact delay, then applies won ÷ (won + lost) within that subgroup.'
              }
            />
          </div>
          <div className="space-y-1">
            {speed.tranches.map((t) => (
              <BarreHorizontale
                key={t.cle}
                libelle={t.libelle}
                valeur={t.fermes === 0 ? '—' : pourcent(t.taux, fr)}
                fraction={t.fermes === 0 ? 0 : t.taux}
                note={
                  fr
                    ? `${t.deals} deal${t.deals > 1 ? 's' : ''} · ${t.fermes} fermé${t.fermes > 1 ? 's' : ''}`
                    : `${t.deals} deal${t.deals > 1 ? 's' : ''} · ${t.fermes} closed`
                }
              />
            ))}
          </div>
        </div>
      </div>

      {/* ── 7. Entonnoir ── */}
      <SectionHead
        titre={fr ? 'Entonnoir' : 'Funnel'}
        aide={
          fr
            ? "Calculé sur l'historique d'étapes : un deal passé par une étape y compte, même s'il l'a quittée depuis."
            : 'Computed on stage history: a deal that went through a stage counts there, even if it has since left.'
        }
      />
      <div className="rounded-xl border border-outline bg-surface-card p-4">
        {aucunDeal ? (
          <Vide texte={fr ? 'Aucun deal sur la période.' : 'No deals for this period.'} />
        ) : (
          <div className="space-y-1">
            {marches.map((m, i) => {
              const etape = etapes.find((e) => e.id === m.stageId);
              const teinte = etape ? visuelEtape(etape, rangs[etape.id] ?? 0).teinte : undefined;
              const accent = idDecrochage.stageId === m.stageId && idDecrochage.perte > 0;
              return (
                <BarreHorizontale
                  key={m.stageId}
                  libelle={fr ? m.nameFr : m.nameEn}
                  valeur={String(m.atteints)}
                  fraction={m.atteints / maxEntonnoir}
                  teinte={teinte}
                  accent={accent}
                  note={
                    accent
                      ? fr
                        ? `Plus gros décrochage — ${idDecrochage.perte} deal${idDecrochage.perte > 1 ? 's' : ''} perdu${idDecrochage.perte > 1 ? 's' : ''} à cette marche (${pourcent(m.tauxPassage, fr)} de passage)`
                        : `Biggest drop-off — ${idDecrochage.perte} deal${idDecrochage.perte > 1 ? 's' : ''} lost at this step (${pourcent(m.tauxPassage, fr)} pass-through)`
                      : i === 0
                        ? fr
                          ? 'Point de départ'
                          : 'Starting point'
                        : fr
                          ? `${pourcent(m.tauxPassage, fr)} de passage depuis l'étape ouverte précédente`
                          : `${pourcent(m.tauxPassage, fr)} pass-through from the previous open stage`
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
            ? "Le cycle va de la création à la fermeture (gagné ou perdu). Le temps par étape se lit sur les transitions : une étape jamais quittée n'y figure pas."
            : 'The cycle runs from creation to close (won or lost). Per-stage time is read from transitions: a stage never left is not counted.'
        }
      />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Tuile
          libelle={fr ? 'Cycle moyen' : 'Average cycle'}
          valeur={cycleJours === null ? '—' : `${nombre(cycleJours, fr)} ${fr ? 'j' : 'd'}`}
          detail={
            fr
              ? `Sur ${fermes.total} deal${fermes.total > 1 ? 's' : ''} fermé${fermes.total > 1 ? 's' : ''}`
              : `Over ${fermes.total} closed deal${fermes.total > 1 ? 's' : ''}`
          }
          calcul={
            fr
              ? 'Moyenne de (date de fermeture − date de création), en jours, sur les deals gagnés ou perdus seulement.'
              : 'Average of (close date − creation date), in days, over won or lost deals only.'
          }
        />
        <div className="lg:col-span-2 rounded-xl border border-outline bg-surface-card p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
              {fr ? 'Temps moyen par étape' : 'Average time per stage'}
            </span>
            <Info
              className="w-3 h-3 text-text-muted"
              role="img"
              aria-label={
                fr
                  ? "Écart moyen entre l'entrée dans l'étape et la transition suivante, d'après l'historique."
                  : 'Average gap between entering a stage and the next transition, from stage history.'
              }
            />
          </div>
          {aucunDeal ? (
            <Vide texte={fr ? 'Aucun deal sur la période.' : 'No deals for this period.'} />
          ) : (
            <div className="space-y-1">
              {tempsEtapes.map((t) => (
                <BarreHorizontale
                  key={t.stageId}
                  libelle={nomEtape.get(t.stageId) ?? t.stageId}
                  valeur={t.jours === 0 ? '—' : `${nombre(t.jours, fr)} ${fr ? 'j' : 'd'}`}
                  fraction={t.jours / maxTempsEtape}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 9. Raisons de perte ── */}
      <SectionHead
        titre={fr ? 'Raisons de perte' : 'Loss reasons'}
        aide={
          fr
            ? "Chaque raison est comptée avec l'étape d'où le deal a été perdu : c'est là qu'il faut agir."
            : 'Each reason is counted with the stage the deal was lost from — that is where to act.'
        }
      />
      <div className="rounded-xl border border-outline bg-surface-card p-4">
        {raisons.length === 0 ? (
          <Vide texte={fr ? 'Aucun deal perdu sur la période.' : 'No lost deals for this period.'} />
        ) : (
          <div className="space-y-1">
            {raisons.map((r) => (
              <BarreHorizontale
                key={`${r.raison}|${r.stageIdPerdu ?? ''}`}
                libelle={r.raison}
                valeur={`${r.nombre} · ${pourcent(totalPertes === 0 ? 0 : r.nombre / totalPertes, fr)}`}
                fraction={totalPertes === 0 ? 0 : r.nombre / totalPertes}
                teinte="var(--color-text-secondary)"
                note={
                  r.stageIdPerdu === null
                    ? fr
                      ? 'Étape non renseignée'
                      : 'Stage not recorded'
                    : fr
                      ? `Perdu à l'étape « ${nomEtape.get(r.stageIdPerdu) ?? r.stageIdPerdu} »`
                      : `Lost at stage “${nomEtape.get(r.stageIdPerdu) ?? r.stageIdPerdu}”`
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* ── 10. Par vendeur ── */}
      <SectionHead
        titre={fr ? 'Par vendeur' : 'By rep'}
        aide={
          fr
            ? "Les deals non assignés forment leur propre ligne. Le taux de closing d'un vendeur suit la même formule que celui du haut : fermés seulement."
            : 'Unassigned deals form their own row. A rep’s close rate uses the same formula as the top tile: closed deals only.'
        }
      />
      <div className="rounded-xl border border-outline bg-surface-card overflow-hidden">
        {vendeurs.length === 0 ? (
          <Vide texte={fr ? 'Aucun deal sur la période.' : 'No deals for this period.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-[12.5px]">
              <thead>
                <tr className="border-b border-outline">
                  <th scope="col" className="text-left font-semibold text-text-tertiary uppercase tracking-wide text-[11px] px-4 py-2.5">{fr ? 'Vendeur' : 'Rep'}</th>
                  <th scope="col" className="text-right font-semibold text-text-tertiary uppercase tracking-wide text-[11px] px-4 py-2.5">{fr ? 'Deals pris' : 'Deals taken'}</th>
                  <th scope="col" className="text-right font-semibold text-text-tertiary uppercase tracking-wide text-[11px] px-4 py-2.5">{fr ? 'Gagnés' : 'Won'}</th>
                  <th scope="col" className="text-right font-semibold text-text-tertiary uppercase tracking-wide text-[11px] px-4 py-2.5">{fr ? 'Closing' : 'Close rate'}</th>
                  <th scope="col" className="text-right font-semibold text-text-tertiary uppercase tracking-wide text-[11px] px-4 py-2.5">{fr ? 'Contact moyen' : 'Avg. contact'}</th>
                </tr>
              </thead>
              <tbody>
                {vendeurs.map((v) => (
                  <tr key={v.memberId ?? NON_ASSIGNE} className="border-b border-border-subtle last:border-0">
                    <td className="px-4 py-3 font-semibold text-text-primary whitespace-nowrap">
                      {v.memberId === null ? (fr ? 'Non assigné' : 'Unassigned') : v.nom}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-primary">{v.pris}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-primary">{v.gagnes}</td>
                    <td
                      className="px-4 py-3 text-right tabular-nums text-text-primary"
                      title={
                        fr
                          ? 'Gagnés ÷ (gagnés + perdus) pour ce vendeur — ses deals encore ouverts sont exclus.'
                          : 'Won ÷ (won + lost) for this rep — their still-open deals are excluded.'
                      }
                    >
                      {pourcent(v.tauxClosing, fr)}
                    </td>
                    <td
                      className="px-4 py-3 text-right tabular-nums text-text-secondary"
                      title={
                        fr
                          ? 'Délai moyen de premier contact sur ses deals contactés.'
                          : 'Average first-contact delay across their contacted deals.'
                      }
                    >
                      {heures(v.delaiContactMoyenHeures, fr)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── 11. À traiter ── */}
      <SectionHead
        titre={fr ? 'À traiter' : 'Needs action'}
        aide={
          fr
            ? "Trois listes d'action, pas un graphique : chaque ligne ouvre le deal. Les délais se comptent depuis la date de référence de la maquette."
            : 'Three action lists, not a chart: each row opens the deal. Delays are counted from the mock reference date.'
        }
      />
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
            {traiter.nonAssignes.length === 0 ? (
              <Vide texte={fr ? 'Tout est assigné.' : 'Everything is assigned.'} />
            ) : (
              traiter.nonAssignes.map((d) => (
                <LigneDeal
                  key={d.id}
                  deal={d}
                  onOuvrir={onOuvrirDeal}
                  secondaire={`${nomEtape.get(d.stageId) ?? d.stageId} · ${fr ? LIBELLE_SOURCE[d.source].fr : LIBELLE_SOURCE[d.source].en}`}
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
              <span className="text-[13px] font-bold tabular-nums text-text-primary">{traiter.sansActiviteDepuis7Jours.length}</span>
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
            {traiter.sansActiviteDepuis7Jours.length === 0 ? (
              <Vide texte={fr ? 'Rien ne dort.' : 'Nothing is stale.'} />
            ) : (
              traiter.sansActiviteDepuis7Jours.map((d) => {
                const jours = Math.floor((ms(MOCK_NOW) - ms(d.lastActivityAt)) / MS_PAR_JOUR);
                return (
                  <LigneDeal
                    key={d.id}
                    deal={d}
                    onOuvrir={onOuvrirDeal}
                    secondaire={
                      fr
                        ? `${nomEtape.get(d.stageId) ?? d.stageId} · ${jours} j sans activité`
                        : `${nomEtape.get(d.stageId) ?? d.stageId} · ${jours}d without activity`
                    }
                  />
                );
              })
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
            {traiter.jobACreer.length === 0 ? (
              <Vide texte={fr ? 'Toutes les jobs sont créées.' : 'All jobs are created.'} />
            ) : (
              traiter.jobACreer.map((d) => (
                <LigneDeal
                  key={d.id}
                  deal={d}
                  onOuvrir={onOuvrirDeal}
                  secondaire={
                    fr
                      ? `Gagné · ${d.assignedName ?? 'Non assigné'}`
                      : `Won · ${d.assignedName ?? 'Unassigned'}`
                  }
                />
              ))
            )}
          </div>
        </div>
      </div>

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
        <TendanceDeuxSeries
          fr={fr}
          labels={tendance.map((s) => libelleSemaine(s.semaine, fr))}
          leads={tendance.map((s) => s.leads)}
          gagnes={tendance.map((s) => s.gagnes)}
          libelleLeads={fr ? 'Leads entrants' : 'Incoming leads'}
          libelleGagnes={fr ? 'Gagnés' : 'Won'}
        />
      </div>
    </div>
  );
}
