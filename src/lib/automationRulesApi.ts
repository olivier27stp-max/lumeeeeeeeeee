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
/**
 * Réécrit le corps d'une action d'envoi — SMS ou courriel.
 *
 * Remplace `updateRuleSmsBody`, qui ne couvrait que les SMS : le texte des
 * courriels n'était modifiable NULLE PART, alors que 35 automatisations
 * écrivent aux clients au nom de l'entreprise.
 *
 * `subject` n'a de sens que pour un courriel ; il est ignoré pour un SMS.
 */
export async function updateRuleMessage(
  id: string,
  actionType: 'send_sms' | 'send_email',
  body: string,
  subject?: string,
): Promise<void> {
  const { data: rule, error: readErr } = await supabase
    .from('automation_rules')
    .select('actions')
    .eq('id', id)
    .single();
  if (readErr) throw readErr;

  const actions = ((rule?.actions || []) as AutomationRule['actions']).map((a) =>
    a.type === actionType
      ? {
          ...a,
          config: {
            ...a.config,
            body,
            ...(actionType === 'send_email' && subject !== undefined ? { subject } : {}),
          },
        }
      : a,
  );

  // `.select()` force PostgREST à retourner les lignes touchées : sans lui, un
  // filtrage par la RLS produirait un « succès » silencieux (0 ligne modifiée)
  // et l'utilisateur croirait avoir enregistré son texte.
  const { data: updated, error } = await supabase
    .from('automation_rules')
    .update({ actions, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!updated || updated.length === 0) {
    throw new Error("Modification refusée — vous n'avez pas accès à cette automatisation.");
  }
}

/** @deprecated Utiliser `updateRuleMessage`. Conservé le temps de migrer les appelants. */
export async function updateRuleSmsBody(id: string, body: string): Promise<void> {
  return updateRuleMessage(id, 'send_sms', body);
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

/* ── Échecs d'automatisation ──────────────────────────────────────
   Le moteur journalise chaque exécution dans `automation_execution_logs`,
   mais AUCUNE page ne lisait cette table : une automatisation cassée restait
   affichée « active » avec un badge vert, et l'utilisateur n'apprenait jamais
   que ses clients n'avaient rien reçu. */

export interface AutomationFailure {
  id: string;
  automation_rule_id: string | null;
  action_type: string;
  result_error: string | null;
  entity_type: string | null;
  created_at: string;
}

/**
 * Échecs d'exécution des 7 derniers jours, les plus récents d'abord.
 *
 * Lecture seule, cloisonnée par l'org courante et par la RLS de la table.
 */
export async function getRecentAutomationFailures(limit = 50): Promise<AutomationFailure[]> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return [];

  const depuis = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('automation_execution_logs')
    .select('id, automation_rule_id, action_type, result_error, entity_type, created_at')
    .eq('org_id', orgId)
    .eq('result_success', false)
    .gte('created_at', depuis)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data || []) as AutomationFailure[];
}

/** Nombre d'échecs par règle sur 7 jours — pour le badge d'alerte de la liste. */
export async function getFailureCountsByRule(): Promise<Record<string, number>> {
  const failures = await getRecentAutomationFailures(200);
  const counts: Record<string, number> = {};
  for (const f of failures) {
    if (!f.automation_rule_id) continue;
    counts[f.automation_rule_id] = (counts[f.automation_rule_id] || 0) + 1;
  }
  return counts;
}

/**
 * Identité de l'entreprise, pour l'aperçu des courriels d'automatisation.
 *
 * Le serveur enveloppe chaque envoi dans `buildEmailLayout` (logo, en-tête,
 * pied de page) — exactement comme pour une facture ou un devis. Sans ces
 * données, l'éditeur montrerait un message « nu » alors qu'il arrivera habillé
 * chez le client.
 */
export interface ApercuEntreprise {
  company_name: string | null;
  company_logo_url: string | null;
  company_phone: string | null;
}

export async function getCompanyBranding(): Promise<ApercuEntreprise> {
  const vide = { company_name: null, company_logo_url: null, company_phone: null };
  const orgId = await getCurrentOrgId();
  if (!orgId) return vide;

  const { data, error } = await supabase
    .from('company_settings')
    .select('company_name, logo_url, phone')
    .eq('org_id', orgId)
    .maybeSingle();

  // Un aperçu sans logo reste utile : on ne bloque pas l'éditeur pour ça.
  if (error || !data) return vide;
  return {
    company_name: data.company_name ?? null,
    company_logo_url: data.logo_url ?? null,
    company_phone: data.phone ?? null,
  };
}
