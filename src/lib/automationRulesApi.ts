/* ═══════════════════════════════════════════════════════════════
   API — Automation Rules (event-driven engine presets)
   Reads/writes to the automation_rules table.
   These are the REAL working workflows powered by the automation engine.

   Presets are seeded via DB migration (idempotent upsert).
   The UI only reads — it never calls seed on page load.
   ═══════════════════════════════════════════════════════════════ */

import { supabase } from './supabase';
import { getCurrentOrgId } from './orgApi';

export interface AutomationRule {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  trigger_event: string;
  conditions: Record<string, any>;
  delay_seconds: number;
  actions: Array<{ type: string; config: Record<string, any> }>;
  is_active: boolean;
  is_preset: boolean;
  preset_key: string | null;
  created_at: string;
  updated_at: string;
}

export async function getAutomationRules(): Promise<AutomationRule[]> {
  // Resolve current org to avoid cross-org leakage when user has multiple memberships
  const orgId = await getCurrentOrgId();
  if (!orgId) return [];

  const { data, error } = await supabase
    .from('automation_rules')
    .select('*')
    .eq('org_id', orgId)
    .order('name');
  if (error) throw error;
  return (data || []) as AutomationRule[];
}

export async function toggleAutomationRule(id: string, isActive: boolean): Promise<void> {
  // .select() force PostgREST à retourner les lignes touchées : si la RLS
  // filtre la ligne (0 ligne mise à jour), l'update « réussit » silencieusement
  // et l'UI afficherait un faux succès. On vérifie que l'écriture a bien pris.
  const { data, error } = await supabase
    .from('automation_rules')
    .update({ is_active: isActive })
    .eq('id', id)
    .select('is_active');
  if (error) throw error;
  if (!data?.length || data[0].is_active !== isActive) {
    throw new Error('Automation rule update was not applied');
  }
}

/**
 * Replace the body of the send_sms action inside a rule's actions array.
 * Read-modify-write: the other actions (email, tasks, logs) are untouched.
 */
export async function updateRuleSmsBody(id: string, body: string): Promise<void> {
  const { data: rule, error: readErr } = await supabase
    .from('automation_rules')
    .select('actions')
    .eq('id', id)
    .single();
  if (readErr) throw readErr;

  const actions = ((rule?.actions || []) as AutomationRule['actions']).map((a) =>
    a.type === 'send_sms' ? { ...a, config: { ...a.config, body } } : a
  );

  const { error } = await supabase
    .from('automation_rules')
    .update({ actions, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// seedDefaultPresets() a été retiré (audit 2026-07-31).
//
// Il appelait seed_automation_presets(), dont le droit d'exécution a été retiré
// à `authenticated` le 2026-05-13 par 20260513020000_security_p0_fixes.sql —
// délibérément, la fonction étant réservée aux admins. L'appel restait donc
// branché dans le vide depuis deux mois et demi, échouant en 42501 avalé par un
// console.warn.
//
// Aucun composant ne l'appelait, et surtout il était REDONDANT : le trigger
// `trg_org_created_seed_automations` sur la table `orgs` sème déjà les presets
// à la création de l'organisation, en SECURITY DEFINER. La fonctionnalité
// marche donc sans ce chemin manuel.
//
// Si un ensemencement manuel redevient nécessaire, le passer par une route
// serveur avec contrôle admin explicite — ne PAS re-accorder le droit à
// `authenticated`.
