/* ═══════════════════════════════════════════════════════════════
   Vue d'ensemble des automatisations — l'écran « Overview » de GHL.

   Trois tuiles, une courbe sur 7 semaines, le résumé des erreurs et
   l'analyse des déclencheurs. Structure relevée sur leur app.

   CE QUI EST VRAI ET CE QUI NE L'EST PAS : les tuiles et le résumé des
   erreurs lisent de vraies données (`automation_rules`,
   `automation_execution_logs`). La courbe et l'analyse des déclencheurs
   attendent le comptage des inscriptions — elles affichent la structure
   et le disent, plutôt que d'inventer des chiffres.
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Settings, TrendingUp, CheckCircle, AlertTriangle } from 'lucide-react';
import { useTranslation } from '../i18n';
import PermissionGate from '../components/PermissionGate';
import {
  getAutomationRules,
  getRecentAutomationFailures,
  type AutomationRule,
  type AutomationFailure,
} from '../lib/automationRulesApi';

export default function AutomationsApercu() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const navigate = useNavigate();

  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [echecs, setEchecs] = useState<AutomationFailure[]>([]);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    let vivant = true;
    Promise.allSettled([getAutomationRules(), getRecentAutomationFailures(200)])
      .then(([r, e]) => {
        if (!vivant) return;
        if (r.status === 'fulfilled') setRules(r.value);
        if (e.status === 'fulfilled') setEchecs(e.value);
      })
      .finally(() => { if (vivant) setChargement(false); });
    return () => { vivant = false; };
  }, []);

  const publiees = rules.filter((r) => r.is_active).length;

  /**
   * Les 7 dernières semaines, du lundi au dimanche.
   *
   * Les barres sont à zéro tant que le comptage des inscriptions n'existe
   * pas : c'est la structure de l'écran, pas une invention de chiffres.
   */
  const semaines = useMemo(() => {
    const out: Array<{ debut: Date; fin: Date; n: number }> = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const fin = new Date(now);
      fin.setDate(now.getDate() - i * 7);
      const debut = new Date(fin);
      debut.setDate(fin.getDate() - 6);
      out.push({ debut, fin, n: 0 });
    }
    return out;
  }, []);

  const jour = (d: Date) =>
    d.toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'short' });

  return (
    <PermissionGate permission="automations.read">
      <div className="mx-auto max-w-[1400px] space-y-4">

        {/* Sous-navigation, identique à la liste */}
        <div className="flex flex-wrap items-center gap-5 border-b border-border">
          <span className="pb-3 text-[15px] font-semibold text-text-primary">
            {fr ? 'Automatisation' : 'Automation'}
          </span>
          <nav className="flex items-center gap-1" aria-label={fr ? 'Sections' : 'Sections'}>
            <button
              type="button"
              onClick={() => navigate('/automations')}
              className="border-b-2 border-transparent px-3 pb-3 pt-1 text-[13px] text-text-secondary transition-colors hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {fr ? 'Automatisations' : 'Workflows'}
            </button>
            <span className="inline-flex items-center gap-1.5 border-b-2 border-primary px-3 pb-3 pt-1 text-[13px] font-semibold text-primary">
              {fr ? 'Vue d’ensemble' : 'Overview'}
              <span className="rounded bg-warning-light px-1 py-0.5 text-[9px] font-bold uppercase text-warning">
                {fr ? 'Bêta' : 'Beta'}
              </span>
            </span>
            <button
              type="button"
              onClick={() => navigate('/automations/reglages')}
              className="inline-flex items-center gap-1.5 border-b-2 border-transparent px-3 pb-3 pt-1 text-[13px] text-text-secondary transition-colors hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Settings size={13} aria-hidden="true" />
              {fr ? 'Réglages globaux' : 'Global settings'}
            </button>
          </nav>
        </div>

        {chargement ? (
          <div className="section-card flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" aria-hidden="true" />
          </div>
        ) : (
          <>
            {/* Les trois tuiles */}
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { l: fr ? 'Total des automatisations' : 'Total workflows', v: rules.length },
                { l: fr ? 'Automatisations publiées' : 'Published workflows', v: publiees },
                { l: fr ? 'Total des déclenchements' : 'Total enrollments', v: '—' },
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
              <div className="mt-4 flex items-end gap-2" role="img"
                aria-label={fr ? 'Déclenchements par semaine' : 'Enrollments per week'}>
                {semaines.map((s) => (
                  <div key={s.debut.toISOString()} className="flex flex-1 flex-col items-center gap-1.5">
                    <div
                      className="w-full rounded-t bg-primary/15"
                      style={{ height: `${Math.max(4, s.n * 4)}px` }}
                    />
                    <span className="text-[10px] text-text-tertiary">{jour(s.debut)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 border-t border-outline/30 pt-3 text-[12px] text-text-tertiary">
                {fr
                  ? 'Du ' + jour(semaines[semaines.length - 1].debut) + ' au ' + jour(semaines[semaines.length - 1].fin)
                    + ' · Déclenchements : 0 · Croissance : —'
                  : 'From ' + jour(semaines[semaines.length - 1].debut) + ' to ' + jour(semaines[semaines.length - 1].fin)
                    + ' · Enrollments: 0 · Growth: —'}
              </p>
            </div>

            {/* Résumé des erreurs — vrai, lu dans les journaux */}
            <div className="section-card p-4">
              <h2 className="text-[14px] font-semibold text-text-primary">
                {fr ? 'Résumé des erreurs' : 'Error review summary'}
              </h2>
              {echecs.length === 0 ? (
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
                    onClick={() => navigate('/automations')}
                    className="glass-button text-[12px]"
                  >
                    {fr ? 'Voir les automatisations à vérifier' : 'See workflows needing review'}
                  </button>
                </div>
              )}
            </div>

            {/* Analyse des déclencheurs */}
            <div className="section-card p-4">
              <h2 className="text-[14px] font-semibold text-text-primary">
                {fr ? 'Analyse des déclencheurs' : 'Trigger analysis'}
              </h2>
              <p className="mt-0.5 text-[12px] text-text-tertiary">
                {fr
                  ? 'Filtrer la performance des déclencheurs pour voir le détail.'
                  : 'Filter trigger performance by various criteria to get detailed insights.'}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {[
                  { t: fr ? 'Tentatives' : 'Attempted enrollments',
                    d: fr ? 'Contacts évalués par automatisation' : 'Contacts evaluated per workflow' },
                  { t: fr ? 'Correspondances' : 'Matched enrollments',
                    d: fr ? 'Contacts qui correspondent au déclencheur' : 'Contacts matching workflow triggers' },
                  { t: fr ? 'Sans correspondance' : 'Unmatched enrollments',
                    d: fr ? 'Contacts qui ne correspondent pas' : 'Contacts failing to match triggers' },
                ].map((c) => (
                  <div key={c.t} className="rounded-xl border border-border p-3">
                    <p className="text-2xl font-bold text-text-primary">—</p>
                    <p className="mt-0.5 text-[12px] font-medium text-text-primary">{c.t}</p>
                    <p className="text-[11px] text-text-tertiary">{c.d}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-text-tertiary">
                {fr
                  ? 'Ces chiffres arrivent avec le comptage des déclenchements, en même temps que l’onglet « Historique ».'
                  : 'These numbers arrive with enrollment counting, alongside the “History” tab.'}
              </p>
            </div>
          </>
        )}
      </div>
    </PermissionGate>
  );
}
