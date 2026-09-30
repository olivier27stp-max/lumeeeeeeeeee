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
import { maintenantPourLumi } from '../lumi/temps';
import type { SupabaseClient } from '@supabase/supabase-js';
import type Anthropic from '@anthropic-ai/sdk';
import { tourLumi, promptSystemeLumi, isLumiConfigured } from '../lumi/orchestrateur';
import { etatBudget, reserverBudget, reglerBudget, reglagesPourPalier, messagePause } from '../lumi/budget';
import { modeleLumi } from '../lumi/tarifs';
import type { Apercu } from '../lumi/fiches';
import { argentFr, argentEn } from '../lumi/apercu-action';
import { EXPIRATION_CONFIRMATION_MIN } from './confirmation';
import { logger } from '../logger';

/** Un SMS est facturé par tranche de 160 caractères : au-delà, on coupe. */
export const LONGUEUR_MAX_SMS = 900;

/** Tours gardés en mémoire pour le fil : assez pour un suivi, pas plus. */
export const TOURS_HISTORIQUE = 6;

/** Une écriture en attente de « oui ». `groupe` : toutes les écritures de la même carte, dans l'ordre. */
export interface PropositionSms {
  tool: string;
  args: Record<string, unknown>;
  tool_use_id: string;
  groupe?: Array<{ tool: string; args: Record<string, unknown>; tool_use_id: string }>;
  /** Le membre qui l'a reçue : un « oui » venu d'un autre compte ne la confirme pas. */
  user_id?: string;
  org_id?: string;
}

export interface ReponseSms {
  texte: string;
  /** Écriture proposée, en attente d'un « oui » au prochain message. */
  proposition: PropositionSms | null;
  cout_cents: number;
}

/**
 * Ce que le « oui » confirmera, écrit par le SERVEUR à partir de l'aperçu de
 * la carte (audit des outils, 2026-09-30). Avant, le texto ne montrait que la
 * phrase du modèle : on pouvait dire « oui » à « je relance Sophie ? » alors
 * que l'action visait une autre Sophie, ou un autre montant.
 */
export function apercuEnTexte(apercu: Apercu | null | undefined, langue: 'fr' | 'en'): { texte: string; bloque: boolean } {
  const fr = langue !== 'en';
  if (!apercu) return { texte: '', bloque: false };
  const lignes: string[] = [];
  let bloque = false;
  const argent = (c: number) => (fr ? argentFr(c) : argentEn(c));
  if (apercu.genre === 'action') {
    for (const l of [...apercu.cibles, ...apercu.details]) {
      if (l.alerte) bloque = true;
      lignes.push(`${fr ? l.libelle.fr : l.libelle.en} : ${fr ? l.valeur : (l.valeur_en ?? l.valeur)}`);
    }
  } else if (apercu.genre === 'quote' || apercu.genre === 'invoice') {
    const quoi = apercu.genre === 'quote' ? (fr ? 'Devis' : 'Quote') : (fr ? 'Facture' : 'Invoice');
    lignes.push(`${quoi} : ${[apercu.client?.name, apercu.title].filter(Boolean).join(' · ')}`);
    lignes.push(`${fr ? 'Total taxes incluses' : 'Total incl. taxes'} : ${argent(apercu.total_cents)}`);
  } else if (apercu.genre === 'sms' || apercu.genre === 'email') {
    if (!apercu.to) bloque = true;
    lignes.push(`${fr ? 'À' : 'To'} : ${apercu.to || (fr ? 'aucun destinataire' : 'no recipient')}`);
    lignes.push(`« ${apercu.body.slice(0, 280)}${apercu.body.length > 280 ? '…' : ''} »`);
  } else if (apercu.genre === 'fusion') {
    if (!apercu.garder || !apercu.absorber) bloque = true;
    lignes.push(`${fr ? 'Garder' : 'Keep'} : ${apercu.garder?.name ?? '?'} · ${fr ? 'absorber' : 'absorb'} : ${apercu.absorber?.name ?? '?'}`);
  }
  if (apercu.drapeaux?.irreversible) lignes.push(fr ? 'Irréversible.' : 'Cannot be undone.');
  if (apercu.drapeaux?.vers_client) lignes.push(fr ? 'Part chez le client.' : 'Goes to the client.');
  return { texte: lignes.map((l) => `- ${l}`).join('\n').slice(0, 600), bloque };
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
    return await clientPourMembre(ctx.userId, ctx.orgId);
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
  let fuseau = 'America/Toronto';
  try {
    const { data } = await ctx.admin.from('company_settings').select('company_name, timezone').eq('org_id', ctx.orgId).maybeSingle();
    companyName = (data as any)?.company_name ?? null;
    if ((data as any)?.timezone) fuseau = String((data as any).timezone);
  } catch { /* non-fatal : le prompt tient sans */ }

  const systeme = promptSystemeLumi({
    companyName,
    userName: ctx.prenom || null,
    language: ctx.langue,
    todayIso: maintenantPourLumi(fuseau, ctx.langue),
    // Les consignes du canal vont dans `focus` : c'est le bloc VARIABLE du
    // prompt, après le point de cache. Les mettre ailleurs casserait le
    // préfixe partagé et ferait repayer le prompt entier à chaque texto.
    focus: consignesSms(ctx.langue),
  });

  // Les outils travaillent avec l'identité du membre ; le budget et les
  // réservations restent sur le client de service, qui écrit hors RLS.
  const { client, accessToken } = await clientDesOutils(ctx);

  let texte = '';
  // Les aperçus de la carte (non exécutés d'office) : ce que le « oui » confirmera.
  let apercus: Array<Apercu | null> = [];
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
      if (e.type === 'proposal' && !e.auto) apercus = e.groupe ? e.groupe.map((g) => g.apercu) : [e.apercu];
    },
    journaliser: async () => { /* l'usage est journalisé par la réservation ci-dessous */ },
    budget: {
      reserver: (cents) => reserverBudget(ctx.admin, ctx.orgId, cents),
      regler: (id, cents) => reglerBudget(ctx.admin, id, cents),
    },
  });

  if (resultat.plafond) return vide(messagePause(ctx.langue));

  const final = pourSms(texte || resultat.texte || '', resultat.proposition ? 400 : LONGUEUR_MAX_SMS);
  const reponse = final || (fr ? "Je n'ai pas trouvé de réponse. Reformule ?" : "I couldn't find an answer. Try rephrasing?");
  if (!resultat.proposition) return { texte: reponse, proposition: null, cout_cents: resultat.cost_cents ?? 0 };

  const p = resultat.proposition;
  const resumes = apercus.map((a) => apercuEnTexte(a, ctx.langue));
  if (resumes.some((r) => r.bloque)) {
    // Un élément visé est introuvable (ou un message sans destinataire) : rien
    // n'attend de « oui », on ne propose pas une action qu'on sait fausse.
    return {
      texte: `${fr ? "Je ne peux pas faire ça : un élément visé est introuvable ou incomplet." : "I can't do that: something it targets is missing or incomplete."}\n${resumes.map((r) => r.texte).filter(Boolean).join('\n')}`.slice(0, LONGUEUR_MAX_SMS),
      proposition: null,
      cout_cents: resultat.cost_cents ?? 0,
    };
  }
  const detail = resumes.map((r) => r.texte).filter(Boolean).join('\n');
  const consigne = fr
    ? `Réponds OUI pour confirmer (valable ${EXPIRATION_CONFIRMATION_MIN} min), NON pour annuler.`
    : `Reply YES to confirm (valid ${EXPIRATION_CONFIRMATION_MIN} min), NO to cancel.`;
  return {
    texte: [reponse, detail ? `${fr ? 'Ce que je ferai' : 'What I will do'} :\n${detail}` : '', consigne].filter(Boolean).join('\n\n'),
    proposition: {
      tool: p.tool, args: p.args, tool_use_id: p.tool_use_id,
      ...(p.groupe && p.groupe.length > 1 ? { groupe: p.groupe.map((g) => ({ tool: g.tool, args: g.args, tool_use_id: g.tool_use_id })) } : {}),
      user_id: ctx.userId, org_id: ctx.orgId,
    },
    cout_cents: resultat.cost_cents ?? 0,
  };
}
