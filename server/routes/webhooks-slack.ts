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
 * Le même relais existe en RELEVÉ PÉRIODIQUE (lib/support/relais-slack.ts),
 * qui ne dépend pas de l'abonnement aux événements : ce webhook est le chemin
 * rapide, le relevé est le filet.
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
import { verifierSignatureSlack } from '../lib/slack';
import { relayerReponseSlack, type EvenementMessageSlack } from '../lib/support/relais-slack';

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

export { estReponseDansUnFil, type EvenementMessageSlack } from '../lib/support/relais-slack';

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
  relayerReponseSlack(ev).then(
    (outcome) => enregistrerRecu({ signature_ok: true, event_type: typeEv, reference: ev.thread_ts || ev.ts || null, outcome, summary: resume }),
    (err: any) => {
      logger.error('[webhooks/slack] traitement en erreur', { error: err?.message || String(err) });
      enregistrerRecu({ signature_ok: true, event_type: typeEv, reference: ev.thread_ts || ev.ts || null, outcome: `error:${String(err?.message || err).slice(0, 200)}`, summary: resume });
    },
  );
}
