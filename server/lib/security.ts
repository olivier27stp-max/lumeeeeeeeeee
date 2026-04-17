/**
 * LUME CRM — Security Engine
 * ==========================
 * Comprehensive security middleware and utilities:
 * - Enhanced rate limiting with sliding window
 * - IP blocking with auto-block on abuse
 * - Request fingerprinting
 * - Input sanitization (XSS, injection prevention)
 * - Security event logging
 * - Anomaly detection engine
 * - Session device tracking
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { getServiceClient } from './supabase';

// ============================================================================
// 1. ENHANCED RATE LIMITER — Sliding window with burst detection
// ============================================================================

interface RateLimitEntry {
  timestamps: number[];
  blocked: boolean;
  blockedUntil: number;
}

const slidingWindowStore = new Map<string, RateLimitEntry>();

// Cleanup every 2 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of slidingWindowStore) {
    // Remove entries older than 10 minutes
    entry.timestamps = entry.timestamps.filter(t => now - t < 600_000);
    if (entry.timestamps.length === 0 && (!entry.blocked || now > entry.blockedUntil)) {
      slidingWindowStore.delete(key);
    }
  }
}, 120_000);

export interface SlidingRateLimitOpts {
  windowMs: number;
  max: number;
  burstMax?: number;     // Max requests in a 5-second burst
  burstWindowMs?: number;
  blockDurationMs?: number; // How long to block after exceeding
  keyFn?: (req: Request) => string;
  onBlock?: (key: string, req: Request) => void;
}

export function slidingRateLimit(opts: SlidingRateLimitOpts) {
  const {
    windowMs,
    max,
    burstMax = Math.min(max, 10),
    burstWindowMs = 5_000,
    blockDurationMs = 60_000,
    keyFn,
    onBlock,
  } = opts;

  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyFn ? keyFn(req) : extractIP(req);
    const now = Date.now();

    let entry = slidingWindowStore.get(key);
    if (!entry) {
      entry = { timestamps: [], blocked: false, blockedUntil: 0 };
      slidingWindowStore.set(key, entry);
    }

    // Check if currently blocked
    if (entry.blocked && now < entry.blockedUntil) {
      const retryAfter = Math.ceil((entry.blockedUntil - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'Too many requests. Please try again later.',
        retryAfter,
      });
    }

    // Unblock if block expired
    if (entry.blocked && now >= entry.blockedUntil) {
      entry.blocked = false;
      entry.timestamps = [];
    }

    // Remove timestamps outside the window
    entry.timestamps = entry.timestamps.filter(t => now - t < windowMs);

    // Check burst (short window)
    const burstCount = entry.timestamps.filter(t => now - t < burstWindowMs).length;
    if (burstCount >= burstMax) {
      entry.blocked = true;
      entry.blockedUntil = now + blockDurationMs;
      onBlock?.(key, req);
      logSecurityEvent({
        event_type: 'rate_limit_burst',
        severity: 'medium',
        source: 'api',
        ip_address: extractIP(req),
        details: { key, burstCount, path: req.path, method: req.method },
      });
      return res.status(429).json({ error: 'Request burst detected. Temporarily blocked.' });
    }

    // Check window limit
    if (entry.timestamps.length >= max) {
      entry.blocked = true;
      entry.blockedUntil = now + blockDurationMs;
      onBlock?.(key, req);
      logSecurityEvent({
        event_type: 'rate_limit_exceeded',
        severity: 'medium',
        source: 'api',
        ip_address: extractIP(req),
        details: { key, count: entry.timestamps.length, path: req.path },
      });
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    entry.timestamps.push(now);

    // Set rate limit headers
    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(max - entry.timestamps.length));
    res.set('X-RateLimit-Reset', String(Math.ceil((now + windowMs) / 1000)));

    next();
  };
}

// ============================================================================
// 2. IP BLOCKING MIDDLEWARE
// ============================================================================

// In-memory cache of blocked IPs (refreshed from DB periodically)
const blockedIPCache = new Set<string>();
let lastIPCacheRefresh = 0;
const IP_CACHE_TTL = 60_000; // Refresh every minute

async function refreshBlockedIPs() {
  try {
    const admin = getServiceClient();
    const { data } = await admin
      .from('ip_blocklist')
      .select('ip_address')
      .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString());

    blockedIPCache.clear();
    if (data) {
      for (const row of data) {
        blockedIPCache.add(String(row.ip_address));
      }
    }
    lastIPCacheRefresh = Date.now();
  } catch {
    // Fail open — don't block if we can't reach DB
  }
}

export function ipBlockMiddleware() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ip = extractIP(req);

    // Refresh cache if stale
    if (Date.now() - lastIPCacheRefresh > IP_CACHE_TTL) {
      refreshBlockedIPs().catch(() => {});
    }

    if (blockedIPCache.has(ip)) {
      logSecurityEvent({
        event_type: 'blocked_ip_access',
        severity: 'high',
        source: 'api',
        ip_address: ip,
        details: { path: req.path, method: req.method },
      });
      return res.status(403).json({ error: 'Access denied.' });
    }

    next();
  };
}

// Auto-block an IP after repeated violations
const violationCounts = new Map<string, { count: number; firstSeen: number }>();

export async function autoBlockIP(ip: string, reason: string, durationMinutes = 60) {
  const now = Date.now();
  const entry = violationCounts.get(ip) || { count: 0, firstSeen: now };

  // Reset if window expired (30 minutes)
  if (now - entry.firstSeen > 30 * 60_000) {
    entry.count = 0;
    entry.firstSeen = now;
  }

  entry.count++;
  violationCounts.set(ip, entry);

  // Auto-block after 10 violations
  if (entry.count >= 10) {
    blockedIPCache.add(ip);
    violationCounts.delete(ip);

    try {
      const admin = getServiceClient();
      await admin.from('ip_blocklist').upsert({
        ip_address: ip,
        reason,
        expires_at: new Date(now + durationMinutes * 60_000).toISOString(),
      }, { onConflict: 'ip_address' });

      logSecurityEvent({
        event_type: 'ip_auto_blocked',
        severity: 'high',
        source: 'system',
        ip_address: ip,
        details: { reason, duration_minutes: durationMinutes, violation_count: entry.count },
      });
    } catch (err: any) {
      console.error('[Security] Failed to persist IP block:', err?.message);
    }
  }
}

// ============================================================================
// 3. REQUEST FINGERPRINTING
// ============================================================================

export function generateRequestFingerprint(req: Request): string {
  const components = [
    req.headers['user-agent'] || '',
    req.headers['accept-language'] || '',
    req.headers['accept-encoding'] || '',
    req.headers['sec-ch-ua'] || '',
    req.headers['sec-ch-ua-platform'] || '',
    extractIP(req),
  ];

  return crypto
    .createHash('sha256')
    .update(components.join('|'))
    .digest('hex')
    .slice(0, 16);
}

export function generateDeviceFingerprint(req: Request): string {
  const components = [
    req.headers['user-agent'] || '',
    req.headers['accept-language'] || '',
    req.headers['sec-ch-ua'] || '',
    req.headers['sec-ch-ua-platform'] || '',
    req.headers['sec-ch-ua-mobile'] || '',
  ];

  return crypto
    .createHash('sha256')
    .update(components.join('|'))
    .digest('hex')
    .slice(0, 32);
}

// ============================================================================
// 4. INPUT SANITIZATION
// ============================================================================

/**
 * Strip dangerous HTML/JS from text input.
 * Used for SMS bodies, notes, comments — anywhere user text is stored.
 */
export function sanitizeText(input: string): string {
  if (!input) return '';

  return input
    // Remove script tags and content
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    // Remove event handlers
    .replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '')
    // Remove javascript: protocol
    .replace(/javascript\s*:/gi, '')
    // Remove data: URIs that could execute (keep data:image)
    .replace(/data\s*:\s*(?!image\/)[^;,]*/gi, '')
    // Remove HTML tags (keep text content)
    .replace(/<\/?[^>]+(>|$)/g, '')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sanitize HTML content — used for email bodies where HTML is expected.
 * Uses DOMPurify for robust XSS prevention while preserving safe formatting.
 */
export function sanitizeHtml(input: string): string {
  if (!input) return '';

  const createDOMPurify = require('dompurify');
  const { JSDOM } = require('jsdom');
  const window = new JSDOM('').window;
  const DOMPurify = createDOMPurify(window);

  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [
      'p', 'br', 'b', 'strong', 'i', 'em', 'u', 'a', 'ul', 'ol', 'li',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code',
      'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'hr', 'div', 'span',
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'style', 'target', 'rel', 'width', 'height'],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'applet', 'form', 'input', 'textarea', 'select', 'button'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
  }).trim();
}

/**
 * Strip CRLF sequences from text that will be used in SMS/email headers.
 * Prevents header injection attacks (e.g., injecting extra email headers via \r\n).
 */
export function stripCRLF(input: string): string {
  if (!input) return '';
  return input.replace(/[\r\n]+/g, ' ').trim();
}

/**
 * Sanitize SMS/email body content — strip CRLF from subject lines
 * and dangerous protocol handlers from bodies.
 */
export function sanitizeMessageContent(subject: string, body: string): { subject: string; body: string } {
  return {
    subject: stripCRLF(subject),
    body: body
      // Remove null bytes
      .replace(/\0/g, '')
      // Remove javascript: protocol
      .replace(/javascript\s*:/gi, '')
      .trim(),
  };
}

/**
 * Validate that a string doesn't contain SQL injection patterns.
 * Defense-in-depth: Supabase uses parameterized queries, but this catches
 * edge cases where raw values might be interpolated.
 */
export function containsSQLInjection(input: string): boolean {
  if (!input) return false;

  const patterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|EXEC|UNION|TRUNCATE)\b.*\b(FROM|INTO|TABLE|SET|WHERE|ALL)\b)/i,
    /(--|\/\*|\*\/|;.*\b(DROP|ALTER|DELETE|EXEC)\b)/i,
    /(\bOR\b\s+\d+\s*=\s*\d+)/i,
    /('\s*OR\s+'[^']*'\s*=\s*'[^']*')/i,
    /(WAITFOR\s+DELAY|BENCHMARK\s*\(|SLEEP\s*\()/i,
  ];

  return patterns.some(p => p.test(input));
}

/**
 * Sanitization middleware — applies to all request bodies.
 * Strips dangerous content AND logs security events for SQL injection attempts.
 */
export function sanitizeRequestBody() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.body && typeof req.body === 'object') {
      const result = sanitizeObject(req.body, req);
      if (result.blocked) {
        return res.status(400).json({ error: 'Request blocked: potentially malicious input detected.' });
      }
    }
    next();
  };
}

function sanitizeObject(obj: Record<string, any>, req?: Request, depth = 0): { blocked: boolean } {
  if (depth > 10) return { blocked: false }; // Prevent infinite recursion

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      // Don't sanitize HTML fields (they have their own sanitization via DOMPurify)
      if (key === 'html' || key === 'body_html' || key === 'content') continue;
      // Don't sanitize password fields
      if (key.includes('password') || key.includes('secret') || key.includes('token')) continue;

      // Detect SQL injection — log and BLOCK the request
      if (containsSQLInjection(value)) {
        logSecurityEvent({
          event_type: 'sql_injection_attempt',
          severity: 'critical',
          source: 'api',
          ip_address: req ? extractIP(req) : undefined,
          details: { field: key, value_preview: value.slice(0, 100), path: req?.path },
        });
        // Auto-block repeat offenders
        if (req) {
          autoBlockIP(extractIP(req), 'sql_injection_attempt', 60).catch(() => {});
        }
        return { blocked: true };
      }

      // Strip dangerous patterns from text fields (XSS prevention)
      // Don't modify the value for fields that are expected to contain special chars
      if (!key.includes('email') && !key.includes('url') && !key.includes('address')) {
        obj[key] = value
          // Remove null bytes
          .replace(/\0/g, '')
          // Remove javascript: protocol
          .replace(/javascript\s*:/gi, '')
          // Remove data: URIs that could execute (keep data:image)
          .replace(/data\s*:\s*(?!image\/)[^;,]*/gi, '');
      }
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const result = sanitizeObject(value, req, depth + 1);
      if (result.blocked) return result;
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object') {
          const result = sanitizeObject(item, req, depth + 1);
          if (result.blocked) return result;
        }
      }
    }
  }
  return { blocked: false };
}

// ============================================================================
// 5. SECURITY EVENT LOGGING
// ============================================================================

interface SecurityEventInput {
  org_id?: string;
  user_id?: string;
  event_type: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  source: 'api' | 'auth' | 'webhook' | 'rls' | 'system';
  ip_address?: string;
  user_agent?: string;
  details?: Record<string, any>;
}

// Buffer events and flush in batches to reduce DB writes
const eventBuffer: SecurityEventInput[] = [];
let flushTimer: NodeJS.Timeout | null = null;

export function logSecurityEvent(event: SecurityEventInput) {
  eventBuffer.push(event);

  // Critical/high events flush immediately
  if (event.severity === 'critical' || event.severity === 'high') {
    flushSecurityEvents();
    return;
  }

  // Others flush every 5 seconds
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushSecurityEvents();
      flushTimer = null;
    }, 5_000);
  }
}

async function flushSecurityEvents() {
  if (eventBuffer.length === 0) return;

  const events = eventBuffer.splice(0, eventBuffer.length);

  try {
    const admin = getServiceClient();
    await admin.from('security_events').insert(events);
  } catch (err: any) {
    // Security logging must never crash the application
    console.error('[Security] Failed to flush events:', err?.message);
  }
}

// ============================================================================
// 6. ANOMALY DETECTION ENGINE
// ============================================================================

interface AnomalyCheck {
  name: string;
  check: (userId: string, orgId: string) => Promise<boolean>;
  severity: 'critical' | 'high' | 'medium';
  title: string;
  description: string;
}

const anomalyChecks: AnomalyCheck[] = [
  {
    name: 'excessive_exports',
    check: async (userId, orgId) => {
      const admin = getServiceClient();
      const { count } = await admin
        .from('audit_events')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('org_id', orgId)
        .in('action', ['export', 'bulk_export', 'download'])
        .gte('created_at', new Date(Date.now() - 10 * 60_000).toISOString());
      return (count ?? 0) >= 3;
    },
    severity: 'high',
    title: 'Excessive data exports detected',
    description: 'User exported data 3+ times in 10 minutes — possible data exfiltration.',
  },
  {
    name: 'mass_deletion',
    check: async (userId, orgId) => {
      const admin = getServiceClient();
      const { count } = await admin
        .from('audit_events')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('org_id', orgId)
        .eq('action', 'delete')
        .gte('created_at', new Date(Date.now() - 5 * 60_000).toISOString());
      return (count ?? 0) >= 20;
    },
    severity: 'high',
    title: 'Mass deletion detected',
    description: 'User deleted 20+ records in 5 minutes — possible malicious or accidental destruction.',
  },
  {
    name: 'off_hours_admin',
    check: async (userId, _orgId) => {
      const hour = new Date().getUTCHours();
      // Flag admin activity between 1 AM and 5 AM UTC
      if (hour < 1 || hour >= 5) return false;

      const admin = getServiceClient();
      const { count } = await admin
        .from('audit_events')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('action', ['role_change', 'member_invite', 'settings_update', 'delete'])
        .gte('created_at', new Date(Date.now() - 30 * 60_000).toISOString());
      return (count ?? 0) >= 3;
    },
    severity: 'medium',
    title: 'Off-hours admin activity',
    description: 'Admin actions detected during unusual hours (1-5 AM UTC).',
  },
];

/**
 * Run anomaly detection for a specific user action.
 * Called after sensitive operations.
 */
export async function checkAnomalies(userId: string, orgId: string) {
  // Run all checks in parallel, but don't block the request
  try {
    const results = await Promise.allSettled(
      anomalyChecks.map(async (check) => {
        const triggered = await check.check(userId, orgId);
        if (triggered) {
          await createSecurityAlert({
            org_id: orgId,
            user_id: userId,
            alert_type: check.name,
            severity: check.severity,
            title: check.title,
            description: check.description,
          });
        }
        return { name: check.name, triggered };
      })
    );

    // Log any triggered anomalies
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.triggered) {
        console.warn(`[Security] Anomaly triggered: ${result.value.name}`);
      }
    }
  } catch (err: any) {
    console.error('[Security] Anomaly detection error:', err?.message);
  }
}

// ============================================================================
// 7. SECURITY ALERTS
// ============================================================================

interface SecurityAlertInput {
  org_id: string;
  user_id?: string;
  alert_type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description?: string;
  metadata?: Record<string, any>;
}

// Dedup: Don't create the same alert type for the same user within 15 minutes
const recentAlerts = new Map<string, number>();

export async function createSecurityAlert(alert: SecurityAlertInput) {
  const dedupKey = `${alert.org_id}:${alert.user_id}:${alert.alert_type}`;
  const now = Date.now();

  if (recentAlerts.has(dedupKey) && now - recentAlerts.get(dedupKey)! < 15 * 60_000) {
    return; // Skip duplicate
  }

  recentAlerts.set(dedupKey, now);

  try {
    const admin = getServiceClient();
    await admin.from('security_alerts').insert(alert);

    logSecurityEvent({
      org_id: alert.org_id,
      user_id: alert.user_id,
      event_type: `alert_${alert.alert_type}`,
      severity: alert.severity,
      source: 'system',
      details: { title: alert.title, description: alert.description },
    });
  } catch (err: any) {
    console.error('[Security] Failed to create alert:', err?.message);
  }
}

// ============================================================================
// 8. SESSION / DEVICE TRACKING
// ============================================================================

export async function recordLoginAttempt(params: {
  userId: string;
  orgId?: string;
  req: Request;
  success: boolean;
  method?: string;
  failureReason?: string;
}) {
  try {
    const admin = getServiceClient();
    const ip = extractIP(params.req);
    const deviceFp = generateDeviceFingerprint(params.req);

    await admin.from('login_history').insert({
      user_id: params.userId,
      org_id: params.orgId || null,
      ip_address: ip,
      user_agent: params.req.headers['user-agent'] || null,
      device_fingerprint: deviceFp,
      login_method: params.method || 'password',
      success: params.success,
      failure_reason: params.failureReason || null,
    });

    // Check for brute force
    if (!params.success) {
      const { count } = await admin
        .from('login_history')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', params.userId)
        .eq('success', false)
        .gte('created_at', new Date(Date.now() - 15 * 60_000).toISOString());

      if ((count ?? 0) >= 5) {
        await createSecurityAlert({
          org_id: params.orgId || '',
          user_id: params.userId,
          alert_type: 'brute_force',
          severity: 'critical',
          title: 'Brute force login detected',
          description: `${count} failed login attempts in 15 minutes from IP ${ip}`,
          metadata: { ip, user_agent: params.req.headers['user-agent'], count },
        });

        // Auto-block the IP
        await autoBlockIP(ip, 'brute_force_login', 30);
      }
    }

    // Check for new device
    if (params.success) {
      const { data: previousLogins } = await admin
        .from('login_history')
        .select('device_fingerprint')
        .eq('user_id', params.userId)
        .eq('success', true)
        .neq('device_fingerprint', deviceFp)
        .limit(1);

      // If user has previous logins but this device is new
      if (previousLogins && previousLogins.length > 0) {
        const { count: thisDeviceCount } = await admin
          .from('login_history')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', params.userId)
          .eq('device_fingerprint', deviceFp)
          .eq('success', true);

        if ((thisDeviceCount ?? 0) <= 1) {
          // First time this device is used
          logSecurityEvent({
            org_id: params.orgId,
            user_id: params.userId,
            event_type: 'new_device_login',
            severity: 'info',
            source: 'auth',
            ip_address: ip,
            user_agent: params.req.headers['user-agent'],
            details: { device_fingerprint: deviceFp },
          });
        }
      }
    }
  } catch (err: any) {
    console.error('[Security] Failed to record login:', err?.message);
  }
}

// ============================================================================
// 9. UTILITY FUNCTIONS
// ============================================================================

/** Extract real client IP from request, handling proxies */
export function extractIP(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded)) {
    return forwarded[0].trim();
  }
  return req.ip || req.socket.remoteAddress || '0.0.0.0';
}

/** Generate a unique request ID for tracing */
export function generateRequestId(): string {
  return crypto.randomUUID();
}

/** Request tracing middleware — adds X-Request-ID header */
export function requestTracing() {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestId = (req.headers['x-request-id'] as string) || generateRequestId();
    res.set('X-Request-ID', requestId);
    (req as any).requestId = requestId;
    next();
  };
}

// ============================================================================
// 10. COMPOSITE SECURITY MIDDLEWARE
// ============================================================================

/**
 * Apply all security middleware in the correct order.
 * Call this once in server/index.ts before any route handlers.
 */
export function applySecurityMiddleware(app: any) {
  // 1. Request tracing
  app.use(requestTracing());

  // 2. IP blocking
  app.use(ipBlockMiddleware());

  // 3. Input sanitization (after body parsing)
  app.use(sanitizeRequestBody());

  // 4. Global rate limit (generous — specific endpoints have tighter limits)
  app.use(slidingRateLimit({
    windowMs: 60_000,
    max: 300,
    burstMax: 30,
    burstWindowMs: 3_000,
    blockDurationMs: 120_000,
    keyFn: (req) => extractIP(req),
    onBlock: (key, req) => {
      autoBlockIP(key, `global_rate_limit:${req.path}`, 15).catch(() => {});
    },
  }));

  console.log('[security] All middleware layers applied');
}

// ============================================================================
// 11. PERIODIC SECURITY MAINTENANCE
// ============================================================================

/**
 * Run periodic security maintenance tasks.
 * Called on a timer from server/index.ts.
 */
export async function runSecurityMaintenance() {
  try {
    const admin = getServiceClient();

    // 1. Cleanup expired IP blocks from cache
    await refreshBlockedIPs();

    // 2. Run DB maintenance function
    try { await admin.rpc('security_maintenance'); } catch {};

    // 3. Cleanup local dedup caches
    const now = Date.now();
    for (const [key, timestamp] of recentAlerts) {
      if (now - timestamp > 60 * 60_000) recentAlerts.delete(key);
    }
    for (const [ip, entry] of violationCounts) {
      if (now - entry.firstSeen > 60 * 60_000) violationCounts.delete(ip);
    }

    // 4. Flush any remaining security events
    await flushSecurityEvents();

    console.log('[security] Maintenance completed');
  } catch (err: any) {
    console.error('[security] Maintenance error:', err?.message);
  }
}
