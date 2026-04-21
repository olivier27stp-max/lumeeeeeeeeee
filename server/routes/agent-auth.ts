/* ═══════════════════════════════════════════════════════════════
   External Agent Auth — Login + Webhook
   ─────────────────────────────────────────────────────────────
   Minimal, multi-tenant entry points for external agents that
   want to participate in a user's chat after the internal AI
   backend was removed (cleanup Phase 4.2). Two endpoints:

   POST /api/agent/connect
     Body: { token: "lk_live_..." }
     Validates a raw API key (stored hashed in `api_keys`) via
     server/lib/api-keys.ts, then returns a short-lived (15-min)
     HMAC-signed JWT that the external agent MUST send back as
     a Bearer token when calling /api/agent/webhook.

   POST /api/agent/webhook
     Headers: Authorization: Bearer <jwt from /connect>
     Body:   { sessionId?, content, role?, messageType? }
     Inserts a row into `agent_messages`, scoped to the org_id
     baked into the JWT (no client-supplied org_id — tamper-proof).

   Signing key: AGENT_JWT_SECRET env var. If not set, a process-
   local random key is generated at startup (tokens won't survive
   restarts — acceptable for 15-min TTL, but for production set
   AGENT_JWT_SECRET to a stable 32+ byte base64 value).

   ─────────────────────────────────────────────────────────────
   DB tables preserved (never dropped): ai_*, agent_*, memory_*
   ═══════════════════════════════════════════════════════════════ */

import express from 'express';
import crypto from 'crypto';
import { validateApiKey } from '../lib/api-keys';
import { getServiceClient } from '../lib/supabase';
import { logSecurityEvent, extractIP } from '../lib/security';

const router = express.Router();

// ── JWT helpers (HMAC-SHA256, no external deps) ──
const JWT_SECRET = process.env.AGENT_JWT_SECRET || crypto.randomBytes(48).toString('base64');
const JWT_TTL_SECONDS = 15 * 60; // 15 minutes

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signAgentJwt(payload: Record<string, unknown>): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + JWT_TTL_SECONDS };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(body));
  const sig = b64url(crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest());
  return `${h}.${p}.${sig}`;
}

function verifyAgentJwt(token: string): { orgId: string; keyId: string } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const expected = b64url(crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest());
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    const body = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    if (!body.exp || body.exp < Math.floor(Date.now() / 1000)) return null;
    if (!body.org_id || !body.key_id) return null;
    return { orgId: String(body.org_id), keyId: String(body.key_id) };
  } catch {
    return null;
  }
}

// ── POST /api/agent/connect — exchange API key for JWT ──
router.post('/agent/connect', express.json({ limit: '4kb' }), async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  if (!token) {
    return res.status(400).json({ error: 'Missing token' });
  }

  const keyData = await validateApiKey(token);
  if (!keyData) {
    logSecurityEvent({
      event_type: 'agent_connect_invalid_key',
      severity: 'medium',
      source: 'api',
      ip_address: extractIP(req),
      details: { prefix: token.slice(0, 12) },
    });
    return res.status(401).json({ error: 'Invalid or revoked API key' });
  }

  const jwt = signAgentJwt({ org_id: keyData.orgId, key_id: keyData.keyId });
  logSecurityEvent({
    org_id: keyData.orgId,
    event_type: 'agent_connect_success',
    severity: 'info',
    source: 'api',
    ip_address: extractIP(req),
    details: { key_id: keyData.keyId },
  });
  res.json({ jwt, expiresIn: JWT_TTL_SECONDS });
});

// ── POST /api/agent/webhook — insert a message scoped to org_id ──
router.post('/agent/webhook', express.json({ limit: '64kb' }), async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Missing Bearer token' });

  const ctx = verifyAgentJwt(token);
  if (!ctx) return res.status(401).json({ error: 'Invalid or expired token' });

  const { sessionId, content, role, messageType } = req.body || {};
  if (typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'content is required' });
  }
  if (content.length > 16_000) {
    return res.status(413).json({ error: 'content too large' });
  }

  const admin = getServiceClient();
  const { data, error } = await admin
    .from('agent_messages')
    .insert({
      org_id: ctx.orgId,                              // tamper-proof — from JWT only
      session_id: sessionId || null,
      role: role === 'assistant' ? 'assistant' : role === 'system' ? 'system' : 'tool',
      content: content.trim(),
      message_type: messageType || 'text',
      structured_data: null,
    })
    .select('id, created_at')
    .single();

  if (error) {
    logSecurityEvent({
      org_id: ctx.orgId,
      event_type: 'agent_webhook_insert_failed',
      severity: 'medium',
      source: 'api',
      ip_address: extractIP(req),
      details: { key_id: ctx.keyId, error: error.message },
    });
    return res.status(500).json({ error: 'Failed to insert message' });
  }

  res.json({ ok: true, messageId: data.id, createdAt: data.created_at });
});

export default router;
