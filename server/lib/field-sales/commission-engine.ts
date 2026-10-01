/**
 * Commission Engine v2
 *
 * Trigger: invoice payment. Computes commission(s) per the rule assigned
 * to the sales rep, applying base + product overrides + performance tiers
 * + conditional bonuses + attribution splits.
 *
 * Inputs come from the invoice total + the sales rep on the source
 * lead/quote. Stores `calc_breakdown` jsonb on the entry so the UI can
 * explain how each dollar was computed.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { companyOrgIds } from '../supabase';
import { fuseauOrg } from '../automations-fuseau-org';
import {
  bornesPeriode, debutDuMoisLocal, enCents, totauxCommissions, repartirParts, baseAvantTaxesCents,
} from './commission-periode';
import { toLocalDate } from '../reports/dates';
import { dateDeRattachement } from './commission-verrou';
import { politiqueRemboursement } from './commission-reglages';

/**
 * Cumul du mois pour les paliers de performance : ce que le rep a GAGNÉ ce
 * mois-ci (mois civil de l'entreprise) avant l'instant `avant`.
 *
 * Corrige trois défauts de l'ancien calcul :
 *  - `base_amount` est en DOLLARS : il était additionné au total de la facture
 *    en CENTS, donc un seuil de 2 500 $ n'était jamais atteint par le cumul ;
 *  - le mois était celui du fuseau du SERVEUR (UTC), pas de l'entreprise ;
 *  - les estimations (jobs non payés, dont celui de la facture en cours) et
 *    les commissions reversées gonflaient le cumul.
 */
async function cumulDuMois(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  avant: string,
): Promise<{ revenueCents: number; ventes: number; error: string | null }> {
  const tz = await fuseauOrg(supabase, orgId);
  const { data, error } = await supabase.from('fs_commission_entries')
    .select('base_amount, invoice_id')
    .eq('org_id', orgId).eq('user_id', userId)
    .is('deleted_at', null).not('invoice_id', 'is', null).neq('status', 'reversed')
    .gte('triggered_at', debutDuMoisLocal(avant, tz)).lt('triggered_at', avant);
  if (error) return { revenueCents: 0, ventes: 0, error: error.message };
  const lignes = data ?? [];
  return {
    revenueCents: lignes.reduce((s: number, e: any) => s + enCents(e.base_amount), 0),
    ventes: new Set(lignes.map((e: any) => e.invoice_id)).size,
    error: null,
  };
}

/**
 * Un membre est payé à commission OU à l'heure (fiche Équipe,
 * team_members.compensation_mode). Un membre « à l'heure » ne touche jamais
 * de commission, même si l'org a un plan par défaut — sinon un admin payé
 * 50 $/h qui crée un job empoche 10 % en plus, en silence. Sans fiche (cas
 * limite : compte sans team_members), on laisse passer comme avant.
 */
export async function membrePayeACommission(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('team_members')
    .select('compensation_mode')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .neq('status', 'inactive')
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(`[commissions] lecture du mode de paie impossible (org ${orgId}, membre ${userId}):`, error.message);
    return true;
  }
  if (!data) return true;
  return data.compensation_mode === 'commission' || data.compensation_mode === 'both';
}


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
  // Règles créées avant les colonnes du moteur (base_*) : leur taux vit encore
  // dans les colonnes historiques `type` / `percentage` / `flat_amount` ($).
  // Sans ce repli, un plan affiché « 10 % » payait 0 $ (constaté en prod le
  // 2026-09-30 sur « [DEMO] Commission 10% »). L'écran lisait déjà ces colonnes.
  const baseKind: 'percent' | 'flat' = rule.base_kind || (rule.type === 'flat' ? 'flat' : 'percent');
  const basePct = Number(rule.base_percent ?? rule.percentage ?? 0);
  const baseFlat = Number(rule.base_value_cents ?? (rule.flat_amount != null ? Math.round(Number(rule.flat_amount) * 100) : 0));

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
    .select('id, org_id, salesperson_id, created_by, subtotal_cents, tax_cents, total_cents, total, deleted_at')
    .eq('id', jobId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (jobErr || !job) return { created: 0, skipped: 'job_not_found' };
  if (job.deleted_at) return { created: 0, skipped: 'job_deleted' };

  // 2. Rep = job salesperson, else its creator
  const repUserId: string | null = job.salesperson_id || job.created_by || null;
  if (!repUserId) return { created: 0, skipped: 'no_rep' };
  if (!(await membrePayeACommission(supabase, orgId, repUserId))) return { created: 0, skipped: 'hourly_member' };

  // 3. Skip if any entry already exists for this job (avoid duplicates)
  const { data: dup, error: dupErr } = await supabase
    .from('fs_commission_entries')
    .select('id')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .is('deleted_at', null)
    .limit(1);
  // Lecture ratée = on ne sait pas s'il existe déjà une entrée : mieux vaut
  // s'abstenir que de projeter une commission en double.
  if (dupErr) {
    console.error(`[commissions] duplicate check failed (org ${orgId}, job ${jobId}):`, dupErr.message);
    return { created: 0, skipped: 'dup_check_failed' };
  }
  if (dup && dup.length > 0) return { created: 0, skipped: 'already_projected' };

  // 4. Resolve rule (same logic as the invoice flow)
  const { data: rules, error: rulesErr } = await supabase.from('fs_commission_rules')
    .select('*').eq('org_id', orgId).eq('is_active', true).is('deleted_at', null)
    .order('priority', { ascending: false });
  if (rulesErr) {
    console.error(`[commissions] rules load failed (org ${orgId}, job ${jobId}):`, rulesErr.message);
    return { created: 0, skipped: 'rules_load_failed' };
  }
  let rule = (rules ?? []).find((r: any) => Array.isArray(r.assigned_user_ids) && r.assigned_user_ids.includes(repUserId));
  if (!rule) {
    const { data: settings, error: setErr } = await supabase.from('commission_settings')
      .select('default_rule_id').eq('org_id', orgId).maybeSingle();
    if (setErr) console.error(`[commissions] settings load failed (org ${orgId}):`, setErr.message);
    if (settings?.default_rule_id) rule = (rules ?? []).find((r: any) => r.id === settings.default_rule_id);
  }
  if (!rule) {
    // Silence coûteux : sans plan configuré (ni règle assignée, ni règle par
    // défaut), le rep ne touche AUCUNE commission et personne n'était prévenu.
    // On le rend visible pour que l'admin configure le plan et régularise.
    console.warn(`[commissions] AUCUN PLAN — commission non générée (org ${orgId}, rep ${repUserId}). Configure une règle ou un plan par défaut dans Réglages › Commissions.`);
    return { created: 0, skipped: 'no_rule' };
  }

  // 5. Estimate base from the job — AVANT taxes, comme la commission réelle.
  const baseCents = job.subtotal_cents != null
    ? baseAvantTaxesCents({ subtotal_cents: job.subtotal_cents })
    : baseAvantTaxesCents({ total_cents: Number(job.total_cents || 0) || Math.round(Number(job.total || 0) * 100), tax_cents: job.tax_cents });
  if (baseCents <= 0) return { created: 0, skipped: 'no_amount' };

  // 6. Rep period stats (calendar month, company time zone) up to now
  const nowIso = new Date().toISOString();
  const cumul = await cumulDuMois(supabase, orgId, repUserId, nowIso);
  // Les paliers de performance se calculent sur ce cumul : une lecture ratée
  // sous-évaluerait la commission sans rien signaler.
  if (cumul.error) {
    console.error(`[commissions] period stats load failed (org ${orgId}, rep ${repUserId}, job ${jobId}):`, cumul.error);
    return { created: 0, skipped: 'period_stats_failed' };
  }
  const repPeriodRevenueCents = cumul.revenueCents;
  const repPeriodSaleCount = cumul.ventes;

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
  if (error) {
    console.error(`[commissions] projected entry insert failed (org ${orgId}, rep ${repUserId}, job ${jobId}):`, error.message);
    return { created: 0, skipped: 'insert_failed' };
  }
  return { created: 1, skipped: null };
}

// ---------------------------------------------------------------------------
// Trigger: job deleted/cancelled → void its UNCONFIRMED projected commission.
// Only removes pending estimates (invoice_id IS NULL). Confirmed commissions
// (invoice already paid → status approved/paid) are left untouched.
// ---------------------------------------------------------------------------
export async function voidProjectedCommissionForJob(
  supabase: SupabaseClient,
  orgId: string,
  jobId: string
): Promise<{ voided: number }> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('fs_commission_entries')
    .update({ status: 'reversed', deleted_at: nowIso })
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .eq('status', 'pending')
    .is('invoice_id', null)
    .is('deleted_at', null)
    .select('id');
  if (error) {
    console.error(`[commissions] void projected entries failed (org ${orgId}, job ${jobId}):`, error.message);
    // Renvoyer `{ voided: 0 }` faisait passer l'échec pour « rien à annuler » :
    // le job disparaissait, la commission restait, et on la payait. On lève.
    throw new Error(`void projected entries failed: ${error.message}`);
  }
  return { voided: (data ?? []).length };
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
  const { data: existing, error: existingErr } = await supabase
    .from('fs_commission_entries')
    .select('id')
    .eq('org_id', orgId)
    .eq('invoice_id', invoiceId)
    .is('deleted_at', null)
    .limit(1);
  // Lecture ratée = on ne sait pas si les commissions existent déjà : on
  // s'abstient plutôt que de les générer une seconde fois.
  if (existingErr) {
    console.error(`[commissions] duplicate check failed (org ${orgId}, invoice ${invoiceId}):`, existingErr.message);
    return { created: 0, skipped: 'dup_check_failed' };
  }
  if (existing && existing.length > 0) return { created: 0, skipped: 'already_generated' };

  // 2. Load invoice
  //    `invoices` n'a ni colonne `line_items` ni `quote_id` : les lignes vivent
  //    dans la table `invoice_items` et le lien vers le devis passe par `job_id`.
  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .select('id, org_id, subtotal_cents, discount_cents, tax_cents, total_cents, paid_at, status, client_id, job_id')
    .eq('id', invoiceId)
    .eq('org_id', orgId)
    .single();
  if (invErr || !invoice) return { created: 0, skipped: 'invoice_not_found' };
  if (invoice.status !== 'paid' || !invoice.paid_at) return { created: 0, skipped: 'not_paid' };

  // 3. Identify rep: from the quote attached to the same job → lead → job
  let repUserId: string | null = null;
  if (invoice.job_id) {
    const { data: q, error: qErr } = await supabase.from('quotes')
      .select('id, salesperson_id, lead_id, client_id')
      .eq('job_id', invoice.job_id).eq('org_id', orgId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1).maybeSingle();
    if (qErr) console.error(`[commissions] quote load failed (org ${orgId}, job ${invoice.job_id}):`, qErr.message);
    repUserId = q?.salesperson_id || null;
    if (!repUserId && q?.lead_id) {
      const { data: l, error: lErr } = await supabase.from('clients')
        .select('assigned_to').eq('id', q.lead_id).eq('org_id', orgId).maybeSingle();
      if (lErr) console.error(`[commissions] lead load failed (org ${orgId}, lead ${q.lead_id}):`, lErr.message);
      repUserId = l?.assigned_to || null;
    }
  }
  // Fallback: attribute to the job's salesperson (or its creator) when no
  // quote/lead rep was found.
  if (!repUserId && invoice.job_id) {
    const { data: j, error: jErr } = await supabase.from('jobs')
      .select('salesperson_id, created_by')
      .eq('id', invoice.job_id).eq('org_id', orgId).maybeSingle();
    if (jErr) console.error(`[commissions] job load failed (org ${orgId}, job ${invoice.job_id}):`, jErr.message);
    repUserId = j?.salesperson_id || j?.created_by || null;
  }
  if (!repUserId) return { created: 0, skipped: 'no_rep' };
  if (!(await membrePayeACommission(supabase, orgId, repUserId))) return { created: 0, skipped: 'hourly_member' };

  // 4. Find rule: assigned_user_ids contains rep → else default rule from settings
  const { data: rules, error: rulesErr } = await supabase.from('fs_commission_rules')
    .select('*').eq('org_id', orgId).eq('is_active', true).is('deleted_at', null)
    .order('priority', { ascending: false });
  if (rulesErr) {
    console.error(`[commissions] rules load failed (org ${orgId}, invoice ${invoiceId}):`, rulesErr.message);
    return { created: 0, skipped: 'rules_load_failed' };
  }
  let rule = (rules ?? []).find((r: any) => Array.isArray(r.assigned_user_ids) && r.assigned_user_ids.includes(repUserId));
  if (!rule) {
    const { data: settings, error: setErr } = await supabase.from('commission_settings')
      .select('default_rule_id').eq('org_id', orgId).maybeSingle();
    if (setErr) console.error(`[commissions] settings load failed (org ${orgId}):`, setErr.message);
    if (settings?.default_rule_id) rule = (rules ?? []).find((r: any) => r.id === settings.default_rule_id);
  }
  if (!rule) {
    // Silence coûteux : sans plan configuré (ni règle assignée, ni règle par
    // défaut), le rep ne touche AUCUNE commission et personne n'était prévenu.
    // On le rend visible pour que l'admin configure le plan et régularise.
    console.warn(`[commissions] AUCUN PLAN — commission non générée (org ${orgId}, rep ${repUserId}). Configure une règle ou un plan par défaut dans Réglages › Commissions.`);
    return { created: 0, skipped: 'no_rule' };
  }

  // 5. Compute rep's period stats (calendar month, company time zone) BEFORE this invoice
  const cumul = await cumulDuMois(supabase, orgId, repUserId, invoice.paid_at);
  // Les paliers de performance dépendent de ce cumul : une lecture ratée
  // fausserait silencieusement le montant versé au rep.
  if (cumul.error) {
    console.error(`[commissions] period stats load failed (org ${orgId}, rep ${repUserId}, invoice ${invoiceId}):`, cumul.error);
    return { created: 0, skipped: 'period_stats_failed' };
  }
  const repPeriodRevenueCents = cumul.revenueCents;
  const repPeriodSaleCount = cumul.ventes;

  // Base de la commission : sous-total − rabais, AVANT taxes. `total_cents`
  // inclut TPS/TVQ : la commission était gonflée de 14,975 % au Québec.
  const baseCents = baseAvantTaxesCents(invoice);

  // 6. Surcharges par produit (rule.product_overrides). La catégorie d'une
  //    ligne vit sur le service prédéfini qu'elle référence
  //    (invoice_items.source_id → predefined_services.category).
  //
  //    PRUDENCE : le calcul « ligne par ligne » remplace le total de la facture
  //    par la SOMME des lignes. Or Σ(line_total_cents) ≠ total_cents (taxes,
  //    remises) — l'appliquer sans raison changerait le montant des commissions
  //    même SANS override. On ne bascule donc en mode ligne-par-ligne QUE si la
  //    règle a des overrides ET qu'au moins une ligne tombe dans une catégorie
  //    couverte. Sinon, liste vide = taux de base sur le total (inchangé).
  const overridesRegle: Array<{ category: string }> = Array.isArray(rule.product_overrides) ? rule.product_overrides : [];
  let lineItems: Array<{ category: string | null; total_cents: number }> = [];
  if (overridesRegle.length) {
    const { data: items } = await supabase
      .from('invoice_items')
      .select('line_total_cents, source_id')
      .eq('invoice_id', invoiceId).eq('org_id', orgId).is('deleted_at', null);
    const serviceIds = [...new Set((items ?? []).map((i: any) => i.source_id).filter(Boolean))];
    const catParService = new Map<string, string | null>();
    if (serviceIds.length) {
      // Catalogue partagé : un service peut appartenir à un bureau frère.
      const { data: services } = await supabase
        .from('predefined_services')
        .select('id, category').in('org_id', await companyOrgIds(supabase, orgId)).in('id', serviceIds);
      for (const s of services ?? []) catParService.set(s.id, s.category ?? null);
    }
    const catsCouvertes = new Set(overridesRegle.map((o) => o.category));
    const construites = (items ?? []).map((i: any) => ({
      category: i.source_id ? (catParService.get(i.source_id) ?? null) : null,
      total_cents: Number(i.line_total_cents || 0),
    }));
    // Uniquement si un override s'applique réellement à une ligne. Sinon on
    // laisse la liste vide pour NE PAS changer le montant de base.
    if (construites.some((l) => l.category && catsCouvertes.has(l.category))) {
      lineItems = construites;
    }
  }

  // 7. Calculate — surcharges par catégorie appliquées le cas échéant ; sinon
  //    taux de base sur le total de la facture, exactement comme avant.
  const calc = calculateCommissionAmount(rule, {
    invoiceTotalCents: baseCents,
    invoicePaidAt: invoice.paid_at,
    lineItems,
    repPeriodRevenueCents,
    repPeriodSaleCount,
  });

  // 7. Attribution: solo vs split
  const attribution = rule.attribution || { mode: 'solo' };
  const recipients: Array<{ user_id: string; pct: number }> = attribution.mode === 'split' && Array.isArray(attribution.splits)
    ? attribution.splits.filter((s: any) => s.user_id).map((s: any) => ({ user_id: s.user_id, pct: Number(s.pct || 0) }))
    : [{ user_id: repUserId, pct: 100 }];
  // Parts exactes (plus grand reste) : Σ parts = commission, jamais 1 ¢ de plus.
  const parts = repartirParts(calc.amountCents, recipients);

  // 8. Insert/confirm one entry per recipient.
  //    When the invoice is tied to a job, confirm the rep's pre-projected
  //    pending entry (created at job creation) instead of inserting a duplicate,
  //    and mark it approved (= earned) since the invoice is now paid.
  const confirmStatus = invoice.job_id ? 'approved' : 'pending';
  let created = 0;
  let echecs = 0;
  for (const r of parts) {
    const share = r.part_cents;
    if (share <= 0) continue;

    // Période de paie déjà versée pour ce membre → rattachée à la période en
    // cours (une paie versée ne change plus), vraie date gardée.
    const rattachement = await dateDeRattachement(supabase, orgId, r.user_id, invoice.paid_at);
    const entryFields = {
      rule_id: rule.id,
      invoice_id: invoiceId,
      job_id: invoice.job_id || null,
      status: confirmStatus,
      amount: share / 100,
      base_amount: baseCents / 100,
      description: 'Commission on invoice payment',
      triggered_at: rattachement.triggered_at,
      calc_breakdown: {
        ...calc.breakdown, split_pct: r.pct, total_calculated_cents: calc.amountCents,
        ...(rattachement.decalee ? { gagnee_le: invoice.paid_at, rattachee_periode_suivante: true } : {}),
      },
    };

    // Confirm an existing projected (pending, no invoice) entry for this rep+job.
    let confirmed = false;
    if (invoice.job_id) {
      const { data: projected, error: projErr } = await supabase.from('fs_commission_entries')
        .select('id')
        .eq('org_id', orgId).eq('job_id', invoice.job_id).eq('user_id', r.user_id)
        .is('invoice_id', null).is('deleted_at', null).limit(1);
      if (projErr) {
        console.error(`[commissions] projected entry lookup failed (org ${orgId}, rep ${r.user_id}, job ${invoice.job_id}):`, projErr.message);
      }
      if (projected && projected.length > 0) {
        const { error } = await supabase.from('fs_commission_entries')
          .update(entryFields).eq('id', projected[0].id);
        if (error) {
          echecs++;
          console.error(`[commissions] entry confirm failed (org ${orgId}, rep ${r.user_id}, invoice ${invoiceId}, entry ${projected[0].id}):`, error.message);
        } else { created++; confirmed = true; }
      }
    }

    if (!confirmed) {
      let { error } = await supabase.from('fs_commission_entries')
        .insert({ org_id: orgId, user_id: r.user_id, lead_id: null, ...entryFields });
      // Facture REFAITE sur un job (payée → remboursée → annulée → supprimée →
      // nouvelle facture) : l'ancienne commission, reprise, occupe encore la
      // place (job, rep) de l'index uniq_job_rep et bloquait la nouvelle — le
      // rep n'était jamais payé. Sans toucher la base : la nouvelle commission
      // est enregistrée sans lien direct au job (la facture reste liée, unique
      // par uniq_invoice_rep) ; le job est gardé dans calc_breakdown.
      if (error && error.code === '23505' && /uniq_job_rep/.test(error.message) && entryFields.job_id) {
        ({ error } = await supabase.from('fs_commission_entries').insert({
          org_id: orgId, user_id: r.user_id, lead_id: null, ...entryFields,
          job_id: null, calc_breakdown: { ...entryFields.calc_breakdown, job_id: entryFields.job_id, facture_refaite: true },
        }));
      }
      if (error) {
        // Doublon concurrent (même facture, même rep) = déjà écrit par un
        // appel parallèle : pas un échec. Tout autre refus en est un — dont
        // l'index uniq_job_rep qui bloque une facture refaite sur le même job.
        const doublonFacture = error.code === '23505' && /uniq_invoice_rep/.test(error.message);
        if (!doublonFacture) echecs++;
        console.error(`[commissions] entry insert failed (org ${orgId}, rep ${r.user_id}, invoice ${invoiceId}):`, error.message);
      } else created++;
    }
  }
  // Avant : { created: 0, skipped: null } même quand l'écriture échouait —
  // un « succès » muet, aucune lettre morte, un rep jamais payé.
  return { created, skipped: echecs > 0 ? 'insert_failed' : null };
}

// ---------------------------------------------------------------------------
// Reversal handler: invoice un-paid (refund/cancel) → apply policy
// ---------------------------------------------------------------------------

export async function handleInvoiceReversal(
  supabase: SupabaseClient,
  orgId: string,
  invoiceId: string,
  reason: string
): Promise<{ action: 'auto_reversed' | 'kept' | 'alert' | 'clawback'; affected: number }> {
  // Politique effective, « Reprendre » compris (drapeau hors migration).
  const policy = await politiqueRemboursement(supabase, orgId);

  const { data: entries, error: entriesErr } = await supabase.from('fs_commission_entries')
    .select('id, status, user_id, rule_id, amount, base_amount').eq('org_id', orgId).eq('invoice_id', invoiceId)
    .is('deleted_at', null);
  if (entriesErr) {
    console.error(`[commissions] reversal entries load failed (org ${orgId}, invoice ${invoiceId}):`, entriesErr.message);
    // Sans lecture, « 0 commission touchée » serait un mensonge : on lève pour
    // que l'appelant consigne l'échec (lettre morte) et qu'on le rejoue.
    throw new Error(`Commission reversal failed for invoice ${invoiceId}: ${entriesErr.message}`);
  }

  const affected = (entries ?? []).length;
  if (affected === 0) return { action: policy as any, affected: 0 };

  if (policy === 'keep') return { action: 'kept', affected };

  if (policy === 'auto' || policy === 'clawback') {
    const ids = (entries ?? []).filter((e: any) => e.status !== 'paid' && e.status !== 'reversed').map((e: any) => e.id);
    if (ids.length > 0) {
      const { error: revErr } = await supabase.from('fs_commission_entries')
        .update({ status: 'reversed', auto_reversed: true, reverse_reason: reason, updated_at: new Date().toISOString() })
        .in('id', ids);
      // Sans ça, une commission déjà annulée côté facture resterait due au rep.
      if (revErr) {
        console.error(`[commissions] auto-reversal failed (org ${orgId}, invoice ${invoiceId}, entries ${ids.join(',')}):`, revErr.message);
        throw new Error(`Commission auto-reversal failed for invoice ${invoiceId}: ${revErr.message}`);
      }
    }
    // Une commission DÉJÀ VERSÉE n'est jamais modifiée (la période payée ne
    // bouge pas) — mais elle ne doit plus passer inaperçue : on la marque
    // « remboursée après versement », affiché sur la page. La reprise
    // éventuelle (ajustement négatif) est une décision en attente (D4).
    const versees = (entries ?? []).filter((e: any) => e.status === 'paid');
    if (versees.length > 0) {
      const { error: flagErr } = await supabase.from('fs_commission_entries')
        .update({ reverse_reason: `${reason} (après versement)`, updated_at: new Date().toISOString() })
        .in('id', versees.map((e: any) => e.id));
      if (flagErr) throw new Error(`Commission refund flag failed for invoice ${invoiceId}: ${flagErr.message}`);
    }
    if (policy === 'clawback') {
      // Politique « Reprendre » (choisie par l'entreprise dans Réglages) : la
      // commission déjà versée reste versée dans SA période (verrouillée) ; une
      // ligne NÉGATIVE visible, du même montant, est ajoutée à la période en
      // cours et sera déduite de la prochaine paie. Idempotent.
      const { data: facture } = await supabase.from('invoices').select('invoice_number').eq('id', invoiceId).maybeSingle();
      let reprises = 0;
      for (const e of versees as any[]) {
        const { data: deja, error: dejaErr } = await supabase.from('fs_commission_entries')
          .select('id').eq('org_id', orgId).eq('calc_breakdown->>reprise_de', e.id).is('deleted_at', null).limit(1);
        if (dejaErr) throw new Error(`Commission clawback check failed: ${dejaErr.message}`);
        if (deja && deja.length) continue;
        const { error: insErr } = await supabase.from('fs_commission_entries').insert({
          org_id: orgId, user_id: e.user_id, rule_id: e.rule_id,
          invoice_id: null, job_id: null, lead_id: null,
          status: 'approved', amount: -Math.abs(Number(e.amount)), base_amount: -Math.abs(Number(e.base_amount || 0)),
          description: `Reprise — facture ${facture?.invoice_number ? `#${facture.invoice_number} ` : ''}remboursée après versement`,
          triggered_at: new Date().toISOString(),
          calc_breakdown: { reprise_de: e.id, invoice_id: invoiceId, reason },
        });
        if (insErr) throw new Error(`Commission clawback insert failed for entry ${e.id}: ${insErr.message}`);
        reprises++;
      }
      return { action: 'clawback', affected: ids.length + reprises };
    }
    return { action: 'auto_reversed', affected: ids.length };
  }

  // alert: mark reverse_reason but keep status; UI will surface
  const { error: alertErr } = await supabase.from('fs_commission_entries')
    .update({ reverse_reason: reason, updated_at: new Date().toISOString() })
    .eq('org_id', orgId).eq('invoice_id', invoiceId).is('deleted_at', null);
  if (alertErr) {
    console.error(`[commissions] reversal alert flag failed (org ${orgId}, invoice ${invoiceId}):`, alertErr.message);
    // Le drapeau EST la politique « alert » : s'il n'est pas posé, personne ne
    // saura qu'une commission porte sur une facture remboursée.
    throw new Error(`Commission reversal flag failed for invoice ${invoiceId}: ${alertErr.message}`);
  }
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

/** « Annuler le versement » d'une commission versée par erreur : versée → approuvée. */
export async function unmarkCommissionPaid(
  supabase: SupabaseClient,
  orgId: string,
  entryId: string
) {
  const { data, error } = await supabase.from('fs_commission_entries')
    .update({ status: 'approved', paid_at: null, updated_at: new Date().toISOString() })
    .eq('id', entryId).eq('org_id', orgId).eq('status', 'paid')
    .select().single();
  if (error || !data) throw new Error('Commission not found or not paid.');
  return data;
}

// ---------------------------------------------------------------------------
// Query — période = date où la commission est GAGNÉE (triggered_at), dans le
// fuseau de l'entreprise. Voir commission-periode.ts.
// ---------------------------------------------------------------------------

const TAILLE_PAGE = 1000; // = max_rows de PostgREST : au-delà, la réponse est tronquée EN SILENCE
// Liste affichée : les 1 000 plus récentes (plafond PostgREST). Les TOTAUX,
// eux, portent toujours sur toute la période (toutesLesEntrees).
const LIMITE_LISTE = 1000;

export interface FiltreEntrees {
  userId?: string | null;
  status?: string;
  dateRange?: { from: string; to: string };
}

/** Bornes UTC de la période, dans le fuseau de l'entreprise (null = pas de filtre de date). */
async function bornesDuFiltre(supabase: SupabaseClient, orgId: string, o: FiltreEntrees) {
  if (!o.dateRange) return null;
  return bornesPeriode(o.dateRange.from, o.dateRange.to, await fuseauOrg(supabase, orgId));
}

// Synchrone exprès : attendre un builder PostgREST l'EXÉCUTE (avant le .range()).
function requeteEntrees(supabase: SupabaseClient, orgId: string, colonnes: string, o: FiltreEntrees, bornes: { debut: string; finExclusive: string } | null) {
  let q = supabase.from('fs_commission_entries').select(colonnes).eq('org_id', orgId).is('deleted_at', null);
  if (o.userId) q = q.eq('user_id', o.userId);
  if (o.status) q = q.eq('status', o.status);
  if (bornes) q = q.gte('triggered_at', bornes.debut).lt('triggered_at', bornes.finExclusive);
  return q;
}

/**
 * Toutes les entrées du filtre, sans jamais être tronqué à max_rows.
 * Pagination par clé (triggered_at, id) plutôt que par décalage (un OFFSET
 * re-triait toute la période à chaque page : 42 s mesurés sur une année de
 * 100 000 commissions). Lire la période en tranches parallèles a été essayé
 * et mesuré SANS gain (15 s contre 14-18 s) : sans index de période, chaque
 * page parcourt toute la table de l'org et les tranches se disputent le même
 * processeur. Le vrai levier est l'index (migration proposée M3).
 */
export async function toutesLesEntrees(supabase: SupabaseClient, orgId: string, colonnes: string, o: FiltreEntrees): Promise<any[]> {
  const out: any[] = [];
  const bornes = await bornesDuFiltre(supabase, orgId, o);
  const cols = colonnes.trim() === '*' ? colonnes : `id, triggered_at, ${colonnes}`;
  // Clé (triggered_at, id) par PLAGE (`triggered_at >= dernier`) : suit
  // l'index de période proposé (M3). Un OR « (t > x) ou (t = x et id > y) »
  // faisait relire la plage depuis le début à chaque page (36 ms/page contre
  // 0,9 ms mesurés). Les lignes déjà vues à l'instant-frontière sont écartées.
  const lire = async (filtre: (q: any) => any) => {
    const { data, error } = await filtre(requeteEntrees(supabase, orgId, cols, o, bornes))
      .order('triggered_at', { ascending: true }).order('id', { ascending: true }).limit(TAILLE_PAGE);
    if (error) throw new Error(error.message);
    return (data ?? []) as any[];
  };
  let depuis: string | null = null;
  let strict = false; // vrai : reprendre STRICTEMENT après `depuis`
  let vusALaFrontiere = new Set<string>();
  for (;;) {
    const page = await lire((q) => (depuis ? (strict ? q.gt('triggered_at', depuis) : q.gte('triggered_at', depuis)) : q));
    out.push(...page.filter((r) => !(r.triggered_at === depuis && vusALaFrontiere.has(r.id))));
    if (page.length < TAILLE_PAGE) return out;
    const fin: string = page[page.length - 1].triggered_at;
    if (fin === depuis && !strict) {
      // Une page entière au même instant (import en masse) : on vide cet
      // instant par id, puis on reprend strictement après lui.
      let apresId = page[page.length - 1].id as string;
      for (;;) {
        const suite = await lire((q) => q.eq('triggered_at', fin).gt('id', apresId));
        out.push(...suite.filter((r) => !vusALaFrontiere.has(r.id)));
        if (suite.length < TAILLE_PAGE) break;
        apresId = suite[suite.length - 1].id;
      }
      strict = true;
      vusALaFrontiere = new Set();
      continue;
    }
    strict = false;
    vusALaFrontiere = new Set(page.filter((r) => r.triggered_at === fin).map((r) => r.id));
    depuis = fin;
  }
}

export async function getCommissionEntries(
  supabase: SupabaseClient,
  orgId: string,
  options: FiltreEntrees = {}
) {
  const bornes = await bornesDuFiltre(supabase, orgId, options);
  const { data, error } = await requeteEntrees(supabase, orgId, '*', options, bornes)
    .order('triggered_at', { ascending: false }).order('id', { ascending: true })
    .range(0, LIMITE_LISTE - 1);
  if (error) throw new Error(error.message);
  return enrichirEntrees(supabase, orgId, data ?? []);
}

/**
 * Ajoute aux entrées le nom du rep, de la règle, le n° de facture / job et le
 * client. Lectures en parallèle, bornées à l'org, par lots de 200 ids (un
 * export peut en contenir des milliers : une URL trop longue échoue).
 */
export async function enrichirEntrees(supabase: SupabaseClient, orgId: string, rows: any[]) {
  const uniques = (k: string) => [...new Set(rows.map((e) => e[k]).filter(Boolean))] as string[];
  // Job d'une facture refaite : gardé dans calc_breakdown (voir generateCommissionsForInvoice).
  const jobDe = (e: any): string | null => e.job_id || e.calc_breakdown?.job_id || null;
  const [userIds, ruleIds, invoiceIds] = [uniques('user_id'), uniques('rule_id'), uniques('invoice_id')];
  const jobIds = [...new Set(rows.map(jobDe).filter(Boolean))] as string[];
  const parLots = async (table: string, colonnes: string, cle: string, ids: string[]) => {
    const out: any[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await supabase.from(table).select(colonnes).eq('org_id', orgId).in(cle, ids.slice(i, i + 200));
      if (error) throw new Error(`${table} lookup failed: ${error.message}`);
      out.push(...(data ?? []));
    }
    return out;
  };
  const [members, rules, invoices, jobs] = await Promise.all([
    parLots('memberships', 'user_id, full_name, avatar_url', 'user_id', userIds),
    parLots('fs_commission_rules', 'id, name', 'id', ruleIds),
    parLots('invoices', 'id, invoice_number, client_name_snapshot', 'id', invoiceIds),
    parLots('jobs', 'id, job_number, title, client_name', 'id', jobIds),
  ]);
  const index = (l: any[], k: string) => new Map<string, any>(l.map((x: any) => [x[k], x]));
  const memberMap = index(members, 'user_id');
  const ruleMap = index(rules, 'id');
  const invoiceMap = index(invoices, 'id');
  const jobMap = index(jobs, 'id');

  return rows.map((entry) => {
    const member = memberMap.get(entry.user_id);
    const inv = entry.invoice_id ? invoiceMap.get(entry.invoice_id) : null;
    const job = jobDe(entry) ? jobMap.get(jobDe(entry) as string) : null;
    return {
      ...entry,
      rep_name: member?.full_name || 'Unknown',
      rep_avatar: member?.avatar_url || null,
      rule_name: ruleMap.get(entry.rule_id)?.name || 'Unknown',
      invoice_number: inv?.invoice_number ?? null,
      job_number: job?.job_number ?? null,
      job_title: job?.title ?? null,
      client_name: inv?.client_name_snapshot || job?.client_name || null,
      is_estimate: !entry.invoice_id && entry.status === 'pending',
    };
  });
}

// ---------------------------------------------------------------------------
// Payroll Preview — totaux de la période, en cents entiers, sur TOUTES les
// entrées (paginé), + ventilation par rep et par jour pour les graphiques.
// ---------------------------------------------------------------------------

export async function getPayrollPreview(
  supabase: SupabaseClient,
  orgId: string,
  userId: string | null,
  periodStart: string,
  periodEnd: string
) {
  const tz = await fuseauOrg(supabase, orgId);
  const entries = await toutesLesEntrees(supabase, orgId,
    'id, user_id, invoice_id, job_id, status, amount, base_amount, triggered_at, reverse_reason',
    { userId, dateRange: { from: periodStart, to: periodEnd } });
  const t = totauxCommissions(entries);

  const parRep = new Map<string, any[]>();
  for (const e of entries) {
    const liste = parRep.get(e.user_id);
    if (liste) liste.push(e); else parRep.set(e.user_id, [e]);
  }
  const ids = [...parRep.keys()];
  const { data: noms } = ids.length
    ? await supabase.from('memberships').select('user_id, full_name').eq('org_id', orgId).in('user_id', ids)
    : { data: [] as any[] };
  const nomDe = new Map((noms ?? []).map((m: any) => [m.user_id, m.full_name]));
  const par_rep = ids.map((uid) => {
    const lignes = parRep.get(uid)!;
    const base_cents = lignes.filter((e) => e.invoice_id && e.status !== 'reversed').reduce((s, e) => s + enCents(e.base_amount), 0);
    return { user_id: uid, rep_name: nomDe.get(uid) || null, base_cents, ...totauxCommissions(lignes) };
  }).sort((a, b) => b.du_cents - a.du_cents);

  const jours = new Map<string, number>();
  for (const e of entries) {
    if (!e.invoice_id || e.status === 'reversed') continue;
    const j = toLocalDate(e.triggered_at, tz);
    jours.set(j, (jours.get(j) ?? 0) + enCents(e.amount));
  }
  const par_jour = [...jours.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, du_cents]) => ({ date, du_cents }));

  return {
    // Dollars (contrat historique de l'API) — dérivés des cents exacts.
    // `total` = gagné et dû (en attente + approuvé + versé) : ni les
    // estimations (jobs non payés), ni les reprises.
    total: t.du_cents / 100,
    pending: t.en_attente_cents / 100,
    approved: t.approuve_cents / 100,
    paid: t.verse_cents / 100,
    reversed: t.repris_cents / 100,
    estimated: t.estime_cents / 100,
    count: entries.length,
    sales: t.ventes,
    timezone: tz,
    totals_cents: t,
    par_rep,
    par_jour,
    /** Commissions versées dont la facture a été remboursée depuis. */
    flagged_ids: entries.filter((e) => e.reverse_reason && e.status !== 'reversed').map((e) => e.id as string),
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
    // Jamais une ESTIMATION (job pas encore payé, sans facture) : l'approuver
    // puis la « Verser » payait un rep pour une vente non encaissée.
    .not('invoice_id', 'is', null)
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
  // Garde ATOMIQUE, comme approve/markPaid : on ne reverse QUE depuis pending
  // ou approved, dans l'UPDATE lui-même. L'ancienne version lisait le statut
  // puis updatait sans filtre — une course avec un markPaid concurrent pouvait
  // reverser une commission qui venait de passer « versée » (argent déjà
  // parti), et reverser deux fois écrasait la raison d'origine.
  const { data, error } = await supabase
    .from('fs_commission_entries')
    .update({
      status: 'reversed',
      // La raison va dans reverse_reason : écraser `description` effaçait ce
      // que la ligne représentait.
      reverse_reason: reason || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', entryId)
    .eq('org_id', orgId)
    .in('status', ['pending', 'approved'])
    .select()
    .single();

  if (error || !data) {
    // Aucune ligne éligible : soit déjà versée/reversée, soit introuvable.
    const { data: actuelle } = await supabase
      .from('fs_commission_entries')
      .select('status')
      .eq('id', entryId).eq('org_id', orgId)
      .maybeSingle();
    if (actuelle?.status === 'paid') throw new Error('Cannot reverse a commission that has already been paid.');
    if (actuelle?.status === 'reversed') throw new Error('This commission is already reversed.');
    throw new Error('Commission not found or not reversible.');
  }
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
