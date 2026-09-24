/**
 * Le fil d'une conversation Lumi par texto.
 * ─────────────────────────────────────────
 * Ce qui manque entre « un membre a écrit » et « Lumi a répondu » :
 *
 *   · retrouver ce qui s'est dit avant (sinon « et Sophie ? » ne veut rien dire) ;
 *   · reconnaître un « oui » qui confirme une action proposée au message
 *     précédent — et ne PAS le confondre avec le « oui » d'opt-in LCAP que le
 *     webhook traite déjà ;
 *   · exécuter l'écriture seulement après ce « oui », jamais avant ;
 *   · renvoyer la réponse par texto.
 *
 * L'écriture en attente vit dans la conversation elle-même (`messages`), pas
 * en mémoire : un redémarrage du serveur entre la proposition et le « oui »
 * ne doit pas exécuter une action orpheline — ni l'oublier en silence.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type Anthropic from '@anthropic-ai/sdk';
import { repondreParSms, type ReponseSms } from './lumi-sms';
import { estConfirmation, estAnnulation, type MembreIdentifie } from './identifier-membre';
import { twilioClient } from '../config';
import { getOrgSmsFromNumber } from '../twilioProvisioning';
import { logger } from '../logger';

/** Combien de messages du fil on relit pour donner du contexte à Lumi. */
export const MESSAGES_RELUS = 12;

/**
 * Marqueur invisible posé dans le texte du message où Lumi propose une
 * écriture. Le relire suffit à savoir ce qui attend un « oui » — pas besoin
 * d'une table de plus, et l'état survit à un redémarrage.
 */
const MARQUE = '​​';

export function marquerProposition(texte: string, p: { tool: string; args: Record<string, unknown>; tool_use_id: string }): string {
  return `${texte}${MARQUE}${JSON.stringify(p)}`;
}

export function lireProposition(texte: string): { visible: string; proposition: { tool: string; args: Record<string, unknown>; tool_use_id: string } | null } {
  const i = (texte || '').indexOf(MARQUE);
  if (i < 0) return { visible: texte || '', proposition: null };
  try {
    return { visible: texte.slice(0, i), proposition: JSON.parse(texte.slice(i + MARQUE.length)) };
  } catch {
    return { visible: texte.slice(0, i), proposition: null };
  }
}

export interface OptionsFil {
  admin: SupabaseClient;
  membre: MembreIdentifie;
  texte: string;
  conversationId: string;
  telephone: string;
}

/**
 * Envoie un texto depuis le numéro de l'entreprise. Ne lève jamais.
 *
 * `body` est ce que la personne LIT ; `journal` est ce qu'on garde en base —
 * il peut porter en plus le marqueur invisible de la proposition. Envoyer le
 * marqueur ferait apparaître des caractères parasites dans le téléphone.
 */
async function envoyer(admin: SupabaseClient, orgId: string, to: string, body: string, conversationId: string, journal = body): Promise<void> {
  try {
    const from = await getOrgSmsFromNumber(orgId);
    const envoi = await twilioClient?.messages.create({ to, from, body });
    // La réponse doit apparaître dans le fil : sans ça, l'équipe qui ouvre la
    // messagerie voit les questions sans les réponses.
    const { error } = await admin.from('messages').insert({
      conversation_id: conversationId,
      org_id: orgId,
      phone_number: to,
      direction: 'outbound',
      message_text: journal,
      status: 'sent',
      provider_message_id: envoi?.sid ?? null,
    });
    if (error) console.error('[sms/fil] réponse envoyée mais non journalisée:', error.message);
  } catch (e: any) {
    console.error('[sms/fil] envoi impossible:', e?.message || e);
  }
}

/**
 * Les derniers messages du fil, au format attendu par le modèle.
 *
 * On retire le marqueur de proposition : le modèle n'a pas à le voir, et il
 * ne doit surtout pas l'imiter.
 */
async function historique(admin: SupabaseClient, conversationId: string): Promise<Anthropic.Messages.MessageParam[]> {
  const { data, error } = await admin
    .from('messages')
    .select('direction, message_text, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(MESSAGES_RELUS);
  if (error || !data) return [];
  return [...data]
    .reverse()
    // Le message qu'on vient de recevoir est déjà en base : il est ajouté par
    // `repondreParSms`, donc on l'écarte ici pour ne pas le compter deux fois.
    .slice(0, -1)
    .map((m: any) => ({
      role: m.direction === 'inbound' ? 'user' as const : 'assistant' as const,
      content: lireProposition(String(m.message_text ?? '')).visible,
    }))
    .filter((m) => m.content.trim().length > 0);
}

/** La dernière écriture proposée par Lumi et encore sans réponse. */
async function propositionEnAttente(admin: SupabaseClient, conversationId: string) {
  const { data } = await admin
    .from('messages')
    .select('message_text, direction')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(3);
  // On ne remonte pas plus loin que l'échange précédent : un « oui » qui
  // arrive trois messages après une proposition ne confirme plus rien.
  for (const m of data ?? []) {
    if ((m as any).direction !== 'outbound') continue;
    const p = lireProposition(String((m as any).message_text ?? '')).proposition;
    if (p) return p;
    break;
  }
  return null;
}

/**
 * Traite un texto reçu d'un membre de l'équipe et lui répond.
 *
 * Trois cas : une confirmation, une annulation, ou une demande ordinaire.
 */
export async function repondreAuMembre(opts: OptionsFil): Promise<void> {
  const { admin, membre, texte, conversationId, telephone } = opts;
  const fr = membre.langue !== 'en';
  const dire = (body: string, journal?: string) => envoyer(admin, membre.orgId, telephone, body, conversationId, journal);

  const enAttente = await propositionEnAttente(admin, conversationId);

  // « oui » / « non » ne comptent QUE s'il y a quelque chose à confirmer.
  // Sans cette garde, un « oui » isolé partirait au modèle comme une demande,
  // et pire : le webhook le lit déjà comme un consentement LCAP.
  if (enAttente && estAnnulation(texte)) {
    await dire(fr ? "C'est correct, je ne fais rien." : "All good, I won't do anything.");
    return;
  }
  if (enAttente && estConfirmation(texte)) {
    try {
      const [{ executerEcriture }, { clientPourMembre }] = await Promise.all([
        import('../lumi/execution'),
        import('./session-membre'),
      ]);
      // Une écriture passe par les mêmes fonctions gardées que la lecture :
      // sans session du membre, la base refuse (`auth.uid()` nul) et la
      // confirmation échouerait alors qu'elle vient d'être donnée.
      const { client, accessToken } = await clientPourMembre(membre.userId);
      const { recu } = await executerEcriture({
        tool: enAttente.tool,
        toolUseId: enAttente.tool_use_id,
        args: enAttente.args,
        userId: membre.userId,
        orgId: membre.orgId,
        client,
        accessToken,
      });
      await dire(recu.ok
        ? (fr ? "C'est fait." : 'Done.')
        : (fr ? "Je n'ai pas réussi. Regarde dans l'app ?" : "That didn't work. Check the app?"));
    } catch (e: any) {
      logger.error('[sms/fil] exécution refusée ou en échec', { error: e?.message || String(e) });
      await dire(fr ? "Je n'ai pas réussi. Regarde dans l'app ?" : "That didn't work. Check the app?");
    }
    return;
  }

  const rep: ReponseSms = await repondreParSms(
    { admin, orgId: membre.orgId, userId: membre.userId, prenom: membre.prenom, langue: membre.langue },
    texte,
    await historique(admin, conversationId),
  );

  // La personne lit `rep.texte` ; la base garde en plus la proposition, pour
  // que le prochain « oui » sache quoi exécuter.
  await dire(rep.texte, rep.proposition ? marquerProposition(rep.texte, rep.proposition) : rep.texte);
}
