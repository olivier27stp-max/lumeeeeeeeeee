/**
 * Lumi par texto.
 * ───────────────
 * Le même Lumi que dans l'app, pour quelqu'un qui a les mains sur le volant.
 * Il écrit « c'est quoi mes jobs demain » ou envoie un vocal, il reçoit une
 * réponse en quelques secondes — sans ouvrir l'application.
 *
 * Ce module NE REFAIT PAS Lumi : il réutilise `tourLumi`, le budget, le prompt
 * système et le journal d'usage de la route web. Ce qu'il apporte, c'est ce
 * qui change quand le canal n'est plus un navigateur :
 *
 *   · pas de session HTTP — l'identité vient du numéro (voir identifier-membre) ;
 *   · pas de flux SSE — on accumule le texte et on envoie un message ;
 *   · pas d'écran — donc un texte court, sans mise en forme ;
 *   · une écriture proposée s'exécute sur un « oui », pas sur un clic.
 *
 * La règle d'or ne change pas : **une écriture n'est jamais exécutée sans
 * confirmation**. En SMS, la confirmation est le message suivant.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type Anthropic from '@anthropic-ai/sdk';
import { tourLumi, promptSystemeLumi, isLumiConfigured } from '../lumi/orchestrateur';
import { etatBudget, reserverBudget, reglerBudget, reglagesPourPalier, messagePause } from '../lumi/budget';
import { modeleLumi } from '../lumi/tarifs';
import { logger } from '../logger';

/** Un SMS est facturé par tranche de 160 caractères : au-delà, on coupe. */
export const LONGUEUR_MAX_SMS = 900;

/** Tours gardés en mémoire pour le fil : assez pour un suivi, pas plus. */
export const TOURS_HISTORIQUE = 6;

export interface ReponseSms {
  texte: string;
  /** Écriture proposée, en attente d'un « oui » au prochain message. */
  proposition: { tool: string; args: Record<string, unknown>; tool_use_id: string } | null;
  cout_cents: number;
}

/**
 * Raccourcit une réponse pour un écran de téléphone.
 *
 * On coupe à la phrase, pas au caractère : une réponse tronquée en plein
 * milieu d'un montant est pire que pas de réponse.
 */
export function pourSms(texte: string, max = LONGUEUR_MAX_SMS): string {
  const t = (texte || '').replace(/\n{3,}/g, '\n\n').trim();
  if (t.length <= max) return t;
  const coupe = t.slice(0, max);
  const fin = Math.max(coupe.lastIndexOf('. '), coupe.lastIndexOf('! '), coupe.lastIndexOf('? '), coupe.lastIndexOf('\n'));
  return (fin > max * 0.5 ? coupe.slice(0, fin + 1) : coupe).trim() + '…';
}

/**
 * Consignes propres au canal : elles s'ajoutent au prompt système, après le
 * point de cache, et ne modifient donc pas le préfixe partagé entre orgs.
 */
export function consignesSms(langue: 'fr' | 'en'): string {
  return langue === 'en'
    ? "You are answering by TEXT MESSAGE. Keep it under 3 short sentences, no markdown, no bullet lists, no headings — plain text only. Give the number and one line of context. If you propose an action, end with a clear question they can answer with \"yes\"."
    : "Tu réponds par TEXTO. Trois phrases courtes au maximum, aucune mise en forme : pas de gras, pas de listes à puces, pas de titres — du texte brut. Donne le chiffre et une phrase de contexte. Si tu proposes une action, termine par une question à laquelle on répond « oui ».";
}

export interface ContexteSms {
  admin: SupabaseClient;
  orgId: string;
  userId: string;
  prenom: string;
  langue: 'fr' | 'en';
}

/**
 * Le client que voient les outils.
 *
 * Une vingtaine de fonctions de base de données sont gardées par
 * `has_org_membership(auth.uid(), org_id)` : avec le client de service,
 * `auth.uid()` est nul et la base refuse — « ça bogue de mon côté », mesuré
 * en production. On ouvre donc une vraie session pour le membre, comme le
 * navigateur en a une.
 */
async function clientDesOutils(ctx: ContexteSms): Promise<{ client: SupabaseClient; accessToken?: string }> {
  try {
    const { clientPourMembre } = await import('./session-membre');
    return await clientPourMembre(ctx.userId);
  } catch (e: any) {
    logger.error('[sms/lumi] session du membre indisponible — outils à identité limités', { error: e?.message || String(e) });
    return { client: ctx.admin };
  }
}

/**
 * Fait tourner Lumi sur un message reçu par texto.
 *
 * Rend toujours un texte : un silence, en SMS, se lit comme une panne. Les
 * refus (forfait sans Lumi, budget épuisé) sont des phrases normales, pas des
 * codes d'erreur.
 */
export async function repondreParSms(
  ctx: ContexteSms,
  message: string,
  historique: Anthropic.Messages.MessageParam[] = [],
): Promise<ReponseSms> {
  const fr = ctx.langue !== 'en';
  const vide = (texte: string): ReponseSms => ({ texte, proposition: null, cout_cents: 0 });

  if (!isLumiConfigured()) {
    logger.error('[sms/lumi] ANTHROPIC_API_KEY absente — aucune réponse possible');
    return vide(fr ? "Je ne suis pas disponible pour l'instant. Réessaie plus tard." : "I'm not available right now. Try again later.");
  }

  const budget = await etatBudget(ctx.admin, ctx.orgId);
  if (!budget.includes_ai) {
    // Le forfait n'inclut pas Lumi : on le dit sans jargon ni nom de plan.
    return vide(fr
      ? "Je ne suis pas inclus dans ton forfait. Parle-nous-en si tu veux m'ajouter."
      : "I'm not included in your plan. Reach out if you'd like to add me.");
  }
  if (budget.palier === 'epuise') {
    return vide(messagePause(ctx.langue));
  }

  const reglages = reglagesPourPalier(budget.palier, modeleLumi());

  let companyName: string | null = null;
  try {
    const { data } = await ctx.admin.from('company_settings').select('company_name').eq('org_id', ctx.orgId).maybeSingle();
    companyName = (data as any)?.company_name ?? null;
  } catch { /* non-fatal : le prompt tient sans */ }

  const systeme = promptSystemeLumi({
    companyName,
    userName: ctx.prenom || null,
    language: ctx.langue,
    todayIso: new Date().toISOString().slice(0, 10),
    // Les consignes du canal vont dans `focus` : c'est le bloc VARIABLE du
    // prompt, après le point de cache. Les mettre ailleurs casserait le
    // préfixe partagé et ferait repayer le prompt entier à chaque texto.
    focus: consignesSms(ctx.langue),
  });

  // Les outils travaillent avec l'identité du membre ; le budget et les
  // réservations restent sur le client de service, qui écrit hors RLS.
  const { client, accessToken } = await clientDesOutils(ctx);

  let texte = '';
  const resultat = await tourLumi({
    client,
    accessToken,
    orgId: ctx.orgId,
    userId: ctx.userId,
    systeme,
    historique: [...historique.slice(-TOURS_HISTORIQUE * 2), { role: 'user', content: message }],
    reglages,
    emettre: (e) => {
      if (e.type === 'text') texte += e.delta;
    },
    journaliser: async () => { /* l'usage est journalisé par la réservation ci-dessous */ },
    budget: {
      reserver: (cents) => reserverBudget(ctx.admin, ctx.orgId, cents),
      regler: (id, cents) => reglerBudget(ctx.admin, id, cents),
    },
  });

  if (resultat.plafond) return vide(messagePause(ctx.langue));

  const final = pourSms(texte || resultat.texte || '');
  return {
    texte: final || (fr ? "Je n'ai pas trouvé de réponse. Reformule ?" : "I couldn't find an answer. Try rephrasing?"),
    proposition: resultat.proposition ?? null,
    cout_cents: resultat.cost_cents ?? 0,
  };
}
