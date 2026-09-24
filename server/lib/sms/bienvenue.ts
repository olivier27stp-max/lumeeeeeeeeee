/**
 * « Salut, c'est Lumi » — le premier texto.
 * ─────────────────────────────────────────
 * Lumi répond par texto (voir fil-lumi), mais personne ne le sait : rien dans
 * l'application ne dit qu'un numéro existe et qu'on peut lui parler. Une
 * fonctionnalité que l'on ignore n'existe pas.
 *
 * D'où ce message, envoyé UNE FOIS, au moment où le numéro de l'entreprise
 * vient d'être acheté — c'est-à-dire quand l'abonnement devient actif. Il
 * arrive dans le téléphone du propriétaire, pas dans un courriel qu'il ne
 * lira pas, et il donne trois exemples à copier plutôt qu'une description.
 *
 * Ce n'est pas un message commercial : c'est le mode d'emploi du service que
 * la personne vient de payer, envoyé à un membre de son équipe. Il reste
 * soumis aux mêmes garde-fous que tout envoi (opt-out, forfait sans SMS).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeE164 } from '../helpers';
import { logger } from '../logger';

export interface CibleBienvenue {
  userId: string;
  telephone: string;
  prenom: string;
  langue: 'fr' | 'en';
}

/**
 * Le texte du message.
 *
 * Exporté pour être relu et testé : c'est le premier contact avec Lumi, il ne
 * doit contenir ni jargon, ni promesse que le produit ne tient pas.
 */
export function texteBienvenue(prenom: string, langue: 'fr' | 'en' = 'fr'): string {
  const nom = (prenom || '').trim();
  if (langue === 'en') {
    return `Hi${nom ? ` ${nom}` : ''}, it's Lumi 👋

This number is mine. Text me — or send me a voice message, even while driving:

• "what are my jobs tomorrow"
• "chase my overdue invoices"
• "how much did I bill this month"

I answer in seconds. And I never do anything without asking you first.

Save me in your contacts 📌`;
  }
  return `Salut${nom ? ` ${nom}` : ''}, c'est Lumi 👋

Ce numéro-là, c'est le mien. Écris-moi ou envoie-moi un message vocal quand tu veux, même en conduisant :

• « c'est quoi mes jobs demain »
• « relance mes factures en retard »
• « combien j'ai fait ce mois-ci »

Je réponds en quelques secondes. Et je ne fais jamais rien sans te demander avant.

Enregistre-moi dans tes contacts 📌`;
}

/**
 * À qui envoyer : les propriétaires et administrateurs actifs qui ont un
 * téléphone ET un compte — sans compte, Lumi ne pourrait pas leur répondre,
 * et leur annoncer un service inutilisable serait pire que le silence.
 */
export async function ciblesBienvenue(admin: SupabaseClient, orgId: string): Promise<CibleBienvenue[]> {
  const { data, error } = await admin
    .from('team_members')
    .select('user_id, first_name, phone, role, status')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .in('role', ['owner', 'admin'])
    .not('user_id', 'is', null);
  if (error) {
    logger.error('[sms/bienvenue] équipe illisible', { orgId, error: error.message });
    return [];
  }

  const vues = new Set<string>();
  const out: CibleBienvenue[] = [];
  for (const m of data ?? []) {
    const tel = normalizeE164(String((m as any).phone ?? ''));
    if (!tel) continue;
    // Deux personnes peuvent partager un numéro (rare, mais vu) : un seul
    // message part, sinon le téléphone reçoit le même texte deux fois.
    if (vues.has(tel)) continue;
    vues.add(tel);
    out.push({
      userId: String((m as any).user_id),
      telephone: tel,
      prenom: String((m as any).first_name ?? '').trim(),
      langue: 'fr',
    });
  }
  return out;
}

/** true si cette personne a déjà reçu le mot de bienvenue de cette org. */
export async function dejaEnvoye(admin: SupabaseClient, orgId: string, telephone: string): Promise<boolean> {
  // La trace est le message lui-même : on cherche un envoi sortant portant le
  // début du texte. Pas de table de plus, et l'état survit à tout.
  const { data } = await admin
    .from('messages')
    .select('id')
    .eq('org_id', orgId)
    .eq('phone_number', normalizeE164(telephone))
    .eq('direction', 'outbound')
    .ilike('message_text', '%c\'est Lumi%')
    .limit(1);
  return (data ?? []).length > 0;
}

/** true si ce numéro a demandé à ne plus recevoir de textos de cette org. */
export async function aRefuse(admin: SupabaseClient, orgId: string, telephone: string): Promise<boolean> {
  const { data } = await admin
    .from('sms_opt_outs')
    .select('phone')
    .eq('org_id', orgId)
    .eq('phone', normalizeE164(telephone))
    .limit(1);
  return (data ?? []).length > 0;
}

export interface ResultatBienvenue {
  envoyes: number;
  ignores: Array<{ telephone: string; raison: 'deja_envoye' | 'a_refuse' | 'echec' }>;
}

/**
 * Envoie le mot de bienvenue aux propriétaires et administrateurs de l'org.
 *
 * Ne lève jamais : un abonnement qui vient d'être payé ne doit pas échouer
 * parce qu'un texto n'est pas parti. Tout est journalisé.
 */
export async function envoyerBienvenue(admin: SupabaseClient, orgId: string): Promise<ResultatBienvenue> {
  const res: ResultatBienvenue = { envoyes: 0, ignores: [] };

  const [{ twilioClient }, { getOrgSmsFromNumber }] = await Promise.all([
    import('../config'),
    import('../twilioProvisioning'),
  ]);
  if (!twilioClient) {
    logger.error('[sms/bienvenue] Twilio non configuré — aucun envoi');
    return res;
  }

  let from: string;
  try {
    // Lève si l'org n'a pas de numéro ou si le forfait exclut les SMS : dans
    // les deux cas il n'y a rien à annoncer.
    from = await getOrgSmsFromNumber(orgId);
  } catch (e: any) {
    logger.info('[sms/bienvenue] pas de numéro pour cette org — rien à envoyer', { orgId, raison: e?.message });
    return res;
  }

  for (const cible of await ciblesBienvenue(admin, orgId)) {
    if (await dejaEnvoye(admin, orgId, cible.telephone)) {
      res.ignores.push({ telephone: cible.telephone, raison: 'deja_envoye' });
      continue;
    }
    if (await aRefuse(admin, orgId, cible.telephone)) {
      res.ignores.push({ telephone: cible.telephone, raison: 'a_refuse' });
      continue;
    }

    const body = texteBienvenue(cible.prenom, cible.langue);
    try {
      const envoi = await twilioClient.messages.create({ to: cible.telephone, from, body });
      // Le message entre dans la conversation : c'est à la fois la trace
      // anti-doublon et le début du fil que Lumi relira.
      const { findOrCreateConversation } = await import('../helpers');
      const conv = await findOrCreateConversation(admin, orgId, cible.telephone, null, cible.prenom || null);
      if (conv?.id) {
        const { error } = await admin.from('messages').insert({
          conversation_id: conv.id,
          org_id: orgId,
          phone_number: cible.telephone,
          direction: 'outbound',
          message_text: body,
          status: 'sent',
          provider_message_id: envoi?.sid ?? null,
        });
        if (error) console.error('[sms/bienvenue] envoyé mais non journalisé:', error.message);
      }
      res.envoyes += 1;
      logger.info('[sms/bienvenue] envoyé', { orgId, tel: `***${cible.telephone.slice(-4)}` });
    } catch (e: any) {
      console.error('[sms/bienvenue] envoi impossible:', e?.message || e);
      res.ignores.push({ telephone: cible.telephone, raison: 'echec' });
    }
  }
  return res;
}
