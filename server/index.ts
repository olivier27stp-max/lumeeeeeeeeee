
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import config (initializes dotenv, validates env vars)
import { supabaseUrl, supabaseServiceRoleKey, twilioClient, twilioPhoneNumber, resendApiKey } from './lib/config';

// ── Validate environment at startup ──
import { validateEnvironment } from './lib/env-validation';
validateEnvironment();
import { startScheduler } from './lib/scheduler';
import { initAutomationEngine } from './lib/automationEngine';
import { startRecurringJobScheduler } from './lib/recurringJobScheduler';
import { createClient } from '@supabase/supabase-js';

// Import route modules
import searchRouter from './routes/search';
import geocodeRouter from './routes/geocode';
import leadsRouter from './routes/leads';
import paymentsRouter, { stripeWebhookHandler } from './routes/payments';
import messagesRouter from './routes/messages';
import quotesRouter, { quoteRedirectRouter } from './routes/quotes';
import notificationsRouter from './routes/notifications';
import emailsRouter from './routes/emails';
import integrationsRouter from './routes/integrations';
import surveysRouter from './routes/surveys';
// invoiceTemplatesRouter removed — no more invoice template system
import emailTemplatesRouter from './routes/email-templates';
import communicationsRouter from './routes/communications';
import automationTestRouter from './routes/automation-test';
import automationEventsRouter from './routes/automation-events';
import portalRouter from './routes/portal';
import connectRouter from './routes/connect';
import paymentRequestsRouter from './routes/payment-requests';
import publicPayRouter from './routes/public-pay';
import directorPanelRouter from './routes/director-panel';
import teamSuggestionsRouter from './routes/team-suggestions';
import jobsRouter from './routes/jobs';
import trackingRouter from './routes/tracking';
import requestFormsRouter from './routes/request-forms';
import quoteTemplatesRouter from './routes/quote-templates';
import taxesRouter from './routes/taxes';
import featureFlagsRouter from './routes/feature-flags';
import scheduledReportsRouter from './routes/scheduled-reports';
import goalsRouter from './routes/goals';
import auditLogRouter from './routes/audit-log';
import aiProxyRouter from './routes/ai-proxy';
import agentRouter from './routes/agent';
import agentTrainingRouter from './routes/agent-training';
import orgKnowledgeRouter from './routes/org-knowledge';
import invitationsRouter from './routes/invitations';
import billingRouter from './routes/billing';
import referralsRouter from './routes/referrals';
import securityRouter from './routes/security';
import coursesRouter from './routes/courses';
import fieldSalesRouter from './routes/field-sales';
import leaderboardRouter from './routes/leaderboard';
import commissionsRouter from './routes/commissions';
import gamificationRouter from './routes/gamification';
import fieldSessionsRouter from './routes/field-sessions';
import memoryGraphRouter from './routes/memory-graph';

// Security engine
import { applySecurityMiddleware, runSecurityMaintenance, slidingRateLimit, extractIP } from './lib/security';
import { redisRateLimit } from './lib/rate-limiter';
import { rbacMiddleware } from './lib/route-permissions';

const app = express();

// ── Security headers (hardened) ──
app.use((_req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '0'); // Disabled: modern CSP is preferred over broken XSS filter
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), payment=(self), usb=(), bluetooth=()');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  // HSTS always on — even in dev, browsers should learn to use HTTPS
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  // CSP always on
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      process.env.NODE_ENV === 'production'
        ? "script-src 'self' https://maps.googleapis.com https://js.stripe.com https://www.paypal.com"
        : "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://maps.googleapis.com https://js.stripe.com https://www.paypal.com http://localhost:*",
      process.env.NODE_ENV === 'production' ? "style-src 'self'" : "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https: blob:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://maps.googleapis.com https://api.stripe.com https://fal.run https://queue.fal.run https://api.paypal.com",
      "frame-src https://js.stripe.com https://www.paypal.com",
      "media-src 'self' https: blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
      "report-uri /api/security/csp-report",
    ].join('; '),
  );
  next();
});

// ── CORS (hardened) ──
const frontendUrl = (process.env.FRONTEND_URL || '').trim();
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (same-origin, server-to-server, Postman in dev)
    if (!origin) return callback(null, true);
    // In production, only allow configured frontend
    if (frontendUrl && origin === frontendUrl) return callback(null, true);
    // In development, allow localhost variants
    if (process.env.NODE_ENV !== 'production' && (
      origin.includes('localhost') || origin.includes('127.0.0.1')
    )) return callback(null, true);
    // Block everything else
    console.warn(`[CORS] Blocked origin: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  maxAge: 600, // Cache preflight for 10 minutes
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Requested-With', 'X-API-Key'],
}));

// ── CSRF protection via custom header check ──
// Browsers enforce that custom headers can only be sent via JS (XMLHttpRequest/fetch),
// not via forms or img tags. This blocks cross-site form-based CSRF attacks.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // API key requests are not vulnerable to CSRF
  if (req.headers['x-api-key']) return next();
  // Require either Authorization header or X-Requested-With (custom header = JS origin)
  if (req.headers['authorization'] || req.headers['x-requested-with']) return next();
  // Content-Type application/json is also safe (forms can't send JSON without JS)
  if (req.headers['content-type']?.includes('application/json')) return next();
  return res.status(403).json({ error: 'CSRF check failed — missing required headers' });
});

// ── Simple in-memory rate limiter ──
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
function rateLimit(opts: { windowMs: number; max: number; keyFn?: (req: express.Request) => string }) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = opts.keyFn ? opts.keyFn(req) : (req.ip || req.headers['x-forwarded-for'] as string || 'unknown');
    const now = Date.now();
    const entry = rateLimitStore.get(key);
    if (!entry || now > entry.resetAt) {
      rateLimitStore.set(key, { count: 1, resetAt: now + opts.windowMs });
      return next();
    }
    if (entry.count >= opts.max) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    entry.count++;
    return next();
  };
}
// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now > entry.resetAt) rateLimitStore.delete(key);
  }
}, 300_000);

const port = Number(process.env.PORT || process.env.API_PORT || 3002);

// ── Stripe webhook must be mounted BEFORE express.json() ──
// Stripe requires the raw body for signature verification, so this route
// uses express.raw() and is registered before the global express.json().
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json', limit: '1mb' }), stripeWebhookHandler);

// ── Global body parsing (after stripe webhook raw route) ──
app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: false })); // For Twilio webhook form data

// ── Security middleware (after body parsing so sanitization can inspect bodies) ──
applySecurityMiddleware(app);

// ── Rate limiters for sensitive endpoints ──
const smsLimiter = rateLimit({ windowMs: 60_000, max: 10, keyFn: (req) => `sms:${req.headers.authorization?.slice(-20) || req.ip}` });
const emailLimiter = rateLimit({ windowMs: 60_000, max: 10, keyFn: (req) => `email:${req.headers.authorization?.slice(-20) || req.ip}` });
const paymentLimiter = rateLimit({ windowMs: 60_000, max: 20, keyFn: (req) => `pay:${req.headers.authorization?.slice(-20) || req.ip}` });
const quoteLimiter = rateLimit({ windowMs: 60_000, max: 30 }); // per IP
const leadCreateLimiter = rateLimit({ windowMs: 60_000, max: 30, keyFn: (req) => `lead:${req.headers.authorization?.slice(-20) || req.ip}` });

// ── Rate limiters for public/sensitive endpoints ──
const publicPayLimiter = rateLimit({ windowMs: 60_000, max: 15 }); // per IP — public payment page
const portalLimiter = rateLimit({ windowMs: 60_000, max: 20 }); // per IP — client portal
const quoteLimiterStrict = rateLimit({ windowMs: 60_000, max: 15 }); // per IP — quote track-view

// ── Apply rate limiters to specific paths ──
// In-memory limiters (always active)
app.use('/api/messages/send', smsLimiter);
app.use('/api/emails', emailLimiter);
app.use('/api/payments', paymentLimiter);
app.use('/api/leads/create', leadCreateLimiter);
app.use('/api/pay', publicPayLimiter);
app.use('/api/portal', portalLimiter);
app.use('/api/quotes', quoteLimiterStrict);

// Redis-backed persistent rate limiters (when Upstash is configured)
app.use('/api/messages/send', redisRateLimit({ preset: 'strict', keyFn: (req) => `sms:${req.headers.authorization?.slice(-20) || extractIP(req)}` }));
app.use('/api/emails', redisRateLimit({ preset: 'strict', keyFn: (req) => `email:${req.headers.authorization?.slice(-20) || extractIP(req)}` }));
app.use('/api/payments', redisRateLimit({ preset: 'standard', keyFn: (req) => `pay:${req.headers.authorization?.slice(-20) || extractIP(req)}` }));
app.use('/api/pay', redisRateLimit({ preset: 'public' }));
app.use('/api/portal', redisRateLimit({ preset: 'public' }));

// ── RBAC permission enforcement (before route handlers) ──
app.use(rbacMiddleware());

// ── Mount all route modules under /api ──
app.use('/api', searchRouter);
app.use('/api', geocodeRouter);
app.use('/api', leadsRouter);
app.use('/api', paymentsRouter);
app.use('/api', notificationsRouter);
app.use('/api', messagesRouter);
app.use('/api', emailsRouter);
app.use('/api', integrationsRouter);
// app.use('/api', invoiceTemplatesRouter); // Removed — no more invoice templates
app.use('/api', emailTemplatesRouter);
app.use('/api', communicationsRouter);
app.use('/api', automationTestRouter);
app.use('/api', automationEventsRouter);
app.use('/api', portalRouter);
app.use('/api', connectRouter);
app.use('/api', paymentRequestsRouter);
app.use('/api', publicPayRouter);
const directorProviderLimiter = rateLimit({ windowMs: 60_000, max: 20, keyFn: (req) => `director:${req.headers.authorization?.slice(-20) || req.ip}` });
app.use('/api/director-panel/providers', directorProviderLimiter);
app.use('/api', directorPanelRouter);
app.use('/api', featureFlagsRouter);
app.use('/api', scheduledReportsRouter);
app.use('/api', goalsRouter);
app.use('/api', auditLogRouter);
app.use('/api', aiProxyRouter);
const agentLimiter = rateLimit({ windowMs: 60_000, max: 20, keyFn: (req) => `agent:${req.headers.authorization?.slice(-20) || req.ip}` });
app.use('/api/agent', agentLimiter);
app.use('/api', agentRouter);
app.use('/api', agentTrainingRouter);
app.use('/api', orgKnowledgeRouter);

// Quote redirect at root level (/q/:token), API routes under /api — rate limited
app.use('/q', quoteLimiter);
app.use('/', quoteRedirectRouter);
app.use('/api', quotesRouter);
const surveyLimiter = rateLimit({ windowMs: 60_000, max: 10 }); // per IP
app.use('/api/survey', surveyLimiter);
app.use('/api', surveysRouter);
app.use('/api', teamSuggestionsRouter);
app.use('/api', jobsRouter);
app.use('/api', trackingRouter);
const formSubmitLimiter = rateLimit({ windowMs: 60_000, max: 10 }); // per IP — public form submissions
app.use('/api/public/form', formSubmitLimiter);
app.use('/api', requestFormsRouter);
app.use('/api', quoteTemplatesRouter);
app.use('/api', taxesRouter);
app.use('/api', invitationsRouter);
app.use('/api', billingRouter);
app.use('/api', referralsRouter);
app.use('/api', coursesRouter);
app.use('/api/field-sales', fieldSalesRouter);
app.use('/api', leaderboardRouter);
app.use('/api', commissionsRouter);
app.use('/api', gamificationRouter);
app.use('/api', fieldSessionsRouter);
app.use('/api', memoryGraphRouter);

// Security dashboard — tightly rate limited, admin-only routes enforce auth internally
const securityLimiter = rateLimit({ windowMs: 60_000, max: 30, keyFn: (req) => `security:${req.headers.authorization?.slice(-20) || req.ip}` });
app.use('/api/security', securityLimiter);
app.use('/api', securityRouter);

// ── Serve frontend static files in production ──
const distPath = path.resolve(__dirname, '..', 'dist');
app.use(express.static(distPath));

// ── Workflow action bridge — routes visual workflow actions to the real engine ──
app.post('/api/workflows/execute-action', async (req, res) => {
  try {
    const { requireAuthedClient, getServiceClient } = await import('./lib/supabase.js');
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { action_type, config, context } = req.body;
    if (!action_type) return res.status(400).json({ error: 'action_type is required' });

    const { executeAction, resolveEntityVariables } = await import('./lib/actions/index.js');
    const admin = getServiceClient();

    const actionCtx = {
      supabase: admin,
      orgId: auth.orgId,
      entityType: context?.entityType || 'workflow',
      entityId: context?.entityId || '',
      twilio: null as any,
      resendApiKey: process.env.RESEND_API_KEY || '',
      baseUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
    };

    // Try to init twilio if available
    try {
      const { twilioClient: tc, twilioPhoneNumber: tp } = await import('./lib/config.js');
      if (tc && tp) actionCtx.twilio = { client: tc, phoneNumber: tp };
    } catch {}

    // Resolve template variables from entity context
    let vars: Record<string, string> = {};
    if (context?.entityType && context?.entityId) {
      try {
        vars = await resolveEntityVariables(admin, auth.orgId, context.entityType, context.entityId);
      } catch {}
    }
    // Merge any extra context vars
    if (context) {
      for (const [k, v] of Object.entries(context)) {
        if (typeof v === 'string' && !vars[k]) vars[k] = v;
      }
    }

    const result = await executeAction(action_type, config || {}, vars, actionCtx);

    return res.json({ ok: true, result });
  } catch (error: any) {
    console.error('[workflows/execute-action]', error.message);
    return res.status(500).json({ error: error?.message || 'Action execution failed' });
  }
});

// SPA fallback — serve index.html with CSP nonce for inline styles
import crypto from 'crypto';
import fs from 'fs';

let indexHtmlTemplate = '';
try { indexHtmlTemplate = fs.readFileSync(path.join(distPath, 'index.html'), 'utf8'); } catch {}

app.get('*', (_req, res, next) => {
  if (_req.path.startsWith('/api')) return next();

  // Generate per-request nonce for CSP
  const nonce = crypto.randomBytes(16).toString('base64');

  // Update CSP header with nonce
  const currentCsp = res.getHeader('Content-Security-Policy')?.toString() || '';
  res.setHeader(
    'Content-Security-Policy',
    currentCsp.includes("'unsafe-inline'")
      ? currentCsp.replace("style-src 'self' 'unsafe-inline'", `style-src 'self' 'nonce-${nonce}' 'unsafe-inline'`)
      : currentCsp.replace("style-src 'self'", `style-src 'self' 'nonce-${nonce}'`)
  );

  if (indexHtmlTemplate) {
    const html = indexHtmlTemplate
      .replace(/<script/g, `<script nonce="${nonce}"`)
      .replace(/<style/g, `<style nonce="${nonce}"`);
    res.type('html').send(html);
  } else {
    res.sendFile(path.join(distPath, 'index.html'));
  }
});
// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Global error handler — sanitized for production (no stack traces, no internal details)
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('[server] unhandled error:', err?.message || err);

  if (!res.headersSent) {
    const status = err?.status || 500;

    // In production, never expose internal error details
    if (process.env.NODE_ENV === 'production' && status >= 500) {
      res.status(status).json({ error: 'Internal server error' });
    } else {
      // In development, show message but never stack traces via API
      res.status(status).json({ error: err?.message || 'Internal server error' });
    }
  }
});

// ── Validate encryption key at startup ──
const encKeyRaw = process.env.PAYMENTS_ENCRYPTION_KEY || '';
if (encKeyRaw) {
  try {
    const keyBuf = Buffer.from(encKeyRaw, 'base64');
    if (keyBuf.length !== 32) throw new Error(`Expected 32 bytes, got ${keyBuf.length}`);
    console.log('[security] payments encryption key validated (32 bytes)');
  } catch (err: any) {
    console.error(`FATAL: Invalid PAYMENTS_ENCRYPTION_KEY — ${err.message}`);
    process.exit(1);
  }
}

app.listen(port, '0.0.0.0', () => {
  console.log(`API listening on 0.0.0.0:${port}`);

  // Start automation scheduler
  startScheduler(supabaseUrl, supabaseServiceRoleKey, {
    client: twilioClient,
    phoneNumber: twilioPhoneNumber,
  });

  // Initialize event-driven automation engine
  if (supabaseServiceRoleKey) {
    const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // Start recurring jobs scheduler
    startRecurringJobScheduler(serviceClient);

    initAutomationEngine({
      supabase: serviceClient,
      twilio: twilioClient && twilioPhoneNumber ? { client: twilioClient, phoneNumber: twilioPhoneNumber } : null,
      resendApiKey: resendApiKey || '',
      baseUrl: process.env.FRONTEND_URL || `http://localhost:${port}`,
    });
  }

  // Automated alerts — scan every 30 minutes
  import('./lib/alerts-engine').then(({ runAlertScan }) => {
    setInterval(async () => {
      try { await runAlertScan(); } catch (err: any) { console.error('[alerts] Scan error:', err?.message); }
    }, 30 * 60 * 1000);
    console.log('[alerts] Engine started (every 30min)');
    // Run once on startup (delayed 10s)
    setTimeout(() => runAlertScan().catch((e: any) => console.error('[alerts] Startup scan error:', e?.message)), 10_000);
  });

  // Scheduled reports — check every hour
  import('./lib/scheduled-reports').then(({ processScheduledReports }) => {
    setInterval(async () => {
    try {
      const sent = await processScheduledReports();
      if (sent > 0) console.log(`[scheduled-reports] Sent ${sent} report(s)`);
    } catch (err: any) {
      console.error('[scheduled-reports] Cron error:', err?.message);
    }
    }, 60 * 60 * 1000);
    console.log('[scheduled-reports] Cron started (hourly)');
  });

  // AI Training maintenance — every 6 hours
  Promise.all([import('./lib/agent/training-engine'), import('./lib/supabase')]).then(([{ runTrainingMaintenance }, { getServiceClient: getSC }]) => {
    const admin = getSC();
    setInterval(async () => {
      try { await runTrainingMaintenance(admin); } catch (err: any) { console.error('[training] Maintenance error:', err?.message); }
    }, 6 * 60 * 60 * 1000);
    console.log('[training] Maintenance job started (every 6h)');
    // Run once on startup (delayed 30s)
    setTimeout(() => runTrainingMaintenance(admin).catch((e: any) => console.error('[training] Startup maintenance error:', e?.message)), 30_000);
  });

  // ── Security maintenance — every 15 minutes ──
  setInterval(() => {
    runSecurityMaintenance().catch((err: any) => {
      console.error('[security] Maintenance error:', err?.message);
    });
  }, 15 * 60 * 1000);
  console.log('[security] Maintenance job started (every 15min)');
  // Run once on startup (delayed 15s)
  setTimeout(() => runSecurityMaintenance().catch((e: any) => console.error('[security] Startup maintenance error:', e?.message)), 15_000);
});
