/**
 * LUME CRM — API Key Management
 * ================================
 * Generates, validates, and revokes hashed API keys.
 * Keys are never stored in plaintext — only SHA-256 hash + prefix.
 *
 * Key format: lk_live_<32 random chars> (shown once at creation)
 * Stored:     SHA-256(key), prefix "lk_live_abc1..."
 */

import crypto from 'crypto';
import { getServiceClient } from './supabase';
import { logSecurityEvent, extractIP } from './security';
import { Request, Response, NextFunction } from 'express';

const KEY_PREFIX = 'lk_live_';

/** Generate a new API key (returns raw key — shown once only) */
export async function createApiKey(params: {
  orgId: string;
  userId: string;
  name: string;
  scopes?: string[];
  rateLimitPerMinute?: number;
  expiresInDays?: number;
}): Promise<{ rawKey: string; keyId: string; prefix: string }> {
  const rawKey = KEY_PREFIX + crypto.randomBytes(24).toString('base64url');
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 12) + '...';

  const admin = getServiceClient();
  const { data, error } = await admin
    .from('api_keys')
    .insert({
      org_id: params.orgId,
      created_by: params.userId,
      name: params.name,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      scopes: params.scopes || ['read'],
      rate_limit_per_minute: params.rateLimitPerMinute || 60,
      expires_at: params.expiresInDays
        ? new Date(Date.now() + params.expiresInDays * 86400_000).toISOString()
        : null,
    })
    .select('id')
    .single();

  if (error) throw error;

  logSecurityEvent({
    org_id: params.orgId,
    user_id: params.userId,
    event_type: 'api_key_created',
    severity: 'medium',
    source: 'api',
    details: { key_name: params.name, key_prefix: keyPrefix, scopes: params.scopes },
  });

  return { rawKey, keyId: data.id, prefix: keyPrefix };
}

/** Validate an API key and return org context */
export async function validateApiKey(rawKey: string): Promise<{
  orgId: string;
  keyId: string;
  scopes: string[];
  rateLimitPerMinute: number;
} | null> {
  if (!rawKey.startsWith(KEY_PREFIX)) return null;

  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const admin = getServiceClient();

  const { data, error } = await admin
    .from('api_keys')
    .select('id, org_id, scopes, rate_limit_per_minute, expires_at')
    .eq('key_hash', keyHash)
    .eq('revoked', false)
    .single();

  if (error || !data) return null;

  // Check expiry
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;

  // Update last used
  admin
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => {});

  return {
    orgId: data.org_id,
    keyId: data.id,
    scopes: data.scopes,
    rateLimitPerMinute: data.rate_limit_per_minute,
  };
}

/** Revoke an API key */
export async function revokeApiKey(keyId: string, orgId: string, userId: string) {
  const admin = getServiceClient();
  await admin
    .from('api_keys')
    .update({ revoked: true, revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('org_id', orgId);

  logSecurityEvent({
    org_id: orgId,
    user_id: userId,
    event_type: 'api_key_revoked',
    severity: 'medium',
    source: 'api',
    details: { key_id: keyId },
  });
}

/**
 * Middleware: authenticate via API key (X-API-Key header)
 * Falls through to normal auth if no API key is present.
 */
export function apiKeyAuth(...requiredScopes: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey) return next(); // No API key, use normal auth

    const keyData = await validateApiKey(apiKey);
    if (!keyData) {
      logSecurityEvent({
        event_type: 'api_key_invalid',
        severity: 'medium',
        source: 'api',
        ip_address: extractIP(req),
        details: { key_prefix: apiKey.slice(0, 12) },
      });
      return res.status(401).json({ error: 'Invalid API key' });
    }

    // Enforce scopes if specified
    if (requiredScopes.length > 0) {
      const keyScopes = keyData.scopes || [];
      const hasWildcard = keyScopes.includes('*');
      const hasRequired = hasWildcard || requiredScopes.every(s => keyScopes.includes(s));
      if (!hasRequired) {
        logSecurityEvent({
          org_id: keyData.orgId,
          event_type: 'api_key_scope_denied',
          severity: 'medium',
          source: 'api',
          ip_address: extractIP(req),
          details: { key_id: keyData.keyId, required: requiredScopes, granted: keyScopes },
        });
        return res.status(403).json({ error: 'Insufficient API key scope', required: requiredScopes });
      }
    }

    // Attach org context to request
    (req as any).apiKeyAuth = keyData;
    (req as any).orgId = keyData.orgId;
    next();
  };
}
