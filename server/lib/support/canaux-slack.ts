/**
 * Un canal Slack par entreprise cliente.
 *
 * À la première escalade d'une entreprise, le bot crée `#client-<entreprise>`,
 * y invite les membres de #support, et y poste l'en-tête du ticket avec la
 * conversation déjà eue avec l'assistant. Les demandes suivantes de la même
 * entreprise arrivent dans le même canal. #support ne reçoit qu'une ligne
 * de renvoi (« 🚨 Plomberie Tremblay → #client-plomberie-tremblay : … »).
 *
 * Dans ce canal, Rafba (ou un bot) écrit au premier niveau, comme dans une
 * conversation : chaque message humain part au DERNIER ticket ouvert de
 * l'entreprise (`ticketPourMessageCanal`), ou en ouvre un si aucun ne l'est
 * (message proactif : le client le voit dans Lume et par courriel). Les
 * réponses en fil restent honorées (relevé des fils, relais-slack.ts).
 *
 * Scope Slack requis pour créer/inviter : `channels:manage` (canaux publics).
 * Sans lui, `canalClient` échoue → l'escalade retombe sur un fil dans
 * #support, comme avant, et le journal dit pourquoi.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger';
import {
  canalSupport, creerCanalSlack, inviterDansCanal, membresDuCanal, definirSujetCanal, envoyerMessageSlack, lireHistoriqueSlack, identiteBot, echapperSlack,
  archiverCanalSlack, desarchiverCanalSlack, accuserLivraisonSlack,
} from '../slack';
import { ajouterMessage, type Ticket } from './tickets';

export interface CanalClient { org_id: string; channel_id: string; channel_name: string; last_seen_ts: string | null; archived_at?: string | null }

/** `client-plomberie-tremblay` : minuscules, sans accent, tirets, ≤ 60 caractères (Slack : 80 max). Pur, testé. */
export function nomCanalPour(companyName: string): string {
  const base = companyName
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
  return `client-${base || 'sans-nom'}`;
}

export async function canalClientExistant(admin: SupabaseClient, orgId: string): Promise<CanalClient | null> {
  const { data } = await admin.from('support_slack_channels').select('org_id, channel_id, channel_name, last_seen_ts, archived_at').eq('org_id', orgId).maybeSingle();
  return (data as CanalClient) || null;
}

/** Un canal archivé (client inactif) revient dans la barre latérale dès qu'on doit y écrire. */
export async function desarchiverSiBesoin(admin: SupabaseClient, canal: CanalClient): Promise<CanalClient> {
  if (!canal.archived_at) return canal;
  await desarchiverCanalSlack(canal.channel_id);
  await admin.from('support_slack_channels').update({ archived_at: null }).eq('org_id', canal.org_id);
  logger.info('[support/canaux] canal client désarchivé', { channel: canal.channel_name });
  return { ...canal, archived_at: null };
}

/** Le canal de l'entreprise, créé au besoin (ou désarchivé). Lève si Slack refuse (scope manquant…). */
export async function canalClient(admin: SupabaseClient, orgId: string, companyName: string, planLabel: string): Promise<CanalClient> {
  const existant = await canalClientExistant(admin, orgId);
  if (existant) return desarchiverSiBesoin(admin, existant);

  const cree = await creerCanalSlack(nomCanalPour(companyName));
  try {
    await definirSujetCanal(cree.id, `${companyName} · forfait ${planLabel} · support Lume (le client répond dans l’app)`);
  } catch (e: any) {
    logger.warn('[support/canaux] sujet du canal non défini', { channel: cree.id, error: e?.message });
  }
  // Les gens de #support suivent le nouveau canal (jamais le bot lui-même).
  try {
    const bot = await identiteBot();
    const membres = (await membresDuCanal(canalSupport())).filter((u) => u !== bot.user_id);
    if (membres.length) await inviterDansCanal(cree.id, membres);
  } catch (e: any) {
    logger.warn('[support/canaux] invitation des membres de #support impossible', { channel: cree.id, error: e?.message });
  }

  const { data, error } = await admin.from('support_slack_channels')
    .insert({ org_id: orgId, channel_id: cree.id, channel_name: cree.name })
    .select('org_id, channel_id, channel_name, last_seen_ts').single();
  if (error) {
    // Course entre deux escalades : l'autre a gagné, on lit la sienne.
    const deja = await canalClientExistant(admin, orgId);
    if (deja) return deja;
    throw new Error(`support_slack_channels insert : ${error.message}`);
  }
  logger.info('[support/canaux] canal client créé', { orgId, channel: cree.name });
  return data as CanalClient;
}

/** Une ligne dans #support pour dire où ça se passe. Best-effort. */
export async function signalerDansSupport(t: Ticket, canal: CanalClient, titre: string): Promise<void> {
  try {
    const tag = t.priority === 'priority' ? ':rotating_light:' : ':speech_balloon:';
    await envoyerMessageSlack({ channel: canalSupport(), text: `${tag} *${echapperSlack(t.company_name || '')}* → <#${canal.channel_id}> : ${echapperSlack(titre)}` });
  } catch (e: any) {
    logger.warn('[support/canaux] renvoi dans #support non posté', { error: e?.message });
  }
}

/** Jours sans demande ouverte avant d'archiver le canal d'un client. `SLACK_ARCHIVE_APRES_JOURS=0` désactive ; défaut 7. */
export function joursAvantArchivage(env: NodeJS.ProcessEnv = process.env): number {
  if (env.SLACK_ARCHIVE_APRES_JOURS === '0') return 0;
  const v = Number(env.SLACK_ARCHIVE_APRES_JOURS);
  return Number.isFinite(v) && v >= 1 ? v : 7;
}

/**
 * Archive les canaux des clients sans demande vivante depuis N jours : ils
 * sortent de la barre latérale (l'historique reste lisible dans Slack) et
 * reviennent d'eux-mêmes à la prochaine demande (`canalClient`). Retourne le
 * nombre archivé.
 */
export async function archiverCanauxInactifs(admin: SupabaseClient, jours: number = joursAvantArchivage()): Promise<number> {
  if (!jours) return 0;
  const { data: canaux, error } = await admin.from('support_slack_channels').select('org_id, channel_id, channel_name, last_seen_ts, archived_at').is('archived_at', null);
  if (error) { logger.error('[support/canaux] lecture des canaux impossible', { error: error.message }); return 0; }
  const limite = new Date(Date.now() - jours * 86_400_000).toISOString();
  let archives = 0;
  for (const c of (canaux || []) as CanalClient[]) {
    try {
      // Vivant = un ticket non fermé, ou n'importe quel message depuis moins de N jours.
      const { data: vivant } = await admin.from('support_tickets').select('id').eq('org_id', c.org_id)
        .or(`status.in.(ai,open,answered),last_message_at.gte.${limite}`).limit(1).maybeSingle();
      if (vivant) continue;
      await archiverCanalSlack(c.channel_id);
      await admin.from('support_slack_channels').update({ archived_at: new Date().toISOString() }).eq('org_id', c.org_id);
      archives += 1;
      logger.info('[support/canaux] canal client archivé (inactif)', { channel: c.channel_name, jours });
    } catch (e: any) {
      logger.error('[support/canaux] archivage impossible', { channel: c.channel_name, error: e?.message || String(e) });
    }
  }
  return archives;
}

/**
 * Le ticket visé par un message écrit au premier niveau d'un canal client :
 * le dernier ticket non fermé de l'entreprise ; sinon un nouveau ticket
 * (message proactif de l'équipe), adressé au dernier demandeur connu.
 */
export async function ticketPourMessageCanal(admin: SupabaseClient, orgId: string, premiereLigne: string): Promise<Ticket | null> {
  const { data: ouvert } = await admin.from('support_tickets').select('*').eq('org_id', orgId).in('status', ['open', 'answered']).order('last_message_at', { ascending: false }).limit(1).maybeSingle();
  if (ouvert) return ouvert as Ticket;
  const { data: dernier } = await admin.from('support_tickets').select('*').eq('org_id', orgId).order('last_message_at', { ascending: false }).limit(1).maybeSingle();
  if (!dernier) return null; // jamais de ticket : on ne sait pas à qui écrire
  const d = dernier as Ticket;
  const { data: neuf, error } = await admin.from('support_tickets').insert({
    org_id: orgId, user_id: d.user_id, subject: premiereLigne.slice(0, 120) || 'Message de l’équipe Lume', priority: d.priority, plan_slug: d.plan_slug, sla_key: d.sla_key,
    status: 'answered', company_name: d.company_name, user_email: d.user_email, user_name: d.user_name,
    slack_channel_id: d.slack_channel_id, escalated_at: new Date().toISOString(), escalation_reason: 'Message proactif de l’équipe (Slack)', source: 'app',
  }).select('*').single();
  if (error) { logger.error('[support/canaux] ticket proactif impossible', { orgId, error: error.message }); return null; }
  await ajouterMessage(admin, { ticket: neuf as Ticket, author: 'system', body: 'opened:slack-proactive' });
  return neuf as Ticket;
}

/**
 * Relevé des canaux clients : les messages écrits au premier niveau depuis le
 * dernier passage. Retourne les événements à relayer, avec le ticket visé —
 * le relais lui-même (dédoublonnage, notification) est fait par l'appelant.
 */
export async function messagesCanauxClients(admin: SupabaseClient): Promise<Array<{ canal: CanalClient; ticket: Ticket; message: { ts: string; user?: string; bot_id?: string; subtype?: string; text?: string } }>> {
  const { data: canaux, error } = await admin.from('support_slack_channels').select('org_id, channel_id, channel_name, last_seen_ts, archived_at').is('archived_at', null).order('created_at', { ascending: false }).limit(100);
  if (error) { logger.error('[support/canaux] lecture des canaux impossible', { error: error.message }); return []; }
  const bot = await identiteBot();
  const sortie: Array<{ canal: CanalClient; ticket: Ticket; message: { ts: string; user?: string; bot_id?: string; subtype?: string; text?: string } }> = [];
  for (const c of (canaux || []) as CanalClient[]) {
    try {
      const messages = await lireHistoriqueSlack(c.channel_id, c.last_seen_ts || undefined);
      if (!messages.length) continue;
      let dernierTs = c.last_seen_ts || '0';
      for (const m of messages.sort((a, b) => Number(a.ts) - Number(b.ts))) {
        if (Number(m.ts) > Number(dernierTs)) dernierTs = m.ts;
        if (m.thread_ts && m.thread_ts !== m.ts) continue;               // réponse de fil : le relevé des fils s'en charge
        if (m.user === bot.user_id || (m.bot_id && m.bot_id === bot.bot_id)) continue; // nos propres messages
        if (m.subtype && m.subtype !== 'bot_message' && m.subtype !== 'file_share') continue; // joined, topic, edits…
        if (!m.text || !m.text.trim()) continue;
        const ticket = await ticketPourMessageCanal(admin, c.org_id, m.text.split('\n')[0]);
        if (!ticket) { await accuserLivraisonSlack(c.channel_id, m.ts, false, 'Non livré : ce client n’a encore jamais écrit au support, je ne sais pas à qui l’envoyer.'); continue; }
        sortie.push({ canal: c, ticket, message: m });
      }
      if (dernierTs !== (c.last_seen_ts || '0')) {
        await admin.from('support_slack_channels').update({ last_seen_ts: dernierTs }).eq('org_id', c.org_id);
      }
    } catch (e: any) {
      logger.error('[support/canaux] relevé impossible pour un canal', { channel: c.channel_name, error: e?.message || String(e) });
    }
  }
  return sortie;
}
