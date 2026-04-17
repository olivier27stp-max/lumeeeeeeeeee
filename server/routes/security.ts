/**
 * LUME CRM — Security Dashboard API Routes
 * ==========================================
 * Admin-only routes for:
 * - Security alerts management
 * - IP blocklist management
 * - Login history viewing
 * - Security events audit trail
 * - Anomaly detection status
 */

import { Router } from 'express';
import { requireAuthedClient, isOrgAdminOrOwner, getServiceClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { extractIP, logSecurityEvent } from '../lib/security';
import { createApiKey, revokeApiKey } from '../lib/api-keys';

const router = Router();

// ── Helper: require admin/owner role ──
async function requireAdmin(req: any, res: any) {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return null;

  const isAdmin = await isOrgAdminOrOwner(auth.client, auth.user.id, auth.orgId);
  if (!isAdmin) {
    res.status(403).json({ error: 'Admin or owner role required.' });
    return null;
  }
  return auth;
}

// ═══════════════════════════════════════════════════════════════
// GET /api/security/alerts — List security alerts
// ═══════════════════════════════════════════════════════════════

router.get('/security/alerts', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 20);
    const offset = (page - 1) * limit;
    const unacknowledgedOnly = req.query.unacknowledged === 'true';

    let query = admin
      .from('security_alerts')
      .select('*', { count: 'exact' })
      .eq('org_id', auth.orgId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (unacknowledgedOnly) {
      query = query.eq('acknowledged', false);
    }
    if (req.query.severity) {
      query = query.eq('severity', req.query.severity);
    }
    if (req.query.alert_type) {
      query = query.eq('alert_type', req.query.alert_type);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    return res.json({ data: data || [], total: count || 0, page, limit });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to fetch alerts.', '[security/alerts]');
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/security/alerts/:id/acknowledge — Acknowledge alert
// ═══════════════════════════════════════════════════════════════

router.post('/security/alerts/:id/acknowledge', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const { data, error } = await admin
      .from('security_alerts')
      .update({
        acknowledged: true,
        acknowledged_by: auth.user.id,
        acknowledged_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Alert not found.' });

    return res.json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to acknowledge alert.', '[security/alerts/ack]');
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/security/events — Security events audit trail
// ═══════════════════════════════════════════════════════════════

router.get('/security/events', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 30);
    const offset = (page - 1) * limit;

    let query = admin
      .from('security_events')
      .select('*', { count: 'exact' })
      .eq('org_id', auth.orgId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (req.query.severity) query = query.eq('severity', req.query.severity);
    if (req.query.event_type) query = query.eq('event_type', req.query.event_type);
    if (req.query.source) query = query.eq('source', req.query.source);

    const { data, error, count } = await query;
    if (error) throw error;

    return res.json({ data: data || [], total: count || 0, page, limit });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to fetch events.', '[security/events]');
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/security/login-history — Login history
// ═══════════════════════════════════════════════════════════════

router.get('/security/login-history', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 30);
    const offset = (page - 1) * limit;

    let query = admin
      .from('login_history')
      .select('*', { count: 'exact' })
      .eq('org_id', auth.orgId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (req.query.user_id) query = query.eq('user_id', req.query.user_id);
    if (req.query.success === 'false') query = query.eq('success', false);
    if (req.query.success === 'true') query = query.eq('success', true);

    const { data, error, count } = await query;
    if (error) throw error;

    return res.json({ data: data || [], total: count || 0, page, limit });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to fetch login history.', '[security/login-history]');
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/security/blocked-ips — List blocked IPs
// ═══════════════════════════════════════════════════════════════

router.get('/security/blocked-ips', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const { data, error } = await admin
      .from('ip_blocklist')
      .select('*')
      .or(`org_id.eq.${auth.orgId},org_id.is.null`)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.json(data || []);
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to fetch blocked IPs.', '[security/blocked-ips]');
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/security/block-ip — Manually block an IP
// ═══════════════════════════════════════════════════════════════

router.post('/security/block-ip', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const { ip_address, reason, duration_hours } = req.body || {};
    if (!ip_address || !reason) {
      return res.status(400).json({ error: 'ip_address and reason are required.' });
    }

    // Validate IP format
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(ip_address)) {
      return res.status(400).json({ error: 'Invalid IP address format.' });
    }

    // Don't allow blocking own IP
    const ownIP = extractIP(req);
    if (ip_address === ownIP) {
      return res.status(400).json({ error: 'Cannot block your own IP address.' });
    }

    const admin = getServiceClient();
    const expiresAt = duration_hours
      ? new Date(Date.now() + Number(duration_hours) * 3600_000).toISOString()
      : null; // permanent

    const { data, error } = await admin
      .from('ip_blocklist')
      .upsert({
        ip_address,
        reason,
        blocked_by: auth.user.id,
        org_id: auth.orgId,
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (error) throw error;

    return res.json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to block IP.', '[security/block-ip]');
  }
});

// ═══════════════════════════════════════════════════════════════
// DELETE /api/security/block-ip/:id — Unblock an IP
// ═══════════════════════════════════════════════════════════════

router.delete('/security/block-ip/:id', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const { error } = await admin
      .from('ip_blocklist')
      .delete()
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId);

    if (error) throw error;
    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to unblock IP.', '[security/unblock-ip]');
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/security/summary — Security dashboard summary
// ═══════════════════════════════════════════════════════════════

router.get('/security/summary', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();
    const since7d = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();

    // Parallel queries
    const [
      unackAlerts,
      events24h,
      failedLogins24h,
      blockedIPs,
      criticalEvents7d,
    ] = await Promise.all([
      admin.from('security_alerts')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', auth.orgId)
        .eq('acknowledged', false),
      admin.from('security_events')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', auth.orgId)
        .gte('created_at', since24h),
      admin.from('login_history')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', auth.orgId)
        .eq('success', false)
        .gte('created_at', since24h),
      admin.from('ip_blocklist')
        .select('*', { count: 'exact', head: true })
        .or(`org_id.eq.${auth.orgId},org_id.is.null`)
        .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString()),
      admin.from('security_events')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', auth.orgId)
        .in('severity', ['critical', 'high'])
        .gte('created_at', since7d),
    ]);

    return res.json({
      unacknowledged_alerts: unackAlerts.count || 0,
      security_events_24h: events24h.count || 0,
      failed_logins_24h: failedLogins24h.count || 0,
      blocked_ips: blockedIPs.count || 0,
      critical_events_7d: criticalEvents7d.count || 0,
    });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to fetch summary.', '[security/summary]');
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/security/api-keys — Create a new API key
// ═══════════════════════════════════════════════════════════════

router.post('/security/api-keys', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const { name, scopes, rate_limit_per_minute, expires_in_days } = req.body || {};
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ error: 'name is required (min 2 chars).' });
    }

    const result = await createApiKey({
      orgId: auth.orgId,
      userId: auth.user.id,
      name: name.trim(),
      scopes: Array.isArray(scopes) ? scopes : ['read'],
      rateLimitPerMinute: Number(rate_limit_per_minute) || 60,
      expiresInDays: Number(expires_in_days) || undefined,
    });

    // Return the raw key ONCE — it will never be shown again
    return res.json({
      id: result.keyId,
      key: result.rawKey,
      prefix: result.prefix,
      warning: 'Save this key now. It will not be shown again.',
    });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to create API key.', '[security/api-keys]');
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/security/api-keys — List API keys (no raw keys shown)
// ═══════════════════════════════════════════════════════════════

router.get('/security/api-keys', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const { data, error } = await admin
      .from('api_keys')
      .select('id, name, key_prefix, scopes, rate_limit_per_minute, last_used_at, expires_at, revoked, created_at')
      .eq('org_id', auth.orgId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.json(data || []);
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to list API keys.', '[security/api-keys]');
  }
});

// ═══════════════════════════════════════════════════════════════
// DELETE /api/security/api-keys/:id — Revoke an API key
// ═══════════════════════════════════════════════════════════════

router.delete('/security/api-keys/:id', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    await revokeApiKey(req.params.id, auth.orgId, auth.user.id);
    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to revoke API key.', '[security/api-keys/revoke]');
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/security/sessions — List active sessions for current user
// ═══════════════════════════════════════════════════════════════

router.get('/security/sessions', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const { data, error } = await admin
      .from('active_sessions')
      .select('id, device_fingerprint, ip_address, user_agent, country_code, last_activity, created_at')
      .eq('user_id', auth.user.id)
      .eq('is_valid', true)
      .order('last_activity', { ascending: false });

    if (error) throw error;
    return res.json(data || []);
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to fetch sessions.', '[security/sessions]');
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/security/sessions/invalidate-all — Kill all sessions
// ═══════════════════════════════════════════════════════════════

router.post('/security/sessions/invalidate-all', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const { data } = await admin.rpc('invalidate_all_sessions', {
      p_user_id: auth.user.id,
      p_reason: 'user_request',
    });

    return res.json({ ok: true, invalidated: data || 0 });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to invalidate sessions.', '[security/sessions/invalidate]');
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/security/csp-report — CSP violation reporting endpoint
// ═══════════════════════════════════════════════════════════════

router.post('/security/csp-report', (req, res) => {
  try {
    const report = req.body?.['csp-report'] || req.body;
    if (report && typeof report === 'object') {
      // Validate + truncate fields to prevent log flooding via oversized payloads
      const safeStr = (v: unknown, max = 500) => {
        const s = String(v || '').slice(0, max);
        return s || undefined;
      };

      logSecurityEvent({
        event_type: 'csp_violation',
        severity: 'low',
        source: 'api',
        ip_address: extractIP(req),
        user_agent: String(req.headers['user-agent'] || '').slice(0, 200),
        details: {
          blocked_uri: safeStr(report['blocked-uri'] || report.blockedURL, 200),
          violated_directive: safeStr(report['violated-directive'] || report.effectiveDirective, 100),
          document_uri: safeStr(report['document-uri'] || report.documentURL, 200),
          source_file: safeStr(report['source-file'] || report.sourceFile, 200),
        },
      });
    }
    return res.status(204).send();
  } catch {
    return res.status(204).send();
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/security/export-log — View data export history
// ═══════════════════════════════════════════════════════════════

router.get('/security/export-log', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 30);
    const offset = (page - 1) * limit;

    const { data, error, count } = await admin
      .from('data_export_log')
      .select('*', { count: 'exact' })
      .eq('org_id', auth.orgId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    return res.json({ data: data || [], total: count || 0, page, limit });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to fetch export log.', '[security/export-log]');
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/security/check-password — Validate password strength
// ═══════════════════════════════════════════════════════════════

router.post('/security/check-password', async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'password is required' });

    const admin = getServiceClient();
    const { data, error } = await admin.rpc('check_password_strength', { p_password: password });

    if (error) throw error;
    return res.json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Password check failed.', '[security/check-password]');
  }
});

export default router;
