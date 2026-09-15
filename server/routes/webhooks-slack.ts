/**
 * webhooks-slack.ts — les réponses du support humain, depuis Slack.
 *
 * Slack (Events API, abonnement `message.channels` — et `message.groups` si
 * le canal est privé) pousse ici chaque message du canal support. On ne garde
 * que les réponses DANS UN FIL ouvert par nous (thread_ts = un ticket), qui ne
 * viennent pas de notre propre bot. Le message est ajouté au ticket, le client
 * est prévenu dans l'app et par courriel. Un autre bot branché sur le canal
 * (Grok…) est traité comme un humain : sa réponse part au client.
 *
 * Signature `x-slack-signature` (HMAC-SHA256, v0) vérifiée sur le CORPS BRUT,
 * ±5 min : la route est montée AVANT express.json(), comme Stripe et Resend.
 * Slack exige une réponse en 3 s et rejoue sinon : on répond 200 tout de
 * suite et on traite après ; l'index unique (ticket, slack_ts) absorbe les
 * rejeux.
 *
 * Env : SLACK_SIGNING_SECRET. Sans lui, 503 — jamais « OK » sur un webhook
 * non vérifié.
 */
import type express from 'express';
import { getServiceClient } from '../lib/supabase';
import { logger } from '../lib/logger';
import { verifierSignatureSlack, identiteBot, nomUtilisateurSlack, texteDepuisSlack } from '../lib/slack';
import { ajouterMessage, notifierClientReponse, type Ticket } from '../lib/support/tickets';

export interface EvenementMessageSlack {
  type: string;
  subtype?: string;
  channel?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
}

/** Ce message est-il une réponse humaine (ou d'un autre bot) dans un fil de ticket ? Pur, testable. */
export function estReponseDansUnFil(e: EvenementMessageSlack, bot: { user_id: string; bot_id: string | null }): boolean {
  if (e.type !== 'message') return false;
  if (!e.thread_ts || !e.ts || e.thread_ts === e.ts) return false; // pas un message de fil, ou le parent lui-même
  if (e.subtype && e.subtype !== 'bot_message' && e.subtype !== 'file_share' && e.subtype !== 'thread_broadcast') return false; // édité, supprimé, joined…
  if (e.user && e.user === bot.user_id) return false;
  if (e.bot_id && bot.bot_id && e.bot_id === bot.bot_id) return false;
  return !!(e.text && e.text.trim());
}

async function traiter(e: EvenementMessageSlack): Promise<void> {
  const bot = await identiteBot();
  if (!estReponseDansUnFil(e, bot)) return;
  const admin = getServiceClient();
  const { data: ticket, error } = await admin.from('support_tickets').select('*').eq('slack_channel_id', e.channel).eq('slack_thread_ts', e.thread_ts).maybeSingle();
  if (error) { logger.error('[webhooks/slack] lecture du ticket impossible', { error: error.message }); return; }
  if (!ticket) return; // un fil qui n'est pas un ticket : rien à faire
  const t = ticket as Ticket;
  if (t.status === 'closed') return;

  const auteur = e.user ? await nomUtilisateurSlack(e.user) : 'Support';
  const corps = texteDepuisSlack(e.text || '');
  if (!corps) return;
  const m = await ajouterMessage(admin, { ticket: t, author: 'agent', body: corps, authorName: auteur, slackTs: e.ts });
  if (!m) return; // rejeu Slack : déjà enregistré
  await admin.from('support_tickets').update({ status: 'answered' }).eq('id', t.id).neq('status', 'closed');
  await notifierClientReponse(admin, t, corps, auteur);
  logger.info('[webhooks/slack] réponse relayée au client', { ticketId: t.id, auteur });
}

export async function slackWebhookHandler(req: express.Request, res: express.Response) {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) {
    logger.error('[webhooks/slack] SLACK_SIGNING_SECRET absent — webhook refusé');
    return res.status(503).json({ error: 'Slack webhook not configured.' });
  }
  const corps: Buffer | string = Buffer.isBuffer(req.body) ? req.body : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));
  const valide = verifierSignatureSlack({ signature: req.header('x-slack-signature'), timestamp: req.header('x-slack-request-timestamp') }, corps, secret);
  if (!valide) return res.status(401).json({ error: 'Invalid signature.' });

  let charge: any;
  try { charge = JSON.parse(typeof corps === 'string' ? corps : corps.toString('utf8')); } catch { return res.status(400).json({ error: 'Invalid JSON.' }); }

  // Poignée de main à la création de l'abonnement (Slack vérifie l'URL).
  if (charge?.type === 'url_verification') return res.status(200).json({ challenge: charge.challenge });

  // Réponse immédiate (Slack rejoue au-delà de 3 s), traitement ensuite.
  res.status(200).json({ ok: true });
  if (charge?.type !== 'event_callback' || !charge.event) return;
  traiter(charge.event as EvenementMessageSlack).catch((err: any) => {
    logger.error('[webhooks/slack] traitement en erreur', { error: err?.message || String(err) });
  });
}
