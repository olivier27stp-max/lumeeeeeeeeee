/* ═══════════════════════════════════════════════════════════════
   MCP & API Keys — client for the org's machine credentials.
   ─────────────────────────────────────────────────────────────
   Wraps the existing /api/security/api-keys routes (owner/admin
   only, enforced server-side by requireAdmin + RLS on `api_keys`).

   The raw key is returned ONCE, at creation. It is never stored
   client-side and never retrievable afterwards — only the prefix
   is listed. Losing it means creating a new one.
   ═══════════════════════════════════════════════════════════════ */

import { supabase } from './supabase';

/** Scope granted to a key. `mcp` is read-only tool access for MCP clients. */
export type ApiKeyScope = 'read' | 'write' | 'mcp' | '*';

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: ApiKeyScope[];
  rate_limit_per_minute: number;
  last_used_at: string | null;
  expires_at: string | null;
  revoked: boolean;
  created_at: string;
}

export interface CreatedApiKey {
  id: string;
  /** Raw key — shown once, never again. */
  key: string;
  prefix: string;
  warning: string;
}

async function authedFetch(path: string, init: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
  return json;
}

export async function listApiKeys(): Promise<ApiKey[]> {
  return authedFetch('/api/security/api-keys');
}

export async function createApiKey(params: {
  name: string;
  scopes?: ApiKeyScope[];
  rateLimitPerMinute?: number;
  expiresInDays?: number;
}): Promise<CreatedApiKey> {
  return authedFetch('/api/security/api-keys', {
    method: 'POST',
    body: JSON.stringify({
      name: params.name,
      scopes: params.scopes ?? ['mcp'],
      rate_limit_per_minute: params.rateLimitPerMinute,
      expires_in_days: params.expiresInDays,
    }),
  });
}

export async function revokeApiKey(id: string): Promise<void> {
  await authedFetch(`/api/security/api-keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** A tool exposed over MCP, as advertised by the server. */
export interface McpToolInfo {
  name: string;
  description: string;
}

export interface McpInfo {
  enabled: boolean;
  /** Absolute URL an MCP client should connect to. */
  url: string;
  tools: McpToolInfo[];
}

export async function getMcpInfo(): Promise<McpInfo> {
  return authedFetch('/api/mcp/info');
}

/** Ready-to-paste `claude mcp add` command for this org's server. */
export function buildClaudeCliCommand(url: string, key = '<YOUR_KEY>'): string {
  return `claude mcp add --transport http lume ${url} --header "X-API-Key: ${key}"`;
}

/** Ready-to-paste JSON config for MCP clients that use a config file. */
export function buildMcpJsonConfig(url: string, key = '<YOUR_KEY>'): string {
  return JSON.stringify(
    { mcpServers: { lume: { type: 'http', url, headers: { 'X-API-Key': key } } } },
    null,
    2,
  );
}
