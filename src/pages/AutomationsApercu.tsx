/* ═══════════════════════════════════════════════════════════════
   Vue d'ensemble des automatisations — l'écran « Overview » de GHL.

   Trois tuiles, une courbe sur 7 semaines et le résumé des erreurs.
   Structure relevée sur leur app.

   TOUT CE QUI EST AFFICHÉ LIT DE VRAIES DONNÉES (`automation_rules`,
   `automation_execution_logs`) : la courbe compte les déclenchements réels
   semaine par semaine. L'« Analyse des déclencheurs » de GHL a été retirée
   (audit du 2026-09-28) : aucune donnée ne la remplissait, elle n'affichait
   que des « — ».
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, TrendingUp, CheckCircle, AlertTriangle } from 'lucide-react';
import { useTranslation } from '../i18n';
import PermissionGate from '../components/PermissionGate';
import SousNavigation from '../components/automations/SousNavigation';
import {
  getAutomationRules,
  getRecentAutomationFailures,
  type AutomationRule,
  type AutomationFailure,
} from '../lib/automationRulesApi';
import { activiteParSemaine, type ActiviteSemaine } from '../lib/automationJournauxApi';

export default function AutomationsApercu() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const navigate = useNavigate();

  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [echecs, setEchecs] = useState<AutomationFailure[]>([]);
  const [chargement, setChargement] = useState(true);
  /*
   * Une lecture ÉCHOUÉE n'est pas une lecture vide (audit V2, A-08) :
   * `allSettled` avalait l'échec, et des journaux illisibles affichaient
   * « Aucune erreur — toutes les automatisations tournent normalement ».
   */
  const [reglesIllisibles, setReglesIllisibles] = useState(false);
  const [echecsIllisibles, setEchecsIllisibles] = useState(false);
  /** Les vrais déclenchements, lus dans les journaux d'exécution. */
  const [activite, setActivite] = useState<{ total: number; parSemaine: ActiviteSemaine[] }>(
    { total: 0, parSemaine: [] },
  );

  useEffect(() => {
    let vivant = true;
    Promise.allSettled([getAutomationRules(), getRecentAutomationFailures(200), activiteParSemaine(7)])
      .then(([r, e, a]) => {
        if (!vivant) return;
        if (r.status === 'fulfilled') setRules(r.value);
        else { setReglesIllisibles(true); console.error('[apercu] règles illisibles', r.reason); }
        if (e.status === 'fulfilled') setEchecs(e.value);
        else { setEchecsIllisibles(true); console.error('[apercu] journaux illisibles', e.reason); }
        if (a.status === 'fulfilled') setActivite(a.value);
        else console.error('[apercu] activité illisible', a.reason);
      })
      .finally(() => { if (vivant) setChargement(false); });
    return () => { vivant = false; };
  }, []);

  /*
   * La corbeille ne compte pas (audit V2, A-14) : la tuile affichait 142
   * pour 141 automatisations vivantes et 1 supprimée.
   */
  const vivantes = rules.filter((r) => !r.deleted_at);
  const publiees = vivantes.filter((r) => r.is_active).length;

  /**
   * Les 7 dernières semaines, du lundi au dimanche.
   *
   * Comptées dans `automation_execution_logs` — les vraies exécutions du
   * moteur, dédoublonnées par déclenchement (une règle qui fait trois
   * actions ne compte qu'une fois).
   */
  const semaines = activite.parSemaine;

  const jour = (d: Date) =>
    d.toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'short' });

  return (
    <PermissionGate permission="automations.read">
      <div className="mx-auto max-w-[1400px] space-y-4">

        {/* Sous-navigation, identique à la liste */}
        <SousNavigation courante="apercu" fr={fr} />

        {chargement ? (
          <div className="section-card flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" aria-hidden="true" />
          </div>
        ) : (
          <>
            {/* Les trois tuiles */}
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { l: fr ? 'Total des automatisations' : 'Total workflows', v: reglesIllisibles ? '—' : vivantes.length },
                { l: fr ? 'Automatisations publiées' : 'Published workflows', v: reglesIllisibles ? '—' : publiees },
                { l: fr ? 'Total des déclenchements' : 'Total enrollments', v: activite.total },
              ].map((t) => (
                <div key={t.l} className="section-card px-4 py-3.5">
                  <p className="text-[12px] text-text-secondary">{t.l}</p>
                  <p className="mt-1 text-2xl font-bold text-text-primary">{t.v}</p>
                </div>
              ))}
            </div>

            {/* La courbe des 7 dernières semaines */}
            <div className="section-card p-4">
              <h2 className="flex items-center gap-2 text-[14px] font-semibold text-text-primary">
                <TrendingUp size={15} className="text-accent" aria-hidden="true" />
                {fr ? 'Déclenchements — 7 dernières semaines' : 'Enrollments — last 7 weeks'}
              </h2>
              {semaines.length === 0 ? (
                <p className="mt-4 text-[12px] text-text-tertiary">
                  {fr ? 'Aucune donnée pour l’instant.' : 'No data yet.'}
                </p>
              ) : (
                <>
                  <div
                    className="mt-4 flex h-[140px] items-end gap-2"
                    role="img"
                    aria-label={fr
                      ? `Déclenchements par semaine : ${semaines.map((s) => s.n).join(', ')}`
                      : `Enrollments per week: ${semaines.map((s) => s.n).join(', ')}`}
                  >
                    {semaines.map((s) => {
                      /* L'échelle suit la plus haute semaine.
                         Une hauteur fixe en `n * 4px` donnait une barre de
                         600 px pour 150 déclenchements : le graphique
                         débordait de sa carte. */
                      const sommet = Math.max(1, ...semaines.map((x) => x.n));
                      const hauteur = s.n === 0 ? 3 : Math.max(6, Math.round((s.n / sommet) * 120));
                      return (
                        <div key={s.debut.toISOString()} className="flex flex-1 flex-col items-center gap-1.5">
                          <span className="text-[10px] font-medium tabular-nums text-text-secondary">
                            {s.n > 0 ? s.n : ''}
                          </span>
                          <div
                            className={s.n > 0 ? 'w-full rounded-t bg-primary/40' : 'w-full rounded-t bg-outline/30'}
                            style={{ height: `${hauteur}px` }}
                          />
                          <span className="text-[10px] text-text-tertiary">{jour(s.debut)}</span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-3 border-t border-outline/30 pt-3 text-[12px] text-text-tertiary">
                    {(() => {
                      const derniere = semaines[semaines.length - 1];
                      const avant = semaines[semaines.length - 2];
                      /* La croissance n'a de sens que si la semaine
                         précédente n'était pas à zéro : sinon tout passage
                         de 0 à 1 afficherait « +∞ ». */
                      const croissance = avant && avant.n > 0
                        ? `${derniere.n >= avant.n ? '+' : ''}${Math.round(((derniere.n - avant.n) / avant.n) * 100)} %`
                        : '—';
                      return fr
                        ? `Du ${jour(derniere.debut)} au ${jour(derniere.fin)} · Déclenchements : ${derniere.n} · Croissance : ${croissance}`
                        : `From ${jour(derniere.debut)} to ${jour(derniere.fin)} · Enrollments: ${derniere.n} · Growth: ${croissance}`;
                    })()}
                  </p>
                </>
              )}
            </div>

            {/* Résumé des erreurs — vrai, lu dans les journaux */}
            <div className="section-card p-4">
              <h2 className="text-[14px] font-semibold text-text-primary">
                {fr ? 'Résumé des erreurs' : 'Error review summary'}
              </h2>
              {echecsIllisibles ? (
                <div className="mt-3 flex items-center gap-2.5 text-[13px] text-warning">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <span>
                    {fr
                      ? 'Les erreurs n’ont pas pu être lues pour le moment. Réessayez dans un instant.'
                      : 'Errors could not be read right now. Try again in a moment.'}
                  </span>
                </div>
              ) : echecs.length === 0 ? (
                <div className="mt-3 flex items-center gap-2.5 text-[13px] text-text-secondary">
                  <CheckCircle size={16} className="text-success" aria-hidden="true" />
                  <span>
                    {fr
                      ? 'Aucune erreur — toutes les automatisations tournent normalement.'
                      : 'No workflow errors found — all workflows are running smoothly.'}
                  </span>
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  <p className="flex items-center gap-2 text-[13px] text-danger">
                    <AlertTriangle size={15} aria-hidden="true" />
                    {fr
                      ? `${echecs.length} envoi(s) ont échoué ces 7 derniers jours.`
                      : `${echecs.length} send(s) failed in the last 7 days.`}
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
