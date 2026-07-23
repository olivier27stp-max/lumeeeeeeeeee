/* ═══════════════════════════════════════════════════════════════
   Email Account Service
   Connect / list / disconnect / refresh personal mailboxes, scoped
   per OWNER (org_id + user_id). Reuses the app's AES-256-GCM crypto.
   All DB access goes through the service_role client; RLS still
   protects direct client reads.
   ═══════════════════════════════════════════════════════════════ */

import { randomBytes, createHash } from 'node:crypto';
import { getServiceClient } from '../supabase';
import { getEmailProvider } from './providers';
import { encryptSecret } from './crypto';
import {
  toEmailAccountInfo,
  type EmailAccountInfo,
  type EmailAccountRecord,
  type EmailProviderSlug,
} from './types';

// ── PKCE helpers ──────────────────────────────────────────────
function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function generateState(): string {
  return randomBytes(32).toString('hex');
}
function generateCodeVerifier(): string {
  return base64url(randomBytes(32));
}
function codeChallengeFor(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

function clientCreds(provider: EmailProviderSlug): { clientId: string; clientSecret: string } {
  const p = getEmailProvider(provider)!;
  const clientId = process.env[p.env_client_id] || '';
  const clientSecret = process.env[p.env_client_secret] || '';
  return { clientId, clientSecret };
}

// ── Start OAuth ───────────────────────────────────────────────
export async function startEmailOAuth(params: {
  orgId: string;
  userId: string;
  provider: EmailProviderSlug;
  callbackBaseUrl: string;
}): Promise<{ authorize_url: string }> {
  const provider = getEmailProvider(params.provider);
  if (!provider) throw new Error(`Unknown email provider: ${params.provider}`);

  const { clientId } = clientCreds(params.provider);
  if (!clientId) {
    throw new Error(`Missing ${provider.env_client_id}. Add the OAuth client ID to your environment.`);
  }

  const db = getServiceClient();
  const state = generateState();
  const redirectUri = `${params.callbackBaseUrl}/api/email/${params.provider}/callback`;

  const codeVerifier = provider.use_pkce ? generateCodeVerifier() : null;
  const codeChallenge = codeVerifier ? codeChallengeFor(codeVerifier) : undefined;

  const { error } = await db.from('email_oauth_states').insert({
    org_id: params.orgId,
    user_id: params.userId,
    provider: params.provider,
    state,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  if (error) throw new Error(`Failed to store OAuth state: ${error.message}`);

  const authorize_url = provider.buildAuthorizeUrl({ clientId, redirectUri, state, codeChallenge });
  return { authorize_url };
}

// ── Handle OAuth callback ─────────────────────────────────────
export async function handleEmailOAuthCallback(params: {
  provider: EmailProviderSlug;
  code: string;
  state: string;
}): Promise<{ success: boolean; error?: string }> {
  const db = getServiceClient();
  const provider = getEmailProvider(params.provider);
  if (!provider) return { success: false, error: `Unknown email provider: ${params.provider}` };

  // 1. Verify + consume state (CSRF)
  const { data: st } = await db
    .from('email_oauth_states')
    .select('*')
    .eq('state', params.state)
    .eq('provider', params.provider)
    .is('consumed_at', null)
    .maybeSingle();

  if (!st) return { success: false, error: 'Invalid or expired OAuth state' };
  if (new Date(st.expires_at) < new Date()) {
    return { success: false, error: 'OAuth state expired. Please try connecting again.' };
  }
  await db.from('email_oauth_states').update({ consumed_at: new Date().toISOString() }).eq('id', st.id);

  // 2. Exchange code for tokens
  const { clientId, clientSecret } = clientCreds(params.provider);
  let tokens;
  try {
    tokens = await provider.exchangeCode({
      code: params.code,
      redirectUri: st.redirect_uri,
      clientId,
      clientSecret,
      codeVerifier: st.code_verifier || undefined,
    });
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Token exchange failed' };
  }

  const email = tokens.email_address;
  if (!email) {
    return { success: false, error: 'Could not resolve the mailbox address from the provider.' };
  }

  // 3. Encrypt + upsert the account (one per user+provider+address)
  const tokenExpiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;

  const { error } = await db
    .from('email_accounts')
    .upsert({
      org_id: st.org_id,
      user_id: st.user_id,
      provider: params.provider,
      email_address: email,
      encrypted_access_token: tokens.access_token ? encryptSecret(tokens.access_token) : null,
      encrypted_refresh_token: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
      token_expires_at: tokenExpiresAt,
      scopes: tokens.scope ? tokens.scope.split(' ') : provider.scopes,
      status: 'connected',
      last_error: null,
      connected_at: new Date().toISOString(),
    }, { onConflict: 'user_id,provider,email_address' });

  if (error) return { success: false, error: `Failed to save mailbox: ${error.message}` };
  return { success: true };
}

// ── List the caller's own mailboxes (safe info) ───────────────
export async function listEmailAccounts(userId: string): Promise<EmailAccountInfo[]> {
  const { data, error } = await getServiceClient()
    .from('email_accounts')
    .select('*')
    .eq('user_id', userId)
    .neq('status', 'disconnected')
    .order('connected_at', { ascending: false });

  if (error) throw new Error(`Failed to list mailboxes: ${error.message}`);
  return (data as EmailAccountRecord[]).map(toEmailAccountInfo);
}

// ── Disconnect one mailbox (must belong to the caller) ────────
export async function disconnectEmailAccount(userId: string, accountId: string): Promise<void> {
  await getServiceClient()
    .from('email_accounts')
    .update({
      status: 'disconnected',
      encrypted_access_token: null,
      encrypted_refresh_token: null,
      token_expires_at: null,
      history_id: null,
      delta_link: null,
    })
    .eq('id', accountId)
    .eq('user_id', userId); // ownership guard
}

// ── Refresh an access token (returns a valid one, or null) ────
// Used by the sync layer (Étape 2). Refreshes ~2 min before expiry.
export async function getValidAccessToken(accountId: string): Promise<string | null> {
  const db = getServiceClient();
  const { data: acc } = await db
    .from('email_accounts')
    .select('*')
    .eq('id', accountId)
    .maybeSingle();

  if (!acc) return null;
  const record = acc as EmailAccountRecord;

  const notExpired =
    record.token_expires_at && new Date(record.token_expires_at).getTime() - Date.now() > 120_000;
  const { decryptSecret } = await import('./crypto');

  if (notExpired && record.encrypted_access_token) {
    try {
      return decryptSecret(record.encrypted_access_token);
    } catch {
      /* fall through to refresh */
    }
  }

  const markReconnectRequired = async (reason: string) => {
    await db
      .from('email_accounts')
      .update({ status: 'reconnect_required', last_error: reason })
      .eq('id', accountId);
  };

  const provider = getEmailProvider(record.provider);
  if (!provider) return null;
  if (!record.encrypted_refresh_token) {
    await markReconnectRequired('No refresh token stored — please reconnect the mailbox.');
    return null;
  }

  let refreshToken: string;
  try {
    refreshToken = decryptSecret(record.encrypted_refresh_token);
  } catch {
    // Encryption key changed since the token was stored — it can never be
    // decrypted again; only a reconnect can fix it.
    await markReconnectRequired('Stored token could not be decrypted — please reconnect the mailbox.');
    return null;
  }

  const { clientId, clientSecret } = clientCreds(record.provider);
  try {
    const t = await provider.refreshToken({ refreshToken, clientId, clientSecret });
    const expiresAt = t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : null;
    await db
      .from('email_accounts')
      .update({
        encrypted_access_token: encryptSecret(t.access_token),
        encrypted_refresh_token: t.refresh_token ? encryptSecret(t.refresh_token) : record.encrypted_refresh_token,
        token_expires_at: expiresAt,
        status: 'connected',
        last_error: null,
      })
      .eq('id', accountId);
    return t.access_token;
  } catch (err) {
    await db
      .from('email_accounts')
      .update({ status: 'reconnect_required', last_error: err instanceof Error ? err.message : 'Token refresh failed' })
      .eq('id', accountId);
    return null;
  }
}
