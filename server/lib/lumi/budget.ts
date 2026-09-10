/**
 * Budget mensuel d'inférence par org (Lumi).
 *
 * L'abonnement vit sur UN bureau du company_group : on lit le plan comme
 * /billing/current, puis plans.ai_monthly_budget_cents. La dépense du mois
 * vient de ai_usage (fonction lumi_depense_du_mois, mois civil de Montréal).
 *
 * Refus AVANT l'appel au modèle si le budget est atteint : un tour refusé ne
 * coûte rien. Un tour qui fait dépasser d'un cent passe — c'est le suivant
 * qui est refusé, on ne coupe pas une réponse en cours.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { companyOrgIds } from '../supabase';

export interface EtatBudget {
  plan_slug: string | null;
  includes_ai: boolean;
  budget_cents: number;
  depense_cents: number;
  reste_cents: number;
  epuise: boolean;
}

export async function etatBudget(admin: SupabaseClient, orgId: string): Promise<EtatBudget> {
  const orgIds = await companyOrgIds(admin, orgId);
  const { data: sub } = await admin
    .from('subscriptions')
    .select('status, plans:plan_id (slug, includes_ai, ai_monthly_budget_cents)')
    .in('org_id', orgIds)
    .in('status', ['active', 'trialing', 'past_due'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const plan = (sub as any)?.plans as { slug?: string; includes_ai?: boolean; ai_monthly_budget_cents?: number } | null;
  const budget = Math.max(0, Number(plan?.ai_monthly_budget_cents ?? 0));
  const includes = !!plan?.includes_ai && budget > 0;

  let depense = 0;
  if (includes) {
    // La dépense se mesure sur tout le groupe : un bureau secondaire puise
    // dans le même budget que le bureau principal.
    for (const id of orgIds) {
      const { data, error } = await admin.rpc('lumi_depense_du_mois', { p_org: id });
      if (error) throw new Error(`lumi_depense_du_mois: ${error.message}`);
      depense += Number(data ?? 0);
    }
  }
  const reste = Math.max(0, budget - depense);
  return {
    plan_slug: plan?.slug ?? null,
    includes_ai: includes,
    budget_cents: budget,
    depense_cents: Math.round(depense * 100) / 100,
    reste_cents: Math.round(reste * 100) / 100,
    epuise: includes && depense >= budget,
  };
}

export async function journaliserUsage(admin: SupabaseClient, ligne: {
  orgId: string; userId: string; conversationId: string | null; model: string;
  input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number; cost_cents: number;
}): Promise<void> {
  const { error } = await admin.from('ai_usage').insert({
    org_id: ligne.orgId,
    user_id: ligne.userId,
    conversation_id: ligne.conversationId,
    model: ligne.model,
    input_tokens: ligne.input_tokens,
    output_tokens: ligne.output_tokens,
    cache_creation_input_tokens: ligne.cache_creation_input_tokens,
    cache_read_input_tokens: ligne.cache_read_input_tokens,
    cost_cents: ligne.cost_cents,
  });
  // Un journal qui saute = un budget qui ne compte plus : on le dit fort.
  if (error) console.error('[lumi] ai_usage non journalisé :', error.message);
}
