/* ═══════════════════════════════════════════════════════════════
   Seeder — Filet de sécurité pour les presets d'automatisation.

   La création d'une org déclenche trg_org_created_seed_automations
   (fonction SQL seed_automation_presets), mais cette fonction a déjà
   divergé en prod (drift de migrations : version du 20260331 restée
   déployée — 21 presets au lieu de 34, quote_followup_1d branché sur
   'estimate.sent', événement jamais émis).

   ensureAutomationPresets() garantit l'état canonique quoi qu'il
   arrive côté DB :
   1. répare quote_followup_1d si encore sur 'estimate.sent';
   2. insère les presets manquants (jamais d'écrasement de l'existant);
   3. optionnellement (création d'org seulement) active tous les presets.
   ═══════════════════════════════════════════════════════════════ */

import { SupabaseClient } from '@supabase/supabase-js';
import { AUTOMATION_PRESETS, type AutomationPresetDef } from './automationPresets.data';
import { PACK_PARCOURS, PACK_ACTIF } from './automationPack.data';

/**
 * Presets de SOLLICITATION commerciale — jamais activés d'office (F7, audit
 * automatisations ; corrigé le 2026-09-19).
 * ─────────────────────────────────────────────────────────────────────
 * La ligne de partage n'est pas « commercial » au sens large : c'est la
 * sollicitation de NOUVELLES affaires auprès de quelqu'un qui n'a rien
 * demandé. Une relance de devis ou de facture impayée suit un échange que le
 * client a lui-même engagé ; un cross-sell six mois après une job, non.
 *
 * Au Canada, ces messages-là exigent un consentement (LCAP ; loi 25 au
 * Québec). Les activer d'office, c'est envoyer de la publicité au nom d'une
 * entreprise qui vient de s'inscrire et n'a jamais donné son accord — avec
 * les amendes pour elle, et le reproche pour nous.
 *
 * L'entreprise reste libre de les activer dans Automatisations : ce n'est pas
 * une interdiction, c'est un choix qui lui revient. Le consentement par client
 * est vérifié en plus, à l'envoi (server/lib/actions/index.ts).
 */
export const PRESETS_SOLLICITATION: ReadonlySet<string> = new Set([
  'cross_sell_30d',            // « on offre aussi d'autres services » — 30 j après la job
  'seasonal_reminder_6m',      // relance saisonnière, 6 mois après
  'lost_lead_reengagement',    // réengagement d'un lead perdu, jamais devenu client
  'reengagement_90d',          // réengagement d'un client dormant, 90 jours
  'client_anniversary',        // message d'anniversaire à visée commerciale
]);

/**
 * Presets qui dépendent du réglage « Avis clients » : ils ne sont publiés
 * qu'une fois les avis activés avec un lien (voir la fin de
 * ensureAutomationPresets et SettingsReviews.tsx).
 */
export const PRESETS_ATTENDENT_AVIS: ReadonlySet<string> = new Set([
  'google_review',
  'review_reminder_7d',
]);

/**
 * Complète les presets d'automatisation d'une org. Idempotent et
 * non destructif : n'insère que les preset_key absents.
 *
 * @param activateAll À passer UNIQUEMENT à la création de l'org (aucun
 *   toggle utilisateur encore possible) — force is_active=true partout.
 */
export async function ensureAutomationPresets(
  admin: SupabaseClient,
  orgId: string,
  opts: { activateAll?: boolean } = {},
): Promise<{ inserted: number; repaired: number }> {
  /*
   * 0. L'entreprise a-t-elle DÉJÀ reçu son socle ?
   *
   * `activateAll` (publier le pack, mettre tout le reste en brouillon) ne
   * doit s'appliquer qu'UNE fois, à la création. Or le webhook de paiement
   * et l'onboarding le rappelaient aussi sur une entreprise EXISTANTE (le
   * client qui paie par un lien a déjà un compte) : ses automatisations
   * étaient remises à zéro, sans un mot — celles qu'elle avait éteintes se
   * rallumaient, celles qu'elle avait publiées retombaient en brouillon
   * (constaté le 2026-09-30). `orgs.automations_initialisees_le` le retient.
   */
  let dejaInitialisee = false;
  if (opts.activateAll) {
    const { data: org, error: orgErr } = await admin
      .from('orgs')
      .select('automations_initialisees_le')
      .eq('id', orgId)
      .maybeSingle();
    if (orgErr) throw orgErr;
    dejaInitialisee = !!(org as { automations_initialisees_le?: string | null } | null)?.automations_initialisees_le;
  }
  const activer = !!opts.activateAll && !dejaInitialisee;

  // 1. Réparer le trigger jamais émis hérité du vieux seed DB
  const { data: repairedRows, error: repErr } = await admin
    .from('automation_rules')
    .update({
      trigger_event: 'quote.sent',
      name: 'Quote Follow-Up — 1 Day After Sent',
      description: 'Follow up on a quote 1 day after sending it',
    })
    .eq('org_id', orgId)
    .eq('preset_key', 'quote_followup_1d')
    .eq('trigger_event', 'estimate.sent')
    .select('id');
  if (repErr) throw repErr;

  // 1b. Workflow « Avis clients » (2026-09-07) : le sondage part DÈS la fin
  // de la job. Seules les règles encore sur la valeur du vieux seed (7200 s)
  // sont ramenées à 0 — un délai personnalisé par l'entreprise est conservé.
  const { data: reviewRows, error: revErr } = await admin
    .from('automation_rules')
    .update({
      delay_seconds: 0,
      name: "Sondage d'avis — dès la fin de la job",
      description: "Envoie la demande d'avis Google / Facebook (courriel + SMS) dès que la job est marquée terminée",
    })
    .eq('org_id', orgId)
    .eq('preset_key', 'google_review')
    .eq('delay_seconds', 7200)
    .select('id');
  if (revErr) throw revErr;

  // 2. Insérer les presets manquants
  const { data: existing, error: exErr } = await admin
    .from('automation_rules')
    .select('preset_key')
    .eq('org_id', orgId)
    .not('preset_key', 'is', null);
  if (exErr) throw exErr;

  const have = new Set((existing || []).map((r: { preset_key: string }) => r.preset_key));
  const catalogue: Array<AutomationPresetDef & { steps?: unknown[]; settings?: Record<string, unknown> | null }> = [...AUTOMATION_PRESETS, ...PACK_PARCOURS];
  const packCles = new Set(PACK_PARCOURS.map((p) => p.preset_key));
  const missing = catalogue.filter((p) => !have.has(p.preset_key));

  if (missing.length > 0) {
    const { error: insErr } = await admin.from('automation_rules').insert(
      missing.map((p) => ({
        org_id: orgId,
        name: p.name,
        description: p.description,
        trigger_event: p.trigger_event,
        conditions: p.conditions,
        delay_seconds: p.delay_seconds,
        actions: p.actions,
        ...(p.steps ? { steps: p.steps, settings: p.settings ?? null } : {}),
        /*
         * Une sollicitation commerciale n'est jamais activée d'office (F7).
         * Les parcours du PACK ne sont publiés qu'à la CRÉATION (étape 3) :
         * ajoutés à une entreprise existante, ils doubleraient ses relances
         * déjà actives (5 relances de devis + le parcours = messages en
         * double). Ils y arrivent en brouillon, donc dans Modèles.
         */
        // Entreprise déjà installée : ce qui manque arrive en BROUILLON —
        // on ne publie jamais rien de neuf chez elle sans qu'elle le décide.
        is_active: !dejaInitialisee && !PRESETS_SOLLICITATION.has(p.preset_key) && !packCles.has(p.preset_key),
        is_preset: true,
        preset_key: p.preset_key,
      })),
    );
    if (insErr) throw insErr;
  }

  // 3. À la création seulement : actif par défaut (décision 20260611), SAUF
  // les presets de sollicitation commerciale (F7, 2026-09-19). Voir
  // PRESETS_SOLLICITATION : on n'active pas d'office une relance publicitaire
  // au nom d'une entreprise qui vient de s'inscrire et n'a rien demandé.
  if (activer) {
    /*
     * LE PACK DE BASE (décidé le 2026-09-28) : seuls ses parcours et
     * préréglages sont publiés ; tout le reste — y compris les anciennes
     * relances séparées que le trigger SQL `seed_automation_presets` insère
     * publiées — passe en brouillon, donc dans l'onglet Modèles. Mesuré en
     * prod : 21 à 27 préréglages publiés jamais déclenchés par entreprise.
     */
    const actifs = [...PACK_ACTIF].filter((k) => !PRESETS_SOLLICITATION.has(k));
    const { error: actErr } = await admin
      .from('automation_rules')
      .update({ is_active: true })
      .eq('org_id', orgId)
      .eq('is_preset', true)
      .in('preset_key', actifs);
    if (actErr) throw actErr;
    const { error: brouillonErr } = await admin
      .from('automation_rules')
      .update({ is_active: false })
      .eq('org_id', orgId)
      .eq('is_preset', true)
      .not('preset_key', 'in', `(${actifs.join(',')})`);
    if (brouillonErr) throw brouillonErr;

    // Les demandes d'avis ne peuvent RIEN envoyer tant que l'entreprise ne les
    // a pas activées avec un lien Google ou Facebook (`review_enabled` vaut
    // faux à la création). Publiées d'office — y compris par le trigger SQL
    // `seed_automation_presets` —, elles échouaient à chaque job terminée.
    // Elles se publient quand l'entreprise active les avis (Paramètres ›
    // Avis clients, SettingsReviews.tsx).
    const { data: cs, error: csErr } = await admin
      .from('company_settings')
      .select('review_enabled')
      .eq('org_id', orgId)
      .maybeSingle();
    if (csErr) throw csErr;
    if (cs?.review_enabled !== true) {
      const { error: avisErr } = await admin
        .from('automation_rules')
        .update({ is_active: false })
        .eq('org_id', orgId)
        .in('preset_key', [...PRESETS_ATTENDENT_AVIS]);
      if (avisErr) throw avisErr;
    }

    // Retenu : les prochains appels (paiement, onboarding) ne toucheront plus
    // jamais à l'activation de ses automatisations.
    const { error: marqueErr } = await admin
      .from('orgs')
      .update({ automations_initialisees_le: new Date().toISOString() })
      .eq('id', orgId)
      .is('automations_initialisees_le', null);
    if (marqueErr) throw marqueErr;
  }

  return { inserted: missing.length, repaired: (repairedRows?.length || 0) + (reviewRows?.length || 0) };
}
