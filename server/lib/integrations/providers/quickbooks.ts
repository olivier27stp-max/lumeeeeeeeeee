/* ═══════════════════════════════════════════════════════════════
   Provider — QuickBooks Online
   Auth type: OAuth 2.0 (Intuit)

   Intuit does NOT support client_credentials for the Accounting API:
   every call is scoped to a company (realm) the user explicitly grants
   access to, so an authorization-code flow is the only option.

   The realm id arrives as a query param on the callback — not inside
   the token response — so it is captured in exchangeCode() and stored
   as connected_account_id. Without it no Accounting API call can be
   addressed, which is why a connection missing a realm is reported as
   an error rather than silently "connected".
   ═══════════════════════════════════════════════════════════════ */

import { registerProvider } from '../registry';
import type {
  ProviderDefinition,
  DecryptedCredentials,
  TestResult,
  TokenResponse,
} from '../types';

const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';

/**
 * Production vs sandbox company data live on different hosts. Development
 * keys only ever see sandbox companies, so pointing at the production host
 * with dev keys yields a confusing 401 rather than "wrong environment".
 */
function apiBaseUrl(): string {
  return process.env.QUICKBOOKS_ENV === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

function basicAuth(clientId: string, clientSecret: string): string {
  return Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

/**
 * Intuit returns errors as JSON or HTML depending on the failure.
 *
 * Every response carries an `intuit_tid` header identifying the request on
 * Intuit's side; their support team asks for it first when troubleshooting,
 * so it is appended to the message that gets persisted on the connection.
 */
async function readError(res: Response): Promise<string> {
  const tid = res.headers.get('intuit_tid');
  const suffix = tid ? ` [intuit_tid: ${tid}]` : '';
  const body = await res.text();
  try {
    const json = JSON.parse(body);
    // The Accounting API nests failures under Fault.Error[]; the OAuth
    // endpoints use flat error/error_description fields.
    const fault = json?.Fault?.Error?.[0];
    if (fault) {
      const detail = fault.Detail || fault.Message || 'Unknown error';
      return `${detail}${fault.code ? ` (code ${fault.code})` : ''}${suffix}`;
    }
    return `${json.error_description || json.error || `HTTP ${res.status}`}${suffix}`;
  } catch {
    return `HTTP ${res.status}: ${body.slice(0, 200)}${suffix}`;
  }
}

const quickbooks: ProviderDefinition = {
  slug: 'quickbooks',
  display_name: 'QuickBooks Online',
  auth_type: 'oauth',

  env_client_id: 'QUICKBOOKS_CLIENT_ID',
  env_client_secret: 'QUICKBOOKS_CLIENT_SECRET',

  oauth: {
    authorize_url: 'https://appcenter.intuit.com/connect/oauth2',
    token_url: TOKEN_URL,
    scopes: ['com.intuit.quickbooks.accounting'],
  },

  // ── Exchange the authorization code for tokens ──────────────
  exchangeCode: async ({ code, redirectUri, clientId, clientSecret }): Promise<TokenResponse> => {
    if (!clientId || !clientSecret) {
      throw new Error(
        'QuickBooks is not configured on the server (QUICKBOOKS_CLIENT_ID / QUICKBOOKS_CLIENT_SECRET).',
      );
    }

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        Authorization: `Basic ${basicAuth(clientId, clientSecret)}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!res.ok) {
      throw new Error(`QuickBooks token exchange failed — ${await readError(res)}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
      realmId?: string;
    };

    // The service passes the callback query through on `raw` so the realm
    // captured by the route can be promoted to account_id here.
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      token_type: data.token_type,
      scope: 'com.intuit.quickbooks.accounting',
      account_id: data.realmId,
      account_name: data.realmId ? `QuickBooks (${data.realmId})` : 'QuickBooks',
      raw: data as unknown as Record<string, unknown>,
    };
  },

  // ── Refresh — Intuit access tokens live 1h, refresh tokens 100d ──
  refreshToken: async ({ refreshToken, clientId, clientSecret }): Promise<TokenResponse> => {
    if (!clientId || !clientSecret) {
      throw new Error('QuickBooks is not configured on the server.');
    }

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        Authorization: `Basic ${basicAuth(clientId, clientSecret)}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!res.ok) {
      throw new Error(`QuickBooks token refresh failed — ${await readError(res)}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
    };

    // Intuit rotates the refresh token: persisting the new one matters,
    // otherwise the connection dies silently 100 days later.
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      token_type: data.token_type,
    };
  },

  // ── Test: read the connected company ────────────────────────
  testConnection: async (creds: DecryptedCredentials): Promise<TestResult> => {
    const token = creds.access_token;
    const realmId = creds.extra?.realm_id;

    if (!token) return { success: false, error: 'Not connected to QuickBooks' };
    if (!realmId) {
      return {
        success: false,
        error: 'Missing QuickBooks company id — reconnect the integration.',
      };
    }

    try {
      const res = await fetch(
        `${apiBaseUrl()}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=70`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      );

      // 401 means the access token lapsed; the service refreshes and retries.
      if (res.status === 401) {
        const tid = res.headers.get('intuit_tid');
        return {
          success: false,
          error: `QuickBooks access expired${tid ? ` [intuit_tid: ${tid}]` : ''}`,
        };
      }
      if (!res.ok) {
        return { success: false, error: `QuickBooks API — ${await readError(res)}` };
      }

      const data = (await res.json()) as {
        CompanyInfo?: { CompanyName?: string; LegalName?: string };
      };
      const name =
        data.CompanyInfo?.CompanyName || data.CompanyInfo?.LegalName || `QuickBooks (${realmId})`;

      return { success: true, account_name: name, account_id: realmId };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to reach QuickBooks',
      };
    }
  },

  // ── Revoke at Intuit on disconnect ──────────────────────────
  revokeAccess: async (creds: DecryptedCredentials): Promise<void> => {
    const clientId = process.env.QUICKBOOKS_CLIENT_ID || '';
    const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET || '';
    const token = creds.refresh_token || creds.access_token;
    if (!clientId || !clientSecret || !token) return;

    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Basic ${basicAuth(clientId, clientSecret)}`,
      },
      body: JSON.stringify({ token }),
    });
  },
};

export function registerQuickBooks(): void {
  registerProvider(quickbooks);
}
