/* ═══════════════════════════════════════════════════════════════
   Email Provider — Gmail (Gmail API + Google OAuth 2.0)

   Scopes requested:
   - gmail.readonly → read messages (list/sync inbox, sent, trash) [SENSITIVE]
   - gmail.send     → send mail
   - userinfo.email → resolve the mailbox address
   Requires GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET.
   NOTE: we deliberately avoid the RESTRICTED gmail.modify scope so that
   Google OAuth verification does NOT require a third-party CASA security
   audit. readonly + send are SENSITIVE scopes (standard verification only).
   Trade-off: the mailbox is read-only in the provider — no mark-read /
   archive / trash write-back to Gmail (those actions were removed).
   ═══════════════════════════════════════════════════════════════ */

import type {
  EmailProviderDefinition,
  EmailTokenResponse,
  EmailRefreshResponse,
} from '../types';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

export const gmailProvider: EmailProviderDefinition = {
  slug: 'gmail',
  display_name: 'Gmail',
  scopes: SCOPES,
  env_client_id: 'GMAIL_CLIENT_ID',
  env_client_secret: 'GMAIL_CLIENT_SECRET',
  use_pkce: false,

  buildAuthorizeUrl: ({ clientId, redirectUri, state }) => {
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SCOPES.join(' '));
    url.searchParams.set('state', state);
    // access_type=offline + prompt=consent → guarantees a refresh_token,
    // even on re-consent (Google only returns it on first grant otherwise).
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('include_granted_scopes', 'true');
    return url.toString();
  },

  exchangeCode: async ({ code, redirectUri, clientId, clientSecret }): Promise<EmailTokenResponse> => {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Gmail token exchange failed: ${json.error_description || json.error || res.status}`);
    }

    let email = '';
    try {
      email = await gmailProvider.getEmailAddress(json.access_token);
    } catch {
      /* profile fetch is best-effort; account service can retry */
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
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Gmail token refresh failed: ${json.error_description || json.error || res.status}`);
    }

    return {
      access_token: json.access_token,
      // Google does not return a new refresh_token on refresh — keep the old one.
      refresh_token: json.refresh_token,
      expires_in: json.expires_in,
      scope: json.scope,
    };
  },

  getEmailAddress: async (accessToken: string): Promise<string> => {
    const res = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Gmail userinfo failed: ${res.status}`);
    const json = await res.json();
    return String(json.email || '');
  },
};
