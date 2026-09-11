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
  /**
   * Palier de consommation du mois, invisible pour le client :
   * - normal   : sous 60 % du plafond ;
   * - econome  : 60 % et plus → modèle moins cher, réflexion réduite (coût par tour divisé par ~2) ;
   * - ralenti  : plafond atteint → Lumi répond encore, mais une fois par minute, jusqu'au 1er.
   * Le client n'est jamais « à sec » ; le plafond en dollars reste un garde-fou interne.
   */
  palier: 'normal' | 'econome' | 'ralenti';
}

/** Part du plafond à partir de laquelle on passe en mode économe. */
export const SEUIL_ECONOME = 0.6;
/** En mode ralenti : un tour par org toutes les N secondes. */
export const INTERVALLE_RALENTI_S = 60;

export function palierBudget(budget_cents: number, depense_cents: number): EtatBudget['palier'] {
  if (budget_cents <= 0) return 'normal';
  if (depense_cents >= budget_cents) return 'ralenti';
  if (depense_cents >= budget_cents * SEUIL_ECONOME) return 'econome';
  return 'normal';
}

/** Modèle et effort de réflexion selon le palier : la pente économe joue avant tout refus. */
export function reglagesPourPalier(palier: EtatBudget['palier'], modeleNormal: string): { model: string; effort: 'low' | 'medium' } {
  return palier === 'normal' ? { model: modeleNormal, effort: 'medium' } : { model: 'claude-haiku-4-5', effort: 'low' };
}

/**
 * En mode ralenti : secondes à attendre avant le prochain tour (0 = on peut
 * répondre). Lu sur le dernier appel journalisé de l'org.
 */
export async function attenteRalenti(admin: SupabaseClient, orgId: string): Promise<number> {
  const orgIds = await companyOrgIds(admin, orgId);
  const { data } = await admin.from('ai_usage').select('created_at').in('org_id', orgIds).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!data?.created_at) return 0;
  const ecoule = (Date.now() - new Date(data.created_at).getTime()) / 1000;
  return Math.max(0, Math.ceil(INTERVALLE_RALENTI_S - ecoule));
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
    palier: includes ? palierBudget(budget, depense) : 'normal',
  };
}

/**
 * Alerte à l'exploitant quand une org passe en mode économe (60 % du plafond) :
 * c'est là qu'on regarde s'il s'agit d'un usage réel ou d'un abus. Une seule
 * fois par org et par mois, tracée dans security_events (event_type
 * lumi_budget_econome) ; courriel à LUMI_ALERT_EMAIL, sinon SECURITY_ALERT_EMAIL.
 */
export async function alerterSiSeuilFranchi(admin: SupabaseClient, orgId: string, budget: EtatBudget, envoyer: (sujet: string, texte: string) => Promise<void>): Promise<void> {
  if (budget.palier === 'normal') return;
  const mois = new Date().toISOString().slice(0, 7);
  const { data: deja } = await admin.from('security_events')
    .select('id').eq('org_id', orgId).eq('event_type', 'lumi_budget_econome')
    .contains('details', { mois }).limit(1).maybeSingle();
  if (deja) return;
  const { error } = await admin.from('security_events').insert({
    org_id: orgId, event_type: 'lumi_budget_econome', severity: 'info', source: 'system',
    details: { mois, depense_cents: budget.depense_cents, budget_cents: budget.budget_cents, plan: budget.plan_slug, palier: budget.palier },
  });
  if (error) { console.error('[lumi] alerte budget non tracée :', error.message); return; }
  const { data: org } = await admin.from('orgs').select('name').eq('id', orgId).maybeSingle();
  const dollars = (c: number) => `${(c / 100).toFixed(2)} $`;
  await envoyer(
    `Lumi · ${org?.name ?? orgId} a dépensé ${dollars(budget.depense_cents)} ce mois-ci (${budget.plan_slug ?? 'plan ?'})`,
    `L'entreprise ${org?.name ?? orgId} a atteint ${dollars(budget.depense_cents)} d'inférence Lumi sur un plafond de ${dollars(budget.budget_cents)} (${budget.plan_slug ?? '?'}).\n`
    + `Elle passe en mode économe (modèle moins cher). À ${dollars(budget.budget_cents)}, Lumi répondra une fois par minute jusqu'au 1er.\n`
    + `Regarde si c'est un usage réel (proposer Autopilot / un supplément) ou un abus (script, boucle).`,
  ).catch((e: any) => console.error('[lumi] alerte budget non envoyée :', e?.message || e));
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
