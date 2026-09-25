/**
 * webhooks-email.ts — les rebonds courriel, enfin captés.
 *
 * Audit QA prod 2026-09-09, n°8 : sendEmail() répondait « envoyé » dès que le
 * relais acceptait le message. Un rebond arrive PLUS TARD, par un autre
 * canal, et n'était jamais capté : une adresse mal saisie = une facture
 * « envoyée, en attente de paiement » pour toujours, sans que personne ne
 * sache que le client ne l'a jamais reçue.
 *
 * Resend pousse ici email.delivered / email.bounced / email.complained /
 * email.delivery_delayed. On met à jour email_deliveries (par message_id) —
 * l'interface affiche « courriel non livré », les relances sautent l'adresse.
 *
 * Signature Svix (standard Resend) : HMAC-SHA256 de `${id}.${timestamp}.${corps
 * brut}` avec la clé base64 après `whsec_`, comparée en temps constant, avec
 * une tolérance de 5 minutes sur l'horodatage. Monté AVANT express.json()
 * (corps brut), comme les webhooks Stripe.
 *
 * Suivi d'ouverture et de clic (plan courriels pro, 2026-09-17) : Resend
 * pousse aussi email.opened / email.clicked (suivi activé par domaine chez
 * eux ; pas de pixel de notre côté). Première ouverture = opened_at, chaque
 * ouverture incrémente open_count ; idem pour le clic (last_clicked_url).
 * Loi 25 : JAMAIS de suivi sur les courriels de compte/abonnement que Lume
 * envoie à ses abonnés — entity_type null ou dans ENTITES_SANS_SUIVI est
 * ignoré ici, même si Resend nous envoie l'évènement. Idempotence : un
 * évènement rejoué (même svix-id) ne compte pas deux fois (webhook_receipts).
 *
 * Env : RESEND_WEBHOOK_SECRET (whsec_…). Sans lui, la route répond 503 —
 * jamais « OK » sur un webhook non vérifié.
 */
import type express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getServiceClient } from '../lib/supabase';
import { logger } from '../lib/logger';

const TOLERANCE_S = 5 * 60;

const STATUT_PAR_EVENEMENT: Record<string, 'delivered' | 'delayed' | 'bounced' | 'complained'> = {
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
};

export type EvenementSuivi = 'opened' | 'clicked';
const SUIVI_PAR_EVENEMENT: Record<string, EvenementSuivi> = {
  'email.opened': 'opened',
  'email.clicked': 'clicked',
};

/**
 * Courriels de compte / d'abonnement / d'exploitation de Lume : aucun suivi
 * d'ouverture (Loi 25). La plupart n'ont pas d'entity_type du tout (null est
 * refusé aussi) ; cette liste couvre ceux qui en portent un.
 */
export const ENTITES_SANS_SUIVI: readonly string[] = [
  'account', 'user', 'team_member', 'invitation', 'subscription', 'billing',
  'support', 'support_ticket', 'security', 'alerte_rebonds', 'data_migration', 'report',
];

export interface SuiviRecu { type: EvenementSuivi; emailId: string; quand: string; url: string | null }

/** Lit un évènement email.opened / email.clicked ; null pour tout le reste. Pur. */
export function interpreterEvenementSuivi(evenement: any): SuiviRecu | null {
  const type = SUIVI_PAR_EVENEMENT[String(evenement?.type || '')];
  const emailId = evenement?.data?.email_id;
  if (!type || typeof emailId !== 'string' || !emailId) return null;
  const brut = type === 'clicked' ? evenement?.data?.click?.timestamp : evenement?.created_at;
  const d = new Date(typeof brut === 'string' ? brut : NaN);
  const quand = Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  const lien = evenement?.data?.click?.link;
  return { type, emailId, quand, url: type === 'clicked' && typeof lien === 'string' && lien ? lien.slice(0, 2000) : null };
}

/** Ouverture / clic : compteur atomique en base, jamais deux fois pour le même svix-id. */
async function traiterSuivi(suivi: SuiviRecu, svixId: string | undefined, typeBrut: string, res: express.Response) {
  const admin = getServiceClient();
  if (svixId) {
    const { data: deja, error: e0 } = await admin
      .from('webhook_receipts')
      .select('id')
      .eq('provider', 'resend')
      .eq('reference', svixId)
      .eq('outcome', 'counted')
      .limit(1);
    if (e0) logger.error('[webhooks/email] lecture webhook_receipts échouée', { error: e0.message });
    else if (deja?.length) return res.json({ received: true, duplicate: true });
  }

  const { data, error } = await admin.rpc('email_deliveries_enregistrer_suivi', {
    p_email_id: suivi.emailId,
    p_evenement: suivi.type,
    p_quand: suivi.quand,
    p_url: suivi.url,
    p_types_exclus: [...ENTITES_SANS_SUIVI],
  });
  if (error) {
    logger.error('[webhooks/email] suivi non enregistré', { error: error.message, emailId: suivi.emailId, type: suivi.type });
    return res.status(500).json({ error: 'Update failed.' });
  }
  const touchees = Array.isArray(data) ? data.length : 0;

  if (svixId) {
    const { error: e1 } = await admin.from('webhook_receipts').insert({
      provider: 'resend', signature_ok: true, event_type: typeBrut, reference: svixId,
      outcome: 'counted', summary: { email_id: suivi.emailId, updated: touchees },
    });
    if (e1) logger.error('[webhooks/email] webhook_receipts non journalisé', { error: e1.message });
  }
  return res.json({ received: true, updated: touchees });
}

export function verifierSignatureSvix(
  headers: { id?: string; timestamp?: string; signature?: string },
  corpsBrut: string | Buffer,
  secret: string,
  maintenantS: number = Math.floor(Date.now() / 1000),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(maintenantS - ts) > TOLERANCE_S) return false;

  const cle = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  if (cle.length === 0) return false;
  const attendu = createHmac('sha256', cle)
    .update(`${id}.${timestamp}.${typeof corpsBrut === 'string' ? corpsBrut : corpsBrut.toString('utf8')}`)
    .digest('base64');
  const attenduBuf = Buffer.from(attendu);

  // Plusieurs signatures possibles (rotation de clé) : "v1,xxx v1,yyy".
  for (const part of signature.split(' ')) {
    const [version, valeur] = part.split(',');
    if (version !== 'v1' || !valeur) continue;
    const candidat = Buffer.from(valeur);
    if (candidat.length === attenduBuf.length && timingSafeEqual(candidat, attenduBuf)) return true;
  }
  return false;
}

export async function emailWebhookHandler(req: express.Request, res: express.Response) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    logger.error('[webhooks/email] RESEND_WEBHOOK_SECRET absent — webhook refusé');
    return res.status(503).json({ error: 'Email webhook not configured.' });
  }

  const corps: Buffer | string = Buffer.isBuffer(req.body) ? req.body : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));
  const valide = verifierSignatureSvix(
    { id: req.header('svix-id'), timestamp: req.header('svix-timestamp'), signature: req.header('svix-signature') },
    corps,
    secret,
  );
  if (!valide) return res.status(400).json({ error: 'Invalid signature.' });

  let evenement: any;
  try {
    evenement = JSON.parse(typeof corps === 'string' ? corps : corps.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON.' });
  }

  const suivi = interpreterEvenementSuivi(evenement);
  if (suivi) return traiterSuivi(suivi, req.header('svix-id'), String(evenement.type), res);

  const statut = STATUT_PAR_EVENEMENT[String(evenement?.type || '')];
  const emailId = evenement?.data?.email_id;
  if (!statut || !emailId) return res.json({ received: true, ignored: true });

  const detail = evenement?.data?.bounce?.message
    || evenement?.data?.bounce?.subType
    || evenement?.data?.bounce?.type
    || null;

  const admin = getServiceClient();
  const { data, error } = await admin
    .from('email_deliveries')
    .update({ status: statut, ...(detail ? { error: String(detail).slice(0, 500) } : {}) })
    .like('message_id', `${emailId}%`)
    .select('id, org_id, to_email, entity_type, entity_id');

  if (error) {
    logger.error('[webhooks/email] mise à jour échouée', { error: error.message, emailId, statut });
    // 500 : Resend réessaiera. Un rebond perdu, c'est le bug qu'on corrige.
    return res.status(500).json({ error: 'Update failed.' });
  }

  if (statut === 'bounced' || statut === 'complained') {
    for (const ligne of data ?? []) {
      logger.warn('[webhooks/email] courriel non livré', {
        statut, email: ligne.to_email, entity_type: ligne.entity_type, entity_id: ligne.entity_id, orgId: ligne.org_id,
      });
      // Notification dans le CRM : le propriétaire doit corriger l'adresse.
      if (ligne.org_id) {
        const lien = ligne.entity_type === 'invoice' && ligne.entity_id ? `/invoices/${ligne.entity_id}`
          : ligne.entity_type === 'quote' && ligne.entity_id ? `/quotes/${ligne.entity_id}` : null;
        const { error: notifErr } = await admin.from('notifications').insert({
          org_id: ligne.org_id,
          type: 'email_bounced',
          title: statut === 'bounced' ? `Courriel non livré à ${ligne.to_email}` : `Plainte pourriel de ${ligne.to_email}`,
          body: detail ? String(detail).slice(0, 300) : 'Vérifiez l’adresse du client et renvoyez le document.',
          icon: 'alert-triangle',
          ...(lien ? { link: lien } : {}),
          ...(ligne.entity_id ? { reference_id: ligne.entity_id } : {}),
        });
        if (notifErr) logger.error('[webhooks/email] notification non créée', { error: notifErr.message });
      }
    }
  }

  return res.json({ received: true, updated: data?.length ?? 0 });
}
