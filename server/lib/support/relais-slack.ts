/**
 * Relais des réponses Slack vers le client — le cœur, partagé par deux
 * entrées :
 *   1. le webhook Events API (routes/webhooks-slack.ts), quand Slack pousse ;
 *   2. le RELEVÉ PÉRIODIQUE (`demarrerReleveSlack`), qui relit les fils des
 *      tickets ouverts avec `conversations.replies`. Il ne dépend d'aucun
 *      abonnement aux événements : seul le jeton du bot est nécessaire
 *      (scope channels:history). Ajouté le 2026-09-15 après constat que
 *      Slack ne livrait aucun événement à l'URL (webhook_receipts vide).
 *
 * Les deux chemins passent par `relayerReponseSlack` ; l'index unique
 * (ticket_id, slack_ts) absorbe les doublons entre eux.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient } from '../supabase';
import { logger } from '../logger';
import { isSlackConfigured, identiteBot, nomUtilisateurSlack, texteDepuisSlack, lireRepliquesSlack } from '../slack';
import { ajouterMessage, notifierClientReponse, type Ticket } from './tickets';

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

/**
 * Relaie une réponse Slack au client si c'en est une. Retourne un verdict
 * lisible (journalisé dans webhook_receipts par le webhook).
 */
export async function relayerReponseSlack(e: EvenementMessageSlack, ticketConnu?: Ticket): Promise<string> {
  const bot = await identiteBot();
  if (!estReponseDansUnFil(e, bot)) return 'ignored:not-a-thread-reply';
  const admin = getServiceClient();
  let t = ticketConnu || null;
  if (!t) {
    const { data: ticket, error } = await admin.from('support_tickets').select('*').eq('slack_channel_id', e.channel).eq('slack_thread_ts', e.thread_ts).maybeSingle();
    if (error) { logger.error('[support/relais] lecture du ticket impossible', { error: error.message }); return `error:${error.message}`; }
    if (!ticket) return 'ignored:unknown-thread'; // un fil qui n'est pas un ticket : rien à faire
    t = ticket as Ticket;
  }
  if (t.status === 'closed') return 'ignored:closed';

  const auteur = e.user ? await nomUtilisateurSlack(e.user) : 'Support';
  const corps = texteDepuisSlack(e.text || '');
  if (!corps) return 'ignored:empty';
  const m = await ajouterMessage(admin, { ticket: t, author: 'agent', body: corps, authorName: auteur, slackTs: e.ts });
  if (!m) return 'ignored:duplicate'; // déjà enregistré (rejeu Slack, ou l'autre chemin)
  await admin.from('support_tickets').update({ status: 'answered' }).eq('id', t.id).neq('status', 'closed');
  await notifierClientReponse(admin, t, corps, auteur);
  logger.info('[support/relais] réponse relayée au client', { ticketId: t.id, auteur });
  return 'relayed';
}

// ── Relevé périodique ────────────────────────────────────────

/** Fenêtre : on ne relit que les fils des tickets encore vivants et récents. */
const FENETRE_JOURS = 14;
const MAX_TICKETS_PAR_PASSAGE = 40;

/** Un passage : relit chaque fil ouvert et relaie ce qui n'y est pas encore. Retourne le nombre relayé. */
export async function releverReponsesSlack(admin: SupabaseClient = getServiceClient()): Promise<number> {
  if (!isSlackConfigured()) return 0;
  const depuis = new Date(Date.now() - FENETRE_JOURS * 86_400_000).toISOString();
  const { data: tickets, error } = await admin
    .from('support_tickets')
    .select('*')
    .in('status', ['open', 'answered'])
    .not('slack_thread_ts', 'is', null)
    .gte('last_message_at', depuis)
    .order('last_message_at', { ascending: false })
    .limit(MAX_TICKETS_PAR_PASSAGE);
  if (error) { logger.error('[support/relais] lecture des tickets impossible', { error: error.message }); return 0; }
  let relayes = 0;
  for (const t of (tickets || []) as Ticket[]) {
    if (!t.slack_channel_id || !t.slack_thread_ts) continue;
    try {
      // Ce qu'on a déjà : les réponses agent déjà enregistrées (par ts Slack).
      const { data: connus } = await admin.from('support_messages').select('slack_ts').eq('ticket_id', t.id).not('slack_ts', 'is', null);
      const deja = new Set((connus || []).map((m: any) => String(m.slack_ts)));
      const repliques = await lireRepliquesSlack(t.slack_channel_id, t.slack_thread_ts);
      for (const r of repliques) {
        if (!r.ts || r.ts === t.slack_thread_ts || deja.has(r.ts)) continue;
        const verdict = await relayerReponseSlack({ type: 'message', channel: t.slack_channel_id, subtype: r.subtype, user: r.user, bot_id: r.bot_id, text: r.text, ts: r.ts, thread_ts: t.slack_thread_ts }, t);
        if (verdict === 'relayed') relayes += 1;
      }
    } catch (e: any) {
      logger.error('[support/relais] relevé impossible pour un ticket', { ticketId: t.id, error: e?.message || String(e) });
    }
  }
  // Canaux clients : ce que l'équipe écrit au premier niveau va au dernier ticket ouvert de l'entreprise.
  try {
    const { messagesCanauxClients } = await import('./canaux-slack');
    for (const { canal, ticket, message } of await messagesCanauxClients(admin)) {
      const verdict = await relayerReponseSlack({ type: 'message', channel: canal.channel_id, subtype: message.subtype, user: message.user, bot_id: message.bot_id, text: message.text, ts: message.ts, thread_ts: ticket.slack_thread_ts || `0.${message.ts}` }, ticket);
      if (verdict === 'relayed') relayes += 1;
    }
  } catch (e: any) {
    logger.error('[support/relais] relevé des canaux clients en erreur', { error: e?.message || String(e) });
  }
  if (relayes) logger.info('[support/relais] relevé Slack', { relayes });
  return relayes;
}

/** Cadence du relevé (ms). `SLACK_POLL_MS=0` le désactive ; défaut 45 s. */
export function cadenceReleveMs(env: NodeJS.ProcessEnv = process.env): number {
  if (env.SLACK_POLL_MS === '0') return 0;
  const v = Number(env.SLACK_POLL_MS);
  return Number.isFinite(v) && v >= 10_000 ? v : 45_000;
}

export function demarrerReleveSlack(): void {
  if ((globalThis as any).__lumeReleveSlackDemarre) return;
  (globalThis as any).__lumeReleveSlackDemarre = true;
  const cadence = cadenceReleveMs();
  if (!cadence || !isSlackConfigured()) {
    logger.info('[support/relais] relevé Slack inactif (Slack non configuré ou SLACK_POLL_MS=0)');
    return;
  }
  logger.info('[support/relais] relevé des fils Slack actif', { cadenceMs: cadence });
  let enCours = false;
  const passage = async () => {
    if (enCours) return; // un passage lent ne doit pas s'empiler sur le suivant
    enCours = true;
    try { await releverReponsesSlack(); } catch (e: any) { logger.error('[support/relais] passage en erreur', { error: e?.message || String(e) }); } finally { enCours = false; }
  };
  setTimeout(() => { void passage(); }, 5_000);
  setInterval(() => { void passage(); }, cadence);

  // Archivage des canaux clients inactifs : une fois par heure suffit.
  const archivage = async () => {
    try {
      const { archiverCanauxInactifs } = await import('./canaux-slack');
      await archiverCanauxInactifs(getServiceClient());
    } catch (e: any) { logger.error('[support/canaux] archivage en erreur', { error: e?.message || String(e) }); }
  };
  setTimeout(() => { void archivage(); }, 60_000);
  setInterval(() => { void archivage(); }, 60 * 60_000);
}
