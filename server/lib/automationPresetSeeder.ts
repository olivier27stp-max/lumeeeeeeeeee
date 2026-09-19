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
import { AUTOMATION_PRESETS } from './automationPresets.data';

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
      description: "Envoie le sondage d'étoiles (courriel + SMS) dès que la job est marquée terminée",
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
  const missing = AUTOMATION_PRESETS.filter((p) => !have.has(p.preset_key));

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
        // Une sollicitation commerciale n'est jamais activée d'office (F7).
        is_active: !PRESETS_SOLLICITATION.has(p.preset_key),
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
  if (opts.activateAll) {
    const { error: actErr } = await admin
      .from('automation_rules')
      .update({ is_active: true })
      .eq('org_id', orgId)
      .eq('is_preset', true)
      .eq('is_active', false)
      .not('preset_key', 'in', `(${[...PRESETS_SOLLICITATION].join(',')})`);
    if (actErr) throw actErr;
  }

  return { inserted: missing.length, repaired: (repairedRows?.length || 0) + (reviewRows?.length || 0) };
}
