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
import { isSlackConfigured, identiteBot, nomUtilisateurSlack, texteDepuisSlack, lireRepliquesSlack, accuserLivraisonSlack } from '../slack';
import { ajouterMessage, notifierClientReponse, messagesDuTicket, type Ticket } from './tickets';
import { texteAApprendre, questionDuTicket, apprendre, accuserApprentissage, dejaAppris } from './savoir';

/**
 * Un message Slack traité sans être relayé (note interne, 📌 retenu) est
 * quand même enregistré, comme message « system » portant son ts : le relevé
 * périodique (toutes les 45 s) ne le revoit plus, donc pas d'accusé répété
 * dans le fil. Invisible du client (vue() et le transcript filtrent system).
 * N'avance pas last_message_at : ce n'est pas une activité de la conversation.
 */
async function marquerTraiteSlack(admin: SupabaseClient, t: Ticket, ts: string | undefined, quoi: string): Promise<void> {
  if (!ts) return;
  const { error } = await admin.from('support_messages').insert({ ticket_id: t.id, org_id: t.org_id, author: 'system', author_name: null, body: quoi, slack_ts: ts });
  if (error && error.code !== '23505') logger.error('[support/relais] marquage impossible', { ticketId: t.id, error: error.message });
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

/**
 * Note interne : un message du fil qui parle à l'ÉQUIPE, pas au client — il ne
 * doit jamais lui être relayé (vu le 2026-09-17 : une relance de suivi
 * « Relance 36h+ — toujours ouvert, pas de réponse produit… À faire : répondre
 * dans ce fil… puis on close » est partie telle quelle à l'abonné).
 * Deux façons de marquer une note interne :
 *  - explicite : commencer par 🔒, « [interne] », « interne : », « note interne », « // » ou « #interne » ;
 *  - reconnue : les gabarits de suivi (« Relance 36h+ », « À faire : », « puis on close »,
 *    « pas de réponse produit », « Compte : à enrichir », « Sent using »).
 * Pur, testable.
 */
export function estNoteInterne(texte: string): boolean {
  const t = texte.trim();
  if (!t) return false;
  if (/^(?:🔒|\[interne\]|interne\s*:|note interne\b|\/\/|#interne\b|\[internal\]|internal\s*:|📌|:pushpin:|@?lumi[, ]+retiens)/i.test(t)) return true;
  if (/^relance\s+\d+\s*[hj]\+?\b/i.test(t)) return true;
  const marqueurs = [/\bà faire\s*:/i, /\bpuis on close\b/i, /\bon close\b/i, /pas de réponse produit/i, /compte\s*:\s*à enrichir/i, /\bsent using\b/i, /\btoujours ouvert\b.*\b(?:relance|réponse)/i];
  return marqueurs.filter((m) => m.test(t)).length >= 1 && (/\brelance\b|\bà faire\b|\bclose\b|sent using/i.test(t));
}

/**
 * Bots tiers dont les réponses de fil sont relayées au client (agents Grok…),
 * par leur bot_id Slack, séparés par des virgules : SLACK_BOTS_RELAYES.
 * Tout autre bot ou workflow Slack (relances de suivi, rappels, intégrations)
 * parle à l'équipe, jamais au client — c'est un workflow qui a fait fuir une
 * relance interne le 2026-09-17.
 */
export function botsRelayes(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  return new Set(String(env.SLACK_BOTS_RELAYES || '').split(',').map((x) => x.trim()).filter(Boolean));
}

/** Ce message est-il une réponse humaine (ou d'un bot tiers autorisé) dans un fil de ticket ? Pur, testable. */
export function estReponseDansUnFil(e: EvenementMessageSlack, bot: { user_id: string; bot_id: string | null }, autorises: ReadonlySet<string> = botsRelayes()): boolean {
  if (e.type !== 'message') return false;
  if (!e.thread_ts || !e.ts || e.thread_ts === e.ts) return false; // pas un message de fil, ou le parent lui-même
  if (e.subtype && e.subtype !== 'bot_message' && e.subtype !== 'file_share' && e.subtype !== 'thread_broadcast') return false; // édité, supprimé, joined…
  if (e.user && e.user === bot.user_id) return false;
  if (e.bot_id && bot.bot_id && e.bot_id === bot.bot_id) return false;
  // Un bot ou un workflow Slack : relayé seulement s'il est nommément autorisé.
  if (e.bot_id || e.subtype === 'bot_message') { if (!e.bot_id || !autorises.has(e.bot_id)) return false; }
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
  // « 📌 … » / « Lumi, retiens : … » : l'équipe apprend quelque chose à Lumi — retenu, jamais envoyé au client.
  const aApprendre = texteAApprendre(corps);
  if (aApprendre) {
    const verdict = await apprendre(admin, { question: questionDuTicket(t, await messagesDuTicket(admin, t.id)), reponse: aApprendre, auteur, ticketId: t.id, channel: e.channel, ts: e.ts });
    await marquerTraiteSlack(admin, t, e.ts, `slack:retenu:${verdict}`);
    if (e.channel && e.ts && verdict !== 'deja') await accuserApprentissage(e.channel, e.ts, verdict);
    return `learned:${verdict}`;
  }
  // Une note interne reste dans Slack : marquée 🔒 dans le fil pour que l'équipe voie qu'elle n'est pas partie.
  if (estNoteInterne(corps)) {
    logger.info('[support/relais] note interne non relayée', { ticketId: t.id });
    await marquerTraiteSlack(admin, t, e.ts, 'slack:note-interne');
    if (e.channel && e.ts) await accuserLivraisonSlack(e.channel, e.ts, false, 'Note interne : pas envoyée au client (commence par 🔒 ou [interne] pour être sûr).');
    return 'ignored:internal-note';
  }
  const m = await ajouterMessage(admin, { ticket: t, author: 'agent', body: corps, authorName: auteur, slackTs: e.ts });
  if (!m) return 'ignored:duplicate'; // déjà enregistré (rejeu Slack, ou l'autre chemin)
  await admin.from('support_tickets').update({ status: 'answered' }).eq('id', t.id).neq('status', 'closed');
  await notifierClientReponse(admin, t, corps, auteur);
  logger.info('[support/relais] réponse relayée au client', { ticketId: t.id, auteur });
  // ✅ sur le message dans Slack : c'est comme ça qu'on SAIT que c'est rendu au client.
  if (e.channel && e.ts) await accuserLivraisonSlack(e.channel, e.ts, true, `Livré à ${t.user_name || 'le client'} (dans l’app + courriel)`);
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
        // Réaction 📌 sur une réponse humaine (déjà relayée ou non) : l'équipe veut que Lumi la retienne.
        if (r.ts && r.text && r.user && r.reactions?.some((x) => x.name === 'pushpin') && !dejaAppris(t.slack_channel_id, r.ts)) {
          const reponse = texteDepuisSlack(r.text);
          if (reponse && !texteAApprendre(reponse) && !estNoteInterne(reponse)) {
            const verdict = await apprendre(admin, { question: questionDuTicket(t, await messagesDuTicket(admin, t.id)), reponse, auteur: await nomUtilisateurSlack(r.user), ticketId: t.id, channel: t.slack_channel_id, ts: r.ts });
            await accuserApprentissage(t.slack_channel_id, r.ts, verdict);
          }
        }
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
      const { fermerTicketsInactifs } = await import('./tickets');
      await fermerTicketsInactifs(getServiceClient());   // conversations sans suite → fermées (le client peut rouvrir)
      await archiverCanauxInactifs(getServiceClient()); // puis canaux sans conversation vivante → archivés
    } catch (e: any) { logger.error('[support/canaux] archivage en erreur', { error: e?.message || String(e) }); }
  };
  setTimeout(() => { void archivage(); }, 60_000);
  setInterval(() => { void archivage(); }, 60 * 60_000);
}
