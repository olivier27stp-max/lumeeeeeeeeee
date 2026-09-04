/* ═══════════════════════════════════════════════════════════════
   Lume — serveur d'autorisation OAuth 2.1 (primitives)
   ─────────────────────────────────────────────────────────────
   Les briques : hachage, PKCE, émission et validation de jetons.
   Les routes vivent dans server/routes/oauth.ts.

   PRINCIPES TENUS ICI
   • Rien en clair. Codes et jetons sont stockés hachés (SHA-256),
     exactement comme les clés d'API. Une fuite de la base ne donne
     aucun accès.
   • Comparaisons en temps constant partout où un secret est comparé.
   • Audience obligatoire (RFC 8707) : un jeton n'est valable que pour
     LA ressource pour laquelle il a été émis. Sans cette vérification,
     un jeton volé sur un autre service ouvrirait Lume.
   ═══════════════════════════════════════════════════════════════ */

import crypto from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient } from './supabase';
import { supabaseUrl, supabaseAnonKey } from './config';

/**
 * Chiffrement de la session Supabase rattachée à une autorisation.
 *
 * On N'UTILISE PAS le helper des paiements : il dépend de
 * PAYMENTS_ENCRYPTION_KEY, variable OPTIONNELLE que le serveur accepte de
 * démarrer sans. En production elle n'était pas définie — le chiffrement
 * échouait, l'erreur était avalée (pour ne pas casser l'autorisation), et la
 * session n'était jamais stockée. Résultat : tous les outils passant par une
 * RPC restaient muets, sans le moindre message.
 *
 * La clé est dérivée d'AGENT_JWT_SECRET, dont l'absence empêche le serveur de
 * démarrer : impossible d'échouer silencieusement à nouveau. La dérivation
 * (HKDF avec un label dédié) garantit qu'un même secret ne sert pas à deux
 * usages cryptographiques distincts.
 */
function cleSession(): Buffer {
  const base = process.env.AGENT_JWT_SECRET;
  if (!base) throw new Error('AGENT_JWT_SECRET requis pour chiffrer la session OAuth.');
  return Buffer.from(
    crypto.hkdfSync('sha256', Buffer.from(base), Buffer.alloc(0), Buffer.from('lume-oauth-session-v1'), 32),
  );
}

function chiffrerSession(clair: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cleSession(), iv);
  const enc = Buffer.concat([c.update(clair, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

function dechiffrerSession(charge: string): string {
  const buf = Buffer.from(charge, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', cleSession(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

/** Durées de vie. Court pour l'accès, long pour le rafraîchissement. */
export const ACCESS_TOKEN_TTL_S = 60 * 60;              // 1 h
export const REFRESH_TOKEN_TTL_S = 60 * 60 * 24 * 30;   // 30 j
export const AUTH_CODE_TTL_S = 60;                      // 60 s (spec : « courte durée »)

/**
 * Scopes du serveur MCP.
 * `mcp:read`  — consulter le CRM.
 * `mcp:write` — créer (jobs, clients, tâches, devis, factures-brouillons)
 *               et envoyer des SMS. Toujours accordé PAR la personne sur
 *               l'écran de consentement, jamais implicite ; chaque écriture
 *               exige en plus l'identité (session) et est idempotente.
 */
export const SCOPE_MCP_READ = 'mcp:read';
export const SCOPE_MCP_WRITE = 'mcp:write';
export const SCOPES_SUPPORTED = [SCOPE_MCP_READ, SCOPE_MCP_WRITE];

/** Base publique du serveur. Sans elle, aucune URL absolue n'est correcte. */
export function baseUrl(): string {
  const b = (process.env.PUBLIC_BASE_URL || process.env.FRONTEND_URL || '').trim().replace(/\/$/, '');
  if (!b) throw new Error('PUBLIC_BASE_URL (ou FRONTEND_URL) est requis pour OAuth.');
  return b;
}

/**
 * Identifiant canonique de cette ressource (RFC 8707 §2).
 * C'est la valeur que les jetons doivent porter en audience, et celle
 * que les clients envoient dans `resource`.
 */
export function canonicalResource(): string {
  return `${baseUrl()}/api/mcp`;
}

// ── Hachage ────────────────────────────────────────────────────────

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Comparaison en temps constant : ne fuit pas la position du 1er écart. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch { return false; }
}

/**
 * Jeton aléatoire en base32 (chiffres + lettres majuscules uniquement).
 *
 * PAS de base64url : son alphabet contient `-`, et deux tirets consécutifs
 * ressemblent à un commentaire SQL (`--`). Le détecteur d'injection global
 * bloquait alors la requête — mesuré à 2 % des jetons générés, soit une
 * connexion sur cinquante qui échouait AU HASARD avec « L'autorisation a
 * échoué », sans que l'utilisateur puisse comprendre pourquoi.
 *
 * L'entropie est préservée : 32 octets → 51 caractères base32, bien au-delà
 * des 128 bits recommandés pour un jeton d'accès.
 */
function randomToken(bytes = 32): string {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // base32 (RFC 4648, sans padding)
  const buf = crypto.randomBytes(bytes);
  let out = '';
  for (let i = 0; i < buf.length; i++) out += ALPHABET[buf[i] % 32];
  return out;
}

// ── PKCE (RFC 7636) ────────────────────────────────────────────────

/**
 * Vérifie le `code_verifier` contre le `code_challenge` enregistré.
 * S256 uniquement : `plain` est refusé (et la contrainte SQL le refuse
 * aussi, ceinture et bretelles).
 */
export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  if (!codeVerifier || !codeChallenge) return false;
  // RFC 7636 §4.1 : 43 à 128 caractères non réservés.
  if (codeVerifier.length < 43 || codeVerifier.length > 128) return false;
  const computed = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return safeEqual(computed, codeChallenge);
}

// ── Redirect URI ───────────────────────────────────────────────────

/**
 * Comparaison EXACTE de l'URI de redirection (OAuth 2.1 §4.1.2.1).
 * Aucune correspondance par préfixe ni joker : c'est la protection
 * contre la redirection ouverte, par laquelle un attaquant se ferait
 * livrer le code d'autorisation.
 */
export function redirectUriAllowed(uri: string, allowed: string[]): boolean {
  return allowed.some((a) => a === uri);
}

// ── Clients ────────────────────────────────────────────────────────

export interface OAuthClient {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  scopes: string[];
  client_secret_hash: string | null;
  disabled: boolean;
  logo_uri: string | null;
  client_uri: string | null;
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  if (!clientId) return null;
  const db = getServiceClient();
  const { data } = await db
    .from('oauth_clients')
    .select('client_id, client_name, redirect_uris, scopes, client_secret_hash, disabled, logo_uri, client_uri')
    .eq('client_id', clientId)
    .maybeSingle();
  if (!data || data.disabled) return null;
  return data as OAuthClient;
}

// ── Codes d'autorisation ───────────────────────────────────────────

export interface IssueCodeParams {
  clientId: string;
  userId: string;
  orgId: string;
  scopes: string[];
  redirectUri: string;
  codeChallenge: string;
  resource: string;
}

/** Émet un code d'autorisation. Le code brut n'est jamais stocké. */
export async function issueAuthorizationCode(p: IssueCodeParams): Promise<string> {
  const code = randomToken(32);
  const db = getServiceClient();
  const { error } = await db.from('oauth_authorization_codes').insert({
    code_hash: sha256(code),
    client_id: p.clientId,
    user_id: p.userId,
    org_id: p.orgId,
    scopes: p.scopes,
    redirect_uri: p.redirectUri,
    code_challenge: p.codeChallenge,
    code_challenge_method: 'S256',
    resource: p.resource,
    expires_at: new Date(Date.now() + AUTH_CODE_TTL_S * 1000).toISOString(),
  });
  if (error) throw new Error(`Émission du code impossible : ${error.message}`);
  return code;
}

export interface ConsumedCode {
  client_id: string;
  user_id: string;
  org_id: string;
  scopes: string[];
  redirect_uri: string;
  code_challenge: string;
  resource: string;
}

/**
 * Consomme un code : le marque utilisé et le renvoie.
 * Usage unique — un code déjà consommé est refusé (et signalé par
 * l'appelant comme incident de sécurité).
 */
export async function consumeAuthorizationCode(code: string): Promise<ConsumedCode | 'reused' | null> {
  const db = getServiceClient();
  const hash = sha256(code);
  const { data } = await db
    .from('oauth_authorization_codes')
    .select('id, client_id, user_id, org_id, scopes, redirect_uri, code_challenge, resource, expires_at, used_at')
    .eq('code_hash', hash)
    .maybeSingle();

  if (!data) return null;
  if (data.used_at) return 'reused';
  if (new Date(data.expires_at) < new Date()) return null;

  // Marquage atomique : `.is('used_at', null)` garantit qu'une course
  // entre deux échanges simultanés n'en laisse passer qu'un seul.
  const { data: claimed } = await db
    .from('oauth_authorization_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('id', data.id)
    .is('used_at', null)
    .select('id')
    .maybeSingle();
  if (!claimed) return 'reused';

  return {
    client_id: data.client_id,
    user_id: data.user_id,
    org_id: data.org_id,
    scopes: data.scopes,
    redirect_uri: data.redirect_uri,
    code_challenge: data.code_challenge,
    resource: data.resource,
  };
}

// ── Jetons ─────────────────────────────────────────────────────────

export interface IssuedTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  /** Id interne de la ligne oauth_tokens émise — usage serveur (révocation
   *  des anciennes autorisations), JAMAIS renvoyé au client HTTP. */
  tokenId: string;
}

export interface IssueTokensParams {
  clientId: string;
  userId: string;
  orgId: string;
  scopes: string[];
  resource: string;
  /** Rotation : conserver la famille du jeton rafraîchi. */
  familyId?: string;
  /**
   * Jeton de rafraîchissement de la session Supabase de l'utilisateur, capturé
   * au consentement. Sans lui, le serveur MCP interroge la base en `service_role`
   * — donc sans `auth.uid()` — et toute RPC `SECURITY DEFINER` qui vérifie
   * l'appartenance à l'org refuse l'appel (« Not allowed for this organization »).
   * C'est ce qui rendait get_revenue_summary et get_overdue_payments inutilisables.
   */
  supabaseRefreshToken?: string | null;
}

export async function issueTokens(p: IssueTokensParams): Promise<IssuedTokens> {
  const accessToken = randomToken(32);
  const refreshToken = randomToken(32);
  const now = Date.now();
  const db = getServiceClient();

  const row: Record<string, unknown> = {
    access_token_hash: sha256(accessToken),
    refresh_token_hash: sha256(refreshToken),
    client_id: p.clientId,
    user_id: p.userId,
    org_id: p.orgId,
    scopes: p.scopes,
    resource: p.resource,
    access_token_expires_at: new Date(now + ACCESS_TOKEN_TTL_S * 1000).toISOString(),
    refresh_token_expires_at: new Date(now + REFRESH_TOKEN_TTL_S * 1000).toISOString(),
  };
  if (p.familyId) row.family_id = p.familyId;
  if (p.supabaseRefreshToken) {
    // Chiffré au repos (AES-256-GCM) : la colonne ne contient jamais de valeur
    // exploitable. Un échec de chiffrement ne doit pas bloquer l'autorisation —
    // on perd seulement l'accès aux outils qui exigent une identité.
    try {
      row.supabase_refresh_token_chiffre = chiffrerSession(p.supabaseRefreshToken);
      row.supabase_session_maj_le = new Date().toISOString();
    } catch (e: any) {
      // Un échec ici prive l'utilisateur de tous les outils passant par une
      // RPC (revenus, factures) SANS message visible : c'est exactement ce qui
      // s'est produit en production. On refuse donc plutôt que de laisser
      // filer une autorisation à moitié fonctionnelle.
      console.error('[oauth] chiffrement de la session Supabase impossible :', e?.message || e);
      throw new Error('Session non chiffrable — autorisation refusée.');
    }
  }

  const { data: insere, error } = await db.from('oauth_tokens').insert(row).select('id').single();
  if (error) throw new Error(`Émission des jetons impossible : ${error.message}`);

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: ACCESS_TOKEN_TTL_S,
    scope: p.scopes.join(' '),
    tokenId: String(insere!.id),
  };
}

export interface ValidatedToken {
  userId: string;
  orgId: string;
  clientId: string;
  scopes: string[];
  tokenId: string;
}

/**
 * Valide un jeton d'accès.
 *
 * `expectedResource` est vérifié systématiquement : c'est l'exigence
 * d'audience de RFC 8707 reprise par la spec MCP. Un jeton émis pour
 * une autre ressource est refusé même s'il est par ailleurs valide.
 */
export async function validateAccessToken(
  token: string,
  expectedResource: string,
): Promise<ValidatedToken | null> {
  if (!token) return null;
  const db = getServiceClient();
  const { data } = await db
    .from('oauth_tokens')
    .select('id, user_id, org_id, client_id, scopes, resource, access_token_expires_at, revoked')
    .eq('access_token_hash', sha256(token))
    .maybeSingle();

  if (!data || data.revoked) return null;
  if (!data.access_token_expires_at || new Date(data.access_token_expires_at) < new Date()) return null;
  // Audience — le cœur de la protection.
  if (data.resource !== expectedResource) return null;

  db.from('oauth_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => {}, () => {});

  return {
    userId: data.user_id,
    orgId: data.org_id,
    clientId: data.client_id,
    scopes: data.scopes || [],
    tokenId: data.id,
  };
}

export interface RefreshResult {
  tokens: IssuedTokens;
  userId: string;
  orgId: string;
}

/**
 * Échange un jeton de rafraîchissement contre un couple neuf.
 *
 * ROTATION (OAuth 2.1 §4.14.2) : l'ancien est révoqué immédiatement.
 * Si un jeton DÉJÀ révoqué est présenté, c'est le signe qu'il a été
 * volé — on révoque alors toute la famille, ce qui coupe l'accès au
 * voleur ET au client légitime, qui devra réautoriser.
 */
export async function rotateRefreshToken(
  refreshToken: string,
  clientId: string,
  expectedResource: string,
): Promise<RefreshResult | 'reuse_detected' | null> {
  const db = getServiceClient();
  const { data } = await db
    .from('oauth_tokens')
    .select('id, family_id, user_id, org_id, client_id, scopes, resource, refresh_token_expires_at, revoked, supabase_refresh_token_chiffre')
    .eq('refresh_token_hash', sha256(refreshToken))
    .maybeSingle();

  if (!data) return null;
  if (data.client_id !== clientId) return null;
  if (data.resource !== expectedResource) return null;

  if (data.revoked) {
    // Réutilisation d'un jeton révoqué → toute la famille tombe.
    await db
      .from('oauth_tokens')
      .update({ revoked: true, revoked_at: new Date().toISOString(), revoked_reason: 'refresh_token_reuse' })
      .eq('family_id', data.family_id);
    return 'reuse_detected';
  }

  if (!data.refresh_token_expires_at || new Date(data.refresh_token_expires_at) < new Date()) return null;

  await db
    .from('oauth_tokens')
    .update({ revoked: true, revoked_at: new Date().toISOString(), revoked_reason: 'rotated' })
    .eq('id', data.id);

  // La session Supabase suit la famille : sans ce report, rafraîchir son jeton
  // OAuth ferait perdre l'identité et recasserait les outils à RPC.
  let sessionSuivie: string | null = null;
  if (data.supabase_refresh_token_chiffre) {
    try { sessionSuivie = dechiffrerSession(data.supabase_refresh_token_chiffre); } catch { /* session perdue */ }
  }

  const tokens = await issueTokens({
    clientId: data.client_id,
    userId: data.user_id,
    orgId: data.org_id,
    scopes: data.scopes,
    resource: data.resource,
    familyId: data.family_id,
    supabaseRefreshToken: sessionSuivie,
  });

  return { tokens, userId: data.user_id, orgId: data.org_id };
}

/**
 * Construit un client Supabase À L'IDENTITÉ de l'utilisateur qui a autorisé.
 *
 * Pourquoi : le serveur MCP interroge normalement la base en `service_role`,
 * qui n'a pas d'`auth.uid()`. Toute RPC `SECURITY DEFINER` vérifiant
 * `has_org_membership(auth.uid(), org)` refuse alors l'appel — c'est ce qui
 * rendait get_revenue_summary et get_overdue_payments inutilisables.
 *
 * On rejoue donc la session Supabase capturée au consentement. Supabase fait
 * TOURNER le jeton de rafraîchissement à chaque usage : on restocke aussitôt
 * le nouveau, sinon l'autorisation se casse au deuxième appel.
 *
 * Renvoie null si la session n'est plus valide (mot de passe changé, session
 * révoquée…). L'appelant retombe alors sur le service client : les outils
 * simples continuent de fonctionner, seuls ceux à RPC échouent.
 */
export interface UserSession {
  client: SupabaseClient;
  accessToken: string;
}

function clientPourJeton(accessToken: string): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Rafraîchissements EN COURS, par autorisation. Le brief du matin lance
 * plusieurs outils en parallèle ; sans ce verrou, chacun rafraîchissait la
 * session en même temps — or le jeton de rafraîchissement TOURNE à chaque
 * usage, et Supabase traite un jeton déjà consommé comme un VOL : famille
 * révoquée, « session plus rejouable », factures et revenus morts jusqu'à
 * reconnexion. Vécu en production le 2026-09-03 au matin.
 * Une seule volée de rafraîchissement à la fois ; les appels concurrents
 * attendent la même promesse.
 */
const rafraichissementsEnCours = new Map<string, Promise<UserSession | null>>();

/**
 * Crée une session Supabase DÉDIÉE à cette autorisation, indépendante du
 * navigateur de l'utilisateur.
 *
 * Le problème résolu : Supabase fait tourner le jeton de rafraîchissement et
 * invalide l'ancien après `reuse_interval` (5 s en prod). Si Claude et le
 * navigateur PARTAGENT la même session (l'ancien comportement, où le
 * consentement capturait le refresh token du navigateur), le premier qui
 * rafraîchit tue l'autre — donc ouvrir Lume dans son navigateur cassait la
 * connexion Claude, chaque jour. Prouvé : deux sessions distinctes du même
 * user survivent l'une à l'autre.
 *
 * generateLink(magiclink) + verifyOtp crée une NOUVELLE ligne dans
 * auth.sessions — un jeton de rafraîchissement bien à Claude, que l'usage
 * normal de Lume ne touche jamais. Fait côté serveur avec l'identité DÉJÀ
 * vérifiée par requireAuthedClient : aucune élévation.
 */
async function tenterSessionDediee(email: string): Promise<string | null> {
  const admin = getServiceClient();
  const { data: lien, error: e1 } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (e1 || !lien?.properties?.hashed_token) {
    throw new Error(`generateLink: ${e1?.message || 'pas de hashed_token'}`);
  }
  const anon = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: sess, error: e2 } = await anon.auth.verifyOtp({ token_hash: lien.properties.hashed_token, type: 'magiclink' });
  if (e2 || !sess?.session?.refresh_token) {
    throw new Error(`verifyOtp: ${e2?.message || 'pas de refresh_token'}`);
  }
  return sess.session.refresh_token;
}

/**
 * Crée la session Supabase dédiée à Claude. generateLink/verifyOtp échoue par
 * INTERMITTENCE (aléa réseau, latence GoTrue) — mesuré ~15 % des reconnexions,
 * et chaque échec laissait un jeton SANS session, donc tous les outils à
 * identité (finances, écritures) morts jusqu'à une reconnexion chanceuse.
 * On RÉESSAIE : un hoquet ne doit pas ruiner la connexion de l'utilisateur.
 */
export async function creerSessionDediee(email: string): Promise<string | null> {
  if (!email) return null;
  const MAX = 3;
  for (let essai = 1; essai <= MAX; essai++) {
    try {
      return await tenterSessionDediee(email);
    } catch (e: any) {
      console.error(`[oauth] session dédiée essai ${essai}/${MAX} :`, e?.message || e);
      if (essai < MAX) await new Promise((r) => setTimeout(r, 400 * essai));
    }
  }
  console.error('[oauth] session dédiée impossible après', MAX, 'tentatives — jeton sans identité (outils finances/écritures indisponibles jusqu\'à reconnexion).');
  return null;
}

export async function buildUserScopedClient(tokenId: string): Promise<UserSession | null> {
  const db = getServiceClient();
  const { data } = await db
    .from('oauth_tokens')
    .select('supabase_refresh_token_chiffre, supabase_access_token_chiffre, supabase_access_expire_a')
    .eq('id', tokenId)
    .maybeSingle();
  if (!data?.supabase_refresh_token_chiffre) return null;

  // ── Chemin rapide : le jeton d'ACCÈS en cache est encore valide ──
  // Aucun rafraîchissement, donc aucune rotation : le parallélisme est
  // inoffensif. Marge de 60 s pour ne jamais servir un jeton mourant.
  if (data.supabase_access_token_chiffre && data.supabase_access_expire_a
      && new Date(data.supabase_access_expire_a).getTime() > Date.now() + 60_000) {
    try {
      const accessToken = dechiffrerSession(data.supabase_access_token_chiffre);
      return { client: clientPourJeton(accessToken), accessToken };
    } catch { /* cache illisible : on retombe sur le rafraîchissement */ }
  }

  // ── Chemin lent : rafraîchir, UNE seule volée par autorisation ──
  const enCours = rafraichissementsEnCours.get(tokenId);
  if (enCours) return enCours;

  const volee = (async (): Promise<UserSession | null> => {
    let refresh: string;
    try {
      refresh = dechiffrerSession(data.supabase_refresh_token_chiffre);
    } catch (e: any) {
      console.error('[oauth] déchiffrement de la session impossible :', e?.message || e);
      return null;
    }

    try {
      const anon = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data: sess, error } = await anon.auth.refreshSession({ refresh_token: refresh });
      if (error || !sess?.session?.access_token) return null;

      const accessToken = sess.session.access_token;
      // Rotation + cache : on garde le NOUVEAU couple, avec l'échéance
      // réelle du jeton d'accès (expires_at Supabase, en secondes epoch).
      const expireA = sess.session.expires_at
        ? new Date(sess.session.expires_at * 1000).toISOString()
        : new Date(Date.now() + 55 * 60_000).toISOString();
      try {
        await db.from('oauth_tokens').update({
          ...(sess.session.refresh_token && sess.session.refresh_token !== refresh
            ? { supabase_refresh_token_chiffre: chiffrerSession(sess.session.refresh_token) }
            : {}),
          supabase_access_token_chiffre: chiffrerSession(accessToken),
          supabase_access_expire_a: expireA,
          supabase_session_maj_le: new Date().toISOString(),
        }).eq('id', tokenId);
      } catch (e: any) {
        console.error('[oauth] restockage de la session impossible :', e?.message || e);
      }

      return { client: clientPourJeton(accessToken), accessToken };
    } catch (e: any) {
      console.error('[oauth] session utilisateur injouable :', e?.message || e);
      return null;
    }
  })();

  rafraichissementsEnCours.set(tokenId, volee);
  try {
    return await volee;
  } finally {
    rafraichissementsEnCours.delete(tokenId);
  }
}

/** Révoque un jeton (accès ou rafraîchissement). Silencieux par design. */
export async function revokeToken(token: string): Promise<void> {
  const db = getServiceClient();
  const hash = sha256(token);
  await db
    .from('oauth_tokens')
    .update({ revoked: true, revoked_at: new Date().toISOString(), revoked_reason: 'client_revoked' })
    .or(`access_token_hash.eq.${hash},refresh_token_hash.eq.${hash}`);
}

/**
 * Au RE-CONSENTEMENT (l'utilisateur reconnecte Lume dans Claude), révoque les
 * autorisations PRÉCÉDENTES du même (utilisateur, client) — sauf celle qu'on
 * vient d'émettre (`saufTokenId`). Sans ça, chaque reconnexion empilait un
 * refresh token OAuth valide (30 j) ET une session Supabase dédiée jamais
 * nettoyée : une traînée d'accès actifs. On invalide aussi, en best-effort,
 * la session Supabase de chaque ancien jeton (signOut global du refresh
 * dédié) pour ne pas laisser de lignes orphelines dans auth.sessions.
 *
 * Appelé APRÈS l'émission du nouveau jeton : si l'utilisateur ferme l'onglet
 * avant l'échange, sa connexion existante n'est pas coupée pour rien.
 */
export async function revoquerAnciennesAutorisations(
  userId: string,
  clientId: string,
  saufTokenId: string,
): Promise<void> {
  try {
    const db = getServiceClient();
    const { data: anciens } = await db
      .from('oauth_tokens')
      .select('id, supabase_refresh_token_chiffre')
      .eq('user_id', userId)
      .eq('client_id', clientId)
      .eq('revoked', false)
      .neq('id', saufTokenId);
    if (!anciens?.length) return;

    // Best-effort : couper chaque session Supabase dédiée. On échange le
    // refresh dédié contre une session le temps d'un signOut global. Un échec
    // (session déjà morte, refresh illisible) n'empêche jamais la révocation
    // du jeton OAuth, qui, elle, est ce qui ferme réellement l'accès.
    for (const t of anciens) {
      if (!t.supabase_refresh_token_chiffre) continue;
      try {
        const refresh = dechiffrerSession(t.supabase_refresh_token_chiffre);
        const anon = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
        const { data: sess } = await anon.auth.refreshSession({ refresh_token: refresh });
        if (sess?.session) {
          // Le client anon porte maintenant CETTE session dédiée précise :
          // scope 'local' n'invalide qu'elle, jamais le navigateur de
          // l'utilisateur ni ses autres sessions légitimes.
          await anon.auth.signOut({ scope: 'local' }).catch(() => {});
        }
      } catch { /* session perdue — le jeton OAuth reste révoqué ci-dessous */ }
    }

    const { error } = await db
      .from('oauth_tokens')
      .update({ revoked: true, revoked_at: new Date().toISOString(), revoked_reason: 're_consent' })
      .eq('user_id', userId)
      .eq('client_id', clientId)
      .eq('revoked', false)
      .neq('id', saufTokenId);
    if (error) console.error('[oauth] révocation des anciennes autorisations :', error.message);
  } catch (e: any) {
    // Ne jamais faire échouer l'émission du nouveau jeton pour un ménage raté.
    console.error('[oauth] revoquerAnciennesAutorisations :', e?.message || e);
  }
}
