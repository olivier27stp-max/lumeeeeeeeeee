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
        is_active: true,
        is_preset: true,
        preset_key: p.preset_key,
      })),
    );
    if (insErr) throw insErr;
  }

  // 3. À la création seulement : tout actif par défaut (décision 20260611)
  if (opts.activateAll) {
    const { error: actErr } = await admin
      .from('automation_rules')
      .update({ is_active: true })
      .eq('org_id', orgId)
      .eq('is_preset', true)
      .eq('is_active', false);
    if (actErr) throw actErr;
  }

  return { inserted: missing.length, repaired: repairedRows?.length || 0 };
}
