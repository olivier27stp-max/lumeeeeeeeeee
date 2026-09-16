/**
 * Budget mensuel d'inférence par org (Lumi).
 *
 * L'abonnement vit sur UN bureau du company_group : on lit le plan comme
 * /billing/current, puis plans.ai_monthly_budget_cents. La dépense du mois
 * vient de ai_usage (fonction lumi_depense_du_mois, mois civil de Montréal).
 *
 * Plafond DUR (audit Lumi B4, 2026-09-16) : avant chaque appel au modèle, le
 * coût maximal est RÉSERVÉ atomiquement (RPC reserve_ai_budget, verrou par
 * groupe d'entreprises), puis RÉGLÉ au coût réel (settle_ai_budget). Cinquante
 * tours lancés en même temps ne dépassent plus le plafond. Si les RPC manquent
 * (migration pas encore appliquée), on retombe sur l'ancien comportement
 * (vérification avant, journal après) avec un avertissement, une seule fois.
 *
 * Échelle de dégradation (jamais de blocage du CRM) :
 *  - < 70 %   normal    : modèle normal, effort medium ;
 *  - ≥ 70 %   econome   : Haiku, effort bas, historique réduit à 3 tours ;
 *  - ≥ 90 %   restreint : idem + au plus 2 étapes d'outils par tour ;
 *  - ≥ 100 %  epuise    : plus aucun appel au modèle ; les raccourcis (étages
 *               0-2) et les caches (3-4) répondent encore ; sinon message
 *               gabarit « en pause jusqu'au 1er ». Le propriétaire est alerté.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { companyOrgIds } from '../supabase';
import { coutEnCents } from './tarifs';

export type Palier = 'normal' | 'econome' | 'restreint' | 'epuise';

export interface EtatBudget {
  plan_slug: string | null;
  includes_ai: boolean;
  budget_cents: number;
  depense_cents: number;
  reste_cents: number;
  epuise: boolean;
  /** Réservations en cours (appels en vol) : comptées dans le palier, pas dans depense_cents. */
  reserve_cents: number;
  /** Palier de consommation du mois (voir l'en-tête). Le plafond en dollars est un garde-fou interne. */
  palier: Palier;
}

/** Parts du plafond où la pente change (mandat §5.5 : 70 / 90 / 100 %). */
export const SEUIL_ECONOME = 0.7;
export const SEUIL_RESTREINT = 0.9;

export function palierBudget(budget_cents: number, depense_cents: number): Palier {
  if (budget_cents <= 0) return 'normal';
  if (depense_cents >= budget_cents) return 'epuise';
  if (depense_cents >= budget_cents * SEUIL_RESTREINT) return 'restreint';
  if (depense_cents >= budget_cents * SEUIL_ECONOME) return 'econome';
  return 'normal';
}

export interface ReglagesPalier {
  model: string;
  effort: 'low' | 'medium';
  /** Messages d'historique renvoyés au modèle (60 = fenêtre normale ; 6 ≈ 3 tours). */
  historique_messages: number;
  /** Étapes d'outils par tour (8 = normal). */
  max_etapes: number;
  /** false au palier epuise : aucun appel au modèle. */
  modele_autorise: boolean;
}

/** Réglages imposés par le palier : la pente joue avant tout refus. */
export function reglagesPourPalier(palier: Palier, modeleNormal: string): ReglagesPalier {
  switch (palier) {
    case 'normal': return { model: modeleNormal, effort: 'medium', historique_messages: 60, max_etapes: 8, modele_autorise: true };
    case 'econome': return { model: 'claude-haiku-4-5', effort: 'low', historique_messages: 6, max_etapes: 8, modele_autorise: true };
    case 'restreint': return { model: 'claude-haiku-4-5', effort: 'low', historique_messages: 6, max_etapes: 2, modele_autorise: true };
    case 'epuise': return { model: 'claude-haiku-4-5', effort: 'low', historique_messages: 6, max_etapes: 0, modele_autorise: false };
  }
}

/** Date de remise à zéro (1er du mois suivant, Montréal), pour le message « en pause jusqu'au … ». */
export function dateRemiseAZero(langue: 'fr' | 'en', maintenant = new Date()): string {
  const [an, mois] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montreal', year: 'numeric', month: '2-digit' }).format(maintenant).split('-').map(Number);
  const premier = new Date(Date.UTC(mois === 12 ? an + 1 : an, mois === 12 ? 0 : mois, 1, 12));
  return langue === 'fr'
    ? `1er ${new Intl.DateTimeFormat('fr-CA', { month: 'long', timeZone: 'UTC' }).format(premier)}`
    : new Intl.DateTimeFormat('en-CA', { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(premier);
}

/** Message gabarit servi au palier epuise quand aucun étage déterministe n'a répondu (0 token). */
export function messagePause(langue: 'fr' | 'en', maintenant = new Date()): string {
  return langue === 'fr'
    ? `Ton assistant IA avancé est en pause jusqu'au ${dateRemiseAZero('fr', maintenant)}. Les actions rapides marchent toujours.`
    : `Your advanced AI assistant is paused until ${dateRemiseAZero('en', maintenant)}. Quick actions still work.`;
}

/**
 * Coût maximal d'un appel, réservé avant de l'envoyer : toute l'entrée au
 * tarif plein (comme si rien n'était en cache) + la sortie au plafond
 * max_tokens. Volontairement pessimiste : le règlement rend la différence.
 */
export function estimationCoutAppel(model: string, caracteresEntree: number, maxTokensSortie: number, tokensOutils = 3_000): number {
  const tokensEntree = Math.ceil(caracteresEntree / 3.5) + tokensOutils;
  return coutEnCents(model, { input_tokens: tokensEntree, output_tokens: maxTokensSortie, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
}

export interface Reservation { id: string | null; statut: 'ok' | 'econome' | 'restreint' | 'capped' | 'plan_sans_lumi' | 'indisponible' }

let rpcManquanteSignalee = false;
function rpcManquante(error: { code?: string; message?: string } | null): boolean {
  const m = `${error?.code ?? ''} ${error?.message ?? ''}`;
  return /PGRST202|42883|Could not find the function|does not exist/i.test(m);
}

/** Réserve `cents` sur le budget du mois (atomique côté base). RPC absente → 'indisponible' (ancien comportement). */
export async function reserverBudget(admin: SupabaseClient, orgId: string, cents: number, proactif = false): Promise<Reservation> {
  const { data, error } = await admin.rpc('reserve_ai_budget', { p_org: orgId, p_cents: Math.round(cents * 10_000) / 10_000, p_proactive: proactif });
  if (error) {
    if (rpcManquante(error)) {
      if (!rpcManquanteSignalee) { rpcManquanteSignalee = true; console.warn('[lumi] reserve_ai_budget absente : appliquer la migration 20260916120000_lumi_budget_reservations.sql'); }
      return { id: null, statut: 'indisponible' };
    }
    throw new Error(`reserve_ai_budget: ${error.message}`);
  }
  const r = (data ?? {}) as { status?: string; reservation_id?: string | null };
  const statut = (['ok', 'econome', 'restreint', 'capped', 'plan_sans_lumi'] as const).find((s) => s === r.status) ?? 'ok';
  return { id: r.reservation_id ?? null, statut };
}

/** Règle une réservation au coût réel (idempotent ; sans id, rien à faire). */
export async function reglerBudget(admin: SupabaseClient, reservationId: string | null, coutCents: number): Promise<void> {
  if (!reservationId) return;
  const { error } = await admin.rpc('settle_ai_budget', { p_reservation: reservationId, p_cost: Math.round(coutCents * 10_000) / 10_000 });
  if (error && !rpcManquante(error)) console.error('[lumi] settle_ai_budget :', error.message);
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
  // Réservations en vol (appels en cours) : comptées dans le palier pour que
  // deux tours simultanés voient le même plafond. Table absente → 0.
  let reserve = 0;
  if (includes) {
    try {
      const periode = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montreal', year: 'numeric', month: '2-digit' }).format(new Date());
      const { data } = await admin.from('ai_usage_monthly').select('reserved_cents').in('org_id', orgIds).eq('period', periode);
      for (const l of (data ?? []) as Array<{ reserved_cents: number | string }>) reserve += Number(l.reserved_cents ?? 0);
    } catch { reserve = 0; }
  }
  const engage = depense + reserve;
  const reste = Math.max(0, budget - engage);
  return {
    plan_slug: plan?.slug ?? null,
    includes_ai: includes,
    budget_cents: budget,
    depense_cents: Math.round(depense * 100) / 100,
    reserve_cents: Math.round(reserve * 100) / 100,
    reste_cents: Math.round(reste * 100) / 100,
    epuise: includes && engage >= budget,
    palier: includes ? palierBudget(budget, engage) : 'normal',
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
  // Une alerte par palier franchi et par mois (économe, restreint, épuisé).
  const { data: deja } = await admin.from('security_events')
    .select('id').eq('org_id', orgId).eq('event_type', 'lumi_budget_econome')
    .contains('details', { mois, palier: budget.palier }).limit(1).maybeSingle();
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
    + (budget.palier === 'epuise'
      ? `Le plafond est atteint : plus aucun appel au modèle jusqu'au 1er (les actions rapides et les caches répondent encore).\n`
      : `Elle passe en mode ${budget.palier === 'restreint' ? 'restreint (Haiku, 2 étapes par tour)' : 'économe (modèle moins cher)'}. À ${dollars(budget.budget_cents)}, Lumi se met en pause jusqu'au 1er.\n`)
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
