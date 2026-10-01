/**
 * Politique de remboursement des commissions, SANS migration (2026-09-30).
 *
 * La contrainte CHECK de commission_settings.reversal_policy n'accepte que
 * 'auto' | 'keep' | 'alert'. L'option « Reprendre » (clawback) est donc
 * enregistrée comme reversal_policy = 'auto' + un drapeau dans une colonne
 * JSON qui existe déjà : field_settings.automation_defaults.commissions_reprise.
 *
 * Écrire field_settings est délicat : la colonne show_peer_payouts vaut `true`
 * par défaut et ouvre, en base, la lecture des commissions de tous les
 * collègues (Loi 25). Toute ligne écrite ici la force donc à `false`, et une
 * ligne créée reprend exactement les valeurs que l'app affiche quand elle
 * n'existe pas (server/routes/field-sales.ts, GET /settings).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type PolitiqueRemboursement = 'auto' | 'keep' | 'alert' | 'clawback';

/** Valeurs affichées par l'app quand l'entreprise n'a pas encore de réglages terrain. */
export const REGLAGES_TERRAIN_PAR_DEFAUT = {
  feature_enabled: false,
  territory_restriction_enabled: false,
  auto_revisit_days: 3,
  auto_followup_days: 1,
  voice_notes_enabled: true,
  ai_summaries_enabled: false,
  show_peer_payouts: false,
  default_pin_template_id: null,
  automation_defaults: {},
} as const;

export async function politiqueRemboursement(sc: SupabaseClient, orgId: string): Promise<PolitiqueRemboursement> {
  const [{ data: cs, error: e1 }, { data: fs, error: e2 }] = await Promise.all([
    sc.from('commission_settings').select('reversal_policy').eq('org_id', orgId).maybeSingle(),
    sc.from('field_settings').select('automation_defaults').eq('org_id', orgId).maybeSingle(),
  ]);
  if (e1) throw new Error(`commission settings read failed: ${e1.message}`);
  if (e2) throw new Error(`field settings read failed: ${e2.message}`);
  const base = (cs?.reversal_policy as PolitiqueRemboursement | undefined) || 'alert';
  const reprise = (fs?.automation_defaults as Record<string, unknown> | null)?.commissions_reprise === true;
  return base === 'auto' && reprise ? 'clawback' : base;
}

/** Pose ou retire le drapeau « Reprendre » (sans jamais ouvrir la visibilité entre collègues). */
export async function ecrireDrapeauReprise(sc: SupabaseClient, orgId: string, actif: boolean): Promise<void> {
  const { data: fs, error } = await sc.from('field_settings').select('id, automation_defaults').eq('org_id', orgId).maybeSingle();
  if (error) throw new Error(`field settings read failed: ${error.message}`);
  if (!fs && !actif) return; // rien à retirer, et on ne crée pas de ligne pour rien
  const automation_defaults = { ...((fs?.automation_defaults as Record<string, unknown> | null) ?? {}), commissions_reprise: actif };
  const { error: eEcr } = fs
    ? await sc.from('field_settings').update({ automation_defaults, show_peer_payouts: false, updated_at: new Date().toISOString() }).eq('id', fs.id)
    : await sc.from('field_settings').insert({ org_id: orgId, ...REGLAGES_TERRAIN_PAR_DEFAUT, automation_defaults });
  if (eEcr) throw new Error(`field settings write failed: ${eEcr.message}`);
}
