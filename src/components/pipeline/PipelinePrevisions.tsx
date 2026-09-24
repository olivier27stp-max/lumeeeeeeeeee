/**
 * Prévisions — l'onglet « Forecast ».
 *
 * CE QUE CES CHIFFRES SONT, ET NE SONT PAS. Une projection, pas une
 * prévision. Le « revenu attendu » multiplie la valeur d'un deal par la
 * probabilité de son étape — un pourcentage saisi à la main, qui dit ce
 * qu'on ESPÈRE, pas ce qui va arriver. L'écran le dit sous le chiffre plutôt
 * que de le laisser passer pour une certitude.
 *
 * Une étape sans probabilité est ABSENTE du revenu attendu, jamais comptée à
 * zéro : un pipeline non configuré afficherait sinon « 0 $ attendu » tout en
 * ayant des deals bien vivants, et le patron conclurait que le mois est
 * mort.
 *
 * Deux vues : le sommaire (chiffres, risques, hygiène des données) et la
 * chronologie (un kanban par mois de fermeture visée).
 */
import { useId, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import PipelineStats from './PipelineStats';
import { libelleSource } from '../../lib/pipeline/presentation';
import { useTranslation } from '../../i18n';
import {
  fetchARisque, fetchChronologie, fetchPrevisions, fetchPrevisionsGroupees,
  type AxeGroupe, type LigneGroupe, type PipelineResume, type RisqueRow,
} from '../../lib/pipelineVentesApi';

/** Cents → « 3 934 $ ». Les cents sont la source de vérité. */
function argent(cents: number, fr: boolean): string {
  return new Intl.NumberFormat(fr ? 'fr-CA' : 'en-CA', {
    style: 'currency', currency: 'CAD',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(cents / 100);
}

function Tuile({ titre, valeur, detail, ton }: {
  titre: string; valeur: string; detail: string; ton?: 'succes' | 'neutre';
}) {
  return (
    <div className="rounded-xl border border-outline bg-surface-card px-5 py-4">
      <div className="text-[12px] font-semibold text-text-secondary">{titre}</div>
      <div
        className="mt-2 text-[24px] font-bold leading-none tabular-nums"
        style={{ color: ton === 'succes' ? 'var(--color-success)' : 'var(--color-text-primary)' }}
      >
        {valeur}
      </div>
      <div className="mt-2 text-[11.5px] text-text-tertiary">{detail}</div>
    </div>
  );
}

/** Une ligne d'hygiène : un compteur et ce qu'il fausse. */
function LigneDonnees({ titre, detail, n, alerte }: {
  titre: string; detail: string; n: number; alerte: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-outline bg-surface-card px-4 py-3">
      <div className="min-w-0">
        <div className="text-[12.5px] font-semibold text-text-primary">{titre}</div>
        <div className="text-[11.5px] text-text-tertiary">{detail}</div>
      </div>
      <span
        className="shrink-0 text-[16px] font-bold tabular-nums"
        style={{ color: alerte && n > 0 ? 'var(--color-danger)' : 'var(--color-text-tertiary)' }}
      >
        {n}
      </span>
    </div>
  );
}

const TEINTE_RISQUE: Record<RisqueRow['niveau'], string> = {
  haut: 'var(--color-danger)',
  moyen: 'var(--color-warning)',
  faible: 'var(--color-success)',
};

/**
 * Les barres horizontales de la répartition.
 *
 * Deux segments empilés par ligne : ce qui est DÉJÀ gagné, et ce qui reste
 * espéré. Les mettre côte à côte laisserait croire à deux quantités
 * indépendantes, alors que l'une est la promesse de l'autre.
 *
 * L'échelle est commune à toutes les lignes (le plus gros total = 100 %) :
 * une barre par ligne mise à son propre maximum donnerait six barres pleines
 * et ne comparerait plus rien.
 */
function BarresGroupes({ lignes, fr, axe }: { lignes: LigneGroupe[]; fr: boolean; axe: AxeGroupe }) {
  const max = Math.max(...lignes.map((l) => l.total_cents), 1);

  return (
    <div className="mt-3 space-y-2">
      {lignes.map((l) => {
        const partGagne = (l.gagne_cents / max) * 100;
        const partOuvert = (l.potentiel_cents / max) * 100;
        return (
          <div key={l.cle} className="flex items-center gap-3">
            <span className="w-[120px] shrink-0 truncate text-[11.5px] text-text-secondary" title={axe === 'source' ? libelleSource(l.libelle, fr) : l.libelle}>
              {axe === 'source' ? libelleSource(l.libelle, fr) : l.libelle}
            </span>
            {/*
              La barre est décorative : le tableau juste en dessous porte les
              mêmes chiffres, lisibles par un lecteur d'écran. La doubler en
              ARIA ferait relire deux fois la même ligne.
            */}
            <div className="h-3.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-tertiary" aria-hidden="true">
              <div className="flex h-full">
                {partGagne > 0 && (
                  <div style={{ width: `${partGagne}%`, background: 'var(--color-success)' }} />
                )}
                {partOuvert > 0 && (
                  <div style={{ width: `${partOuvert}%`, background: 'var(--color-primary)', opacity: 0.55 }} />
                )}
              </div>
            </div>
            <span className="w-[92px] shrink-0 text-right text-[11.5px] tabular-nums text-text-tertiary">
              {argent(l.total_cents, fr)}
            </span>
          </div>
        );
      })}

      <div className="flex flex-wrap gap-4 pt-1 text-[11px] text-text-tertiary">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: 'var(--color-success)' }} aria-hidden="true" />
          {fr ? 'Gagné' : 'Won'}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: 'var(--color-primary)', opacity: 0.55 }}
            aria-hidden="true"
          />
          {fr ? 'Encore ouvert' : 'Still open'}
        </span>
      </div>
    </div>
  );
}

export default function PipelinePrevisions({ pipelines, pipelineActif, onOuvrirDeal }: {
  pipelines: PipelineResume[];
  /** `null` = tous les pipelines confondus. */
  pipelineActif: string | null;
  /** Ouvrir un deal depuis « À traiter » de l'historique. */
  onOuvrirDeal?: (dealId: string) => void;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const idPipeline = useId();
  const idSeuils = useId();

  const [portee, setPortee] = useState<string>(pipelineActif ?? '');
  const [vue, setVue] = useState<'sommaire' | 'chronologie' | 'historique'>('sommaire');
  const [seuilsOuverts, setSeuilsOuverts] = useState(false);
  const idAxe = useId();
  const [axe, setAxe] = useState<AxeGroupe>('etape');
  const [hautFois, setHautFois] = useState(2);
  const [hautJours, setHautJours] = useState(14);
  const [moyenFois, setMoyenFois] = useState(1);
  const [moyenJours, setMoyenJours] = useState(7);

  const cible = portee || null;

  const prevQ = useQuery({
    queryKey: ['pipeline-previsions', cible],
    queryFn: () => fetchPrevisions(cible),
    staleTime: 60_000,
  });
  const risqueQ = useQuery({
    queryKey: ['pipeline-risque', cible, hautFois, hautJours, moyenFois, moyenJours],
    queryFn: () => fetchARisque(cible, { hautFois, hautJours, moyenFois, moyenJours }),
    staleTime: 60_000,
  });
  const groupesQ = useQuery({
    queryKey: ['pipeline-previsions-groupees', cible, axe],
    queryFn: () => fetchPrevisionsGroupees(cible, axe),
    enabled: vue === 'sommaire',
    staleTime: 60_000,
  });

  const chronoQ = useQuery({
    queryKey: ['pipeline-chronologie', cible],
    queryFn: () => fetchChronologie(cible, 6),
    enabled: vue === 'chronologie',
    staleTime: 60_000,
  });

  const p = prevQ.data ?? null;
  const risques = risqueQ.data ?? [];
  const chrono = useMemo(() => chronoQ.data ?? [], [chronoQ.data]);
  const groupes = useMemo(() => groupesQ.data ?? [], [groupesQ.data]);

  /**
   * Le libellé d'une ligne. Groupé par source, la base rend la CLÉ
   * (`form_web`) : c'est ici qu'on la traduit. Par étape ou par vendeur,
   * elle rend déjà un nom lisible qu'il ne faut surtout pas retoucher.
   */
  const libelleLigne = (l: LigneGroupe): string =>
    (axe === 'source' ? libelleSource(l.libelle, fr) : l.libelle);


  const LIBELLE_RISQUE: Record<RisqueRow['niveau'], { titre: string; detail: string }> = {
    haut: {
      titre: fr ? 'Risque élevé' : 'High risk',
      detail: fr
        ? `Repoussé ${hautFois} fois ou ${hautJours} jours et plus`
        : `Pushed ${hautFois}+ times or ${hautJours}+ days`,
    },
    moyen: {
      titre: fr ? 'Risque moyen' : 'Medium risk',
      detail: fr
        ? `Repoussé ${moyenFois} fois ou ${moyenJours} jours (hors élevé)`
        : `Pushed ${moyenFois}+ times or ${moyenJours}+ days (excluding high)`,
    },
    faible: {
      titre: fr ? 'Risque faible' : 'Low risk',
      detail: fr
        ? 'Repoussé au moins une fois (hors élevé et moyen)'
        : 'Pushed at least once (excluding high/medium)',
    },
  };

  const moisCourt = (iso: string) =>
    new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(fr ? 'fr-CA' : 'en-CA', {
      month: 'long', year: 'numeric', timeZone: 'UTC',
    });

  return (
    <div>
      {/* Portée et vue */}
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={idPipeline} className="sr-only">
          {fr ? 'Pipeline' : 'Pipeline'}
        </label>
        <select
          id={idPipeline}
          value={portee}
          onChange={(e) => setPortee(e.target.value)}
          className="input-field max-w-[220px] text-[13px] font-semibold"
        >
          <option value="">{fr ? 'Tous les pipelines' : 'All pipelines'}</option>
          {pipelines.map((pl) => (
            <option key={pl.id} value={pl.id}>{pl.name}</option>
          ))}
        </select>

        <div role="tablist" aria-label={fr ? 'Vue' : 'View'} className="flex gap-1">
          <button
            type="button" role="tab" aria-selected={vue === 'sommaire'}
            onClick={() => setVue('sommaire')}
            className={
              'rounded-lg px-3 py-1.5 text-[12.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary '
              + (vue === 'sommaire'
                ? 'bg-surface-tertiary font-semibold text-text-primary'
                : 'text-text-tertiary hover:bg-surface-secondary hover:text-text-primary')
            }
          >
            {fr ? 'Sommaire' : 'Summary'}
          </button>
          <button
            type="button" role="tab" aria-selected={vue === 'chronologie'}
            onClick={() => setVue('chronologie')}
            className={
              'rounded-lg px-3 py-1.5 text-[12.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary '
              + (vue === 'chronologie'
                ? 'bg-surface-tertiary font-semibold text-text-primary'
                : 'text-text-tertiary hover:bg-surface-secondary hover:text-text-primary')
            }
          >
            {fr ? 'Chronologie' : 'Forecast timeline'}
          </button>
          {/*
            L'historique était un onglet séparé « Statistiques ». Deux écrans
            pour la même question — « où en sont mes ventes ? » — obligeaient
            à se rappeler lequel portait quoi. Ce qui s'est PASSÉ et ce qui va
            ARRIVER vivent maintenant côte à côte.
          */}
          <button
            type="button" role="tab" aria-selected={vue === 'historique'}
            onClick={() => setVue('historique')}
            className={
              'rounded-lg px-3 py-1.5 text-[12.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary '
              + (vue === 'historique'
                ? 'bg-surface-tertiary font-semibold text-text-primary'
                : 'text-text-tertiary hover:bg-surface-secondary hover:text-text-primary')
            }
          >
            {fr ? 'Historique' : 'History'}
          </button>
        </div>
      </div>

      {vue !== 'historique' && prevQ.isLoading && (
        <p className="mt-4 text-[12px] text-text-muted" role="status">
          {fr ? 'Chargement…' : 'Loading…'}
        </p>
      )}

      {vue === 'sommaire' && p && (
        <>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tuile
              titre={fr ? 'Revenu potentiel maximum' : 'Max potential revenue'}
              valeur={argent(p.max_potentiel_cents, fr)}
              detail={fr
                ? 'Si tous les deals ouverts se concluaient'
                : 'If every open deal closed'}
            />
            <Tuile
              titre={fr ? 'Revenu attendu' : 'Expected revenue'}
              valeur={argent(p.attendu_cents, fr)}
              detail={fr
                ? "Pondéré par la probabilité de chaque étape. Les étapes sans probabilité n'y sont pas."
                : 'Weighted by each stage probability. Stages without one are excluded.'}
            />
            <Tuile
              titre={fr ? 'Revenu gagné' : 'Won revenue'}
              valeur={argent(p.gagne_cents, fr)}
              detail={fr ? 'Deals conclus' : 'Closed-won deals'}
              ton="succes"
            />
            <Tuile
              titre={fr ? 'Deals ouverts' : 'Open opportunities'}
              valeur={String(p.ouverts)}
              detail={fr ? 'En cours en ce moment' : 'Currently in progress'}
            />
          </div>

          {/* ── Ventilation ──
              Les quatre totaux disent COMBIEN ; cette section dit D'OÙ. Un
              revenu attendu de 40 000 $ ne se travaille pas ; trois deals
              coincés dans la même étape, oui. */}
          <section className="mt-4 rounded-xl border border-outline bg-surface-card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[13px] font-semibold text-text-primary">
                {fr ? 'Répartition' : 'Breakdown'}
              </h3>
              <div className="flex items-center gap-2">
                <label htmlFor={idAxe} className="text-[11.5px] text-text-tertiary">
                  {fr ? 'Regrouper par' : 'Group by'}
                </label>
                <select
                  id={idAxe}
                  value={axe}
                  onChange={(e) => setAxe(e.target.value as AxeGroupe)}
                  className="input-field max-w-[170px] text-[12px]"
                >
                  <option value="etape">{fr ? 'Étape' : 'Stage'}</option>
                  <option value="vendeur">{fr ? 'Responsable' : 'Owner'}</option>
                  <option value="source">{fr ? 'Source' : 'Source'}</option>
                </select>
              </div>
            </div>

            {groupesQ.isLoading && (
              <p className="mt-3 text-[12px] text-text-muted" role="status">
                {fr ? 'Chargement…' : 'Loading…'}
              </p>
            )}

            {!groupesQ.isLoading && groupes.length === 0 && (
              <p className="mt-3 text-[12px] text-text-muted">
                {fr ? 'Aucun deal à ventiler.' : 'No opportunity to break down.'}
              </p>
            )}

            {groupes.length > 0 && (
              <>
                <BarresGroupes lignes={groupes} fr={fr} axe={axe} />

                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="border-b border-border-subtle text-left text-[10.5px] uppercase tracking-wide text-text-tertiary">
                        <th scope="col" className="py-2 pr-3 font-semibold">
                          {axe === 'etape' ? (fr ? 'Étape' : 'Stage')
                            : axe === 'vendeur' ? (fr ? 'Responsable' : 'Owner')
                            : (fr ? 'Source' : 'Source')}
                        </th>
                        <th scope="col" className="py-2 px-3 text-right font-semibold">{fr ? 'Deals' : 'Opportunities'}</th>
                        <th scope="col" className="py-2 px-3 text-right font-semibold">{fr ? 'Potentiel max' : 'Max potential'}</th>
                        <th scope="col" className="py-2 px-3 text-right font-semibold">{fr ? 'Attendu' : 'Expected'}</th>
                        <th scope="col" className="py-2 px-3 text-right font-semibold">{fr ? 'Gagné' : 'Won'}</th>
                        <th scope="col" className="py-2 pl-3 text-right font-semibold">{fr ? 'Potentiel total' : 'Total potential'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                      {groupes.map((g) => (
                        <tr key={g.cle}>
                          <td className="py-2 pr-3 text-text-primary">{libelleLigne(g)}</td>
                          <td className="py-2 px-3 text-right tabular-nums text-text-secondary">{g.nb}</td>
                          <td className="py-2 px-3 text-right tabular-nums text-text-secondary">{argent(g.potentiel_cents, fr)}</td>
                          <td className="py-2 px-3 text-right tabular-nums text-text-primary">{argent(g.attendu_cents, fr)}</td>
                          <td className="py-2 px-3 text-right tabular-nums" style={{ color: 'var(--color-success)' }}>
                            {argent(g.gagne_cents, fr)}
                          </td>
                          <td className="py-2 pl-3 text-right tabular-nums font-semibold text-text-primary">
                            {argent(g.total_cents, fr)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {/* Le total : il doit retomber sur les tuiles du haut.
                        Deux chiffres différents pour la même chose, et on ne
                        croit plus ni l'un ni l'autre. */}
                    <tfoot>
                      <tr className="border-t-2 border-outline font-semibold text-text-primary">
                        <td className="py-2 pr-3">{fr ? 'Total' : 'Total'}</td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {groupes.reduce((n, g) => n + g.nb, 0)}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {argent(groupes.reduce((n, g) => n + g.potentiel_cents, 0), fr)}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {argent(groupes.reduce((n, g) => n + g.attendu_cents, 0), fr)}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {argent(groupes.reduce((n, g) => n + g.gagne_cents, 0), fr)}
                        </td>
                        <td className="py-2 pl-3 text-right tabular-nums">
                          {argent(groupes.reduce((n, g) => n + g.total_cents, 0), fr)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </section>

          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {/* Les deals qui glissent */}
            <section className="rounded-xl border border-outline bg-surface-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[13px] font-semibold text-text-primary">
                  {fr ? 'Deals à risque' : 'At-risk opportunities'}
                </h3>
                <button
                  type="button"
                  onClick={() => setSeuilsOuverts((o) => !o)}
                  aria-expanded={seuilsOuverts}
                  className="text-[11.5px] text-text-tertiary underline-offset-2 hover:text-text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary rounded"
                >
                  {fr ? 'Ajuster les seuils' : 'Adjust risk settings'}
                </button>
              </div>
              <p className="mt-1 text-[11.5px] text-text-tertiary">
                {fr
                  ? 'Deals dont la date visée a été repoussée. Avancer une date ne compte pas.'
                  : 'Deals whose target date was pushed back. Moving a date earlier does not count.'}
              </p>

              {seuilsOuverts && (
                <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-outline bg-surface-secondary p-3">
                  <label htmlFor={`${idSeuils}-hf`} className="text-[11px] text-text-tertiary">
                    {fr ? 'Élevé — reports' : 'High — pushes'}
                    <input
                      id={`${idSeuils}-hf`} type="number" min={1} max={20} value={hautFois}
                      onChange={(e) => setHautFois(Number(e.target.value) || 1)}
                      className="input-field mt-1 w-full text-[12px]"
                    />
                  </label>
                  <label htmlFor={`${idSeuils}-hj`} className="text-[11px] text-text-tertiary">
                    {fr ? 'Élevé — jours' : 'High — days'}
                    <input
                      id={`${idSeuils}-hj`} type="number" min={1} max={365} value={hautJours}
                      onChange={(e) => setHautJours(Number(e.target.value) || 1)}
                      className="input-field mt-1 w-full text-[12px]"
                    />
                  </label>
                  <label htmlFor={`${idSeuils}-mf`} className="text-[11px] text-text-tertiary">
                    {fr ? 'Moyen — reports' : 'Medium — pushes'}
                    <input
                      id={`${idSeuils}-mf`} type="number" min={1} max={20} value={moyenFois}
                      onChange={(e) => setMoyenFois(Number(e.target.value) || 1)}
                      className="input-field mt-1 w-full text-[12px]"
                    />
                  </label>
                  <label htmlFor={`${idSeuils}-mj`} className="text-[11px] text-text-tertiary">
                    {fr ? 'Moyen — jours' : 'Medium — days'}
                    <input
                      id={`${idSeuils}-mj`} type="number" min={1} max={365} value={moyenJours}
                      onChange={(e) => setMoyenJours(Number(e.target.value) || 1)}
                      className="input-field mt-1 w-full text-[12px]"
                    />
                  </label>
                </div>
              )}

              <div className="mt-3 space-y-2">
                {risques.map((r) => (
                  <div
                    key={r.niveau}
                    className="flex items-center justify-between gap-3 rounded-lg border-l-[3px] bg-surface-secondary px-3 py-2.5"
                    style={{ borderLeftColor: TEINTE_RISQUE[r.niveau] }}
                  >
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-semibold text-text-primary">
                        {LIBELLE_RISQUE[r.niveau].titre}
                      </div>
                      <div className="text-[11px] text-text-tertiary">
                        {LIBELLE_RISQUE[r.niveau].detail}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="text-[13px] font-bold tabular-nums text-text-primary">{r.deals}</span>
                      <span className="ml-1.5 text-[11.5px] tabular-nums text-text-tertiary">
                        ({argent(r.montant_cents, fr)})
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* L'hygiène des données */}
            <section className="rounded-xl border border-outline bg-surface-card p-4">
              <h3 className="text-[13px] font-semibold text-text-primary">
                {fr ? 'Corriger vos données' : 'Fix your forecast data'}
              </h3>
              <p className="mt-1 text-[11.5px] text-text-tertiary">
                {fr
                  ? 'La qualité des données décide de la justesse de la projection.'
                  : 'Data quality directly impacts forecast accuracy.'}
              </p>
              <div className="mt-3 space-y-2">
                <LigneDonnees
                  titre={fr ? 'Sans date de fermeture' : 'Missing close date'}
                  detail={fr ? 'Absents de la chronologie.' : 'Not included in the timeline.'}
                  n={p.sans_date} alerte
                />
                <LigneDonnees
                  titre={fr ? 'Sans montant' : 'Missing value'}
                  detail={fr ? 'Ces deals comptent pour 0 $.' : 'These deals contribute $0.'}
                  n={p.sans_montant} alerte
                />
                <LigneDonnees
                  titre={fr ? 'En retard' : 'Overdue'}
                  detail={fr ? 'Leur date visée est passée.' : 'Their target date has passed.'}
                  n={p.en_retard} alerte
                />
              </div>
            </section>
          </div>
        </>
      )}

      {vue === 'historique' && (
        <div className="mt-4">
          <PipelineStats onOuvrirDeal={onOuvrirDeal} />
        </div>
      )}

      {vue === 'chronologie' && (
        <div className="mt-4">
          {chronoQ.isLoading && (
            <p className="text-[12px] text-text-muted" role="status">
              {fr ? 'Chargement…' : 'Loading…'}
            </p>
          )}

          {!chronoQ.isLoading && chrono.length === 0 && (
            <div className="rounded-xl border border-dashed border-outline px-5 py-10 text-center">
              <p className="text-[13px] text-text-secondary">
                {fr
                  ? 'Aucun deal avec une date de fermeture visée.'
                  : 'No deal has a target close date yet.'}
              </p>
              <p className="mt-1.5 text-[11.5px] text-text-muted">
                {fr
                  ? 'La date se saisit sur le deal. Sans elle, il ne peut apparaître dans aucun mois.'
                  : 'The date is set on the deal. Without it, it cannot appear in any month.'}
              </p>
            </div>
          )}

          {chrono.length > 0 && (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {/* Les deals SANS date, en premier : ce sont eux qu'il faut
                  corriger, et les cacher reviendrait à sous-estimer le mois. */}
              {p && p.sans_date > 0 && (
                <div className="w-[240px] shrink-0 rounded-xl border border-dashed border-outline bg-surface-card px-3.5 py-3">
                  <div className="text-[12.5px] font-semibold" style={{ color: 'var(--color-warning)' }}>
                    {fr ? 'Sans date' : 'No close date'}
                  </div>
                  <div className="mt-1 text-[11.5px] text-text-tertiary">
                    {p.sans_date} {fr ? 'deal(s)' : 'deal(s)'}
                  </div>
                  <div className="mt-1 text-[11px] text-text-muted">
                    {fr ? 'À dater pour compter.' : 'Needs a date to count.'}
                  </div>
                </div>
              )}

              {chrono.map((m) => {
                const part = m.potentiel_cents > 0
                  ? Math.round((m.gagne_cents / m.potentiel_cents) * 100)
                  : 0;
                return (
                  <div
                    key={m.mois}
                    className="w-[240px] shrink-0 rounded-xl border border-outline bg-surface-card px-3.5 py-3"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[12.5px] font-semibold capitalize text-text-primary">
                        {moisCourt(m.mois)}
                      </span>
                      <span className="text-[12px] tabular-nums text-text-primary">
                        {argent(m.potentiel_cents, fr)}
                      </span>
                    </div>
                    <div className="mt-1 text-[11.5px] text-text-tertiary">
                      {m.deals} {fr ? 'deal(s)' : 'deal(s)'}
                    </div>
                    <div className="mt-1 text-[11px] tabular-nums" style={{ color: 'var(--color-success)' }}>
                      {part} % {fr ? 'déjà gagné' : 'already won'} · {argent(m.gagne_cents, fr)}
                    </div>
                    {/* La part gagnée, en barre : un pourcentage se lit plus
                        vite en longueur qu'en chiffres. */}
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-tertiary">
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${Math.min(100, part)}%`, background: 'var(--color-success)' }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
