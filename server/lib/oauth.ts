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
import { getServiceClient } from './supabase';

/** Durées de vie. Court pour l'accès, long pour le rafraîchissement. */
export const ACCESS_TOKEN_TTL_S = 60 * 60;              // 1 h
export const REFRESH_TOKEN_TTL_S = 60 * 60 * 24 * 30;   // 30 j
export const AUTH_CODE_TTL_S = 60;                      // 60 s (spec : « courte durée »)

/** Le seul scope pour l'instant : lecture du CRM. */
export const SCOPE_MCP_READ = 'mcp:read';
export const SCOPES_SUPPORTED = [SCOPE_MCP_READ];

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

function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
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
}

export interface IssueTokensParams {
  clientId: string;
  userId: string;
  orgId: string;
  scopes: string[];
  resource: string;
  /** Rotation : conserver la famille du jeton rafraîchi. */
  familyId?: string;
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

  const { error } = await db.from('oauth_tokens').insert(row);
  if (error) throw new Error(`Émission des jetons impossible : ${error.message}`);

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: ACCESS_TOKEN_TTL_S,
    scope: p.scopes.join(' '),
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
    .select('id, family_id, user_id, org_id, client_id, scopes, resource, refresh_token_expires_at, revoked')
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

  const tokens = await issueTokens({
    clientId: data.client_id,
    userId: data.user_id,
    orgId: data.org_id,
    scopes: data.scopes,
    resource: data.resource,
    familyId: data.family_id,
  });

  return { tokens, userId: data.user_id, orgId: data.org_id };
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
