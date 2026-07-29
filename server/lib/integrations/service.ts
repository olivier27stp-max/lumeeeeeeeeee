/* ═══════════════════════════════════════════════════════════════
   Integration Service
   Core business logic for connecting, testing, refreshing,
   and disconnecting integrations.
   ═══════════════════════════════════════════════════════════════ */

import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getProvider } from './registry';
import { encryptSecret, encryptCredentials, buildDecryptedCredentials } from './crypto';
import type {
  ConnectionInfo,
  ConnectionRecord,
  ConnectionStatus,
  TokenResponse,
  TestResult,
} from './types';

function getDb(): SupabaseClient {
  const url = process.env.VITE_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// ── Helpers ───────────────────────────────────────────────────

function generateState(): string {
  return randomBytes(32).toString('hex');
}

function toConnectionInfo(r: ConnectionRecord): ConnectionInfo {
  return {
    id: r.id,
    app_id: r.app_id,
    status: r.status,
    auth_type: r.auth_type,
    connected_account_name: r.connected_account_name,
    connected_account_id: r.connected_account_id,
    scopes_granted: r.scopes_granted,
    last_tested: r.last_tested,
    last_test_result: r.last_test_result,
    last_error: r.last_error,
    connected_at: r.connected_at,
    disconnected_at: r.disconnected_at,
  };
}

// ── Audit logging ─────────────────────────────────────────────

async function auditLog(params: {
  orgId: string;
  appId: string;
  userId: string;
  connectionId?: string;
  action: string;
  status?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await getDb().from('integration_audit_logs').insert({
      org_id: params.orgId,
      app_id: params.appId,
      user_id: params.userId,
      connection_id: params.connectionId || null,
      action: params.action,
      status: params.status || null,
      message: params.message || null,
      metadata: params.metadata || {},
    });
  } catch {
    // Audit logging should never break the flow
  }
}

// ── Public API ────────────────────────────────────────────────

/**
 * Get all connections for an org (safe info only, no secrets).
 */
export async function listConnections(orgId: string): Promise<ConnectionInfo[]> {
  const { data, error } = await getDb()
    .from('app_connections')
    .select('*')
    .eq('org_id', orgId)
    .neq('status', 'not_connected');

  if (error) throw new Error(`Failed to list connections: ${error.message}`);
  return (data || []).map(toConnectionInfo);
}

/**
 * Get a single connection (safe info).
 */
export async function getConnection(orgId: string, appId: string): Promise<ConnectionInfo | null> {
  const { data, error } = await getDb()
    .from('app_connections')
    .select('*')
    .eq('org_id', orgId)
    .eq('app_id', appId)
    .maybeSingle();

  if (error) throw new Error(`Failed to get connection: ${error.message}`);
  return data ? toConnectionInfo(data) : null;
}

/**
 * Start an OAuth flow: generate state, store it, return authorize URL.
 */
export async function startOAuth(params: {
  orgId: string;
  userId: string;
  appId: string;
  callbackBaseUrl: string;
}): Promise<{ authorize_url: string }> {
  const provider = getProvider(params.appId);
  if (!provider) throw new Error(`Unknown provider: ${params.appId}`);
  if (provider.auth_type !== 'oauth' || !provider.oauth) {
    throw new Error(`Provider ${params.appId} does not support OAuth`);
  }

  const clientId = provider.env_client_id ? process.env[provider.env_client_id] || '' : '';
  if (!clientId) {
    throw new Error(`Missing client ID for ${params.appId}. Set ${provider.env_client_id} in environment.`);
  }

  const state = generateState();
  const redirectUri = `${params.callbackBaseUrl}/api/integrations/${params.appId}/callback`;

  // Store state for CSRF verification
  const { error: stateError } = await getDb()
    .from('integration_oauth_states')
    .insert({
      org_id: params.orgId,
      user_id: params.userId,
      app_id: params.appId,
      state,
      redirect_uri: redirectUri,
    });

  if (stateError) throw new Error(`Failed to store OAuth state: ${stateError.message}`);

  // Build authorize URL
  let authorizeUrl: string;
  if (provider.buildAuthorizeUrl) {
    authorizeUrl = provider.buildAuthorizeUrl({
      clientId,
      redirectUri,
      state,
      scopes: provider.oauth.scopes,
    });
  } else {
    const url = new URL(provider.oauth.authorize_url);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('response_type', 'code');
    if (provider.oauth.scopes.length > 0) {
      url.searchParams.set('scope', provider.oauth.scopes.join(' '));
    }
    if (provider.oauth.extra_authorize_params) {
      for (const [k, v] of Object.entries(provider.oauth.extra_authorize_params)) {
        url.searchParams.set(k, v);
      }
    }
    authorizeUrl = url.toString();
  }

  await auditLog({
    orgId: params.orgId,
    appId: params.appId,
    userId: params.userId,
    action: 'oauth_redirect',
    message: 'OAuth flow started, redirecting to provider',
  });

  // Upsert connection as pending
  await getDb()
    .from('app_connections')
    .upsert({
      org_id: params.orgId,
      app_id: params.appId,
      status: 'pending_authorization',
      auth_type: 'oauth',
      connected_by: params.userId,
    }, { onConflict: 'org_id,app_id' });

  return { authorize_url: authorizeUrl };
}

/**
 * Handle OAuth callback: verify state, exchange code, test, save.
 */
export async function handleOAuthCallback(params: {
  appId: string;
  code: string;
  state: string;
  callbackBaseUrl: string;
  /**
   * Non-secret identifiers some providers return on the callback query
   * rather than in the token response (e.g. Intuit's `realmId`). Stored
   * alongside the credentials so later API calls can address the account.
   */
  callbackParams?: Record<string, string>;
}): Promise<{ success: boolean; orgId: string; error?: string }> {
  const db = getDb();

  // 1. Verify state
  const { data: stateRecord, error: stateError } = await db
    .from('integration_oauth_states')
    .select('*')
    .eq('state', params.state)
    .eq('app_id', params.appId)
    .is('consumed_at', null)
    .maybeSingle();

  if (stateError || !stateRecord) {
    return { success: false, orgId: '', error: 'Invalid or expired callback state' };
  }

  if (new Date(stateRecord.expires_at) < new Date()) {
    return { success: false, orgId: stateRecord.org_id, error: 'OAuth state expired. Please try again.' };
  }

  // Mark state as consumed
  await db
    .from('integration_oauth_states')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', stateRecord.id);

  // 2. Get provider
  const provider = getProvider(params.appId);
  if (!provider?.exchangeCode) {
    return { success: false, orgId: stateRecord.org_id, error: `No token exchange handler for ${params.appId}` };
  }

  const clientId = provider.env_client_id ? process.env[provider.env_client_id] || '' : '';
  const clientSecret = provider.env_client_secret ? process.env[provider.env_client_secret] || '' : '';

  // 3. Exchange code for tokens
  let tokens: TokenResponse;
  try {
    tokens = await provider.exchangeCode({
      code: params.code,
      redirectUri: stateRecord.redirect_uri,
      clientId,
      clientSecret,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Token exchange failed';
    await updateConnectionError(db, stateRecord.org_id, params.appId, errorMsg);
    await auditLog({
      orgId: stateRecord.org_id,
      appId: params.appId,
      userId: stateRecord.user_id,
      action: 'oauth_callback',
      status: 'error',
      message: errorMsg,
    });
    return { success: false, orgId: stateRecord.org_id, error: errorMsg };
  }

  // 4. Encrypt and store tokens
  const tokenExpiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;

  // Callback identifiers (Intuit realm id, …) are not secrets, but they
  // live with the credentials so providers receive them via `extra`.
  const extraCredentials = { ...(params.callbackParams || {}) };

  const updatePayload: Record<string, unknown> = {
    status: 'connected' as ConnectionStatus,
    auth_type: 'oauth',
    encrypted_access_token: encryptSecret(tokens.access_token),
    encrypted_refresh_token: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
    token_expires_at: tokenExpiresAt,
    encrypted_credentials: Object.keys(extraCredentials).length
      ? encryptCredentials(extraCredentials)
      : {},
    connected_account_name: tokens.account_name || null,
    connected_account_id: tokens.account_id || params.callbackParams?.realm_id || null,
    scopes_granted: tokens.scope ? tokens.scope.split(' ') : provider.oauth?.scopes || [],
    connected_at: new Date().toISOString(),
    last_tested: new Date().toISOString(),
    last_test_result: 'success',
    last_error: null,
    error_message: null,
    disconnected_at: null,
  };

  // 5. Test connection if possible
  try {
    const testResult = await provider.testConnection({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      extra: extraCredentials,
    });
    if (!testResult.success) {
      updatePayload.status = 'error';
      updatePayload.last_test_result = 'failure';
      updatePayload.last_error = testResult.error || 'Connection test failed after OAuth';
    } else {
      if (testResult.account_name) updatePayload.connected_account_name = testResult.account_name;
      if (testResult.account_id) updatePayload.connected_account_id = testResult.account_id;
    }
  } catch {
    // Test failure shouldn't prevent storage — token is valid from OAuth
  }

  await db
    .from('app_connections')
    .upsert({
      org_id: stateRecord.org_id,
      app_id: params.appId,
      connected_by: stateRecord.user_id,
      ...updatePayload,
    }, { onConflict: 'org_id,app_id' });

  await auditLog({
    orgId: stateRecord.org_id,
    appId: params.appId,
    userId: stateRecord.user_id,
    action: 'oauth_callback',
    status: updatePayload.status === 'connected' ? 'success' : 'error',
    message: updatePayload.status === 'connected' ? 'OAuth completed successfully' : String(updatePayload.last_error),
  });

  return {
    success: updatePayload.status === 'connected',
    orgId: stateRecord.org_id,
    error: updatePayload.status !== 'connected' ? String(updatePayload.last_error) : undefined,
  };
}

/**
 * Connect with API key / credentials: validate, encrypt, store.
 */
export async function connectWithCredentials(params: {
  orgId: string;
  userId: string;
  appId: string;
  credentials: Record<string, string>;
}): Promise<{ success: boolean; connection?: ConnectionInfo; error?: string }> {
  const provider = getProvider(params.appId);
  if (!provider) return { success: false, error: `Unknown provider: ${params.appId}` };

  // Validate required fields
  if (provider.credential_fields) {
    for (const field of provider.credential_fields) {
      if (field.required && !params.credentials[field.key]?.trim()) {
        return { success: false, error: `Missing required field: ${field.label}` };
      }
    }
  }

  await auditLog({
    orgId: params.orgId,
    appId: params.appId,
    userId: params.userId,
    action: 'credentials_submitted',
    message: 'Credentials submitted, testing connection',
  });

  // Test the connection with real credentials
  let testResult: TestResult;
  try {
    const decrypted = {
      extra: params.credentials,
      api_key: params.credentials.api_key || params.credentials.secret_key,
      api_secret: params.credentials.api_secret || params.credentials.auth_token,
    };
    testResult = await provider.testConnection(decrypted);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Connection test failed';
    return { success: false, error: errorMsg };
  }

  if (!testResult.success) {
    await auditLog({
      orgId: params.orgId,
      appId: params.appId,
      userId: params.userId,
      action: 'connection_tested',
      status: 'failure',
      message: testResult.error || 'Credentials are invalid',
    });
    return { success: false, error: testResult.error || 'Credentials are invalid. Please check and try again.' };
  }

  // Encrypt and store
  const encryptedCreds = encryptCredentials(params.credentials);

  const { data, error } = await getDb()
    .from('app_connections')
    .upsert({
      org_id: params.orgId,
      app_id: params.appId,
      status: 'connected',
      auth_type: provider.auth_type,
      encrypted_credentials: encryptedCreds,
      connected_account_name: testResult.account_name || null,
      connected_account_id: testResult.account_id || null,
      connected_at: new Date().toISOString(),
      connected_by: params.userId,
      last_tested: new Date().toISOString(),
      last_test_result: 'success',
      last_error: null,
      error_message: null,
      disconnected_at: null,
    }, { onConflict: 'org_id,app_id' })
    .select()
    .single();

  if (error) return { success: false, error: `Failed to save connection: ${error.message}` };

  await auditLog({
    orgId: params.orgId,
    appId: params.appId,
    userId: params.userId,
    connectionId: data.id,
    action: 'connection_validated',
    status: 'success',
    message: `Connected as ${testResult.account_name || params.appId}`,
  });

  return { success: true, connection: toConnectionInfo(data) };
}

/**
 * Test an existing connection.
 */
export async function testConnection(orgId: string, appId: string): Promise<TestResult> {
  const db = getDb();
  const { data: conn } = await db
    .from('app_connections')
    .select('*')
    .eq('org_id', orgId)
    .eq('app_id', appId)
    .maybeSingle();

  if (!conn) return { success: false, error: 'No connection found' };

  const provider = getProvider(appId);
  if (!provider) return { success: false, error: `Unknown provider: ${appId}` };

  const creds = buildDecryptedCredentials(conn);
  let result: TestResult;
  try {
    result = await provider.testConnection(creds);
  } catch (err) {
    result = { success: false, error: err instanceof Error ? err.message : 'Test failed' };
  }

  // An OAuth access token that simply lapsed is not a broken connection.
  // Intuit's expire after an hour, so testing an idle integration would
  // otherwise always report failure. Refresh once, then retry.
  if (!result.success && conn.auth_type === 'oauth' && conn.encrypted_refresh_token) {
    const refreshed = await refreshOAuthToken(orgId, appId);
    if (refreshed) {
      const { data: renewed } = await db
        .from('app_connections')
        .select('*')
        .eq('org_id', orgId)
        .eq('app_id', appId)
        .maybeSingle();
      if (renewed) {
        try {
          result = await provider.testConnection(buildDecryptedCredentials(renewed));
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : 'Test failed' };
        }
      }
    }
  }

  // Update test result in DB
  await db
    .from('app_connections')
    .update({
      last_tested: new Date().toISOString(),
      last_test_result: result.success ? 'success' : 'failure',
      last_error: result.error || null,
      status: result.success ? 'connected' : (conn.status === 'connected' ? 'error' : conn.status),
    })
    .eq('org_id', orgId)
    .eq('app_id', appId);

  return result;
}

/**
 * Disconnect an app: revoke if possible, update status.
 */
export async function disconnect(params: {
  orgId: string;
  userId: string;
  appId: string;
}): Promise<void> {
  const db = getDb();
  const { data: conn } = await db
    .from('app_connections')
    .select('*')
    .eq('org_id', params.orgId)
    .eq('app_id', params.appId)
    .maybeSingle();

  if (!conn) return;

  // Try to revoke at provider side
  const provider = getProvider(params.appId);
  if (provider?.revokeAccess && conn.status === 'connected') {
    try {
      const creds = buildDecryptedCredentials(conn);
      await provider.revokeAccess(creds);
    } catch {
      // Revocation failure shouldn't prevent disconnect
    }
  }

  // Clear secrets and mark disconnected
  await db
    .from('app_connections')
    .update({
      status: 'not_connected',
      encrypted_access_token: null,
      encrypted_refresh_token: null,
      encrypted_credentials: {},
      token_expires_at: null,
      disconnected_at: new Date().toISOString(),
      last_error: null,
      error_message: null,
    })
    .eq('org_id', params.orgId)
    .eq('app_id', params.appId);

  await auditLog({
    orgId: params.orgId,
    appId: params.appId,
    userId: params.userId,
    connectionId: conn.id,
    action: 'disconnected',
    status: 'success',
    message: 'Integration disconnected',
  });
}

/**
 * Refresh an expired OAuth token.
 */
export async function refreshOAuthToken(orgId: string, appId: string): Promise<boolean> {
  const db = getDb();
  const { data: conn } = await db
    .from('app_connections')
    .select('*')
    .eq('org_id', orgId)
    .eq('app_id', appId)
    .maybeSingle();

  if (!conn?.encrypted_refresh_token) return false;

  const provider = getProvider(appId);
  if (!provider?.refreshToken) return false;

  const clientId = provider.env_client_id ? process.env[provider.env_client_id] || '' : '';
  const clientSecret = provider.env_client_secret ? process.env[provider.env_client_secret] || '' : '';

  const creds = buildDecryptedCredentials(conn);
  if (!creds.refresh_token) return false;

  try {
    const tokens = await provider.refreshToken({
      refreshToken: creds.refresh_token,
      clientId,
      clientSecret,
    });

    const tokenExpiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;

    await db
      .from('app_connections')
      .update({
        status: 'connected',
        encrypted_access_token: encryptSecret(tokens.access_token),
        encrypted_refresh_token: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : conn.encrypted_refresh_token,
        token_expires_at: tokenExpiresAt,
        last_error: null,
        error_message: null,
      })
      .eq('org_id', orgId)
      .eq('app_id', appId);

    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Token refresh failed';

    // `invalid_grant` means the refresh token itself is dead — revoked by the
    // user, expired (Intuit: 100 days), or already rotated. Retrying can never
    // succeed, so the connection must ask for a fresh authorization instead of
    // sitting in a state that looks recoverable.
    const unrecoverable = /invalid_grant|invalid_request|unauthorized_client/i.test(message);

    await db
      .from('app_connections')
      .update({
        status: unrecoverable ? 'reconnect_required' : 'token_expired',
        last_error: unrecoverable
          ? 'Authorization is no longer valid — please reconnect this integration.'
          : message,
      })
      .eq('org_id', orgId)
      .eq('app_id', appId);

    return false;
  }
}

/**
 * Return a valid access token for an org's OAuth integration, refreshing
 * it first when it is expired or about to be.
 *
 * Any caller that hits a provider API must go through this rather than
 * reading the stored token directly: Intuit access tokens live one hour,
 * so a token read straight from the row is expired far more often than
 * not. The 2-minute skew covers a refresh landing just before expiry.
 *
 * Returns null when there is no usable token — the caller should surface
 * a "reconnect required" state rather than retrying.
 */
export async function getValidAccessToken(
  orgId: string,
  appId: string,
): Promise<{ access_token: string; extra: Record<string, string> } | null> {
  const db = getDb();
  const { data: conn } = await db
    .from('app_connections')
    .select('*')
    .eq('org_id', orgId)
    .eq('app_id', appId)
    .maybeSingle();

  if (!conn || conn.status === 'not_connected') return null;

  const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  const stillValid = expiresAt - Date.now() > 120_000;

  if (!stillValid && conn.encrypted_refresh_token) {
    const ok = await refreshOAuthToken(orgId, appId);
    if (!ok) return null;
    const { data: renewed } = await db
      .from('app_connections')
      .select('*')
      .eq('org_id', orgId)
      .eq('app_id', appId)
      .maybeSingle();
    if (!renewed) return null;
    const creds = buildDecryptedCredentials(renewed);
    return creds.access_token
      ? { access_token: creds.access_token, extra: creds.extra || {} }
      : null;
  }

  const creds = buildDecryptedCredentials(conn);
  return creds.access_token
    ? { access_token: creds.access_token, extra: creds.extra || {} }
    : null;
}

// ── Internal helpers ──────────────────────────────────────────

async function updateConnectionError(db: SupabaseClient, orgId: string, appId: string, error: string) {
  await db
    .from('app_connections')
    .upsert({
      org_id: orgId,
      app_id: appId,
      status: 'error',
      last_error: error,
      error_message: error,
    }, { onConflict: 'org_id,app_id' });
}
