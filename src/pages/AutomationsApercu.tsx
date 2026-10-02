/* ═══════════════════════════════════════════════════════════════
   Vue d'ensemble des automatisations.

   Les tuiles, la courbe, le détail des envois ignorés et le résumé des
   erreurs — sur la PÉRIODE CHOISIE (7, 30 ou 90 jours), écrite à l'écran.

   TOUS LES CHIFFRES viennent de la même route que la liste
   (`/api/automations/rules/stats`), qui compte EN BASE avec une seule
   définition par métrique. Avant, cette page lisait les journaux depuis le
   navigateur : au-delà de 1 000 lignes elle affichait 1 000 et mettait la
   semaine en cours à zéro (D-01), au-delà de 200 échecs elle en affichait
   200 (D-02), et son « Total des déclenchements » ne comptait pas la même
   chose que la colonne de la liste (D-09 : 20 contre 24).

   Une lecture en panne s'affiche comme une panne : « — » et un message,
   jamais « 0 ». Les chiffres se relisent au retour sur l'onglet et toutes
   les 30 secondes tant que la page est visible.
   ═══════════════════════════════════════════════════════════════ */

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, TrendingUp, CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { useTranslation } from '../i18n';
import PermissionGate from '../components/PermissionGate';
import SousNavigation from '../components/automations/SousNavigation';
import { getAutomationRules, type AutomationRule } from '../lib/automationRulesApi';
import {
  chargerStatistiquesBureau, lirePeriodeChoisie, retenirPeriode, type JourStats, type Statistiques,
} from '../lib/automationStatsApi';
import { PERIODES_JOURS, libelleGroupe, libelleIssue, libellePeriode, type PeriodeJours } from '../lib/automationIssues';
import type { GroupeMotif } from '../lib/automationMotifs';
import { useRafraichissementVisible } from '../hooks/useRafraichissementVisible';

/** Une barre de la courbe : un jour, ou une tranche de 7 jours quand la période est longue. */
interface Tranche {
  /** Premier et dernier jour (AAAA-MM-JJ). */
  debut: string;
  fin: string;
  n: number;
}

/**
 * La courbe : un jour par barre jusqu'à 30 jours ; au-delà, des tranches de 7 jours qui
 * FINISSENT aujourd'hui (la plus ancienne peut être plus courte). La somme des barres est
 * toujours le total de la période.
 */
export function tranchesDeLaCourbe(jours: JourStats[]): Tranche[] {
  if (jours.length <= 31) return jours.map((j) => ({ debut: j.jour, fin: j.jour, n: j.declenchees }));
  const tranches: Tranche[] = [];
  for (let fin = jours.length - 1; fin >= 0; fin -= 7) {
    const debut = Math.max(0, fin - 6);
    const morceau = jours.slice(debut, fin + 1);
    tranches.unshift({ debut: morceau[0].jour, fin: morceau[morceau.length - 1].jour, n: morceau.reduce((s, j) => s + j.declenchees, 0) });
  }
  return tranches;
}

/** L'ordre d'affichage des raisons d'un envoi ignoré. */
const ORDRE_GROUPES: GroupeMotif[] = ['doublon', 'desabonne', 'hors_ciblage', 'donnee_manquante', 'condition_plus_valide', 'plafond', 'autre', 'hors_heures'];

export default function AutomationsApercu() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const navigate = useNavigate();
  const idPeriode = useId();

  const [periode, setPeriode] = useState<PeriodeJours>(() => lirePeriodeChoisie());
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [stats, setStats] = useState<Statistiques | null>(null);
  const [chargement, setChargement] = useState(true);
  const [rafraichissement, setRafraichissement] = useState(false);
  /*
   * Une lecture ÉCHOUÉE n'est pas une lecture vide (audit V2, A-08) :
   * des journaux illisibles affichaient « Aucune erreur — toutes les
   * automatisations tournent normalement ».
   */
  const [reglesIllisibles, setReglesIllisibles] = useState(false);
  const [statsIllisibles, setStatsIllisibles] = useState(false);

  /** Seule la dernière lecture a le droit d'écrire l'écran (changement de période pendant une lecture). */
  const numero = useRef(0);
  const lire = useCallback(async (silencieux: boolean) => {
    const moi = ++numero.current;
    if (silencieux) setRafraichissement(true); else setChargement(true);
    const [r, s] = await Promise.allSettled([getAutomationRules(), chargerStatistiquesBureau(periode)]);
    if (moi !== numero.current) return;
    if (r.status === 'fulfilled') { setRules(r.value); setReglesIllisibles(false); }
    else { setReglesIllisibles(true); console.error('[apercu] règles illisibles', r.reason); }
    if (s.status === 'fulfilled') { setStats(s.value); setStatsIllisibles(false); }
    else { setStats(null); setStatsIllisibles(true); console.error('[apercu] statistiques illisibles', s.reason); }
    setChargement(false);
    setRafraichissement(false);
  }, [periode]);

  useEffect(() => { void lire(false); }, [lire]);
  useRafraichissementVisible(() => { if (!chargement) void lire(true); });

  /*
   * La corbeille ne compte pas (audit V2, A-14) : la tuile affichait 142
   * pour 141 automatisations vivantes et 1 supprimée.
   */
  const vivantes = rules.filter((r) => !r.deleted_at);
  const publiees = vivantes.filter((r) => r.is_active).length;

  const total = stats?.total ?? null;
  const tranches = useMemo(() => tranchesDeLaCourbe(stats?.par_jour ?? []), [stats]);
  const parJour = tranches.length > 0 && tranches.every((t) => t.debut === t.fin);

  const jour = (iso: string) =>
    // Midi UTC : la date civile rendue par le serveur ne change pas de jour selon le fuseau du navigateur.
    new Date(`${iso}T12:00:00Z`).toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'short', timeZone: 'UTC' });

  const sousTitre = libellePeriode(periode, fr);
  const chiffre = (n: number | undefined) => (total ? (n ?? 0) : '—');
  const groupes = ORDRE_GROUPES.filter((g) => (total?.ignorees_par_groupe[g] ?? 0) > 0);
  const reports = Object.entries(total?.reportees_par_code ?? {}).filter(([, n]) => n > 0);

  return (
    <PermissionGate permission="automations.read">
      <div className="mx-auto max-w-[1400px] space-y-4">

        {/* Sous-navigation, identique à la liste */}
        <SousNavigation courante="apercu" fr={fr} />

        {/* La période des chiffres : choisie ici, écrite sur chaque tuile. */}
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={idPeriode} className="text-[12px] text-text-secondary">{fr ? 'Période' : 'Period'}</label>
          <select
            id={idPeriode}
            value={periode}
            onChange={(e) => { const j = Number(e.target.value) as PeriodeJours; retenirPeriode(j); setPeriode(j); }}
            className="glass-input py-1 text-[12px]"
          >
            {PERIODES_JOURS.map((j) => <option key={j} value={j}>{libellePeriode(j, fr)}</option>)}
          </select>
          <button
            type="button"
            onClick={() => void lire(true)}
            disabled={rafraichissement || chargement}
            className="glass-button inline-flex items-center gap-1.5 text-[12px] disabled:opacity-60"
          >
            <RefreshCw size={12} className={rafraichissement ? 'animate-spin' : undefined} aria-hidden="true" />
            {fr ? 'Actualiser' : 'Refresh'}
          </button>
          <Link to="/automations/activite" className="ml-auto text-[12px] font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            {fr ? 'Voir l’activité, client par client' : 'See the activity, client by client'}
          </Link>
        </div>

        {chargement ? (
          <div className="section-card flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" aria-hidden="true" />
          </div>
        ) : (
          <>
            {statsIllisibles && (
              <div role="alert" className="flex flex-wrap items-center gap-2.5 rounded-xl border border-warning/40 bg-warning-light px-3 py-2.5 text-[13px] text-text-primary">
                <AlertTriangle size={15} className="shrink-0 text-warning" aria-hidden="true" />
                <span>
                  {fr
                    ? 'Les chiffres n’ont pas pu être lus pour le moment : rien n’est affiché plutôt qu’un faux zéro.'
                    : 'The numbers could not be read right now: nothing is shown rather than a false zero.'}
                </span>
                <button type="button" onClick={() => void lire(false)} className="glass-button text-[12px]">
                  {fr ? 'Réessayer' : 'Try again'}
                </button>
              </div>
            )}

            {/* Les automatisations */}
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { l: fr ? 'Total des automatisations' : 'Total workflows', v: reglesIllisibles ? '—' : vivantes.length },
                { l: fr ? 'Automatisations publiées' : 'Published workflows', v: reglesIllisibles ? '—' : publiees },
              ].map((t) => (
                <div key={t.l} className="section-card px-4 py-3.5">
                  <p className="text-[12px] text-text-secondary">{t.l}</p>
                  <p className="mt-1 text-2xl font-bold text-text-primary">{t.v}</p>
                </div>
              ))}
            </div>

            {/* Les quatre chiffres de la période */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  l: fr ? 'Déclenchées' : 'Triggered', v: chiffre(total?.declenchees),
                  aide: fr ? 'Fiches entrées dans une automatisation.' : 'Records that entered an automation.',
                },
                {
                  l: fr ? 'Envoyées' : 'Sent', v: chiffre(total?.envoyees),
                  aide: fr ? 'Messages réellement partis chez un client.' : 'Messages that actually went out to a client.',
                },
                {
                  l: fr ? 'Échouées' : 'Failed', v: chiffre(total?.echouees),
                  aide: fr ? 'Échecs définitifs, après les nouvelles tentatives.' : 'Final failures, after the retries.',
                },
                {
                  l: fr ? 'Ignorées' : 'Skipped', v: chiffre(total?.ignorees),
                  aide: fr ? 'Rien n’est parti, volontairement : le détail est plus bas.' : 'Nothing was sent, on purpose: details below.',
                },
              ].map((t) => (
                <div key={t.l} className="section-card px-4 py-3.5">
                  <p className="text-[12px] text-text-secondary">{t.l}</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-text-primary">{t.v}</p>
                  <p className="mt-0.5 text-[11px] text-text-tertiary">{sousTitre} · {t.aide}</p>
                </div>
              ))}
            </div>
            {total && (
              <p className="px-1 text-[12px] text-text-secondary">
                {fr
                  ? `${sousTitre} : ${total.reportees} envoi(s) reporté(s), ${total.actions} action(s) interne(s) faite(s) (tâche, étiquette, notification). En ce moment : ${total.en_cours} fiche(s) en cours.`
                  : `${sousTitre}: ${total.reportees} send(s) postponed, ${total.actions} internal action(s) done (task, tag, notification). Right now: ${total.en_cours} record(s) in progress.`}
              </p>
            )}

            {/* La courbe de la période */}
            <div className="section-card p-4">
              <h2 className="flex items-center gap-2 text-[14px] font-semibold text-text-primary">
                <TrendingUp size={15} className="text-accent" aria-hidden="true" />
                {parJour
                  ? (fr ? `Déclenchées par jour — ${sousTitre}` : `Triggered per day — ${sousTitre}`)
                  : (fr ? `Déclenchées par semaine — ${sousTitre}` : `Triggered per week — ${sousTitre}`)}
              </h2>
              {tranches.length === 0 ? (
                <p className="mt-4 text-[12px] text-text-tertiary">
                  {statsIllisibles
                    ? (fr ? 'La courbe n’a pas pu être lue.' : 'The chart could not be read.')
                    : (fr ? 'Aucune donnée pour l’instant.' : 'No data yet.')}
                </p>
              ) : (
                <>
                  <div
                    className="mt-4 flex h-[140px] items-end gap-1"
                    role="img"
                    aria-label={fr
                      ? `Déclenchées ${parJour ? 'par jour' : 'par semaine'} : ${tranches.map((s) => s.n).join(', ')}`
                      : `Triggered ${parJour ? 'per day' : 'per week'}: ${tranches.map((s) => s.n).join(', ')}`}
                  >
                    {tranches.map((s, i) => {
                      /* L'échelle suit la plus haute barre.
                         Une hauteur fixe en `n * 4px` donnait une barre de
                         600 px pour 150 déclenchements : le graphique
                         débordait de sa carte. */
                      const sommet = Math.max(1, ...tranches.map((x) => x.n));
                      const hauteur = s.n === 0 ? 3 : Math.max(6, Math.round((s.n / sommet) * 120));
                      // Trente barres : une étiquette sur cinq, et toujours la dernière.
                      const etiquette = tranches.length <= 14 || i === tranches.length - 1 || (tranches.length - 1 - i) % 5 === 0;
                      return (
                        <div key={s.debut} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                          <span className="text-[10px] font-medium tabular-nums text-text-secondary">
                            {s.n > 0 ? s.n : ''}
                          </span>
                          <div
                            className={s.n > 0 ? 'w-full rounded-t bg-primary/40' : 'w-full rounded-t bg-outline/30'}
                            style={{ height: `${hauteur}px` }}
                          />
                          <span className="h-3 whitespace-nowrap text-[10px] text-text-tertiary">{etiquette ? jour(s.debut) : ''}</span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-3 border-t border-outline/30 pt-3 text-[12px] text-text-tertiary">
                    {(() => {
                      const derniere = tranches[tranches.length - 1];
                      const avant = tranches[tranches.length - 2];
                      /* La croissance n'a de sens que si la tranche
                         précédente n'était pas à zéro : sinon tout passage
                         de 0 à 1 afficherait « +∞ ». */
                      const croissance = avant && avant.n > 0
                        ? `${derniere.n >= avant.n ? '+' : ''}${Math.round(((derniere.n - avant.n) / avant.n) * 100)} %`
                        : '—';
                      const quand = derniere.debut === derniere.fin
                        ? (fr ? `Le ${jour(derniere.debut)}` : `On ${jour(derniere.debut)}`)
                        : (fr ? `Du ${jour(derniere.debut)} au ${jour(derniere.fin)}` : `From ${jour(derniere.debut)} to ${jour(derniere.fin)}`);
                      const contre = parJour ? (fr ? 'la veille' : 'the day before') : (fr ? 'la semaine d’avant' : 'the week before');
                      return fr
                        ? `${quand} · Déclenchées : ${derniere.n} · Contre ${contre} : ${croissance}`
                        : `${quand} · Triggered: ${derniere.n} · Versus ${contre}: ${croissance}`;
                    })()}
                  </p>
                </>
              )}
            </div>

            {/* Pourquoi des envois ont été ignorés ou reportés */}
            <div className="section-card p-4">
              <h2 className="text-[14px] font-semibold text-text-primary">
                {fr ? `Envois ignorés, par raison — ${sousTitre}` : `Skipped sends, by reason — ${sousTitre}`}
              </h2>
              {!total ? (
                <p className="mt-3 text-[12px] text-text-tertiary">{fr ? 'Les raisons n’ont pas pu être lues.' : 'The reasons could not be read.'}</p>
              ) : groupes.length === 0 && reports.length === 0 ? (
                <p className="mt-3 text-[13px] text-text-secondary">
                  {fr ? 'Aucun envoi ignoré ni reporté sur cette période.' : 'No send was skipped or postponed over this period.'}
                </p>
              ) : (
                <table className="mt-3 w-full max-w-[560px] text-[13px]">
                  <thead>
                    <tr className="border-b border-outline/40 text-left text-[12px] text-text-secondary">
                      <th scope="col" className="py-1.5 pr-3 font-medium">{fr ? 'Raison' : 'Reason'}</th>
                      <th scope="col" className="py-1.5 text-right font-medium">{fr ? 'Nombre' : 'Count'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupes.map((g) => (
                      <tr key={g} className="border-b border-outline/20 last:border-0">
                        <td className="py-1.5 pr-3 text-text-primary">{libelleGroupe(g, fr)}</td>
                        <td className="py-1.5 text-right tabular-nums text-text-primary">{total.ignorees_par_groupe[g]}</td>
                      </tr>
                    ))}
                    {reports.map(([code, n]) => (
                      <tr key={code} className="border-b border-outline/20 last:border-0">
                        <td className="py-1.5 pr-3 text-text-secondary">
                          {libelleIssue(code, fr)}
                          <span className="text-text-tertiary">{fr ? ' (le message partira : il n’est pas ignoré)' : ' (the message will go out: it is not skipped)'}</span>
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-text-secondary">{n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Résumé des erreurs — vrai, compté en base */}
            <div className="section-card p-4">
              <h2 className="text-[14px] font-semibold text-text-primary">
                {fr ? 'Résumé des erreurs' : 'Error review summary'}
              </h2>
              {!total ? (
                <div className="mt-3 flex items-center gap-2.5 text-[13px] text-warning">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <span>
                    {fr
                      ? 'Les erreurs n’ont pas pu être lues pour le moment. Réessayez dans un instant.'
                      : 'Errors could not be read right now. Try again in a moment.'}
                  </span>
                </div>
              ) : total.echouees === 0 ? (
                <div className="mt-3 flex items-center gap-2.5 text-[13px] text-text-secondary">
                  <CheckCircle size={16} className="text-success" aria-hidden="true" />
                  <span>
                    {fr
                      ? `Aucune erreur sur les ${periode} derniers jours — toutes les automatisations tournent normalement.`
                      : `No workflow errors in the last ${periode} days — all workflows are running smoothly.`}
                  </span>
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  <p className="flex items-center gap-2 text-[13px] text-danger">
                    <AlertTriangle size={15} aria-hidden="true" />
                    {fr
                      ? `${total.echouees} action(s) ont échoué ces ${periode} derniers jours.`
                      : `${total.echouees} action(s) failed in the last ${periode} days.`}
                  </p>
                  <button
                    type="button"
                    onClick={() => navigate('/automations?onglet=verifier')}
                    className="glass-button text-[12px]"
                  >
                    {fr ? 'Voir les automatisations à vérifier' : 'See workflows needing review'}
                  </button>
                </div>
              )}
            </div>

            {/* « Analyse des déclencheurs » (tentatives, correspondances) RETIRÉE
                le 2026-09-28 : aucune donnée ne la remplit — le moteur ne
                journalise pas les événements qui ne correspondent à aucune
                règle. Trois cases « — » au launch disaient « ça ne marche
                pas ». Elle reviendra avec un vrai comptage. */}
          </>
        )}
      </div>
    </PermissionGate>
  );
}
