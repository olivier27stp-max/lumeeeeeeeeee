/* ═══════════════════════════════════════════════════════════════
   Lume MCP Server — Model Context Protocol endpoint
   ─────────────────────────────────────────────────────────────
   Exposes the org's CRM as MCP tools so any MCP client (Claude,
   Cursor, ChatGPT, a custom agent) can query it in natural language.

   AUTH — X-API-Key: lk_live_… , created in Settings → API & MCP.
   The key carries its own org_id (server-side, from `api_keys`);
   no client-supplied org is ever trusted. The `mcp` scope is
   required — a key without it is rejected even if otherwise valid.

   READ ONLY, BY CONSTRUCTION — this route serves only tools whose
   `kind === 'read'`. Write tools in the registry have no handler at
   all: they produce a *proposal* the user confirms in the Lume UI
   (see the header of server/lib/agent/tools.ts). An MCP client has
   no such confirmation step, so writes stay out. Both conditions
   are checked below; neither alone is relied upon.

   ⚠️  Adding a `kind: 'read'` tool to AGENT_TOOLS publishes it here
   automatically. Anything unfit for a third-party client must not
   be registered as a read tool.

   TRANSPORT — JSON-RPC 2.0 over HTTP POST (the MCP "streamable
   HTTP" transport, non-streaming subset). Implemented directly:
   three methods, no SDK dependency, no extra supply-chain surface.
   ═══════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { validateApiKey } from '../lib/api-keys';
import { getServiceClient, requireAuthedClient } from '../lib/supabase';
import { logSecurityEvent, extractIP } from '../lib/security';
import { sendSafeError } from '../lib/error-handler';
import { AGENT_TOOLS, TOOLS_BY_NAME, type AgentTool } from '../lib/agent/tools';
import { validateAccessToken, canonicalResource, baseUrl, SCOPE_MCP_READ } from '../lib/oauth';

const router = Router();

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'lume-crm', version: '1.0.0' };
const REQUIRED_SCOPE = 'mcp';

/** Tools published over MCP: read-only AND actually executable. */
const MCP_TOOLS: AgentTool[] = AGENT_TOOLS.filter((t) => t.kind === 'read' && typeof t.handler === 'function');

/** Gemini FunctionDeclaration → MCP tool descriptor. */
function toMcpTool(tool: AgentTool) {
  return {
    name: tool.declaration.name,
    description: tool.declaration.description,
    inputSchema: tool.declaration.parameters ?? { type: 'object', properties: {} },
  };
}

// ── JSON-RPC helpers ──
type JsonRpcId = string | number | null;

function rpcResult(id: JsonRpcId, result: any) {
  return { jsonrpc: '2.0' as const, id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: '2.0' as const, id, error: { code, message } };
}

// ── Auth ──
// Deux modes coexistent, par ordre de préférence :
//   • OAuth Bearer  → le jeton porte un user_id : RLS redevient actif.
//   • Clé X-API-Key → identifiant partagé par l'org, RLS inactif.
// La clé reste acceptée pour ne rien casser chez ceux qui l'utilisent
// déjà, mais OAuth est le chemin recommandé (et le seul qui pourra
// un jour porter des écritures).
interface McpAuth {
  orgId: string;
  /** Présent en OAuth uniquement — permet un client RLS et un audit nominatif. */
  userId?: string;
  /** Identifiant de la clé (mode clé) ou du jeton (mode OAuth). */
  credentialId: string;
  mode: 'oauth' | 'api_key';
}

/**
 * En-tête exigé par la spec MCP sur un 401 : c'est LUI qui déclenche
 * la découverte OAuth côté client. Sans cet en-tête, Claude ne sait
 * pas où trouver le serveur d'autorisation et ne propose jamais de
 * se connecter.
 */
function challengeHeader(): string {
  let metadata: string;
  try {
    metadata = `${baseUrl()}/.well-known/oauth-protected-resource`;
  } catch {
    // PUBLIC_BASE_URL absent : on ne peut pas annoncer d'URL correcte.
    return `Bearer scope="${SCOPE_MCP_READ}"`;
  }
  return `Bearer resource_metadata="${metadata}", scope="${SCOPE_MCP_READ}"`;
}

/**
 * Authentifie l'appelant (OAuth Bearer ou clé d'API).
 * Répond et renvoie null en cas d'échec.
 */
async function authenticate(req: any, res: any): Promise<McpAuth | null> {
  // ── 1. OAuth Bearer (préféré) ──
  const authz = (req.headers['authorization'] as string | undefined)?.trim();
  if (authz && /^Bearer\s+/i.test(authz)) {
    const token = authz.replace(/^Bearer\s+/i, '').trim();
    const validated = await validateAccessToken(token, canonicalResource());
    if (!validated) {
      logSecurityEvent({
        event_type: 'mcp_oauth_token_invalid',
        severity: 'medium',
        source: 'api',
        ip_address: extractIP(req),
        details: { reason: 'invalide, expiré, révoqué ou audience incorrecte' },
      });
      res.setHeader('WWW-Authenticate', challengeHeader());
      res.status(401).json({ error: 'Invalid or expired access token.' });
      return null;
    }
    if (!validated.scopes.includes(SCOPE_MCP_READ)) {
      res.setHeader(
        'WWW-Authenticate',
        `Bearer error="insufficient_scope", scope="${SCOPE_MCP_READ}"`,
      );
      res.status(403).json({ error: 'insufficient_scope' });
      return null;
    }
    return {
      orgId: validated.orgId,
      userId: validated.userId,
      credentialId: validated.tokenId,
      mode: 'oauth',
    };
  }

  // ── 2. Clé d'API (rétrocompatibilité) ──
  const raw = (req.headers['x-api-key'] as string | undefined)?.trim();
  if (!raw) {
    // Aucune preuve d'identité : c'est ici que le parcours OAuth démarre.
    res.setHeader('WWW-Authenticate', challengeHeader());
    res.status(401).json({ error: 'Authorization required.' });
    return null;
  }

  const key = await validateApiKey(raw);
  if (!key) {
    logSecurityEvent({
      event_type: 'mcp_auth_failed',
      severity: 'medium',
      source: 'api',
      ip_address: extractIP(req),
      details: { key_prefix: raw.slice(0, 12) },
    });
    res.setHeader('WWW-Authenticate', challengeHeader());
    res.status(401).json({ error: 'Invalid, expired or revoked API key.' });
    return null;
  }

  const scopes = key.scopes || [];
  if (!scopes.includes(REQUIRED_SCOPE) && !scopes.includes('*')) {
    logSecurityEvent({
      org_id: key.orgId,
      event_type: 'api_key_scope_denied',
      severity: 'medium',
      source: 'api',
      ip_address: extractIP(req),
      details: { key_id: key.keyId, required: [REQUIRED_SCOPE], granted: scopes, surface: 'mcp' },
    });
    res.status(403).json({ error: `This key lacks the "${REQUIRED_SCOPE}" scope.` });
    return null;
  }

  return { orgId: key.orgId, credentialId: key.keyId, mode: 'api_key' };
}

/**
 * Supabase client used to run tool handlers for an API-key caller.
 *
 * An API key is not tied to a live Supabase session, so there is no user JWT
 * to build an RLS-scoped client from (buildSupabaseWithAuth needs one). We use
 * the service client and rely on the explicit `.eq('org_id', ctx.orgId)` that
 * every read handler already applies, with orgId taken from the key row itself
 * — never from the request body.
 *
 * This trades RLS's second barrier for the handlers' own filter. It is the
 * reason this surface stays read-only: a leak here exposes data, whereas the
 * same gap on a write path would corrupt it. Tests must cover org isolation
 * with two keys from two orgs.
 */
function buildToolClient(): SupabaseClient {
  return getServiceClient();
}

// ═══════════════════════════════════════════════════════════════
// GET /api/mcp/info — what the settings page shows (session auth)
// ═══════════════════════════════════════════════════════════════

router.get('/info', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const base = (process.env.PUBLIC_BASE_URL || process.env.FRONTEND_URL || '').trim().replace(/\/$/, '');
    return res.json({
      enabled: MCP_TOOLS.length > 0,
      url: `${base}/api/mcp`,
      tools: MCP_TOOLS.map((t) => ({
        name: t.declaration.name,
        description: t.declaration.description,
      })),
    });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to load MCP info.', '[mcp/info]');
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/mcp — JSON-RPC 2.0 endpoint (API-key auth)
// ═══════════════════════════════════════════════════════════════

router.post('/', async (req, res) => {
  const auth = await authenticate(req, res);
  if (!auth) return;

  const body = req.body || {};
  const id: JsonRpcId = body.id ?? null;
  const method = String(body.method || '');

  try {
    // ── initialize ──
    if (method === 'initialize') {
      return res.json(
        rpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
        }),
      );
    }

    // ── notifications (no response body per JSON-RPC) ──
    if (method.startsWith('notifications/')) {
      return res.status(202).end();
    }

    // ── ping ──
    if (method === 'ping') {
      return res.json(rpcResult(id, {}));
    }

    // ── tools/list ──
    if (method === 'tools/list') {
      return res.json(rpcResult(id, { tools: MCP_TOOLS.map(toMcpTool) }));
    }

    // ── tools/call ──
    if (method === 'tools/call') {
      const name = String(body.params?.name || '');
      const args = (body.params?.arguments || {}) as Record<string, any>;
      const tool = TOOLS_BY_NAME[name];

      // Unknown, write, or handler-less tools are all refused identically:
      // an MCP client must never reach a mutation path.
      if (!tool || tool.kind !== 'read' || typeof tool.handler !== 'function') {
        return res.json(rpcError(id, -32602, `Unknown or unavailable tool: ${name}`));
      }

      const result = await tool.handler(args, {
        client: buildToolClient(),
        orgId: auth.orgId,
        // En OAuth, l'identité réelle du porteur ; en clé d'API, l'identifiant
        // de la clé (aucun humain derrière). L'audit sait ainsi qui a demandé.
        userId: auth.userId ?? auth.credentialId,
      });

      // MCP returns tool output as content parts; JSON goes in a text part.
      return res.json(
        rpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          isError: Boolean((result as any)?.error),
        }),
      );
    }

    return res.json(rpcError(id, -32601, `Method not found: ${method}`));
  } catch (err: any) {
    // Never surface raw errors to an MCP client (they can leak schema details).
    console.error('[mcp]', err?.message || err);
    return res.json(rpcError(id, -32603, 'Internal error.'));
  }
});

export default router;
