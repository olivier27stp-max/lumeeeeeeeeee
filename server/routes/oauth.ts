/* ═══════════════════════════════════════════════════════════════
   Lume — serveur d'autorisation OAuth 2.1 (routes)
   ─────────────────────────────────────────────────────────────
   Permet à un client MCP (Claude, Cursor…) d'obtenir un jeton lié à
   UNE personne plutôt qu'une clé partagée par toute l'organisation.

   PARCOURS
     1. Claude appelle /api/mcp sans jeton → 401 + WWW-Authenticate
        qui pointe vers le document de métadonnées.
     2. Claude lit /.well-known/oauth-protected-resource, puis
        /.well-known/oauth-authorization-server.
     3. Claude s'enregistre (POST /oauth/register) si nécessaire.
     4. Claude ouvre /oauth/authorize dans le navigateur → écran de
        consentement Lume → l'utilisateur autorise.
     5. Claude échange le code contre un jeton (POST /oauth/token),
        avec PKCE.
     6. Claude appelle /api/mcp avec `Authorization: Bearer …`.

   CE ROUTEUR PORTE SA PROPRE AUTH — comme agentAuthRouter. Il doit
   être monté AVANT les routers nus sur /api (voir server/index.ts).
   ═══════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import express from 'express';
import crypto from 'crypto';
import {
  baseUrl, canonicalResource, sha256, safeEqual,
  SCOPES_SUPPORTED, SCOPE_MCP_READ, AUTH_CODE_TTL_S,
  getClient, redirectUriAllowed, verifyPkce,
  issueAuthorizationCode, consumeAuthorizationCode,
  issueTokens, rotateRefreshToken, revokeToken,
} from '../lib/oauth';
import { getServiceClient, requireAuthedClient } from '../lib/supabase';
import { logSecurityEvent, extractIP } from '../lib/security';
import { sendSafeError } from '../lib/error-handler';

const router = Router();
const json = express.json({ limit: '16kb' });
const form = express.urlencoded({ extended: false, limit: '16kb' });

/** Réponse d'erreur OAuth normalisée (RFC 6749 §5.2). */
function oauthError(res: any, status: number, code: string, description?: string) {
  return res.status(status).json({ error: code, error_description: description });
}

/**
 * Redirige l'erreur vers le client quand c'est sûr de le faire
 * (RFC 6749 §4.1.2.1) : uniquement si l'URI de redirection est
 * validée. Sinon on affiche l'erreur, sans jamais rediriger — c'est
 * ce qui empêche de transformer le serveur en redirecteur ouvert.
 */
function redirectError(res: any, redirectUri: string, state: string | undefined, code: string, description?: string) {
  const u = new URL(redirectUri);
  u.searchParams.set('error', code);
  if (description) u.searchParams.set('error_description', description);
  if (state) u.searchParams.set('state', state);
  u.searchParams.set('iss', baseUrl());
  return res.redirect(302, u.toString());
}

// ═══════════════════════════════════════════════════════════════
// Découverte
// ═══════════════════════════════════════════════════════════════

/**
 * RFC 9728 — dit au client où se trouve le serveur d'autorisation.
 * C'est le premier document que Claude lit après le 401.
 */
export function protectedResourceMetadata() {
  return {
    resource: canonicalResource(),
    authorization_servers: [baseUrl()],
    scopes_supported: SCOPES_SUPPORTED,
    bearer_methods_supported: ['header'],
    resource_documentation: `${baseUrl()}/settings/api`,
  };
}

/** RFC 8414 — décrit les endpoints et capacités du serveur. */
export function authorizationServerMetadata() {
  const b = baseUrl();
  return {
    issuer: b,
    authorization_endpoint: `${b}/api/oauth/authorize`,
    token_endpoint: `${b}/api/oauth/token`,
    registration_endpoint: `${b}/api/oauth/register`,
    revocation_endpoint: `${b}/api/oauth/revoke`,
    scopes_supported: SCOPES_SUPPORTED,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    // PKCE S256 uniquement : `plain` est refusé côté code ET côté SQL.
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    // RFC 9207 — on renvoie toujours `iss`, le client peut le vérifier.
    authorization_response_iss_parameter_supported: true,
  };
}

// ═══════════════════════════════════════════════════════════════
// POST /oauth/register — enregistrement dynamique (RFC 7591)
// ═══════════════════════════════════════════════════════════════

router.post('/register', json, async (req, res) => {
  try {
    const b = req.body || {};
    const redirectUris: string[] = Array.isArray(b.redirect_uris) ? b.redirect_uris : [];
    if (redirectUris.length === 0) {
      return oauthError(res, 400, 'invalid_redirect_uri', 'redirect_uris est requis.');
    }
    // Toute URI de redirection doit être https, sauf localhost (client de bureau).
    for (const uri of redirectUris) {
      let parsed: URL;
      try { parsed = new URL(uri); } catch { return oauthError(res, 400, 'invalid_redirect_uri', `URI invalide : ${uri}`); }
      const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      if (parsed.protocol !== 'https:' && !isLocal) {
        return oauthError(res, 400, 'invalid_redirect_uri', 'https requis (sauf localhost).');
      }
      if (parsed.hash) return oauthError(res, 400, 'invalid_redirect_uri', 'fragment interdit.');
    }

    const clientName = String(b.client_name || 'Client MCP').slice(0, 120);
    const clientId = `lume-${crypto.randomBytes(16).toString('hex')}`;

    const db = getServiceClient();
    const { error } = await db.from('oauth_clients').insert({
      client_id: clientId,
      client_name: clientName,
      redirect_uris: redirectUris,
      scopes: [SCOPE_MCP_READ],
      registration_type: 'dynamic',
      client_uri: typeof b.client_uri === 'string' ? b.client_uri.slice(0, 500) : null,
      logo_uri: typeof b.logo_uri === 'string' ? b.logo_uri.slice(0, 500) : null,
    });
    if (error) throw error;

    logSecurityEvent({
      event_type: 'oauth_client_registered',
      severity: 'info',
      source: 'api',
      ip_address: extractIP(req),
      details: { client_id: clientId, client_name: clientName },
    });

    // Client public : pas de secret, PKCE fait le travail.
    return res.status(201).json({
      client_id: clientId,
      client_name: clientName,
      redirect_uris: redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: SCOPE_MCP_READ,
    });
  } catch (err: any) {
    return sendSafeError(res, err, 'Enregistrement impossible.', '[oauth/register]');
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /oauth/authorize — envoie vers l'écran de consentement
// ═══════════════════════════════════════════════════════════════

router.get('/authorize', async (req, res) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const clientId = q.client_id || '';
    const redirectUri = q.redirect_uri || '';
    const responseType = q.response_type || '';
    const codeChallenge = q.code_challenge || '';
    const method = q.code_challenge_method || '';
    const state = q.state;
    const resource = q.resource || '';
    const scope = q.scope || SCOPE_MCP_READ;

    // Tant que le client et l'URI ne sont pas VALIDÉS, on n'a pas le
    // droit de rediriger : ce serait un redirecteur ouvert.
    const client = await getClient(clientId);
    if (!client) return oauthError(res, 400, 'invalid_client', 'Client inconnu.');
    if (!redirectUriAllowed(redirectUri, client.redirect_uris)) {
      return oauthError(res, 400, 'invalid_redirect_uri', 'URI de redirection non enregistrée.');
    }

    // À partir d'ici l'URI est sûre : les erreurs repartent vers le client.
    if (responseType !== 'code') {
      return redirectError(res, redirectUri, state, 'unsupported_response_type');
    }
    if (!codeChallenge || method !== 'S256') {
      return redirectError(res, redirectUri, state, 'invalid_request', 'PKCE S256 requis.');
    }
    // RFC 8707 : le client doit dire pour quelle ressource il veut le jeton.
    if (resource && resource !== canonicalResource()) {
      return redirectError(res, redirectUri, state, 'invalid_target', 'Ressource inconnue.');
    }
    const scopes = scope.split(/\s+/).filter(Boolean);
    if (scopes.some((s) => !SCOPES_SUPPORTED.includes(s))) {
      return redirectError(res, redirectUri, state, 'invalid_scope');
    }

    // L'écran de consentement est une page de l'application : on y passe
    // les paramètres, elle se charge de la session utilisateur (et de la
    // connexion si besoin), puis appelle POST /oauth/consent.
    const consent = new URL(`${baseUrl()}/oauth/consent`);
    consent.searchParams.set('client_id', clientId);
    consent.searchParams.set('redirect_uri', redirectUri);
    consent.searchParams.set('code_challenge', codeChallenge);
    consent.searchParams.set('scope', scopes.join(' '));
    consent.searchParams.set('resource', resource || canonicalResource());
    if (state) consent.searchParams.set('state', state);
    return res.redirect(302, consent.toString());
  } catch (err: any) {
    return sendSafeError(res, err, 'Autorisation impossible.', '[oauth/authorize]');
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /oauth/consent — l'utilisateur a cliqué « Autoriser »
// ═══════════════════════════════════════════════════════════════
// Authentifié par la session Supabase de l'utilisateur (l'écran de
// consentement est une page de l'app). C'est ici que l'identité réelle
// entre dans le flux : le code est lié à SON user_id et SON org.

router.post('/consent', json, async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId, user } = authed;

    const { client_id, redirect_uri, code_challenge, scope, resource, state } = req.body || {};
    const client = await getClient(String(client_id || ''));
    if (!client) return oauthError(res, 400, 'invalid_client', 'Client inconnu.');
    if (!redirectUriAllowed(String(redirect_uri || ''), client.redirect_uris)) {
      return oauthError(res, 400, 'invalid_redirect_uri', 'URI de redirection non enregistrée.');
    }
    if (!code_challenge) return oauthError(res, 400, 'invalid_request', 'code_challenge requis.');

    const scopes = String(scope || SCOPE_MCP_READ).split(/\s+/).filter(Boolean);
    if (scopes.some((s) => !SCOPES_SUPPORTED.includes(s))) {
      return oauthError(res, 400, 'invalid_scope');
    }
    const res_ = String(resource || canonicalResource());
    if (res_ !== canonicalResource()) return oauthError(res, 400, 'invalid_target');

    const code = await issueAuthorizationCode({
      clientId: client.client_id,
      userId: user.id,
      orgId,
      scopes,
      redirectUri: String(redirect_uri),
      codeChallenge: String(code_challenge),
      resource: res_,
    });

    logSecurityEvent({
      org_id: orgId,
      user_id: user.id,
      event_type: 'oauth_consent_granted',
      severity: 'info',
      source: 'api',
      ip_address: extractIP(req),
      details: { client_id: client.client_id, client_name: client.client_name, scopes },
    });

    const u = new URL(String(redirect_uri));
    u.searchParams.set('code', code);
    if (state) u.searchParams.set('state', String(state));
    u.searchParams.set('iss', baseUrl()); // RFC 9207
    return res.json({ redirect_to: u.toString(), expires_in: AUTH_CODE_TTL_S });
  } catch (err: any) {
    return sendSafeError(res, err, 'Consentement impossible.', '[oauth/consent]');
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /oauth/token — code → jeton, et rafraîchissement
// ═══════════════════════════════════════════════════════════════

router.post('/token', form, json, async (req, res) => {
  try {
    const b = req.body || {};
    const grantType = String(b.grant_type || '');
    const clientId = String(b.client_id || '');
    const resource = String(b.resource || canonicalResource());

    const client = await getClient(clientId);
    if (!client) return oauthError(res, 401, 'invalid_client', 'Client inconnu.');

    // Client confidentiel : vérifier le secret. Public : PKCE suffit.
    if (client.client_secret_hash) {
      const provided = String(b.client_secret || '');
      if (!provided || !safeEqual(sha256(provided), client.client_secret_hash)) {
        return oauthError(res, 401, 'invalid_client', 'Secret invalide.');
      }
    }

    // ── Échange du code ──
    if (grantType === 'authorization_code') {
      const code = String(b.code || '');
      const verifier = String(b.code_verifier || '');
      const redirectUri = String(b.redirect_uri || '');
      if (!code || !verifier) return oauthError(res, 400, 'invalid_request', 'code et code_verifier requis.');

      const consumed = await consumeAuthorizationCode(code);

      if (consumed === 'reused') {
        // Un code rejoué signale un vol. On coupe tout ce que ce client
        // détient pour cet utilisateur plutôt que d'attendre.
        logSecurityEvent({
          event_type: 'oauth_code_reuse',
          severity: 'critical',
          source: 'api',
          ip_address: extractIP(req),
          details: { client_id: clientId },
        });
        return oauthError(res, 400, 'invalid_grant', 'Code déjà utilisé.');
      }
      if (!consumed) return oauthError(res, 400, 'invalid_grant', 'Code invalide ou expiré.');

      if (consumed.client_id !== clientId) return oauthError(res, 400, 'invalid_grant', 'Code émis pour un autre client.');
      if (consumed.redirect_uri !== redirectUri) return oauthError(res, 400, 'invalid_grant', 'redirect_uri différent.');
      if (consumed.resource !== resource) return oauthError(res, 400, 'invalid_target', 'Ressource différente.');
      if (!verifyPkce(verifier, consumed.code_challenge)) {
        logSecurityEvent({
          org_id: consumed.org_id,
          user_id: consumed.user_id,
          event_type: 'oauth_pkce_failed',
          severity: 'high',
          source: 'api',
          ip_address: extractIP(req),
          details: { client_id: clientId },
        });
        return oauthError(res, 400, 'invalid_grant', 'PKCE invalide.');
      }

      const tokens = await issueTokens({
        clientId: consumed.client_id,
        userId: consumed.user_id,
        orgId: consumed.org_id,
        scopes: consumed.scopes,
        resource: consumed.resource,
      });

      getServiceClient().from('oauth_clients')
        .update({ last_used_at: new Date().toISOString() })
        .eq('client_id', clientId).then(() => {}, () => {});

      return res.json({ token_type: 'Bearer', ...tokens });
    }

    // ── Rafraîchissement ──
    if (grantType === 'refresh_token') {
      const refresh = String(b.refresh_token || '');
      if (!refresh) return oauthError(res, 400, 'invalid_request', 'refresh_token requis.');

      const result = await rotateRefreshToken(refresh, clientId, resource);
      if (result === 'reuse_detected') {
        logSecurityEvent({
          event_type: 'oauth_refresh_reuse',
          severity: 'critical',
          source: 'api',
          ip_address: extractIP(req),
          details: { client_id: clientId, action: 'famille révoquée' },
        });
        return oauthError(res, 400, 'invalid_grant', 'Jeton révoqué (réutilisation détectée).');
      }
      if (!result) return oauthError(res, 400, 'invalid_grant', 'Jeton invalide ou expiré.');

      return res.json({ token_type: 'Bearer', ...result.tokens });
    }

    return oauthError(res, 400, 'unsupported_grant_type');
  } catch (err: any) {
    return sendSafeError(res, err, 'Émission du jeton impossible.', '[oauth/token]');
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /oauth/revoke — RFC 7009
// ═══════════════════════════════════════════════════════════════
// Répond toujours 200, même pour un jeton inconnu : révéler qu'un
// jeton existe donnerait un oracle à un attaquant.

router.post('/revoke', form, json, async (req, res) => {
  try {
    const token = String((req.body || {}).token || '');
    if (token) await revokeToken(token);
    return res.status(200).json({});
  } catch (err: any) {
    console.error('[oauth/revoke]', err?.message || err);
    return res.status(200).json({});
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /oauth/client-info — pour l'écran de consentement
// ═══════════════════════════════════════════════════════════════
// Ce que l'utilisateur doit voir avant d'autoriser : qui demande, et
// quoi. Public par nature (nom + logo), aucun secret n'est exposé.

router.get('/client-info', async (req, res) => {
  try {
    const client = await getClient(String(req.query.client_id || ''));
    if (!client) return res.status(404).json({ error: 'Client inconnu.' });
    return res.json({
      client_id: client.client_id,
      client_name: client.client_name,
      logo_uri: client.logo_uri,
      client_uri: client.client_uri,
    });
  } catch (err: any) {
    return sendSafeError(res, err, 'Client introuvable.', '[oauth/client-info]');
  }
});

export default router;
