/* ═══════════════════════════════════════════════════════════════
   Email Provider — Outlook (Microsoft Graph + Microsoft identity platform)

   Scopes requested:
   - Mail.ReadWrite → read + modify (mark read, move, delete)
   - Mail.Send      → send mail
   - offline_access → refresh tokens
   - User.Read      → resolve the mailbox address
   Requires MS_CLIENT_ID / MS_CLIENT_SECRET (Azure App registration).
   Uses the "common" tenant so both work & personal Microsoft accounts
   can connect. Uses PKCE for the authorization code flow.
   ═══════════════════════════════════════════════════════════════ */

import type {
  EmailProviderDefinition,
  EmailTokenResponse,
  EmailRefreshResponse,
} from '../types';

const AUTHORIZE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const ME_URL = 'https://graph.microsoft.com/v1.0/me';

const SCOPES = [
  'https://graph.microsoft.com/Mail.ReadWrite',
  'https://graph.microsoft.com/Mail.Send',
  'https://graph.microsoft.com/User.Read',
  'offline_access',
];

export const outlookProvider: EmailProviderDefinition = {
  slug: 'outlook',
  display_name: 'Outlook',
  scopes: SCOPES,
  env_client_id: 'MS_CLIENT_ID',
  env_client_secret: 'MS_CLIENT_SECRET',
  use_pkce: true,

  buildAuthorizeUrl: ({ clientId, redirectUri, state, codeChallenge }) => {
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_mode', 'query');
    url.searchParams.set('scope', SCOPES.join(' '));
    url.searchParams.set('state', state);
    if (codeChallenge) {
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }
    return url.toString();
  },

  exchangeCode: async ({ code, redirectUri, clientId, clientSecret, codeVerifier }): Promise<EmailTokenResponse> => {
    const body: Record<string, string> = {
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      scope: SCOPES.join(' '),
    };
    // Confidential client → send secret. PKCE verifier also sent when present.
    if (clientSecret) body.client_secret = clientSecret;
    if (codeVerifier) body.code_verifier = codeVerifier;

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Outlook token exchange failed: ${json.error_description || json.error || res.status}`);
    }

    let email = '';
    try {
      email = await outlookProvider.getEmailAddress(json.access_token);
    } catch {
      /* best-effort */
    }

    return {
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_in: json.expires_in,
      scope: json.scope,
      email_address: email,
      raw: json,
    };
  },

  refreshToken: async ({ refreshToken, clientId, clientSecret }): Promise<EmailRefreshResponse> => {
    const body: Record<string, string> = {
      client_id: clientId,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: SCOPES.join(' '),
    };
    if (clientSecret) body.client_secret = clientSecret;

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Outlook token refresh failed: ${json.error_description || json.error || res.status}`);
    }

    return {
      access_token: json.access_token,
      refresh_token: json.refresh_token, // Graph DOES rotate refresh tokens
      expires_in: json.expires_in,
      scope: json.scope,
    };
  },

  getEmailAddress: async (accessToken: string): Promise<string> => {
    const res = await fetch(ME_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Graph /me failed: ${res.status}`);
    const json = await res.json();
    // mail is the primary SMTP address; userPrincipalName is the fallback.
    return String(json.mail || json.userPrincipalName || '');
  },
};
