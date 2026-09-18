/**
 * webhooks-ses.ts — les rebonds et le suivi quand c'est Amazon SES qui envoie.
 * ───────────────────────────────────────────────────────────────────────────
 * SES ne pousse pas ses évènements comme Resend : il les publie dans SNS, qui
 * les livre ici en HTTPS. Trois différences qui comptent :
 *
 *   1. SNS commence par une poignée de main : une requête
 *      « SubscriptionConfirmation » qu'il faut confirmer en visitant l'URL
 *      qu'elle contient, UNE fois. Sans ça, aucun évènement n'arrive jamais.
 *      On ne visite que des URL en `sns.<région>.amazonaws.com` — sinon
 *      n'importe qui nous ferait appeler n'importe quelle adresse.
 *
 *   2. Le vrai message est une CHAÎNE JSON dans le champ `Message` de
 *      l'enveloppe SNS. On le déplie avant de le lire.
 *
 *   3. SES distingue un rebond « Permanent » (adresse morte) d'un rebond
 *      « Transient » (boîte pleine, serveur en panne). Seul le permanent doit
 *      bannir l'adresse : bannir sur une boîte pleine ferait perdre un vrai
 *      client. `evenementDepuisSns` porte cette distinction (`definitif`).
 *
 * Sécurité : SNS signe ses messages, mais la vérification demande de
 * télécharger le certificat cité dans la requête. Ici, on exige en plus un
 * jeton partagé dans l'URL (`SES_WEBHOOK_TOKEN`), ce qui suffit à fermer la
 * porte : l'adresse n'est connue que d'Amazon et de nous. La route répond 503
 * si le jeton n'est pas configuré — jamais « OK » sur un webhook non vérifié.
 *
 * Idempotence : `webhook_receipts` (même clé que Resend), sur le `MessageId`
 * de SNS. Un rejeu ne compte pas deux fois.
 *
 * Env : SES_WEBHOOK_TOKEN (chaîne au hasard, la même dans l'URL SNS).
 */
import type express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { getServiceClient } from '../lib/supabase';
import { logger } from '../lib/logger';
import { deplierMessageSns, evenementDepuisSns, urlDeConfirmationSns, type EvenementSes } from '../lib/courriels/ses';
import { ENTITES_SANS_SUIVI } from './webhooks-email';

/** Comparaison en temps constant de deux jetons, sans fuiter leur longueur. */
export function jetonValide(recu: unknown, attendu: string): boolean {
  const a = Buffer.from(String(recu || ''));
  const b = Buffer.from(attendu);
  if (!attendu || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Le statut que prend `email_deliveries` pour un évènement SES. */
export function statutPourEvenement(e: EvenementSes): 'delivered' | 'bounced' | 'complained' | null {
  if (e.type === 'delivered') return 'delivered';
  if (e.type === 'complained') return 'complained';
  // Un rebond transitoire (boîte pleine) ne marque pas l'adresse comme morte.
  if (e.type === 'bounced') return e.definitif ? 'bounced' : null;
  return null;
}

export async function sesWebhookHandler(req: express.Request, res: express.Response) {
  const attendu = String(process.env.SES_WEBHOOK_TOKEN || '');
  if (!attendu) {
    logger.error('[webhooks/ses] SES_WEBHOOK_TOKEN absent : webhook refusé');
    return res.status(503).json({ error: 'SES webhook is not configured.' });
  }
  if (!jetonValide(req.query.token, attendu)) {
    logger.warn('[webhooks/ses] jeton invalide');
    return res.status(401).json({ error: 'Invalid token.' });
  }

  const brut = req.body instanceof Buffer ? req.body.toString('utf8') : '';
  let enveloppe: unknown;
  try {
    enveloppe = JSON.parse(brut);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON.' });
  }

  // 1. Poignée de main SNS : une seule fois, à l'abonnement.
  const confirmation = urlDeConfirmationSns(enveloppe);
  if (confirmation) {
    try {
      await fetch(confirmation, { signal: AbortSignal.timeout(10_000) });
      logger.info('[webhooks/ses] abonnement SNS confirmé');
    } catch (err: any) {
      logger.error('[webhooks/ses] confirmation SNS impossible', { error: err?.message || String(err) });
    }
    return res.json({ received: true, subscription: true });
  }

  const evenement = evenementDepuisSns(deplierMessageSns(enveloppe));
  if (!evenement) return res.json({ received: true, ignored: true });

  const admin = getServiceClient();
  const reference = String((enveloppe as { MessageId?: string })?.MessageId || '');

  // 2. Idempotence : un rejeu SNS ne compte pas deux fois.
  if (reference) {
    const { data: deja, error } = await admin
      .from('webhook_receipts')
      .select('id')
      .eq('provider', 'ses')
      .eq('reference', reference)
      .eq('outcome', 'counted')
      .limit(1);
    if (error) logger.error('[webhooks/ses] lecture webhook_receipts échouée', { error: error.message });
    else if (deja?.length) return res.json({ received: true, duplicate: true });
  }

  let touchees = 0;
  try {
    if (evenement.type === 'opened' || evenement.type === 'clicked') {
      // Même compteur atomique que Resend, mêmes exclusions Loi 25.
      const { data, error } = await admin.rpc('email_deliveries_enregistrer_suivi', {
        p_email_id: evenement.messageId,
        p_evenement: evenement.type,
        p_quand: evenement.quand,
        p_url: evenement.url,
        p_types_exclus: [...ENTITES_SANS_SUIVI],
      });
      if (error) throw new Error(error.message);
      touchees = Number(data ?? 0);
    } else {
      const statut = statutPourEvenement(evenement);
      if (statut) {
        const { data, error } = await admin
          .from('email_deliveries')
          .update({ status: statut, error: evenement.detail, updated_at: new Date().toISOString() })
          .eq('message_id', evenement.messageId)
          .select('id');
        if (error) throw new Error(error.message);
        touchees = data?.length ?? 0;
      }
    }
  } catch (err: any) {
    logger.error('[webhooks/ses] évènement non enregistré', { error: err?.message || String(err), type: evenement.type, messageId: evenement.messageId });
    // 200 quand même : SNS rejouerait sans fin, et la ligne est déjà journalisée.
  }

  if (reference) {
    const { error } = await admin.from('webhook_receipts').insert({
      provider: 'ses',
      reference,
      event_type: evenement.type,
      signature_ok: true,
      outcome: 'counted',
      summary: { messageId: evenement.messageId, updated: touchees, definitif: evenement.definitif },
    });
    if (error) logger.error('[webhooks/ses] accusé non journalisé', { error: error.message });
  }

  return res.json({ received: true, updated: touchees });
}
