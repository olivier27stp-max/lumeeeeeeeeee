
import express from 'express';
import crypto from 'node:crypto';
// Base publique canonique : lue depuis la configuration, JAMAIS derivee des
// en-tetes de la requete (voir helpers.ts).
import { resolvePublicBaseUrl } from './lib/helpers';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import config (initializes dotenv, validates env vars)
import { supabaseUrl, supabaseServiceRoleKey, twilioClient, twilioPhoneNumber, getBaseUrl } from './lib/config';
import { qaRedirectActif, qaRedirectResume } from './lib/qa-redirect';

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
import clientErrorsRouter from './routes/client-errors';
import leadsRouter from './routes/leads';
import paymentsRouter, { stripeWebhookHandler } from './routes/payments';
import messagesRouter from './routes/messages';
import quotesRouter, { quoteRedirectRouter } from './routes/quotes';
import agreementsRouter from './routes/agreements';
import notificationsRouter from './routes/notifications';
import emailsRouter from './routes/emails';
import integrationsRouter from './routes/integrations';
import emailAccountsRouter from './routes/email-accounts';
import surveysRouter from './routes/surveys';
import emailTemplatesRouter from './routes/email-templates';
import communicationsRouter from './routes/communications';
import automationTestRouter from './routes/automation-test';
import automationEventsRouter from './routes/automation-events';
import portalRouter from './routes/portal';
import connectRouter from './routes/connect';
import paymentRequestsRouter from './routes/payment-requests';
import publicPayRouter from './routes/public-pay';
import unsubscribeRouter from './routes/unsubscribe';
import teamSuggestionsRouter from './routes/team-suggestions';
import jobsRouter from './routes/jobs';
import trackingRouter from './routes/tracking';
import storageUploadRouter from './routes/storage-upload';
import timesheetsRouter from './routes/timesheets';
import requestFormsRouter from './routes/request-forms';
import marketingRouter from './routes/marketing';
import routeOptimizationRouter from './routes/route-optimization';
// Removed: campaigns / booking / recurring-invoices / webhooks-config /
// quickbooks-export — corresponding UI features deleted.
import quoteTemplatesRouter from './routes/quote-templates';
import checklistsRouter from './routes/checklists';
import taxesRouter from './routes/taxes';
import featureFlagsRouter from './routes/feature-flags';
import scheduledReportsRouter from './routes/scheduled-reports';
import goalsRouter from './routes/goals';
import auditLogRouter from './routes/audit-log';
import activityNotesRouter from './routes/activity-notes';
import orgKnowledgeRouter from './routes/org-knowledge';
import agentAuthRouter from './routes/agent-auth';
import agentRouter from './routes/agent';
import invitationsRouter from './routes/invitations';
import orgsRouter from './routes/orgs';
import rolePresetsRouter from './routes/role-presets';
import billingRouter from './routes/billing';
import referralsRouter from './routes/referrals';
import supportRouter from './routes/support';
import securityRouter from './routes/security';
import mfaSmsRouter from './routes/mfa-sms';
import coursesRouter from './routes/courses';
import fieldSalesRouter from './routes/field-sales';
import leaderboardRouter from './routes/leaderboard';
import commissionsRouter from './routes/commissions';
import payrollRouter from './routes/payroll';
import gamificationRouter from './routes/gamification';
import fieldSessionsRouter from './routes/field-sessions';
import authRouter from './routes/auth';
import dsrRouter from './routes/dsr';
import teamComplianceRouter from './routes/team-compliance';
import incidentsRouter from './routes/incidents';
import cronRouter from './routes/cron';
import remindersCronRouter from './routes/reminders-cron';
import remindersRouter from './routes/reminders';
import meRouter from './routes/me';
import onboardingRouter from './routes/onboarding';

// Security engine
import { applySecurityMiddleware, runSecurityMaintenance, slidingRateLimit, userKey } from './lib/security';
import { redisRateLimit, useRedis } from './lib/rate-limiter';
import { rbacMiddleware } from './lib/route-permissions';
import { mfaEnforcementMiddleware } from './lib/mfa-enforcement';
import { auditRequestMiddleware } from './lib/audit-middleware';
import { initSentry, attachSentryErrorHandler, captureException, captureCronFailure, withCronCheckIn } from './lib/sentry';

const app = express();

// Trust exactly one reverse proxy (Railway's edge). This makes req.ip the real
// client IP derived from the RIGHT end of X-Forwarded-For, so a client can no
// longer spoof its rate-limit / IP-block key by prepending a fake XFF entry.
// NOTE: assumes a single proxy hop (Railway's default). If IP-based limits ever
// mis-bucket in prod, adjust this hop count.
app.set('trust proxy', 1);

// Do not advertise Express — small reconnaissance signal removed.
app.disable('x-powered-by');

// ── Canonical host redirect ──
// The site moved to lumecrm.net (2026-07-23) but the old Railway subdomain
// still resolves and would otherwise serve a second copy of the app (stale
// bookmarks, split sessions). Browser traffic gets a permanent redirect.
// /api is exempt on purpose: webhook senders (Stripe, Twilio) don't follow
// redirects, so anything still pointed at the old host must keep working.
// www.lumecrm.net is also folded into the apex — one canonical origin keeps
// the Supabase/Google allowlists and localStorage sessions on a single host.
const CANONICAL_HOST = 'lumecrm.net';
const LEGACY_HOSTS = new Set([
  'lumeeeeeeeeee-production.up.railway.app',
  'www.lumecrm.net',
]);
app.use((req, res, next) => {
  if (LEGACY_HOSTS.has(req.hostname) && !req.path.startsWith('/api')) {
    return res.redirect(301, `https://${CANONICAL_HOST}${req.originalUrl}`);
  }
  next();
});

// ── Sentry (no-op if SENTRY_DSN not set) ──
initSentry(app);

// ── Security headers (hardened) ──
app.use((req, res, next) => {
  // The public request form (`/form/:apiKey`) is meant to be embedded in an
  // <iframe> on external sites (Squarespace, Wix, etc.), so it must NOT send
  // frame-blocking headers. Everything else stays locked down.
  const framable = req.path.startsWith('/form/');
  if (!framable) res.setHeader('X-Frame-Options', 'DENY');
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
        // wasm-unsafe-eval: le moteur de la carte 3D photoréaliste Google est en
        // WebAssembly — sans cette source, gmp-map-3d charge à l'infini. Ça
        // n'autorise QUE la compilation WASM, pas l'eval JavaScript.
        ? "script-src 'self' 'wasm-unsafe-eval' https://maps.googleapis.com https://js.stripe.com https://www.paypal.com"
        // unsafe-eval required for Vite HMR in dev only; unsafe-inline scoped to dev
        : "script-src 'self' 'unsafe-eval' https://maps.googleapis.com https://js.stripe.com https://www.paypal.com http://localhost:*",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.mapbox.com",
      "img-src 'self' data: https: blob:",
      "font-src 'self' data: https://fonts.gstatic.com",
      // *.googleapis.com covers maps + solar (building heights) + tile (photorealistic
      // 3D tiles); *.gstatic.com is used by the 3D map renderer. Both are required by
      // the 3D height tool and were previously blocked (Solar fetch + 3D tiles failed).
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.googleapis.com https://*.gstatic.com https://api.stripe.com https://api.paypal.com https://api.mapbox.com https://events.mapbox.com https://*.tiles.mapbox.com https://fal.run https://queue.fal.run https://api.open-meteo.com https://geocoding-api.open-meteo.com",
      "worker-src 'self' blob:",
      "child-src 'self' blob:",
      "frame-src https://js.stripe.com https://www.paypal.com",
      "media-src 'self' https: blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      framable ? 'frame-ancestors *' : "frame-ancestors 'none'",
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
    // In development, allow known localhost origins (strict match prevents localhost.evil.com)
    if (process.env.NODE_ENV !== 'production') {
      try {
        const parsed = new URL(origin);
        if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
          return callback(null, true);
        }
      } catch (err) { console.error('[CORS] origin parse failed:', err); }
    }
    // Block everything else
    console.warn(`[CORS] Blocked origin: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  maxAge: 600, // Cache preflight for 10 minutes
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Requested-With', 'X-API-Key'],
}));

// ── Build marker — bypasses ALL middleware to identify the live deploy ──
// Bumped 2026-04-24T21:55Z to verify Railway picks up the CSRF webhook exemption fix.
const BUILD_MARKER = 'csrf-webhook-fix-v2-mountpath-aware-2026-04-24-2200';
app.get('/api/__build', (_req, res) => res.json({ build: BUILD_MARKER, t: new Date().toISOString() }));

// ── CSRF protection via custom header check ──
// Browsers enforce that custom headers can only be sent via JS (XMLHttpRequest/fetch),
// not via forms or img tags. This blocks cross-site form-based CSRF attacks.
//
// Webhook routes are exempted: they're called by external services (Twilio sends
// application/x-www-form-urlencoded with no auth header) and protect themselves
// via provider-specific signature validation (e.g. x-twilio-signature, stripe-signature).
// Paths are relative to the /api mount point — Express strips the prefix
// from req.path inside a mounted middleware, so DO NOT include /api here.
// (e.g. '/messages/inbound', NOT '/api/messages/inbound').
const WEBHOOK_PATHS_EXEMPT_FROM_CSRF = [
  '/messages/inbound',
  '/messages/status',
  '/webhooks/stripe',
  '/webhooks/stripe-connect',
  '/webhooks/paypal',
];
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // External webhooks: signature-validated downstream, never carry CSRF headers.
  if (WEBHOOK_PATHS_EXEMPT_FROM_CSRF.includes(req.path)) return next();
  // Désinscription en un clic : le POST est émis par le client de messagerie
  // (bouton natif « Se désabonner » de Gmail/Outlook via List-Unsubscribe-Post),
  // qui n'envoie aucun en-tête personnalisé. Le jeton de 32 octets dans l'URL
  // tient lieu d'authentification, et l'action est idempotente et sans risque :
  // le pire cas d'un CSRF réussi serait de désabonner quelqu'un — ce que la
  // route est faite pour faire.
  if (/^\/unsubscribe\/[a-f0-9]{64}$/.test(req.path)) return next();
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
// Stripe Connect events are configured to hit /stripe-connect. Same handler:
// it verifies the signature against either webhook secret (direct or Connect).
app.post('/api/webhooks/stripe-connect', express.raw({ type: 'application/json', limit: '1mb' }), stripeWebhookHandler);

// ── Global body parsing (after stripe webhook raw route) ──
app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: false })); // For Twilio webhook form data

// ─────────────────────────────────────────────────────────────────────────
// GET /api/auth/from-kairo — connexion automatique depuis Kairo
//
// Kairo (autre application, autre projet Supabase) affiche des liens
// « Ouvrir dans Lume ». Il signe un jeton court avec un secret partagé ;
// Lume le vérifie, retrouve l'utilisateur par courriel, et lui ouvre une
// session sans qu'il ait à se reconnecter.
//
// ⚠️ CE QUE CE SECRET PERMET
// `KAIRO_LUME_HANDOFF_SECRET` ne doit JAMAIS atteindre un navigateur, un
// commit, ni un canal de discussion. Quiconque le détient peut forger un
// jeton pour n'importe quelle adresse et ouvrir une session Lume à ce nom :
// il vaut un mot de passe administrateur, pas une clé d'API.
//
// La signature prouve « ce jeton vient de Kairo » — PAS « le porteur de ce
// lien est bien cette personne ». Le lien lui-même est donc un identifiant :
// il fuit par l'historique du navigateur, les journaux de proxy et l'en-tête
// Referer. C'est la raison du TTL de 60 secondes et de l'usage unique.
//
// PROTECTIONS EN PLACE
//   · TTL de 60 s, borné par `exp` dans le jeton ;
//   · usage unique via `jti`, mémorisé le temps de sa validité ;
//   · comparaison de signature à temps constant ;
//   · l'adhésion à l'organisation doit être ACTIVE — un employé congédié ne
//     doit pas entrer par cette porte ;
//   · chaque échange est journalisé dans `audit_events`.
//
// ⚠️ LIMITE CONNUE — le garde anti-rejeu vit EN MÉMOIRE. Avec plusieurs
// instances, un jeton rejoué sur une autre instance passerait. Le jour où
// l'on met à l'échelle horizontalement, il faut déplacer `jetonsVus` dans
// Redis, ou dans une table portant un index unique sur `jti`.
// ─────────────────────────────────────────────────────────────────────────

/** Jetons déjà consommés → date d'expiration. Purgé à chaque appel. */
const jetonsVus = new Map<string, number>();

/** Préfixes de destination autorisés — tout le reste est refusé. */
const DESTINATIONS_AUTORISEES = [
  '/invoices/', '/jobs/', '/clients/', '/deals/', '/quotes/', '/messages/', '/leads/',
];

/** Un jeton légitime fait quelques centaines d'octets. */
const TAILLE_MAX_JETON = 4096;

app.get('/api/auth/from-kairo', async (req, res) => {
  const refuser = (code: number, motif: string) => {
    // Le motif complet reste dans les journaux du serveur. Le client ne reçoit
    // qu'un code court : assez pour qu'un intégrateur sache quoi corriger, trop
    // vague pour indiquer ce qui manque à un jeton forgé.
    //
    // Sans lui, toute erreur d'intégration se présentait comme le même « Lien
    // invalide », impossible à diagnostiquer depuis l'autre service.
    console.warn('[from-kairo] refusé :', motif);
    const codes: Record<string, string> = {
      'jeton absent': 'NO_TOKEN',
      'jeton trop long': 'TOKEN_TOO_LONG',
      'format attendu corps.signature': 'BAD_FORMAT',
      'signature invalide': 'BAD_SIGNATURE',
      'corps illisible': 'BAD_BODY',
      'corps non conforme': 'BAD_BODY',
      'émetteur inattendu': 'BAD_ISSUER',
      'jti manquant': 'MISSING_JTI',
      'courriel manquant': 'MISSING_EMAIL',
      'organisation manquante': 'MISSING_ORG',
      'destination manquante': 'MISSING_TARGET',
      'jeton expiré': 'EXPIRED',
      'jeton déjà utilisé': 'ALREADY_USED',
      'destination absolue refusée': 'TARGET_NOT_RELATIVE',
      'destination hors liste blanche': 'TARGET_NOT_ALLOWED',
      'aucun compte Lume pour ce courriel': 'NO_LUME_ACCOUNT',
      'utilisateur non membre actif de cette organisation': 'NOT_ORG_MEMBER',
    };
    return res.status(code).json({ error: 'Lien invalide ou expiré.', code: codes[motif] || 'REJECTED' });
  };

  try {
    const jeton = typeof req.query.token === 'string' ? req.query.token : '';
    if (!jeton) return refuser(400, 'jeton absent');
    if (jeton.length > TAILLE_MAX_JETON) return refuser(400, 'jeton trop long');

    const sep = jeton.lastIndexOf('.');
    if (sep <= 0 || sep === jeton.length - 1) return refuser(400, 'format attendu corps.signature');
    const corpsB64 = jeton.slice(0, sep);
    const signatureB64 = jeton.slice(sep + 1);

    const secret = process.env.KAIRO_LUME_HANDOFF_SECRET;
    if (!secret) {
      // 503 et non 400 : le problème est de notre côté, pas dans la requête.
      console.error('[from-kairo] KAIRO_LUME_HANDOFF_SECRET absent de la configuration');
      return res.status(503).json({ error: 'Connexion depuis Kairo non configurée.' });
    }

    // ── Signature ──
    const attendue = crypto.createHmac('sha256', secret).update(corpsB64).digest();
    // Les trois encodages ci-dessous portent la MEME preuve cryptographique :
    // seule la representation change. Les bibliotheques HMAC rendent
    // naturellement de l'hexadecimal (Node `.digest('hex')`, Python
    // `.hexdigest()`) ou du base64 standard ; n'accepter que le base64url
    // faisait echouer une integration correcte pour une raison purement
    // cosmetique, avec un 401 impossible a diagnostiquer depuis l'autre cote.
    // Accepter les trois ne diminue en rien la securite.
    const candidats: Buffer[] = [];
    if (/^[0-9a-f]{64}$/i.test(signatureB64)) {
      candidats.push(Buffer.from(signatureB64, 'hex'));
    } else {
      candidats.push(Buffer.from(signatureB64, 'base64url'));
      // base64 standard : `+` et `/` la ou base64url met `-` et `_`.
      if (/[+/=]/.test(signatureB64)) candidats.push(Buffer.from(signatureB64, 'base64'));
    }
    // `timingSafeEqual` exige des longueurs egales : on teste avant, sinon il
    // leve une exception au lieu de renvoyer false.
    const valide = candidats.some(
      (c) => c.length === attendue.length && crypto.timingSafeEqual(c, attendue),
    );
    if (!valide) return refuser(401, 'signature invalide');

    // ── Contenu ──
    let charge: any;
    try {
      charge = JSON.parse(Buffer.from(corpsB64, 'base64url').toString('utf8'));
    } catch {
      return refuser(400, 'corps illisible');
    }
    if (!charge || typeof charge !== 'object') return refuser(400, 'corps non conforme');

    const { email, lume_org_id: orgId, target, exp, jti, iss } = charge;
    if (iss !== 'kairo') return refuser(401, 'émetteur inattendu');
    if (typeof jti !== 'string' || !jti) return refuser(400, 'jti manquant');
    if (typeof email !== 'string' || !email.includes('@')) return refuser(400, 'courriel manquant');
    if (typeof orgId !== 'string' || !orgId) return refuser(400, 'organisation manquante');
    if (typeof target !== 'string' || !target) return refuser(400, 'destination manquante');

    const maintenant = Math.floor(Date.now() / 1000);
    if (typeof exp !== 'number' || exp < maintenant) return refuser(401, 'jeton expiré');

    // ── Usage unique ──
    for (const [cle, fin] of jetonsVus) if (fin < maintenant) jetonsVus.delete(cle);
    if (jetonsVus.has(jti)) return refuser(401, 'jeton déjà utilisé');
    // Marqué AVANT la suite : deux requêtes simultanées portant le même jti ne
    // doivent pas passer toutes les deux.
    jetonsVus.set(jti, exp);

    // ── Destination ──
    // `//evil.com` est une URL protocol-relative, que le navigateur suivrait
    // vers un autre domaine. Un schéma absolu (`https:`, `javascript:`) est
    // refusé pour la même raison.
    if (target.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
      return refuser(400, 'destination absolue refusée');
    }
    if (!DESTINATIONS_AUTORISEES.some((p) => target.startsWith(p))) {
      return refuser(400, 'destination hors liste blanche');
    }

    // ── Utilisateur et adhésion ──
    const { getServiceClient } = await import('./lib/supabase.js');
    const admin = getServiceClient();

    const courriel = email.toLowerCase();
    const { data: liste, error: errListe } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (errListe) {
      console.error('[from-kairo] lecture des comptes impossible :', errListe.message);
      return res.status(503).json({ error: 'Service momentanément indisponible.' });
    }
    const utilisateur = (liste?.users || []).find((u: any) => (u.email || '').toLowerCase() === courriel);
    if (!utilisateur) return refuser(403, 'aucun compte Lume pour ce courriel');

    // `status` compte autant que l'existence du lien : une adhésion révoquée
    // reste en base, et sans ce filtre un employé congédié entrerait encore.
    const { data: adhesion, error: errAdhesion } = await admin
      .from('memberships')
      .select('user_id, status')
      .eq('user_id', utilisateur.id)
      .eq('org_id', orgId)
      .eq('status', 'active')
      .maybeSingle();
    // supabase-js ne lève pas : sans ce test, une erreur de lecture passerait
    // pour « pas membre » et donnerait un refus trompeur.
    if (errAdhesion) {
      console.error('[from-kairo] lecture adhésion impossible :', errAdhesion.message);
      return res.status(503).json({ error: 'Service momentanément indisponible.' });
    }
    if (!adhesion) return refuser(403, 'utilisateur non membre actif de cette organisation');

    // ── Journal ──
    // Le secret vaut un mot de passe administrateur : chaque usage doit laisser
    // une trace exploitable. Best-effort — un journal en échec ne doit pas
    // bloquer une connexion légitime.
    admin.from('audit_events').insert({
      org_id: orgId,
      user_id: utilisateur.id,
      action: 'auth.from_kairo',
      entity_type: 'session',
      metadata: { jti, target, email: courriel },
    }).then(({ error }: { error: any }) => {
      if (error) console.error('[from-kairo] journal non écrit :', error.message);
    });

    // ── Lien de connexion ──
    // `resolvePublicBaseUrl` ignore délibérément les en-têtes de la requête :
    // dériver la base d'un en-tête Host permettrait de rediriger la session
    // fraîchement ouverte vers un domaine contrôlé par l'attaquant.
    const publicBase = resolvePublicBaseUrl(req);
    const { data: lien, error: errLien } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: courriel,
      options: { redirectTo: `${publicBase}${target}` },
    });
    if (errLien) {
      console.error('[from-kairo] génération du lien impossible :', errLien.message);
      return res.status(503).json({ error: 'Connexion impossible pour le moment.' });
    }

    const actionLink = (lien as any)?.properties?.action_link || (lien as any)?.action_link;
    if (!actionLink) {
      console.error('[from-kairo] aucun action_link renvoyé par Supabase');
      return res.status(503).json({ error: 'Connexion impossible pour le moment.' });
    }

    return res.redirect(302, actionLink);
  } catch (err: any) {
    console.error('[from-kairo] échec inattendu :', err?.message);
    return res.status(500).json({ error: 'Erreur interne.' });
  }
});

// ── Security middleware (after body parsing so sanitization can inspect bodies) ──
applySecurityMiddleware(app);

// ── Audit logging (after security middleware, captures requestId) ──
app.use(auditRequestMiddleware());

// PII stored as plaintext — protected by Supabase encryption at rest (AES-256) + RLS org_id isolation

// ── Rate limiters for sensitive endpoints ──
const smsLimiter = rateLimit({ windowMs: 60_000, max: 10, keyFn: (req) => `sms:${userKey(req)}` });
const emailLimiter = rateLimit({ windowMs: 60_000, max: 10, keyFn: (req) => `email:${userKey(req)}` });
const paymentLimiter = rateLimit({ windowMs: 60_000, max: 20, keyFn: (req) => `pay:${userKey(req)}` });
const quoteLimiter = rateLimit({ windowMs: 60_000, max: 30 }); // per IP
const leadCreateLimiter = rateLimit({ windowMs: 60_000, max: 30, keyFn: (req) => `lead:${userKey(req)}` });

// ── Rate limiters for public/sensitive endpoints ──
const publicPayLimiter = rateLimit({ windowMs: 60_000, max: 10 }); // per IP — public payment page (tighter)
const portalLimiter = rateLimit({ windowMs: 60_000, max: 10 }); // per IP — client portal (tighter to prevent token brute-force)
const quoteLimiterStrict = rateLimit({ windowMs: 60_000, max: 15 }); // per IP — quote track-view
const automationLimiter = rateLimit({ windowMs: 60_000, max: 30, keyFn: (req) => `auto:${userKey(req)}` });
// Per-user limiters for cost-bearing / compliance-sensitive endpoints. Keyed on
// the JWT `sub` (userKey), so they're immune to X-Forwarded-For spoofing. These
// also act as the in-memory fallback for dsr/incidents when Redis is absent.
const agentLimiter = rateLimit({ windowMs: 60_000, max: 30, keyFn: (req) => `agent:${userKey(req)}` });
const workflowActionLimiter = rateLimit({ windowMs: 60_000, max: 60, keyFn: (req) => `wfaction:${userKey(req)}` });
const dsrLimiterMem = rateLimit({ windowMs: 60_000, max: 20, keyFn: (req) => `dsr:${userKey(req)}` });
const incidentsLimiterMem = rateLimit({ windowMs: 60_000, max: 60, keyFn: (req) => `inc:${userKey(req)}` });

// ── Apply rate limiters to specific paths ──
// When Redis is available, the redisRateLimit middleware below handles limiting
// and in-memory limiters become redundant overhead. Skip them to save a Map
// lookup + setInterval sweep on every request.
if (!useRedis) {
  app.use('/api/messages/send', smsLimiter);
  app.use('/api/emails', emailLimiter);
  app.use('/api/payments', paymentLimiter);
  app.use('/api/pay', publicPayLimiter);
  app.use('/api/portal', portalLimiter);
  app.use('/api/quotes', quoteLimiterStrict);
  app.use('/api/automations/events', automationLimiter);
  app.use('/api/agent', agentLimiter);
  app.use('/api/dsr', dsrLimiterMem);
  app.use('/api/incidents', incidentsLimiterMem);
}
// Always applied (no Redis equivalent registered below)
app.use('/api/leads/create', leadCreateLimiter);
// Per-token limiter — prevents brute-force via IP rotation (not covered by presets)
app.use('/api/pay', rateLimit({
  windowMs: 60_000,
  max: 20,
  keyFn: (req) => `paytok:${(req.path.match(/\/pay\/([a-f0-9]+)/)?.[1] || '').slice(0, 80)}`,
}));

// Redis-backed persistent rate limiters (when Upstash is configured)
app.use('/api/messages/send', redisRateLimit({ preset: 'strict', keyFn: (req) => `sms:${userKey(req)}` }));
app.use('/api/emails', redisRateLimit({ preset: 'strict', keyFn: (req) => `email:${userKey(req)}` }));
app.use('/api/email/', redisRateLimit({ preset: 'standard', keyFn: (req) => `emailbox:${userKey(req)}` }));
app.use('/api/payments', redisRateLimit({ preset: 'standard', keyFn: (req) => `pay:${userKey(req)}` }));
app.use('/api/pay', redisRateLimit({ preset: 'public' }));
app.use('/api/portal', redisRateLimit({ preset: 'auth' }));
// Public form submissions — tight rate limit to prevent abuse
app.use('/api/public/form', redisRateLimit({ preset: 'auth' }));
// Survey submissions — prevent ballot stuffing
app.use('/api/survey', redisRateLimit({ preset: 'auth' }));
// DSR endpoints — tight rate limit (compliance-sensitive + expensive export)
app.use('/api/dsr', redisRateLimit({ preset: 'strict', keyFn: (req) => `dsr:${userKey(req)}` }));
// Incidents — strict (failed-login needs to fit brute-force detection window)
app.use('/api/incidents/failed-login', redisRateLimit({ preset: 'auth' }));
app.use('/api/incidents', redisRateLimit({ preset: 'standard', keyFn: (req) => `inc:${userKey(req)}` }));
// AI agent (Gemini tool-loop) — cap per-user cost abuse
app.use('/api/agent', redisRateLimit({ preset: 'standard', keyFn: (req) => `agent:${userKey(req)}` }));
// ── MFA enforcement for admin/owner on sensitive endpoints ──
// SMS 2FA enrollment/challenge routes must stay reachable (they authenticate
// the user themselves) — mount before the MFA/RBAC gates so a step-up flow
// can never be blocked by the very gate it's meant to satisfy.
app.use('/api', mfaSmsRouter);

app.use(mfaEnforcementMiddleware());

// ── RBAC permission enforcement (before route handlers) ──
app.use(rbacMiddleware());

// ── Mount all route modules under /api ──
app.use('/api', searchRouter);
app.use('/api', geocodeRouter);
app.use('/api', clientErrorsRouter);
app.use('/api', routeOptimizationRouter);
app.use('/api', leadsRouter);
app.use('/api', paymentsRouter);
app.use('/api', notificationsRouter);
app.use('/api', messagesRouter);
app.use('/api', emailsRouter);
app.use('/api', integrationsRouter);
app.use('/api', emailAccountsRouter);
app.use('/api', emailTemplatesRouter);
app.use('/api', communicationsRouter);
app.use('/api', automationTestRouter);
app.use('/api', automationEventsRouter);
app.use('/api', portalRouter);
app.use('/api', connectRouter);
app.use('/api', paymentRequestsRouter);
app.use('/api', publicPayRouter);
// Désinscription courriel — publique, authentifiée par le jeton de l'URL.
app.use('/api', unsubscribeRouter);
app.use('/api', featureFlagsRouter);
app.use('/api', authRouter);
app.use('/api', dsrRouter);
app.use('/api', teamComplianceRouter);
app.use('/api', incidentsRouter);
app.use('/api', cronRouter);
app.use('/api', remindersCronRouter);
app.use('/api', remindersRouter);
app.use('/api', meRouter);
app.use('/api', onboardingRouter);
app.use('/api', scheduledReportsRouter);
app.use('/api', goalsRouter);
app.use('/api', auditLogRouter);
app.use('/api', activityNotesRouter);
// C4-01 — monté sous son propre préfixe. Avant, `app.use('/api', …)` avec des
// routes nues (`/`, `/:id`, `/bulk`) faisait ombrage à `GET/POST /api`, créait un
// `DELETE /api/:id` fourre-tout, cassait `/bulk`, et fuitait maxBodySize/guardCommonShape
// sur les ~29 routers montés après cette ligne.
app.use('/api/org-knowledge', orgKnowledgeRouter);
// External agent auth (API-key → short-lived JWT) + webhook — owns its auth
app.use('/api', agentAuthRouter);
// Lume Agent — in-app AI chat (Gemini). Auth per-request via requireAuthedClient.
app.use('/api', agentRouter);

// Quote redirect at root level (/q/:token), API routes under /api — rate limited.
// Per-token limiter on top of IP limiter to block token brute-force via IP rotation.
const quoteTokenLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyFn: (req) => `qtok:${(req.params?.token || req.url.split('/q/')[1] || '').slice(0, 80)}`,
});
app.use('/q', quoteLimiter);
app.use('/q', quoteTokenLimiter);
app.use('/q', redisRateLimit({
  preset: 'public',
  keyFn: (req) => `qtok:${(req.params?.token || req.url.split('/q/')[1] || '').slice(0, 80)}`,
}));
app.use('/', quoteRedirectRouter);
app.use('/api', quotesRouter);
app.use('/api', agreementsRouter);
const surveyLimiter = rateLimit({ windowMs: 60_000, max: 10 }); // per IP
app.use('/api/survey', surveyLimiter);
app.use('/api', surveysRouter);
app.use('/api', teamSuggestionsRouter);
app.use('/api', jobsRouter);
app.use('/api', trackingRouter);
app.use('/api', storageUploadRouter);
app.use('/api', timesheetsRouter);
const formSubmitLimiter = rateLimit({ windowMs: 60_000, max: 10 }); // per IP — public form submissions
app.use('/api/public/form', formSubmitLimiter);
app.use('/api/public/book-demo', formSubmitLimiter);
app.use('/api', requestFormsRouter);
app.use('/api', marketingRouter);
app.use('/api', quoteTemplatesRouter);
app.use('/api', checklistsRouter);
app.use('/api', taxesRouter);
app.use('/api', invitationsRouter);
app.use('/api', orgsRouter);
app.use('/api', rolePresetsRouter);
app.use('/api', billingRouter);
app.use('/api', referralsRouter);
// In-app support: cap per user so one tenant can't flood the support inbox.
// Clé sur l'utilisateur, pas l'IP : plusieurs employés d'un même client
// derrière un NAT partageaient le quota (faux positifs), et une rotation d'IP
// le contournait. La route exige déjà une session, donc la clé est fiable.
app.use('/api/support', rateLimit({ windowMs: 60_000, max: 5, keyFn: (req) => `support:${userKey(req)}` }));
app.use('/api', supportRouter);
app.use('/api', coursesRouter);
app.use('/api/field-sales', fieldSalesRouter);
app.use('/api', leaderboardRouter);
app.use('/api', commissionsRouter);
app.use('/api', payrollRouter);
app.use('/api', gamificationRouter);
app.use('/api', fieldSessionsRouter);

// Le back-office « Platform Admin » (page + 8 routes de lecture seule donnant
// une vue inter-tenants) a été retiré à la demande du propriétaire. Un accès
// transverse aux données de tous les locataires n'a pas sa place dans l'app.
// GET /api/incidents/anomalies, dernier survivant de cette catégorie, a été
// retiré ensuite : il exposait les courriels et IP de tous les locataires et
// n'était consultable que depuis ce back-office. `PLATFORM_OWNER_ID` ne sert
// donc plus qu'à la boîte de réception des demandes de démo (marketing.ts).

// CSP violation reports — public endpoint, tight limit to prevent log flooding
const cspReportLimiter = rateLimit({ windowMs: 60_000, max: 20 }); // per IP
app.use('/api/security/csp-report', cspReportLimiter);

// Security dashboard — tightly rate limited, admin-only routes enforce auth internally
const securityLimiter = rateLimit({ windowMs: 60_000, max: 30, keyFn: (req) => `security:${userKey(req)}` });
app.use('/api/security', securityLimiter);
app.use('/api', securityRouter);

// ── Serve frontend static files in production ──
const distPath = path.resolve(__dirname, '..', 'dist');
app.use(express.static(distPath, {
  maxAge: '1y',
  immutable: true,
  setHeaders: (res, filePath) => {
    // index.html must never be cached (it references hashed asset filenames
    // that change every deploy). Hashed JS/CSS in /assets are immutable.
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  },
}));

// ── Workflow action bridge — routes visual workflow actions to the real engine ──
app.post('/api/workflows/execute-action', workflowActionLimiter, async (req, res) => {
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
      baseUrl: getBaseUrl(),
    };

    // Try to init twilio if available
    try {
      const { twilioClient: tc, twilioPhoneNumber: tp } = await import('./lib/config.js');
      if (tc && tp) actionCtx.twilio = { client: tc, phoneNumber: tp };
    } catch (err) { console.error('[automation] twilio init failed:', err); }

    // Resolve template variables from entity context
    let vars: Record<string, string> = {};
    if (context?.entityType && context?.entityId) {
      try {
        vars = await resolveEntityVariables(admin, auth.orgId, context.entityType, context.entityId);
      } catch (err) { console.error('[automation] resolveEntityVariables failed:', err); }
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

/* ── Résumé initial par route ──
   index.html porte un résumé de la page d'accueil dans #root, remplacé par
   l'application au chargement. Comme cette application est monopage, toutes les
   routes reçoivent ce même document : sans traitement, /privacy et /terms
   afficheraient le résumé de l'accueil avant chargement, et les clients HTTP qui
   n'exécutent pas de script (moteurs d'indexation, aperçus de lien, lecteurs
   hors ligne) n'y verraient jamais le contenu légal. On substitue donc au <main>
   un résumé fidèle à la route demandée.                                        */
const CRAWLER_FALLBACKS: Record<string, string> = {
  '/privacy': `<h1 style="font-size:2rem;margin:0 0 1rem">Politique de confidentialité — Lume</h1>
        <p style="margin:0 0 1rem">Cette politique explique quelles données personnelles Lume collecte, pourquoi, comment elles sont protégées et quels sont vos droits (Loi 25, LPRPDE, RGPD).</p>
        <p style="margin:0 0 1rem"><strong>Intégration Google.</strong> La connexion d'un compte Google est facultative et sert uniquement à l'authentification. Lume demande uniquement les autorisations <code>userinfo.email</code> et <code>openid</code>, qui identifient le compte connecté. Lume ne demande aucun accès à Gmail : ni lecture, ni envoi, ni modification de vos messages.</p>
        <p style="margin:0 0 1rem"><strong>Limited Use.</strong> L'utilisation par Lume des informations obtenues via les API Google est conforme à la Google API Services User Data Policy, y compris ses exigences relatives à la Limited Use. Ces données ne sont jamais utilisées à des fins publicitaires, ne sont jamais vendues et ne servent jamais à entraîner des modèles d'intelligence artificielle.</p>
        <p style="margin:0 0 1rem"><strong>Conservation et révocation.</strong> À la déconnexion du compte Google, les jetons OAuth sont révoqués immédiatement et les données synchronisées sont supprimées sous 30 jours. L'accès peut être révoqué à tout moment depuis <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.</p>
        <p style="margin:0 0 1rem"><strong>Privacy Policy (English).</strong> This policy explains what personal data Lume collects, why, how it is protected, and your rights. Google sign-in is optional and used for authentication only; Lume requests only <code>userinfo.email</code> and <code>openid</code> and requests no Gmail access whatsoever. Its use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements, and Google data is never used for advertising, never sold, and never used to train AI models.</p>
        <p style="margin:0"><a href="/">Accueil / Home</a> · <a href="/terms">Conditions d'utilisation / Terms of Service</a></p>`,
  '/terms': `<h1 style="font-size:2rem;margin:0 0 1rem">Conditions d'utilisation — Lume</h1>
        <p style="margin:0 0 1rem">En créant un compte ou en utilisant Lume (le « Service »), vous acceptez les présentes conditions. Si vous les acceptez au nom d'une organisation, vous déclarez avoir le pouvoir de l'engager.</p>
        <p style="margin:0 0 1rem">Lume est un logiciel de gestion pour les entreprises de services résidentiels : clients, soumissions, factures, planification et courriels.</p>
        <p style="margin:0 0 1rem"><strong>Terms of Service (English).</strong> By creating an account or using Lume (the "Service"), you agree to these Terms. If you are accepting on behalf of an organization, you represent that you have authority to bind that organization.</p>
        <p style="margin:0"><a href="/">Accueil / Home</a> · <a href="/privacy">Politique de confidentialité / Privacy Policy</a></p>`,
};

/* ── /about — présentation du produit, servie en HTML complet ──
   Page autonome (aucun script requis) décrivant Lume, ses fonctionnalités
   et son usage des données Google. Sert de page de présentation officielle
   référencée depuis l'écran de consentement OAuth.                            */
const ABOUT_PAGE = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lume</title>
<meta name="application-name" content="Lume">
<meta name="description" content="Lume est un logiciel de gestion tout-en-un pour les entreprises de services résidentiels : clients, soumissions, factures, planification et courriels.">
<meta property="og:site_name" content="Lume">
<meta property="og:title" content="Lume">
<meta property="og:type" content="website">
<meta property="og:url" content="https://lumecrm.net/about">
<meta property="og:description" content="Lume est un logiciel de gestion tout-en-un pour les entreprises de services résidentiels : clients, soumissions, factures, planification et courriels.">
<link rel="canonical" href="https://lumecrm.net/about">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"SoftwareApplication","name":"Lume","applicationCategory":"BusinessApplication","operatingSystem":"Web","url":"https://lumecrm.net/","description":"Lume est un logiciel de gestion tout-en-un pour les entreprises de services résidentiels : clients, soumissions, factures, planification et courriels.","publisher":{"@type":"Organization","name":"Lume"}}
</script>
</head>
<body>
<h1>Lume</h1>
<p class="lead">Lume est un logiciel de gestion tout-en-un conçu pour les entreprises de services résidentiels : lavage de vitres, toiture, paysagement, CVAC, excavation, pavage et autres métiers de services à domicile.</p>

<h2>À quoi sert Lume</h2>
<p>Lume réunit dans une seule application les outils dont une entreprise de services a besoin au quotidien :</p>
<ul>
  <li><strong>Clients et prospects</strong> — fiches, historique, suivi des relances.</li>
  <li><strong>Soumissions et factures</strong> — création, envoi, suivi des paiements.</li>
  <li><strong>Planification</strong> — calendrier des travaux, assignation des équipes, itinéraires.</li>
  <li><strong>Boîte de réception</strong> — consulter et répondre aux courriels professionnels sans quitter le dossier client.</li>
  <li><strong>Automatisations</strong> — rappels de rendez-vous, relances de soumissions, demandes d'avis.</li>
</ul>

<h2>Utilisation des données Google</h2>
<p>La connexion d'un compte Google est <strong>facultative</strong> et sert uniquement à l'authentification. Lume demande deux autorisations :</p>
<ul>
  <li><code>userinfo.email</code> — identifier le compte connecté.</li>
  <li><code>openid</code> — authentifier l'utilisateur.</li>
</ul>
<p>Lume ne demande <strong>aucun accès à Gmail</strong> : ni lecture, ni envoi, ni modification de vos messages. L'utilisation des informations obtenues via les API Google est conforme à la <em>Google API Services User Data Policy</em>, y compris ses exigences relatives à la <em>Limited Use</em>. Ces données ne sont jamais utilisées à des fins publicitaires, ne sont jamais vendues et ne servent jamais à entraîner des modèles d'intelligence artificielle.</p>

<h2>About Lume (English)</h2>
<p>Lume is an all-in-one management platform for residential service businesses (window cleaning, roofing, landscaping, HVAC, excavation and similar trades). It lets owners manage clients and leads, create quotes and invoices, schedule jobs and crews, and track payments — all in one place.</p>
<p>Connecting a Google account is optional and is used for sign-in only. Lume requests <code>userinfo.email</code> and <code>openid</code>, and requests no access to Gmail. Its use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements. Google data is never used for advertising, never sold, and never used to train artificial-intelligence models.</p>

<footer>
<p><strong>Lume</strong> — exploité par William Hébert, Québec, Canada — <a href="mailto:willhebert30@gmail.com">willhebert30@gmail.com</a></p>
<p><a href="/">Application</a> · <a href="/privacy">Politique de confidentialité</a> · <a href="/terms">Conditions d'utilisation</a> · <a href="/pricing">Tarifs</a></p>
</footer>
<style>
  body{max-width:46rem;margin:0 auto;padding:3rem 1.5rem;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.65;color:#1a1a1a;background:#fff}
  h1{font-size:2.25rem;margin:0 0 .5rem}
  h2{font-size:1.25rem;margin:2.5rem 0 .75rem}
  p{margin:0 0 1rem}
  ul{margin:0 0 1rem;padding-left:1.25rem}
  li{margin:.25rem 0}
  a{color:#1a56db}
  .lead{font-size:1.15rem}
  footer{margin-top:3rem;padding-top:1.5rem;border-top:1px solid #e5e5e5;font-size:.9rem}
</style>
</body>
</html>`;

// Même page de présentation servie sous plusieurs chemins. Un vérificateur
// externe met parfois son verdict en cache par URL ; disposer d'un chemin
// encore jamais consulté permet d'obtenir une évaluation fraîche.
for (const p of ['/about', '/lume-crm-presentation']) {
  app.get(p, (_req, res) => {
    res.set('Cache-Control', 'no-store, must-revalidate');
    res.type('html').send(ABOUT_PAGE);
  });
}

/* robots.txt et sitemap.xml : servis explicitement. Sans ces routes, le
   fallback monopage renvoie index.html pour ces chemins — un client qui
   demande robots.txt recevrait du HTML, réponse invalide qui peut faire
   abandonner l'exploration du site.                                          */
app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send(
    'User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: https://lumecrm.net/sitemap.xml\n',
  );
});

// SPA fallback — serve index.html fresh from disk every time.
// Reading once at boot caused stale HTML referencing old hashed assets
// after a redeploy (dist/ rewritten but template in memory).
app.get('*', (_req, res, next) => {
  if (_req.path.startsWith('/api')) return next();
  res.set('Cache-Control', 'no-store, must-revalidate');

  /* Une requête pour un fichier (extension connue) qui n'a pas été servie par
     express.static n'existe pas : renvoyer index.html avec un 200 en ferait un
     « soft 404 », que les moteurs d'indexation pénalisent au niveau du domaine.
     Les chemins sans extension restent traités par le routeur de l'application. */
  if (/\.(txt|xml|json|js|css|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|pdf|zip|mp4|webm)$/i.test(_req.path)) {
    res.status(404).type('text/plain').send('Not Found');
    return;
  }

  const routeFallback = CRAWLER_FALLBACKS[_req.path.replace(/\/+$/, '') || '/'];
  if (routeFallback) {
    try {
      const html = fs.readFileSync(path.join(distPath, 'index.html'), 'utf8');
      // Substitue au résumé de l'accueil celui de la route demandée ; le tout
      // est remplacé par l'application au chargement.
      const swapped = html.replace(
        /(<main[^>]*>)[\s\S]*?(<\/main>)/,
        (_m, open: string, close: string) => `${open}${routeFallback}${close}`,
      );
      res.type('html').send(swapped);
      return;
    } catch {
      /* si la lecture echoue, on retombe sur le sendFile standard */
    }
  }

  res.sendFile(path.join(distPath, 'index.html'));
});
// Health check endpoint
// Sonde de disponibilité, destinée à un moniteur externe (UptimeRobot & co).
//
// Elle interroge la base : un serveur qui répond « ok » alors que Supabase est
// injoignable est un faux positif — le moniteur reste vert pendant que
// l'application est inutilisable pour tout le monde. Un 503 est renvoyé dans ce
// cas, c'est ce que les moniteurs interprètent comme une panne.
//
// La requête est volontairement minuscule (une ligne, une colonne) et n'est PAS
// mise en cache : elle tourne à chaque appel, toutes les 1 à 5 minutes.
app.get('/api/health', async (_req, res) => {
  const started = Date.now();
  try {
    const { getServiceClient } = await import('./lib/supabase.js');
    const admin = getServiceClient();
    const { error } = await admin.from('orgs').select('id').limit(1);
    if (error) throw new Error(error.message);
    res.json({ status: 'ok', uptime: process.uptime(), db_ms: Date.now() - started });
  } catch (err: any) {
    // Pas de captureCronFailure ici : la panne se répéterait à chaque sondage et
    // noierait Sentry. Le moniteur externe est le bon canal d'alerte.
    console.error('[health] base injoignable:', err?.message || err);
    res.status(503).json({ status: 'degraded', error: 'database unreachable' });
  }
});

// Global error handler — sanitized for ALL environments (no stack traces, no DB details)
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('[server] unhandled error:', err?.message || err);

  if (!res.headersSent) {
    const status = err?.status || 500;

    // NEVER expose internal error details in 5xx responses — even in dev.
    // DB errors (Postgres codes), stack traces, and internal messages can reveal
    // schema details, query patterns, or server internals to attackers.
    if (status >= 500) {
      res.status(status).json({ error: 'Internal server error' });
    } else {
      // 4xx errors: show a safe message but strip any DB-internal details
      const safeMessage = sanitizeErrorMessage(err?.message || 'Request failed');
      res.status(status).json({ error: safeMessage });
    }
  }
});

/** Strip database-internal details from error messages before sending to client */
function sanitizeErrorMessage(msg: string): string {
  // Strip PostgreSQL error details
  if (/\b(PGRES|PG_|pg_|relation|constraint|violates|duplicate key|column|schema|row-level security)\b/i.test(msg)) {
    return 'Request failed due to a data constraint.';
  }
  // Strip SQL-looking content
  if (/\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|INDEX)\b/.test(msg)) {
    return 'Request failed.';
  }
  // Strip stack-trace-looking content
  if (msg.includes('at ') && msg.includes('.ts:')) {
    return 'An unexpected error occurred.';
  }
  return msg;
}

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

// ── Sentry error handler must be BEFORE any other error middleware ──
attachSentryErrorHandler(app);

// ── Process-level crash safety net ──────────────────────────────────
// Without these, an unhandled promise rejection or async throw outside an
// Express handler dies silently — no log, no capture. We log loudly and
// forward to Sentry (a no-op until SENTRY_DSN is set). We deliberately do NOT
// exit: a single-instance deploy should stay up rather than risk a crash loop;
// the goal here is visibility, not termination.
process.on('unhandledRejection', (reason: unknown) => {
  console.error('[fatal] unhandledRejection:', reason);
  captureException(reason instanceof Error ? reason : new Error(String(reason)), { kind: 'unhandledRejection' });
});
process.on('uncaughtException', (err: Error) => {
  console.error('[fatal] uncaughtException:', err);
  captureException(err, { kind: 'uncaughtException' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`API listening on 0.0.0.0:${port}`);

  // Mode QA : impossible de l'oublier armé. Sans cette bannière, on pourrait
  // croire que les messages partent aux clients alors qu'ils sont tous détournés
  // — ou l'inverse, bien plus grave, croire qu'ils sont détournés alors que non.
  if (qaRedirectActif()) {
    console.warn('');
    console.warn('  ╔════════════════════════════════════════════════════════════╗');
    console.warn('  ║  MODE QA ACTIF — les envois réels sont DÉTOURNÉS           ║');
    console.warn(`  ║  ${qaRedirectResume().padEnd(58)}║`);
    console.warn('  ║  Aucun client ne recevra de message.                       ║');
    console.warn('  ╚════════════════════════════════════════════════════════════╝');
    console.warn('');
  }

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
      baseUrl: getBaseUrl(),
    });

    // D2D Pipeline sync — auto-update pipeline stages on CRM events
    import('./lib/d2d-pipeline-listener').then(({ initD2DPipelineListeners }) => {
      initD2DPipelineListeners();
    });
  }

  // ── Cron jobs — wrapped in advisory locks so only one replica runs each tick ──
  import('./lib/advisory-lock').then(({ withAdvisoryLock }) => {
    // Automated alerts — scan every 30 minutes
    import('./lib/alerts-engine').then(({ runAlertScan }) => {
      setInterval(async () => {
        const res = await withAdvisoryLock('alerts-engine', () => withCronCheckIn('alerts-engine', () => runAlertScan())).catch((e: any) => {
          captureCronFailure('alerts-engine', e); return { acquired: true };
        });
        if (!res.acquired) { /* another replica owns this tick */ }
      }, 30 * 60 * 1000);
      console.log('[alerts] Engine started (every 30min, lock-guarded)');
      setTimeout(() => withAdvisoryLock('alerts-engine-startup', () => runAlertScan())
        .catch((e: any) => captureCronFailure('alerts-engine-startup', e)), 10_000);
    // Un import() qui échoue laisse la tâche non démarrée, sans erreur ni trace :
    // le cron ne tourne simplement jamais.
    }).catch((e: any) => captureCronFailure('alerts-engine-import', e));

    // Relance des impayés — J+3 rappel, J+7 suspension. Toutes les 6 heures :
    // la granularité utile est le jour, inutile de scruter plus souvent.
    Promise.all([import('./lib/dunning-engine'), import('./lib/supabase')]).then(
      ([{ runDunningScan }, { getServiceClient }]) => {
        const runDunning = () =>
          withAdvisoryLock('dunning-engine', () => withCronCheckIn('dunning-engine', () => runDunningScan(getServiceClient())))
            .catch((e: any) => captureCronFailure('dunning-engine', e));
        setInterval(runDunning, 6 * 60 * 60 * 1000);
        setTimeout(runDunning, 30_000);
        console.log('[dunning] Cron started (every 6h, lock-guarded)');
      },
    ).catch((e: any) => captureCronFailure('dunning-engine-import', e));

    // Map pin repair — geocode request pins saved without coords, every 10 minutes
    Promise.all([import('./lib/fieldPinSync'), import('./lib/supabase')]).then(
      ([{ repairMissingPinCoords }, { getServiceClient }]) => {
        const runRepair = () =>
          withAdvisoryLock('field-pin-repair', () => withCronCheckIn('field-pin-repair', () => repairMissingPinCoords(getServiceClient())))
            .catch((e: any) => captureCronFailure('field-pin-repair', e));
        setInterval(runRepair, 10 * 60 * 1000);
        setTimeout(runRepair, 20_000);
        console.log('[field-pin-repair] Cron started (every 10min, lock-guarded)');
      },
    ).catch((e: any) => captureCronFailure('field-pin-repair-import', e));

    // Surveillance des évènements de sécurité — le dernier maillon de la
    // détection installée le 2026-07-31. Les sondes et la télémétrie écrivaient
    // dans security_events, mais rien ne lisait cette table : une détection que
    // personne ne regarde équivaut à pas de détection.
    import('./lib/security-alerting').then(({ demarrerAlertingSecurite }) => {
      demarrerAlertingSecurite();
    }).catch((e: any) => captureCronFailure('security-alerting-startup', e));

    // Scheduled reports — check every hour
    import('./lib/scheduled-reports').then(({ processScheduledReports }) => {
      setInterval(async () => {
        const res = await withAdvisoryLock('scheduled-reports', () => withCronCheckIn('scheduled-reports', async () => {
          const sent = await processScheduledReports();
          if (sent > 0) console.log(`[scheduled-reports] Sent ${sent} report(s)`);
        })).catch((e: any) => { captureCronFailure('scheduled-reports', e); return { acquired: true }; });
        if (!res.acquired) { /* skipped */ }
      }, 60 * 60 * 1000);
      console.log('[scheduled-reports] Cron started (hourly, lock-guarded)');
    }).catch((e: any) => captureCronFailure('scheduled-reports-import', e));

    // Security maintenance — every 15 minutes
    setInterval(() => {
      withAdvisoryLock('security-maintenance', () => withCronCheckIn('security-maintenance', () => runSecurityMaintenance()))
        .catch((err: any) => captureCronFailure('security-maintenance', err));
    }, 15 * 60 * 1000);
    console.log('[security] Maintenance job started (every 15min, lock-guarded)');
    setTimeout(() => withAdvisoryLock('security-maintenance-startup', () => runSecurityMaintenance())
      .catch((e: any) => captureCronFailure('security-maintenance-startup', e)), 15_000);
  });
});
