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

/**
 * Trace de chaque appel reçu (table webhook_receipts, service_role) : quand
 * « Slack n'appelle pas », c'est le seul témoin lisible sans les logs Railway.
 * Best-effort : ne bloque jamais la réponse.
 */
function enregistrerRecu(r: { signature_ok: boolean | null; event_type: string | null; reference: string | null; outcome: string; summary?: Record<string, unknown> }): void {
  getServiceClient().from('webhook_receipts').insert({ provider: 'slack', ...r, summary: r.summary || {} }).then(({ error }) => {
    if (error) logger.warn('[webhooks/slack] trace non écrite', { error: error.message });
  }, (err: any) => logger.warn('[webhooks/slack] trace non écrite', { error: err?.message }));
}

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

async function traiter(e: EvenementMessageSlack): Promise<string> {
  const bot = await identiteBot();
  if (!estReponseDansUnFil(e, bot)) return 'ignored:not-a-thread-reply';
  const admin = getServiceClient();
  const { data: ticket, error } = await admin.from('support_tickets').select('*').eq('slack_channel_id', e.channel).eq('slack_thread_ts', e.thread_ts).maybeSingle();
  if (error) { logger.error('[webhooks/slack] lecture du ticket impossible', { error: error.message }); return `error:${error.message}`; }
  if (!ticket) return 'ignored:unknown-thread'; // un fil qui n'est pas un ticket : rien à faire
  const t = ticket as Ticket;
  if (t.status === 'closed') return 'ignored:closed';

  const auteur = e.user ? await nomUtilisateurSlack(e.user) : 'Support';
  const corps = texteDepuisSlack(e.text || '');
  if (!corps) return 'ignored:empty';
  const m = await ajouterMessage(admin, { ticket: t, author: 'agent', body: corps, authorName: auteur, slackTs: e.ts });
  if (!m) return 'ignored:duplicate'; // rejeu Slack : déjà enregistré
  await admin.from('support_tickets').update({ status: 'answered' }).eq('id', t.id).neq('status', 'closed');
  await notifierClientReponse(admin, t, corps, auteur);
  logger.info('[webhooks/slack] réponse relayée au client', { ticketId: t.id, auteur });
  return 'relayed';
}

export async function slackWebhookHandler(req: express.Request, res: express.Response) {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) {
    logger.error('[webhooks/slack] SLACK_SIGNING_SECRET absent — webhook refusé');
    return res.status(503).json({ error: 'Slack webhook not configured.' });
  }
  const corps: Buffer | string = Buffer.isBuffer(req.body) ? req.body : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));
  const valide = verifierSignatureSlack({ signature: req.header('x-slack-signature'), timestamp: req.header('x-slack-request-timestamp') }, corps, secret);
  if (!valide) {
    enregistrerRecu({ signature_ok: false, event_type: null, reference: null, outcome: 'rejected:signature', summary: { has_signature: !!req.header('x-slack-signature'), has_timestamp: !!req.header('x-slack-request-timestamp'), retry: req.header('x-slack-retry-num') || null } });
    return res.status(401).json({ error: 'Invalid signature.' });
  }

  let charge: any;
  try { charge = JSON.parse(typeof corps === 'string' ? corps : corps.toString('utf8')); } catch { return res.status(400).json({ error: 'Invalid JSON.' }); }

  // Poignée de main à la création de l'abonnement (Slack vérifie l'URL).
  if (charge?.type === 'url_verification') {
    enregistrerRecu({ signature_ok: true, event_type: 'url_verification', reference: null, outcome: 'challenge' });
    return res.status(200).json({ challenge: charge.challenge });
  }

  // Réponse immédiate (Slack rejoue au-delà de 3 s), traitement ensuite.
  res.status(200).json({ ok: true });
  const ev = charge?.event as EvenementMessageSlack | undefined;
  const typeEv = `${charge?.type || '?'}${ev?.type ? ':' + ev.type : ''}${ev?.subtype ? '/' + ev.subtype : ''}`;
  const resume = { event_id: charge?.event_id || null, channel: ev?.channel || null, ts: ev?.ts || null, thread_ts: ev?.thread_ts || null, user: ev?.user || null, bot_id: ev?.bot_id || null, retry: req.header('x-slack-retry-num') || null };
  if (charge?.type !== 'event_callback' || !ev) { enregistrerRecu({ signature_ok: true, event_type: typeEv, reference: null, outcome: 'ignored:not-event', summary: resume }); return; }
  traiter(ev).then(
    (outcome) => enregistrerRecu({ signature_ok: true, event_type: typeEv, reference: ev.thread_ts || ev.ts || null, outcome, summary: resume }),
    (err: any) => {
      logger.error('[webhooks/slack] traitement en erreur', { error: err?.message || String(err) });
      enregistrerRecu({ signature_ok: true, event_type: typeEv, reference: ev.thread_ts || ev.ts || null, outcome: `error:${String(err?.message || err).slice(0, 200)}`, summary: resume });
    },
  );
}
