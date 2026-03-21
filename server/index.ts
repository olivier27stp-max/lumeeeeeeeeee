
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import config (initializes dotenv, validates env vars)
import { supabaseUrl, supabaseServiceRoleKey, twilioClient, twilioPhoneNumber, resendApiKey } from './lib/config';
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
import invoiceTemplatesRouter from './routes/invoice-templates';
import emailTemplatesRouter from './routes/email-templates';
import communicationsRouter from './routes/communications';
import automationTestRouter from './routes/automation-test';
import automationEventsRouter from './routes/automation-events';
import portalRouter from './routes/portal';
import connectRouter from './routes/connect';
import paymentRequestsRouter from './routes/payment-requests';
import publicPayRouter from './routes/public-pay';
import directorPanelRouter from './routes/director-panel';

const app = express();

// ── Security headers ──
app.use((_req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), payment=(self)');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' https://maps.googleapis.com https://js.stripe.com https://www.paypal.com",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https: blob:",
        "font-src 'self' data:",
        "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://maps.googleapis.com https://api.stripe.com https://fal.run https://queue.fal.run https://api.paypal.com",
        "frame-src https://js.stripe.com https://www.paypal.com",
        "media-src 'self' https: blob:",
        "object-src 'none'",
        "base-uri 'self'",
      ].join('; '),
    );
  }
  next();
});

// ── CORS — strict in prod, permissive in dev ──
const rawOrigin = (process.env.FRONTEND_URL || '').trim();
const allowedOrigin = rawOrigin || (process.env.NODE_ENV === 'production' ? true : 'http://localhost:5173');
app.use(cors({
  origin: allowedOrigin,
  credentials: true,
}));

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

const port = Number(process.env.API_PORT || 3002);

// ── Stripe webhook must be mounted BEFORE express.json() ──
// Stripe requires the raw body for signature verification, so this route
// uses express.raw() and is registered before the global express.json().
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json', limit: '1mb' }), stripeWebhookHandler);

// ── Global body parsing (after stripe webhook raw route) ──
app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: false })); // For Twilio webhook form data

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
app.use('/api/messages/send', smsLimiter);
app.use('/api/emails', emailLimiter);
app.use('/api/payments', paymentLimiter);
app.use('/api/leads/create', leadCreateLimiter);
app.use('/api/pay', publicPayLimiter);
app.use('/api/portal', portalLimiter);
app.use('/api/quotes', quoteLimiterStrict);

// ── Mount all route modules under /api ──
app.use('/api', searchRouter);
app.use('/api', geocodeRouter);
app.use('/api', leadsRouter);
app.use('/api', paymentsRouter);
app.use('/api', notificationsRouter);
app.use('/api', messagesRouter);
app.use('/api', emailsRouter);
app.use('/api', integrationsRouter);
app.use('/api', invoiceTemplatesRouter);
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

// Quote redirect at root level (/q/:token), API routes under /api — rate limited
app.use('/q', quoteLimiter);
app.use('/', quoteRedirectRouter);
app.use('/api', quotesRouter);
const surveyLimiter = rateLimit({ windowMs: 60_000, max: 10 }); // per IP
app.use('/api/survey', surveyLimiter);
app.use('/api', surveysRouter);

// ── Serve frontend static files in production ──
const distPath = path.resolve(__dirname, '..', 'dist');
app.use(express.static(distPath));

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// SPA fallback — serve index.html for all non-API routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(distPath, 'index.html'));
});

// Global error handler
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('[server] unhandled error:', err?.message || err);
  if (!res.headersSent) {
    res.status(err?.status || 500).json({ error: err?.message || 'Internal server error' });
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

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);

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
});
