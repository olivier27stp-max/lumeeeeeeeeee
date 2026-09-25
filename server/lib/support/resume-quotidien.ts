/**
 * Résumé quotidien du support dans le canal Slack central (2026-09-17).
 * ─────────────────────────────────────────────────────────────────────
 * Une conversation que Lumi règle seul n'arrive jamais dans Slack (le fil ne
 * s'ouvre qu'à l'escalade). Rafba veut tout voir sans le bruit d'un fil par
 * client : chaque matin à 7 h (Montréal), UN message dans le canal support —
 * SLACK_SUPPORT_CHANNEL_ID, jamais les canaux par entreprise — avec une
 * ligne par conversation de la veille : entreprise, personne, sujet, nombre
 * de messages, sort (réglée par Lumi, escaladée, fermée), le fil Slack quand
 * il existe, et pour celles réglées par Lumi un extrait de la demande et de
 * la réponse.
 *
 * Idempotent sans table : avant d'envoyer, on relit l'historique du canal et
 * on saute si l'en-tête du jour y est déjà (redémarrage à 7 h, deux instances).
 * Rien de tout ça n'est visible d'un client.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { isSlackConfigured, envoyerMessageSlack, lireHistoriqueSlack } from '../slack';
import { jourLocal, minuitLocal } from '../lumi/raccourcis';
import { logger } from '../logger';

export const HEURE_LOCALE_ENVOI = 7;
export const FUSEAU_SUPPORT = 'America/Montreal';
const CADENCE_MS = 10 * 60_000;
const MAX_LIGNES = 40;
const EXTRAIT = 110;

export interface TicketResume {
  id: string;
  company_name: string | null;
  user_name: string | null;
  subject: string;
  status: string;
  created_at: string;
  last_message_at: string;
  escalated_at: string | null;
  closed_at: string | null;
  slack_channel_id: string | null;
  slack_thread_ts: string | null;
}
export interface MessageResume { ticket_id: string; author: string; body: string; created_at: string; avis?: string | null }

/** La veille, dans le fuseau : son libellé et ses bornes ISO UTC [debut, fin). */
export function bornesVeille(maintenant: Date, fuseau = FUSEAU_SUPPORT): { jour: string; debut: string; fin: string } {
  const jour = jourLocal(fuseau, maintenant, -1);
  const aujourdhui = jourLocal(fuseau, maintenant, 0);
  return { jour, debut: minuitLocal(jour, fuseau), fin: minuitLocal(aujourdhui, fuseau) };
}

function jourLisible(jour: string, fuseau: string): string {
  const s = new Intl.DateTimeFormat('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: fuseau }).format(new Date(minuitLocal(jour, fuseau)));
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const extrait = (s: string) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > EXTRAIT ? `${t.slice(0, EXTRAIT - 1)}…` : t; };
const lienFil = (t: TicketResume) => (t.slack_channel_id && t.slack_thread_ts ? `https://slack.com/archives/${t.slack_channel_id}/p${t.slack_thread_ts.replace('.', '')}` : null);

/** En-tête du jour : c'est lui qu'on cherche dans l'historique pour ne pas envoyer deux fois. */
export function enTeteResume(jour: string): string {
  return `Support — ${jourLisible(jour, FUSEAU_SUPPORT)}`;
}

export function sortDuTicket(t: TicketResume, fin: string): 'lumi' | 'escalade' | 'fermee' {
  if (t.closed_at && t.closed_at < fin) return 'fermee';
  if (t.escalated_at) return 'escalade';
  return 'lumi';
}

/** Le message Slack (mrkdwn). null s'il n'y a rien eu la veille. Pur, testé. */
export function composerResume(jour: string, fin: string, tickets: TicketResume[], messages: MessageResume[]): string | null {
  if (!tickets.length) return null;
  const parTicket = new Map<string, MessageResume[]>();
  for (const m of messages) { if (!parTicket.has(m.ticket_id)) parTicket.set(m.ticket_id, []); parTicket.get(m.ticket_id)!.push(m); }
  const sorts = tickets.map((t) => sortDuTicket(t, fin));
  const n = (s: string) => sorts.filter((x) => x === s).length;
  const lignes: string[] = [];
  const mauvais = messages.filter((m) => m.avis === 'mauvais').length;
  lignes.push(`*${enTeteResume(jour)}* : ${tickets.length} conversation${tickets.length > 1 ? 's' : ''} · ${n('lumi')} réglée${n('lumi') > 1 ? 's' : ''} par Lumi · ${n('escalade')} escaladée${n('escalade') > 1 ? 's' : ''} · ${n('fermee')} fermée${n('fermee') > 1 ? 's' : ''}${mauvais ? ` · ${mauvais} 👎` : ''}`);
  const tri = [...tickets].sort((a, b) => (a.last_message_at < b.last_message_at ? 1 : -1));
  for (const t of tri.slice(0, MAX_LIGNES)) {
    const msgs = (parTicket.get(t.id) ?? []).slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    const sort = sortDuTicket(t, fin);
    const etiquette = sort === 'lumi' ? 'réglée par Lumi' : sort === 'escalade' ? 'escaladée' : 'fermée';
    const lien = lienFil(t);
    const avis = `${msgs.some((m) => m.avis === 'bon') ? ` · 👍 ${msgs.filter((m) => m.avis === 'bon').length}` : ''}${msgs.some((m) => m.avis === 'mauvais') ? ` · 👎 ${msgs.filter((m) => m.avis === 'mauvais').length}` : ''}`;
    lignes.push(`• *${t.company_name || 'Entreprise inconnue'}* · ${t.user_name || 'utilisateur'} · « ${extrait(t.subject)} » · ${msgs.length} message${msgs.length > 1 ? 's' : ''} · ${etiquette}${avis}${lien ? ` · <${lien}|fil>` : ''}`);
    if (sort === 'lumi') {
      const client = msgs.find((m) => m.author === 'client' || m.author === 'user');
      const lumi = [...msgs].reverse().find((m) => m.author === 'lumi' || m.author === 'ai' || m.author === 'assistant');
      if (client) lignes.push(`    ↳ client : « ${extrait(client.body)} »`);
      if (lumi) lignes.push(`    ↳ Lumi : « ${extrait(lumi.body)} »`);
    }
  }
  if (tri.length > MAX_LIGNES) lignes.push(`… et ${tri.length - MAX_LIGNES} autre${tri.length - MAX_LIGNES > 1 ? 's' : ''}.`);
  return lignes.join('\n');
}

/** Faut-il envoyer maintenant ? À l'heure locale d'envoi, dans sa première tranche de dix minutes. */
export function doitEnvoyerMaintenant(maintenant: Date, fuseau = FUSEAU_SUPPORT): boolean {
  const p = new Intl.DateTimeFormat('en-CA', { hourCycle: 'h23', hour: '2-digit', minute: '2-digit', timeZone: fuseau }).formatToParts(maintenant);
  const v = (t: string) => Number(p.find((x) => x.type === t)?.value ?? -1);
  return v('hour') === HEURE_LOCALE_ENVOI && v('minute') < CADENCE_MS / 60_000;
}

/** Déjà dans le canal ? On cherche l'en-tête du jour dans les messages récents. */
export function dejaEnvoye(historique: Array<{ text?: string }>, jour: string): boolean {
  const entete = enTeteResume(jour);
  return historique.some((m) => (m.text ?? '').includes(entete));
}

export async function envoyerResumeQuotidien(admin: SupabaseClient, maintenant = new Date()): Promise<'envoye' | 'rien' | 'deja' | 'sans-slack' | 'erreur'> {
  if (!isSlackConfigured()) return 'sans-slack';
  const canal = process.env.SLACK_SUPPORT_CHANNEL_ID!;
  const { jour, debut, fin } = bornesVeille(maintenant);
  try {
    const depuis = String((Date.now() - 36 * 3_600_000) / 1000);
    if (dejaEnvoye(await lireHistoriqueSlack(canal, depuis, 200), jour)) return 'deja';
    const { data: tickets, error } = await admin
      .from('support_tickets')
      .select('id, company_name, user_name, subject, status, created_at, last_message_at, escalated_at, closed_at, slack_channel_id, slack_thread_ts')
      .gte('last_message_at', debut).lt('last_message_at', fin)
      .order('last_message_at', { ascending: false }).limit(200);
    if (error) throw error;
    if (!tickets?.length) return 'rien';
    const { data: messages, error: e2 } = await admin
      .from('support_messages')
      .select('ticket_id, author, body, created_at, avis')
      .in('ticket_id', tickets.map((t: any) => t.id))
      .neq('author', 'system')
      .order('created_at', { ascending: true }).limit(2000);
    if (e2) throw e2;
    const texte = composerResume(jour, fin, tickets as TicketResume[], (messages ?? []) as MessageResume[]);
    if (!texte) return 'rien';
    await envoyerMessageSlack({ channel: canal, text: texte });
    logger.info('[support/resume] résumé quotidien envoyé', { jour, conversations: tickets.length });
    return 'envoye';
  } catch (e: any) {
    logger.error('[support/resume] résumé quotidien impossible', { error: e?.message || String(e) });
    return 'erreur';
  }
}

/** Vérifie toutes les dix minutes ; envoie une fois par jour à HEURE_LOCALE_ENVOI. */
export function demarrerResumeQuotidien(admin: () => SupabaseClient): void {
  if (!isSlackConfigured()) return;
  const t = setInterval(() => {
    if (!doitEnvoyerMaintenant(new Date())) return;
    void envoyerResumeQuotidien(admin());
  }, CADENCE_MS);
  t.unref?.();
  logger.info('[support/resume] résumé quotidien armé (7 h Montréal, canal support)');
}
