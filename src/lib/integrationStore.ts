/* ═══════════════════════════════════════════════════════════════
   Integration Connection Store
   Real backend-backed API client for integration connections.
   Replaces the previous localStorage-only implementation.
   ═══════════════════════════════════════════════════════════════ */

import { supabase } from './supabase';

const API_BASE = import.meta.env.VITE_API_URL || '';

// ── Types ──────────────────────────────────────────────────────

export type ConnectionStatus =
  | 'not_connected'
  | 'setup_required'
  | 'pending_authorization'
  | 'connected'
  | 'token_expired'
  | 'reconnect_required'
  | 'error'
  | 'disabled';

export interface ConnectionInfo {
  id: string;
  app_id: string;
  status: ConnectionStatus;
  auth_type: string | null;
  connected_account_name: string | null;
  connected_account_id: string | null;
  scopes_granted: string[] | null;
  last_tested: string | null;
  last_test_result: string | null;
  last_error: string | null;
  connected_at: string | null;
  disconnected_at: string | null;
}

export interface ProviderInfo {
  slug: string;
  display_name: string;
  auth_type: string;
  credential_fields: CredentialField[];
  scopes: string[];
}

export interface CredentialField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url';
  required: boolean;
  placeholder?: string;
  help_text?: string;
  validation_pattern?: string;
}

export interface TestResult {
  success: boolean;
  account_name?: string;
  account_id?: string;
  message?: string;
  error?: string;
}

// ── Auth helper ────────────────────────────────────────────────

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  };
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `API error: ${res.status}`);
  }
  return data as T;
}

// ── Connection cache (in-memory, refreshed on demand) ─────────

let connectionCache: Map<string, ConnectionInfo> = new Map();
let cacheLoaded = false;

function updateCache(conn: ConnectionInfo) {
  connectionCache.set(conn.app_id, conn);
}

function removeFromCache(appId: string) {
  connectionCache.delete(appId);
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Fetch all connections for the current org.
 */
export async function fetchAllConnections(): Promise<ConnectionInfo[]> {
  const { connections } = await apiFetch<{ connections: ConnectionInfo[] }>('/integrations');
  connectionCache = new Map(connections.map((c) => [c.app_id, c]));
  cacheLoaded = true;
  return connections;
}

/**
 * Get a single connection status.
 */
export async function fetchConnectionStatus(appId: string): Promise<ConnectionInfo | null> {
  const { connection } = await apiFetch<{ connection: ConnectionInfo | null }>(`/integrations/${appId}/status`);
  if (connection) updateCache(connection);
  return connection;
}

/**
 * Get cached connection (call fetchAllConnections first).
 */
export function getConnection(appId: string): ConnectionInfo | null {
  return connectionCache.get(appId) || null;
}

/**
 * Get all cached connected app IDs.
 */
export function getConnectedAppIds(): string[] {
  return Array.from(connectionCache.entries())
    .filter(([, c]) => c.status === 'connected')
    .map(([id]) => id);
}

/**
 * Get provider info (auth type, credential fields, scopes).
 */
export async function fetchProviderInfo(appId: string): Promise<ProviderInfo> {
  return apiFetch<ProviderInfo>(`/integrations/${appId}/provider`);
}

/**
 * Start OAuth flow — returns authorize URL to redirect to.
 */
export async function startOAuthFlow(appId: string): Promise<string> {
  const { authorize_url } = await apiFetch<{ authorize_url: string }>(
    `/integrations/${appId}/connect/oauth`,
    {
      method: 'POST',
      body: JSON.stringify({
        callback_base_url: API_BASE,
      }),
    },
  );
  return authorize_url;
}

/**
 * Connect with credentials (API key, etc.).
 */
export async function connectWithCredentials(
  appId: string,
  credentials: Record<string, string>,
): Promise<{ success: boolean; connection?: ConnectionInfo; error?: string }> {
  const result = await apiFetch<{ success: boolean; connection?: ConnectionInfo; error?: string }>(
    `/integrations/${appId}/connect/credentials`,
    {
      method: 'POST',
      body: JSON.stringify({ credentials }),
    },
  );
  if (result.connection) updateCache(result.connection);
  return result;
}

/**
 * Test an existing connection.
 */
export async function testConnectionApi(appId: string): Promise<TestResult> {
  return apiFetch<TestResult>(`/integrations/${appId}/test`, { method: 'POST' });
}

/**
 * Disconnect an app.
 */
export async function disconnectApp(appId: string): Promise<void> {
  await apiFetch(`/integrations/${appId}/disconnect`, { method: 'POST' });
  removeFromCache(appId);
}

/**
 * Refresh an expired OAuth token.
 */
export async function refreshToken(appId: string): Promise<boolean> {
  const { success } = await apiFetch<{ success: boolean }>(`/integrations/${appId}/refresh`, { method: 'POST' });
  return success;
}

// ── Legacy-compatible helpers ──────────────────────────────────

/**
 * Resolves the display status for an integration.
 * Works with cached data — call fetchAllConnections() first.
 */
export function resolveAppStatus(
  appId: string,
  connectionType: string,
): 'connected' | 'available' | 'coming_soon' | 'requires_setup' | 'error' | 'pending' | 'token_expired' {
  if (connectionType === 'internal') return 'connected';
  if (connectionType === 'coming_soon') return 'coming_soon';

  const conn = connectionCache.get(appId);
  if (!conn || conn.status === 'not_connected') return 'available';

  switch (conn.status) {
    case 'connected': return 'connected';
    case 'setup_required': return 'requires_setup';
    case 'pending_authorization': return 'pending';
    case 'token_expired': return 'token_expired';
    case 'reconnect_required': return 'error';
    case 'error': return 'error';
    case 'disabled': return 'available';
    default: return 'available';
  }
}

// ── Deprecated (no-op stubs for gradual migration) ─────────────

/** @deprecated Use connectWithCredentials instead */
export function saveConnection(_appId: string, _credentials: Record<string, string>) {
  console.warn('[integrationStore] saveConnection is deprecated. Use connectWithCredentials().');
  return null;
}

/** @deprecated Use fetchAllConnections instead */
export function getAllConnections(): Record<string, ConnectionInfo> {
  const result: Record<string, ConnectionInfo> = {};
  connectionCache.forEach((v, k) => { result[k] = v; });
  return result;
}
