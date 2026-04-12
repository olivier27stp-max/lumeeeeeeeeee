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
  const { error } = await supabase
    .from('automation_rules')
    .update({ is_active: isActive })
    .eq('id', id);
  if (error) throw error;
}

/** Manually trigger preset seeding for an org (admin use only) */
export async function seedDefaultPresets(): Promise<number> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return 0;

  const { data, error } = await supabase.rpc('seed_automation_presets', { p_org_id: orgId });
  if (error) {
    console.warn('[automationRulesApi] seed_automation_presets error:', error.message);
    return 0;
  }
  return (data as number) || 0;
}
