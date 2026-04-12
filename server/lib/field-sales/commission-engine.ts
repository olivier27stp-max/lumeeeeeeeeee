/**
 * Commission Engine
 *
 * Calculate, approve, reverse, and query commission entries.
 * Manages commission rules and payroll preview aggregation.
 * Adapted from Clostra for Lume's org_id multi-tenancy model.
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Calculate & Create
// ---------------------------------------------------------------------------

export async function calculateCommission(
  supabase: SupabaseClient,
  orgId: string,
  leadId: string,
  repUserId: string
) {
  // Get lead with value
  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .eq('org_id', orgId)
    .single();

  if (leadErr) throw new Error(leadErr.message);

  const dealValue = lead.value ?? 0;
  if (!dealValue) throw new Error('Lead has no value set.');

  // Find applicable commission rule (user-specific first, then general)
  const { data: rules, error: ruleErr } = await supabase
    .from('fs_commission_rules')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('priority', { ascending: false });

  if (ruleErr) throw new Error(ruleErr.message);

  // Find best matching rule: user-specific > role-specific > general
  const rule = (rules ?? []).find(
    (r) => r.applies_to_user_id === repUserId
  ) || (rules ?? []).find(
    (r) => !r.applies_to_user_id && !r.applies_to_role
  ) || (rules ?? [])[0];

  if (!rule) throw new Error('No applicable commission rule found.');

  let amount = 0;

  switch (rule.type) {
    case 'flat':
      amount = rule.flat_amount ?? 0;
      break;
    case 'percentage':
      amount = dealValue * ((rule.percentage ?? 0) / 100);
      break;
    case 'tiered': {
      const tiers = (rule.tiers ?? []) as Array<{
        min: number;
        max: number;
        rate: number;
      }>;
      const tier = tiers.find(
        (t) => dealValue >= t.min && dealValue <= t.max
      );
      if (tier) {
        amount = dealValue * (tier.rate / 100);
      }
      break;
    }
  }

  const { data: entry, error: entryErr } = await supabase
    .from('fs_commission_entries')
    .insert({
      org_id: orgId,
      user_id: repUserId,
      rule_id: rule.id,
      lead_id: leadId,
      amount: Math.round(amount * 100) / 100,
      base_amount: dealValue,
      description: `Commission for lead ${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
    })
    .select()
    .single();

  if (entryErr) throw new Error(entryErr.message);
  return entry;
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export async function getCommissionEntries(
  supabase: SupabaseClient,
  orgId: string,
  options: {
    userId?: string;
    dateRange?: { from: string; to: string };
    status?: string;
  } = {}
) {
  let query = supabase
    .from('fs_commission_entries')
    .select('*')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (options.userId) query = query.eq('user_id', options.userId);
  if (options.status) query = query.eq('status', options.status);
  if (options.dateRange) {
    query = query
      .gte('created_at', options.dateRange.from)
      .lte('created_at', options.dateRange.to);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  // Enrich with member names
  const userIds = [...new Set((data ?? []).map((e) => e.user_id))];
  const { data: members } = await supabase
    .from('memberships')
    .select('user_id, full_name, avatar_url')
    .eq('org_id', orgId)
    .in('user_id', userIds);

  const memberMap = new Map(
    (members ?? []).map((m) => [m.user_id, m])
  );

  // Enrich with rule names
  const ruleIds = [...new Set((data ?? []).map((e) => e.rule_id))];
  const { data: rules } = await supabase
    .from('fs_commission_rules')
    .select('id, name')
    .in('id', ruleIds);

  const ruleMap = new Map(
    (rules ?? []).map((r) => [r.id, r.name])
  );

  return (data ?? []).map((entry) => {
    const member = memberMap.get(entry.user_id);
    return {
      ...entry,
      rep_name: member?.full_name || 'Unknown',
      rep_avatar: member?.avatar_url || null,
      rule_name: ruleMap.get(entry.rule_id) || 'Unknown',
    };
  });
}

// ---------------------------------------------------------------------------
// Payroll Preview
// ---------------------------------------------------------------------------

export async function getPayrollPreview(
  supabase: SupabaseClient,
  orgId: string,
  userId: string | null,
  periodStart: string,
  periodEnd: string
) {
  let query = supabase
    .from('fs_commission_entries')
    .select('*')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .gte('created_at', periodStart)
    .lte('created_at', periodEnd);

  if (userId) query = query.eq('user_id', userId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const entries = data ?? [];
  const byStatus = (s: string) =>
    entries.filter((e) => e.status === s).reduce((sum, e) => sum + Number(e.amount), 0);

  return {
    total: entries.reduce((sum, e) => sum + Number(e.amount), 0),
    pending: byStatus('pending'),
    approved: byStatus('approved'),
    paid: byStatus('paid'),
    reversed: byStatus('reversed'),
    count: entries.length,
    entries,
  };
}

// ---------------------------------------------------------------------------
// Approve / Reverse
// ---------------------------------------------------------------------------

export async function approveCommission(
  supabase: SupabaseClient,
  orgId: string,
  entryId: string,
  approvedBy: string
) {
  const { data, error } = await supabase
    .from('fs_commission_entries')
    .update({
      status: 'approved',
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', entryId)
    .eq('org_id', orgId)
    .eq('status', 'pending')
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function reverseCommission(
  supabase: SupabaseClient,
  orgId: string,
  entryId: string,
  reason: string
) {
  const { data: existing, error: fetchErr } = await supabase
    .from('fs_commission_entries')
    .select('status')
    .eq('id', entryId)
    .eq('org_id', orgId)
    .single();

  if (fetchErr) throw new Error(fetchErr.message);
  if (existing.status === 'paid') {
    throw new Error('Cannot reverse a commission that has already been paid.');
  }

  const { data, error } = await supabase
    .from('fs_commission_entries')
    .update({
      status: 'reversed',
      description: reason ? `Reversed: ${reason}` : undefined,
      updated_at: new Date().toISOString(),
    })
    .eq('id', entryId)
    .eq('org_id', orgId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

// ---------------------------------------------------------------------------
// Commission Rules CRUD
// ---------------------------------------------------------------------------

export async function getCommissionRules(
  supabase: SupabaseClient,
  orgId: string
) {
  const { data, error } = await supabase
    .from('fs_commission_rules')
    .select('*')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('priority', { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createCommissionRule(
  supabase: SupabaseClient,
  orgId: string,
  ruleData: Record<string, unknown>
) {
  const { data, error } = await supabase
    .from('fs_commission_rules')
    .insert({ ...ruleData, org_id: orgId })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function updateCommissionRule(
  supabase: SupabaseClient,
  orgId: string,
  id: string,
  ruleData: Record<string, unknown>
) {
  const { data, error } = await supabase
    .from('fs_commission_rules')
    .update({ ...ruleData, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('org_id', orgId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}
