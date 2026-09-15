/**
 * Slack — le canal du support humain.
 *
 * Un seul usage : le support. Une demande escaladée ouvre un FIL dans le canal
 * `SLACK_SUPPORT_CHANNEL_ID` ; les réponses écrites dans ce fil (par Rafba, ou
 * par un bot branché sur le canal) reviennent au client par le webhook
 * `POST /api/webhooks/slack` (voir routes/webhooks-slack.ts).
 *
 * Pas de SDK : trois appels HTTP (chat.postMessage, users.info, auth.test) et
 * une signature HMAC. Env :
 *   SLACK_BOT_TOKEN            xoxb-… (scopes : chat:write, channels:history,
 *                              channels:read, channels:manage (un canal par
 *                              entreprise cliente), users:read)
 *   SLACK_SIGNING_SECRET       vérifie chaque webhook entrant
 *   SLACK_SUPPORT_CHANNEL_ID   C0…  (le canal, pas son nom)
 * Sans les trois : `isSlackConfigured()` = false et le support retombe sur le
 * courriel, comme avant.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { logger } from './logger';

const API = 'https://slack.com/api';
const TOLERANCE_S = 5 * 60;

export function isSlackConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!(env.SLACK_BOT_TOKEN && env.SLACK_SIGNING_SECRET && env.SLACK_SUPPORT_CHANNEL_ID);
}

export function canalSupport(env: NodeJS.ProcessEnv = process.env): string {
  return env.SLACK_SUPPORT_CHANNEL_ID || '';
}

async function appel<T = any>(methode: string, corps: Record<string, unknown> | null, query?: Record<string, string>): Promise<T> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error('SLACK_BOT_TOKEN absent');
  const url = `${API}/${methode}${query ? `?${new URLSearchParams(query)}` : ''}`;
  const res = await fetch(url, {
    method: corps ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: corps ? JSON.stringify(corps) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok === false) {
    throw new Error(`Slack ${methode} : ${json?.error || res.status}`);
  }
  return json as T;
}

/**
 * Poste un message (ou une réponse dans un fil). Retourne l'horodatage Slack
 * `ts`, qui identifie le message — et le fil, quand c'est le premier.
 */
export async function envoyerMessageSlack(p: {
  channel: string;
  text: string;
  blocks?: unknown[];
  thread_ts?: string;
}): Promise<{ ts: string; channel: string }> {
  const r = await appel<{ ts: string; channel: string }>('chat.postMessage', {
    channel: p.channel,
    text: p.text,
    ...(p.blocks ? { blocks: p.blocks } : {}),
    ...(p.thread_ts ? { thread_ts: p.thread_ts } : {}),
    unfurl_links: false,
    unfurl_media: false,
  });
  return { ts: r.ts, channel: r.channel };
}

// ── Canaux (un canal par entreprise cliente) — scope channels:manage ──
export async function creerCanalSlack(nom: string): Promise<{ id: string; name: string }> {
  // `name_taken` : on suffixe (-2, -3…) — deux entreprises peuvent porter le même nom.
  for (let i = 0; i < 6; i++) {
    const candidat = i === 0 ? nom : `${nom.slice(0, 76)}-${i + 1}`;
    try {
      const r = await appel<{ channel: { id: string; name: string } }>('conversations.create', { name: candidat, is_private: false });
      return { id: r.channel.id, name: r.channel.name };
    } catch (e: any) {
      if (!/name_taken/.test(String(e?.message))) throw e;
    }
  }
  throw new Error(`Slack conversations.create : name_taken (${nom})`);
}
export async function inviterDansCanal(channel: string, users: string[]): Promise<void> {
  if (!users.length) return;
  try {
    await appel('conversations.invite', { channel, users: users.slice(0, 1000).join(',') });
  } catch (e: any) {
    // Déjà membres, ou un des ids invalide : pas une erreur pour nous.
    if (!/already_in_channel|cant_invite_self|cant_invite|user_not_found/.test(String(e?.message))) throw e;
  }
}
export async function membresDuCanal(channel: string): Promise<string[]> {
  const out: string[] = [];
  let cursor = '';
  for (let i = 0; i < 10; i++) {
    const r = await appel<{ members?: string[]; response_metadata?: { next_cursor?: string } }>('conversations.members', null, { channel, limit: '200', ...(cursor ? { cursor } : {}) });
    out.push(...(r.members || []));
    cursor = r.response_metadata?.next_cursor || '';
    if (!cursor) break;
  }
  return out;
}
export async function archiverCanalSlack(channel: string): Promise<void> {
  try { await appel('conversations.archive', { channel }); } catch (e: any) { if (!/already_archived|is_archived/.test(String(e?.message))) throw e; }
}
export async function desarchiverCanalSlack(channel: string): Promise<void> {
  try { await appel('conversations.unarchive', { channel }); } catch (e: any) { if (!/not_archived/.test(String(e?.message))) throw e; }
}
export async function definirSujetCanal(channel: string, topic: string): Promise<void> {
  await appel('conversations.setTopic', { channel, topic: topic.slice(0, 250) });
}
/** Messages de premier niveau d'un canal depuis `oldest` (exclu), du plus ancien au plus récent. */
export interface MessageCanalSlack { ts: string; thread_ts?: string; user?: string; bot_id?: string; subtype?: string; text?: string }
export async function lireHistoriqueSlack(channel: string, oldest?: string, limite = 200): Promise<MessageCanalSlack[]> {
  const r = await appel<{ messages?: MessageCanalSlack[] }>('conversations.history', null, { channel, limit: String(limite), ...(oldest ? { oldest, inclusive: 'false' } : {}) });
  return (r.messages || []).slice().sort((a, b) => Number(a.ts) - Number(b.ts));
}

/** Répliques d'un fil (sans le parent), pour le relevé périodique. */
export interface RepliqueSlack { ts: string; user?: string; bot_id?: string; subtype?: string; text?: string }
export async function lireRepliquesSlack(channel: string, threadTs: string, limite = 100): Promise<RepliqueSlack[]> {
  const r = await appel<{ messages?: RepliqueSlack[] }>('conversations.replies', null, { channel, ts: threadTs, limit: String(limite) });
  return (r.messages || []).filter((m) => m.ts !== threadTs);
}

// ── Identité du bot (pour ignorer ses propres messages dans le fil) ──
let identite: { user_id: string; bot_id: string | null } | null = null;
export async function identiteBot(): Promise<{ user_id: string; bot_id: string | null }> {
  if (identite) return identite;
  const r = await appel<{ user_id: string; bot_id?: string }>('auth.test', {});
  identite = { user_id: r.user_id, bot_id: r.bot_id || null };
  return identite;
}

// ── Nom lisible d'un utilisateur Slack (mis en cache) ──
const noms = new Map<string, string>();
export async function nomUtilisateurSlack(userId: string): Promise<string> {
  if (!userId) return 'Support';
  const enCache = noms.get(userId);
  if (enCache) return enCache;
  try {
    const r = await appel<{ user: { real_name?: string; name?: string; profile?: { display_name?: string; real_name?: string } } }>('users.info', null, { user: userId });
    const u = r.user;
    const nom = u.profile?.display_name || u.profile?.real_name || u.real_name || u.name || 'Support';
    noms.set(userId, nom);
    return nom;
  } catch (e: any) {
    logger.warn('[slack] users.info impossible', { userId, error: e?.message });
    return 'Support';
  }
}

/**
 * Signature des webhooks Slack : `v0=` + HMAC-SHA256(secret, `v0:${ts}:${corps}`),
 * comparée en temps constant, horodatage à ±5 min (anti-rejeu).
 */
export function verifierSignatureSlack(
  headers: { signature?: string; timestamp?: string },
  corpsBrut: string | Buffer,
  secret: string,
  maintenantS: number = Math.floor(Date.now() / 1000),
): boolean {
  const { signature, timestamp } = headers;
  if (!signature || !timestamp || !secret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(maintenantS - ts) > TOLERANCE_S) return false;
  const corps = typeof corpsBrut === 'string' ? corpsBrut : corpsBrut.toString('utf8');
  const attendu = `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${corps}`).digest('hex')}`;
  const a = Buffer.from(attendu);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Texte Slack (mrkdwn) sans injection de balises : on neutralise &, <, >. */
export function echapperSlack(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Convertit le mrkdwn Slack minimal (<url|texte>, <@U…>) en texte lisible pour le client. */
export function texteDepuisSlack(s: string): string {
  return s
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<(https?:\/\/[^>]+)>/g, '$1')
    .replace(/<@[A-Z0-9]+>/g, '')
    .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
    .trim();
}
