/**
 * Commission Engine v2
 *
 * Trigger: invoice payment. Computes commission(s) per the rule assigned
 * to the sales rep, applying base + product overrides + performance tiers
 * + conditional bonuses + attribution splits.
 *
 * Inputs come from invoices.line_items + the sales rep on the source
 * lead/quote. Stores `calc_breakdown` jsonb on the entry so the UI can
 * explain how each dollar was computed.
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Core calculator — pure function, no DB
// ---------------------------------------------------------------------------

export interface CalcInput {
  invoiceTotalCents: number;
  invoicePaidAt: string; // ISO
  lineItems: Array<{ category?: string | null; total_cents: number }>;
  // Rep's cumulative period stats up to (but not including) this invoice
  repPeriodRevenueCents: number;
  repPeriodSaleCount: number;
}

export interface CalcResult {
  amountCents: number;
  baseAmountCents: number;
  breakdown: {
    base_kind: 'percent' | 'flat';
    base_value: number;
    base_amount_cents: number;
    product_overrides_applied: Array<{ category: string; amount_cents: number }>;
    tier_bonuses_cents: number;
    conditional_bonuses_cents: number;
  };
}

export function calculateCommissionAmount(rule: any, input: CalcInput): CalcResult {
  const lineItems = input.lineItems || [];
  const total = input.invoiceTotalCents;

  // 1. Base
  const baseKind: 'percent' | 'flat' = rule.base_kind || 'percent';
  const basePct = Number(rule.base_percent ?? 0);
  const baseFlat = Number(rule.base_value_cents ?? 0);

  // Apply per-category overrides where defined, base rate elsewhere
  const overrides: Array<{ category: string; base_kind: 'percent'|'flat'; base_percent: number|null; base_value_cents: number|null }> =
    rule.product_overrides || [];
  const overrideMap = new Map(overrides.map((o) => [o.category, o]));

  let amount = 0;
  const productOverridesApplied: Array<{ category: string; amount_cents: number }> = [];

  if (lineItems.length > 0 && (overrides.length > 0 || baseKind === 'percent')) {
    // Item-by-item to allow per-category rates
    for (const item of lineItems) {
      const cat = item.category || '';
      const ov = cat ? overrideMap.get(cat) : undefined;
      let itemCommission = 0;
      if (ov) {
        itemCommission = ov.base_kind === 'flat'
          ? Number(ov.base_value_cents ?? 0)
          : Math.round(item.total_cents * (Number(ov.base_percent ?? 0) / 100));
        productOverridesApplied.push({ category: cat, amount_cents: itemCommission });
      } else if (baseKind === 'percent') {
        itemCommission = Math.round(item.total_cents * (basePct / 100));
      } // flat base handled below as single amount
      amount += itemCommission;
    }
    if (baseKind === 'flat' && overrides.length === 0) {
      amount = baseFlat;
    } else if (baseKind === 'flat') {
      // For items without override → flat doesn't apply per-item; fall back to single flat
      // (overrides already contributed). Add flat once for items without overrides.
      const hasUncovered = lineItems.some((i) => !overrideMap.has(i.category || ''));
      if (hasUncovered) amount += baseFlat;
    }
  } else {
    // No items: base on invoice total
    amount = baseKind === 'flat' ? baseFlat : Math.round(total * (basePct / 100));
  }

  const baseAmountCents = amount;

  // 2. Performance tiers (additive modifiers on top of base)
  let tierBonus = 0;
  const tiers: Array<{ metric: 'revenue_cents'|'sale_count'; threshold: number; modifier_percent: number|null; modifier_flat_cents: number|null }> =
    rule.performance_tiers || [];
  for (const tier of tiers) {
    const metricValue = tier.metric === 'sale_count'
      ? input.repPeriodSaleCount + 1
      : input.repPeriodRevenueCents + total;
    if (metricValue >= tier.threshold) {
      if (tier.modifier_percent) tierBonus += Math.round(total * (tier.modifier_percent / 100));
      if (tier.modifier_flat_cents) tierBonus += tier.modifier_flat_cents;
    }
  }
  amount += tierBonus;

  // 3. Conditional bonuses
  let condBonus = 0;
  const bonuses: Array<{ condition: string; value: number; modifier_percent: number|null; modifier_flat_cents: number|null }> =
    rule.bonuses || [];
  for (const b of bonuses) {
    let matched = false;
    if (b.condition === 'min_sale_amount') matched = total >= b.value;
    // max_refund_days_passed / paid_within_days require external timestamps — handled at trigger time
    if (matched) {
      if (b.modifier_percent) condBonus += Math.round(total * (b.modifier_percent / 100));
      if (b.modifier_flat_cents) condBonus += b.modifier_flat_cents;
    }
  }
  amount += condBonus;

  return {
    amountCents: Math.max(0, amount),
    baseAmountCents,
    breakdown: {
      base_kind: baseKind,
      base_value: baseKind === 'percent' ? basePct : baseFlat,
      base_amount_cents: baseAmountCents,
      product_overrides_applied: productOverridesApplied,
      tier_bonuses_cents: tierBonus,
      conditional_bonuses_cents: condBonus,
    },
  };
}

// ---------------------------------------------------------------------------
// Trigger: job created → project a PENDING (estimated) commission entry.
// The amount is an estimate from the job total; it is recomputed and the entry
// is confirmed (→ approved) when the linked invoice is paid.
// ---------------------------------------------------------------------------
export async function projectCommissionForJob(
  supabase: SupabaseClient,
  orgId: string,
  jobId: string
): Promise<{ created: number; skipped: string | null }> {
  // 1. Load the job
  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select('id, org_id, salesperson_id, created_by, total_cents, total, deleted_at')
    .eq('id', jobId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (jobErr || !job) return { created: 0, skipped: 'job_not_found' };
  if (job.deleted_at) return { created: 0, skipped: 'job_deleted' };

  // 2. Rep = job salesperson, else its creator
  const repUserId: string | null = job.salesperson_id || job.created_by || null;
  if (!repUserId) return { created: 0, skipped: 'no_rep' };

  // 3. Skip if any entry already exists for this job (avoid duplicates)
  const { data: dup } = await supabase
    .from('fs_commission_entries')
    .select('id')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .is('deleted_at', null)
    .limit(1);
  if (dup && dup.length > 0) return { created: 0, skipped: 'already_projected' };

  // 4. Resolve rule (same logic as the invoice flow)
  const { data: rules } = await supabase.from('fs_commission_rules')
    .select('*').eq('org_id', orgId).eq('is_active', true).is('deleted_at', null)
    .order('priority', { ascending: false });
  let rule = (rules ?? []).find((r: any) => Array.isArray(r.assigned_user_ids) && r.assigned_user_ids.includes(repUserId));
  if (!rule) {
    const { data: settings } = await supabase.from('commission_settings')
      .select('default_rule_id').eq('org_id', orgId).maybeSingle();
    if (settings?.default_rule_id) rule = (rules ?? []).find((r: any) => r.id === settings.default_rule_id);
  }
  if (!rule) return { created: 0, skipped: 'no_rule' };

  // 5. Estimate base from the job total
  const baseCents = Number(job.total_cents || 0) || Math.round(Number(job.total || 0) * 100);
  if (baseCents <= 0) return { created: 0, skipped: 'no_amount' };

  // 6. Rep period stats (calendar month) up to now
  const now = new Date();
  const nowIso = now.toISOString();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const { data: priorEntries } = await supabase.from('fs_commission_entries')
    .select('base_amount').eq('org_id', orgId).eq('user_id', repUserId)
    .is('deleted_at', null).gte('triggered_at', periodStart).lt('triggered_at', nowIso);
  const repPeriodRevenueCents = (priorEntries ?? []).reduce((s: number, e: any) => s + Number(e.base_amount || 0), 0);
  const repPeriodSaleCount = (priorEntries ?? []).length;

  // 7. Calculate the estimate
  const calc = calculateCommissionAmount(rule, {
    invoiceTotalCents: baseCents,
    invoicePaidAt: nowIso,
    lineItems: [],
    repPeriodRevenueCents,
    repPeriodSaleCount,
  });
  if (calc.amountCents <= 0) return { created: 0, skipped: 'zero_amount' };

  // 8. Insert the pending (estimated) entry — confirmed when the invoice is paid
  const { error } = await supabase.from('fs_commission_entries').insert({
    org_id: orgId, user_id: repUserId, rule_id: rule.id,
    invoice_id: null, job_id: jobId, lead_id: null,
    status: 'pending', amount: calc.amountCents / 100, base_amount: baseCents / 100,
    description: 'Estimation — en attente du paiement de la facture', triggered_at: nowIso,
    calc_breakdown: { ...calc.breakdown, projected: true, total_calculated_cents: calc.amountCents },
  });
  if (error) return { created: 0, skipped: 'insert_failed' };
  return { created: 1, skipped: null };
}

// ---------------------------------------------------------------------------
// Trigger: invoice paid → create commission entries
// ---------------------------------------------------------------------------

export async function generateCommissionsForInvoice(
  supabase: SupabaseClient,
  orgId: string,
  invoiceId: string
): Promise<{ created: number; skipped: string | null }> {
  // 1. Skip if already generated
  const { data: existing } = await supabase
    .from('fs_commission_entries')
    .select('id')
    .eq('org_id', orgId)
    .eq('invoice_id', invoiceId)
    .is('deleted_at', null)
    .limit(1);
  if (existing && existing.length > 0) return { created: 0, skipped: 'already_generated' };

  // 2. Load invoice + line items
  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .select('id, org_id, total_cents, paid_at, status, client_id, quote_id, job_id, line_items')
    .eq('id', invoiceId)
    .eq('org_id', orgId)
    .single();
  if (invErr || !invoice) return { created: 0, skipped: 'invoice_not_found' };
  if (invoice.status !== 'paid' || !invoice.paid_at) return { created: 0, skipped: 'not_paid' };

  // 3. Identify rep: from quote.assigned_to / lead.assigned_to
  let repUserId: string | null = null;
  if (invoice.quote_id) {
    const { data: q } = await supabase.from('quotes')
      .select('assigned_to, lead_id, client_id')
      .eq('id', invoice.quote_id).eq('org_id', orgId).maybeSingle();
    repUserId = q?.assigned_to || null;
    if (!repUserId && q?.lead_id) {
      const { data: l } = await supabase.from('leads')
        .select('assigned_to').eq('id', q.lead_id).eq('org_id', orgId).maybeSingle();
      repUserId = l?.assigned_to || null;
    }
  }
  // Fallback: attribute to the job's salesperson (or its creator) when no
  // quote/lead rep was found.
  if (!repUserId && invoice.job_id) {
    const { data: j } = await supabase.from('jobs')
      .select('salesperson_id, created_by')
      .eq('id', invoice.job_id).eq('org_id', orgId).maybeSingle();
    repUserId = j?.salesperson_id || j?.created_by || null;
  }
  if (!repUserId) return { created: 0, skipped: 'no_rep' };

  // 4. Find rule: assigned_user_ids contains rep → else default rule from settings
  const { data: rules } = await supabase.from('fs_commission_rules')
    .select('*').eq('org_id', orgId).eq('is_active', true).is('deleted_at', null)
    .order('priority', { ascending: false });
  let rule = (rules ?? []).find((r: any) => Array.isArray(r.assigned_user_ids) && r.assigned_user_ids.includes(repUserId));
  if (!rule) {
    const { data: settings } = await supabase.from('commission_settings')
      .select('default_rule_id').eq('org_id', orgId).maybeSingle();
    if (settings?.default_rule_id) rule = (rules ?? []).find((r: any) => r.id === settings.default_rule_id);
  }
  if (!rule) return { created: 0, skipped: 'no_rule' };

  // 5. Compute rep's period stats (calendar month) BEFORE this invoice
  const paidDate = new Date(invoice.paid_at);
  const periodStart = new Date(paidDate.getFullYear(), paidDate.getMonth(), 1).toISOString();
  const { data: priorEntries } = await supabase.from('fs_commission_entries')
    .select('base_amount').eq('org_id', orgId).eq('user_id', repUserId)
    .is('deleted_at', null).gte('triggered_at', periodStart).lt('triggered_at', invoice.paid_at);
  const repPeriodRevenueCents = (priorEntries ?? []).reduce((s: number, e: any) => s + Number(e.base_amount || 0), 0);
  const repPeriodSaleCount = (priorEntries ?? []).length;

  // 6. Calculate
  const calc = calculateCommissionAmount(rule, {
    invoiceTotalCents: Number(invoice.total_cents || 0),
    invoicePaidAt: invoice.paid_at,
    lineItems: Array.isArray(invoice.line_items) ? invoice.line_items : [],
    repPeriodRevenueCents,
    repPeriodSaleCount,
  });

  // 7. Attribution: solo vs split
  const attribution = rule.attribution || { mode: 'solo' };
  const recipients: Array<{ user_id: string; pct: number }> = attribution.mode === 'split' && Array.isArray(attribution.splits)
    ? attribution.splits.filter((s: any) => s.user_id).map((s: any) => ({ user_id: s.user_id, pct: Number(s.pct || 0) }))
    : [{ user_id: repUserId, pct: 100 }];
  const sumPct = recipients.reduce((s, r) => s + r.pct, 0) || 100;

  // 8. Insert/confirm one entry per recipient.
  //    When the invoice is tied to a job, confirm the rep's pre-projected
  //    pending entry (created at job creation) instead of inserting a duplicate,
  //    and mark it approved (= earned) since the invoice is now paid.
  const confirmStatus = invoice.job_id ? 'approved' : 'pending';
  let created = 0;
  for (const r of recipients) {
    const share = Math.round(calc.amountCents * (r.pct / sumPct));
    if (share <= 0) continue;

    const entryFields = {
      rule_id: rule.id,
      invoice_id: invoiceId,
      job_id: invoice.job_id || null,
      status: confirmStatus,
      amount: share / 100,
      base_amount: Number(invoice.total_cents || 0) / 100,
      description: 'Commission on invoice payment',
      triggered_at: invoice.paid_at,
      calc_breakdown: { ...calc.breakdown, split_pct: r.pct, total_calculated_cents: calc.amountCents },
    };

    // Confirm an existing projected (pending, no invoice) entry for this rep+job.
    let confirmed = false;
    if (invoice.job_id) {
      const { data: projected } = await supabase.from('fs_commission_entries')
        .select('id')
        .eq('org_id', orgId).eq('job_id', invoice.job_id).eq('user_id', r.user_id)
        .is('invoice_id', null).is('deleted_at', null).limit(1);
      if (projected && projected.length > 0) {
        const { error } = await supabase.from('fs_commission_entries')
          .update(entryFields).eq('id', projected[0].id);
        if (!error) { created++; confirmed = true; }
      }
    }

    if (!confirmed) {
      const { error } = await supabase.from('fs_commission_entries')
        .insert({ org_id: orgId, user_id: r.user_id, lead_id: null, ...entryFields });
      if (!error) created++;
    }
  }
  return { created, skipped: null };
}

// ---------------------------------------------------------------------------
// Reversal handler: invoice un-paid (refund/cancel) → apply policy
// ---------------------------------------------------------------------------

export async function handleInvoiceReversal(
  supabase: SupabaseClient,
  orgId: string,
  invoiceId: string,
  reason: string
): Promise<{ action: 'auto_reversed' | 'kept' | 'alert'; affected: number }> {
  const { data: settings } = await supabase.from('commission_settings')
    .select('reversal_policy').eq('org_id', orgId).maybeSingle();
  const policy = settings?.reversal_policy || 'alert';

  const { data: entries } = await supabase.from('fs_commission_entries')
    .select('id, status').eq('org_id', orgId).eq('invoice_id', invoiceId)
    .is('deleted_at', null);

  const affected = (entries ?? []).length;
  if (affected === 0) return { action: policy as any, affected: 0 };

  if (policy === 'keep') return { action: 'kept', affected };

  if (policy === 'auto') {
    const ids = (entries ?? []).filter((e: any) => e.status !== 'paid').map((e: any) => e.id);
    if (ids.length > 0) {
      await supabase.from('fs_commission_entries')
        .update({ status: 'reversed', auto_reversed: true, reverse_reason: reason, updated_at: new Date().toISOString() })
        .in('id', ids);
    }
    return { action: 'auto_reversed', affected: ids.length };
  }

  // alert: mark reverse_reason but keep status; UI will surface
  await supabase.from('fs_commission_entries')
    .update({ reverse_reason: reason, updated_at: new Date().toISOString() })
    .eq('org_id', orgId).eq('invoice_id', invoiceId).is('deleted_at', null);
  return { action: 'alert', affected };
}

// ---------------------------------------------------------------------------
// Mark paid
// ---------------------------------------------------------------------------

export async function markCommissionPaid(
  supabase: SupabaseClient,
  orgId: string,
  entryId: string
) {
  const { data, error } = await supabase.from('fs_commission_entries')
    .update({ status: 'paid', paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', entryId).eq('org_id', orgId).eq('status', 'approved')
    .select().single();
  if (error) throw new Error(error.message);
  return data;
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
