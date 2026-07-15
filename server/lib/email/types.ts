/* ═══════════════════════════════════════════════════════════════
   Email Provider Types
   Shared contract for Gmail (Gmail API) and Outlook (MS Graph).
   Mirrors the shape of integrations/types.ts, but scoped per-OWNER
   (user mailbox), not per-org.
   ═══════════════════════════════════════════════════════════════ */

export type EmailProviderSlug = 'gmail' | 'outlook';

export type EmailAccountStatus =
  | 'connected'
  | 'error'
  | 'reconnect_required'
  | 'disconnected';

/** Tokens + profile returned after a successful OAuth code exchange. */
export interface EmailTokenResponse {
  access_token: string;
  refresh_token?: string;
  /** Seconds until the access token expires. */
  expires_in?: number;
  scope?: string;
  /** The mailbox address (e.g. owner@gmail.com). */
  email_address?: string;
  raw?: Record<string, unknown>;
}

/** Result of exchanging a refresh token for a fresh access token. */
export interface EmailRefreshResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

export interface EmailProviderDefinition {
  slug: EmailProviderSlug;
  display_name: string;

  /** OAuth scopes requested (read + send + profile). */
  scopes: string[];

  /** Env var names holding the OAuth client credentials. */
  env_client_id: string;
  env_client_secret: string;

  /** Whether this provider uses PKCE (Outlook does). */
  use_pkce: boolean;

  /** Build the provider's authorize URL. */
  buildAuthorizeUrl: (params: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge?: string;
  }) => string;

  /** Exchange an authorization code for tokens + profile. */
  exchangeCode: (params: {
    code: string;
    redirectUri: string;
    clientId: string;
    clientSecret: string;
    codeVerifier?: string;
  }) => Promise<EmailTokenResponse>;

  /** Refresh an expired access token. */
  refreshToken: (params: {
    refreshToken: string;
    clientId: string;
    clientSecret: string;
  }) => Promise<EmailRefreshResponse>;

  /** Fetch the mailbox address for the given access token. */
  getEmailAddress: (accessToken: string) => Promise<string>;
}

/** DB row (server-side, includes encrypted secrets). */
export interface EmailAccountRecord {
  id: string;
  org_id: string;
  user_id: string;
  provider: EmailProviderSlug;
  email_address: string;
  encrypted_access_token: string | null;
  encrypted_refresh_token: string | null;
  token_expires_at: string | null;
  history_id: string | null;
  delta_link: string | null;
  scopes: string[];
  status: EmailAccountStatus;
  last_error: string | null;
  last_synced_at: string | null;
  connected_at: string;
  created_at: string;
  updated_at: string;
}

/** Safe info returned to the frontend — NEVER includes tokens. */
export interface EmailAccountInfo {
  id: string;
  provider: EmailProviderSlug;
  email_address: string;
  status: EmailAccountStatus;
  scopes: string[];
  last_error: string | null;
  last_synced_at: string | null;
  connected_at: string;
}

export function toEmailAccountInfo(r: EmailAccountRecord): EmailAccountInfo {
  return {
    id: r.id,
    provider: r.provider,
    email_address: r.email_address,
    status: r.status,
    scopes: r.scopes,
    last_error: r.last_error,
    last_synced_at: r.last_synced_at,
    connected_at: r.connected_at,
  };
}
