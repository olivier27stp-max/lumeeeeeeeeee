/**
 * Route → Permission mapping for RBAC enforcement.
 *
 * Applied as Express middleware in index.ts to enforce permissions
 * on all API routes without modifying individual route files.
 *
 * Routes not listed here are either:
 * - Public (no auth needed): webhooks, public forms, surveys, portal, etc.
 * - Already protected internally by the route handler
 */

import express from 'express';
import { getUserContext, hasPermission, type UserContext } from './rbac';
import { requireAuthedClient } from './supabase';

// Extend Express Request to carry user context
declare global {
  namespace Express {
    interface Request {
      userContext?: UserContext;
    }
  }
}

/**
 * Route permission rules.
 * Key: "METHOD /path" or "ALL /path" (prefix match).
 * Value: permission key string, or array (any = OR).
 */
const ROUTE_PERMISSIONS: Record<string, string | string[]> = {
  // ── Clients ──
  'GET /api/clients/search': 'clients.read',
  'POST /api/clients/by-ids': 'clients.read',
  'POST /api/clients/soft-delete': 'clients.delete',

  // ── Leads ──
  'POST /api/leads/create': 'leads.create',
  'POST /api/leads/soft-delete': 'leads.delete',
  'POST /api/leads/update-status': 'leads.update',
  'POST /api/leads/convert-to-job': 'jobs.create',
  'POST /api/leads/resolve-client': 'leads.read',
  'POST /api/deals/soft-delete': 'leads.delete',

  // ── Quotes ──
  'POST /api/quotes/send-email': 'quotes.send',
  'POST /api/quotes/send-sms': 'quotes.send',
  'POST /api/quotes/convert-to-job': 'jobs.create',
  'POST /api/quotes/convert-to-invoice': 'invoices.create',

  // ── Jobs ──
  'POST /api/jobs/assign-team': 'jobs.assign',
  'GET /api/jobs/search-for-invoice': 'jobs.read',
  'POST /api/geocode-job': 'jobs.update',
  'POST /api/geocode-batch': 'jobs.update',

  // ── Invoices ──
  'POST /api/invoices/from-job': 'invoices.create',

  // ── Payments ──
  'GET /api/payments/settings': 'settings.read',
  'POST /api/payments/keys': 'settings.update',
  'POST /api/payments/settings': 'settings.update',
  'GET /api/payments/payouts/summary': 'payments.read',
  'GET /api/payments/payouts/list': 'payments.read',
  'GET /api/payments/payouts/detail': 'payments.read',
  'POST /api/payments/payouts/email-csv': 'payments.read',
  'GET /api/payments/providers/status': 'settings.read',
  'POST /api/payments/providers/settings': 'settings.update',
  'POST /api/payments/stripe/create-intent': 'payments.create',
  'GET /api/payments/stripe/transactions': 'payments.read',
  'GET /api/payments/stripe/balance': 'payments.read',
  'POST /api/payments/paypal/create-order': 'payments.create',
  'POST /api/payments/paypal/capture-order': 'payments.create',
  'POST /api/payments/refund': 'payments.refund',
  'POST /api/payment-requests/create': 'payments.create',
  'POST /api/payment-requests/resend': 'payments.create',

  // ── Messages ──
  'POST /api/messages/send': 'messages.send',

  // ── Communications ──
  'POST /api/communications/send-sms': 'messages.send',
  'POST /api/communications/send-email': 'messages.send',
  'GET /api/communications/messages': 'messages.read',
  'GET /api/communications/channels': 'integrations.read',
  'GET /api/communications/settings': 'settings.read',
  'POST /api/communications/provision-sms': 'integrations.update',

  // ── Emails ──
  'POST /api/emails/send-invoice': 'messages.send',
  'POST /api/emails/send-quote': 'messages.send',
  'POST /api/emails/send-custom': 'messages.send',

  // ── Automations ──
  'GET /api/automations/test': 'automations.read',
  'POST /api/automations/events/appointment-created': 'automations.update',
  'POST /api/automations/events/appointment-cancelled': 'automations.update',
  'POST /api/automations/events/job-completed': 'automations.update',
  'POST /api/automations/events/deal-stage-changed': 'automations.update',
  'POST /api/automations/events/quote-sent': 'automations.update',
  'POST /api/automations/events/quote-approved': 'automations.update',
  'POST /api/automations/events/invoice-paid': 'automations.update',
  'POST /api/automations/events/lead-created': 'automations.update',
  'POST /api/automations/events/lead-status-changed': 'automations.update',

  // ── AI / Agent ──
  'POST /api/ai/chat': 'ai.use',
  'POST /api/ai/chat/stream': 'ai.use',
  'POST /api/agent/chat': 'ai.use',
  'POST /api/agent/approve': 'ai.review',
  'GET /api/agent/sessions': 'ai.use',
  'DELETE /api/agent/sessions/:id': 'ai.use',
  'POST /api/agent/feedback': 'ai.use',
  'POST /api/agent/outcome': 'ai.admin',
  'POST /api/agent/correction': 'ai.admin',
  'POST /api/agent/feedback-train': 'ai.admin',
  'GET /api/agent/calibration': 'ai.review',
  'GET /api/agent/user-prefs': 'ai.use',
  'POST /api/team-suggestions': 'ai.use',

  // ── Director Panel ──
  'POST /api/director-panel/providers/execute': 'ai.admin',
  'POST /api/director-panel/storage/ensure-bucket': 'ai.admin',
  'POST /api/director-panel/storage/ensure-training-bucket': 'ai.admin',
  'POST /api/director-panel/assets/save': 'ai.admin',
  'GET /api/director-panel/credits': 'ai.admin',
  'POST /api/director-panel/training/start': 'ai.admin',
  'GET /api/director-panel/training/status/:trainingId': 'ai.admin',
  'GET /api/director-panel/proxy-image': 'ai.admin',

  // ── Invitations / Team ──
  'GET /api/invitations/list': 'team.read',
  'POST /api/invitations/send': 'users.invite',
  'POST /api/invitations/resend': 'users.invite',
  'POST /api/invitations/revoke': 'users.invite',
  'POST /api/invitations/update-role': 'users.update_role',
  'POST /api/invitations/remove-member': 'users.delete',

  // ── Settings ──
  'GET /api/features': 'settings.read',
  'PUT /api/features/:feature': 'settings.update',

  // ── Billing ──
  'GET /api/billing/current': 'settings.read',
  'POST /api/billing/onboarding': 'settings.update',
  'POST /api/billing/subscribe': 'settings.update',
  'POST /api/billing/cancel': 'settings.update',
  'POST /api/billing/validate-promo': 'settings.update',

  // ── Connect (Stripe Connect) ──
  'POST /api/connect/create-account': 'settings.update',
  'POST /api/connect/create-onboarding-link': 'settings.update',
  'POST /api/connect/refresh-onboarding-link': 'settings.update',
  'GET /api/connect/account-status': 'settings.read',

  // ── Commissions ──
  'GET /api/commissions': 'reports.read',
  'POST /api/commissions/calculate': 'reports.read',
  'POST /api/commissions/:id/approve': 'team.update',
  'POST /api/commissions/:id/reverse': 'team.update',
  'GET /api/commissions/rules': 'settings.read',
  'POST /api/commissions/rules': 'settings.update',
  'PUT /api/commissions/rules/:id': 'settings.update',
  'GET /api/commissions/payroll-preview': 'reports.read',

  // ── Integrations ──
  'GET /api/integrations': 'integrations.read',
  'POST /api/integrations/:appId/connect/oauth': 'integrations.update',
  'POST /api/integrations/:appId/connect/credentials': 'integrations.update',
  'POST /api/integrations/:appId/test': 'integrations.update',
  'POST /api/integrations/:appId/disconnect': 'integrations.update',
  'POST /api/integrations/:appId/refresh': 'integrations.update',

  // ── Templates ──
  'GET /api/email-templates': 'settings.read',
  'POST /api/email-templates': 'settings.update',
  'PUT /api/email-templates/:id': 'settings.update',
  'DELETE /api/email-templates/:id': 'settings.update',
  'GET /api/quote-templates': 'settings.read',
  'POST /api/quote-templates': 'settings.update',
  'PUT /api/quote-templates/:id': 'settings.update',
  'DELETE /api/quote-templates/:id': 'settings.update',

  // ── Taxes ──
  'GET /api/taxes': 'settings.read',
  'GET /api/taxes/resolve': 'settings.read',
  'POST /api/taxes/setup': 'settings.update',
  'POST /api/taxes/config': 'settings.update',
  'PUT /api/taxes/config/:id': 'settings.update',
  'DELETE /api/taxes/group/:id': 'settings.update',

  // ── Reports ──
  'GET /api/leaderboard': 'reports.read',
  'GET /api/leaderboard/rep/:userId': 'reports.read',
  'GET /api/leaderboard/realtime/:userId': 'reports.read',
  'GET /api/scheduled-reports': 'reports.read',
  'POST /api/scheduled-reports': 'reports.read',
  'PUT /api/scheduled-reports/:id': 'reports.read',
  'DELETE /api/scheduled-reports/:id': 'reports.read',
  'POST /api/scheduled-reports/:id/send-now': 'reports.read',
  'GET /api/goals': 'reports.read',
  'POST /api/goals': 'settings.update',
  'DELETE /api/goals/:id': 'settings.update',
  'GET /api/goals/progress': 'reports.read',

  // ── Gamification ──
  'GET /api/gamification/badges': 'reports.read',
  'POST /api/gamification/badges': 'settings.update',
  'GET /api/gamification/challenges': 'reports.read',
  'POST /api/gamification/challenges': 'settings.update',
  'POST /api/gamification/battles': 'settings.update',
  'GET /api/gamification/battles': 'reports.read',
  'GET /api/gamification/feed': 'reports.read',
  'POST /api/gamification/feed': 'reports.read',

  // ── Courses ──
  'GET /api/courses': 'settings.read',
  'POST /api/courses': 'settings.update',
  'DELETE /api/courses/:id': 'settings.update',

  // ── GPS / Tracking / Field Sessions ──
  'POST /api/tracking/start': 'gps.read',
  'POST /api/tracking/stop': 'gps.read',
  'POST /api/tracking/point': 'gps.read',
  'POST /api/tracking/points-batch': 'gps.read',
  'POST /api/tracking/event': 'gps.read',
  'POST /api/field-sessions/start': 'gps.read',
  'GET /api/field-sessions/active': 'gps.read',
  'GET /api/field-sessions/active/all': 'gps.read',
  'GET /api/field-sessions/history': 'gps.read',

  // ── Field Sales / D2D ──
  'GET /api/field-sales/houses': 'door_to_door.access',
  'POST /api/field-sales/houses': 'door_to_door.edit',
  'PUT /api/field-sales/houses/:id': 'door_to_door.edit',
  'DELETE /api/field-sales/houses/:id': 'door_to_door.edit',
  'GET /api/field-sales/territories': 'door_to_door.access',
  'POST /api/field-sales/territories': 'door_to_door.edit',
  'PUT /api/field-sales/territories/:id': 'door_to_door.edit',
  'DELETE /api/field-sales/territories/:id': 'door_to_door.edit',
  'GET /api/field-sales/pins': 'door_to_door.access',
  'GET /api/field-sales/stats': 'reports.read',
  'GET /api/field-sales/stats/daily': 'reports.read',
  'GET /api/field-sales/stats/leaderboard': 'reports.read',
  'GET /api/field-sales/reps': 'team.read',
  'POST /api/field-sales/reps': 'team.update',
  'PUT /api/field-sales/reps/:id': 'team.update',
  'DELETE /api/field-sales/reps/:id': 'team.update',
  'GET /api/field-sales/teams': 'team.read',
  'POST /api/field-sales/teams': 'team.update',

  // ── Timesheets ──
  'GET /api/timesheets': 'timesheets.read',
  'POST /api/timesheets': 'timesheets.update',
  'PUT /api/timesheets/:id': 'timesheets.update',

  // ── Notifications ──
  'GET /api/notifications': 'settings.read',
  'GET /api/notifications/unread-count': 'settings.read',
  'POST /api/notifications/read': 'settings.read',
  'DELETE /api/notifications/:id': 'settings.read',

  // ── Security (admin-only) ──
  'GET /api/security/alerts': 'settings.read',
  'POST /api/security/alerts/:id/acknowledge': 'settings.update',
  'GET /api/security/events': 'settings.read',
  'GET /api/security/login-history': 'settings.read',
  'GET /api/security/blocked-ips': 'settings.update',
  'POST /api/security/block-ip': 'settings.update',
  'DELETE /api/security/block-ip/:id': 'settings.update',
  'GET /api/security/summary': 'settings.read',
  'POST /api/security/api-keys': 'settings.update',
  'GET /api/security/api-keys': 'settings.read',
  'DELETE /api/security/api-keys/:id': 'settings.update',
  'GET /api/security/sessions': 'settings.read',
  'POST /api/security/sessions/invalidate-all': 'settings.update',
  'GET /api/security/export-log': 'settings.read',
  'POST /api/security/check-password': 'settings.read',

  // ── Audit Log ──
  'GET /api/audit-log': 'settings.read',

  // ── Search ──
  'GET /api/search': 'settings.read',
  'GET /api/search/suggestions': 'settings.read',
  'GET /api/search/results': 'settings.read',

  // ── Request Forms ──
  'GET /api/request-forms': 'settings.read',
  'POST /api/request-forms': 'settings.update',
  'POST /api/request-forms/regenerate-key': 'settings.update',
  'GET /api/request-forms/submissions': 'settings.read',

  // ── Referrals ──
  'GET /api/referrals/me': 'settings.read',
  'GET /api/referrals/history': 'settings.read',

  // ── Workflows ──
  'POST /api/workflows/execute-action': 'automations.update',
};

/**
 * Normalise a request path to match route patterns with :params.
 * e.g. /api/commissions/abc-123/approve → /api/commissions/:id/approve
 */
function normalisePathForMatch(method: string, path: string): string[] {
  // Try exact match first
  const exact = `${method} ${path}`;

  // Generate patterns by replacing UUID-like or numeric segments with :param
  const segments = path.split('/');
  const candidates: string[] = [exact];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    // UUID or numeric ID pattern
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) ||
        /^\d+$/.test(seg) ||
        (seg.length > 10 && /^[a-zA-Z0-9_-]+$/.test(seg))) {
      // Try common param names
      for (const param of [':id', ':appId', ':userId', ':token', ':trainingId', ':feature', ':courseId', ':moduleId', ':eventId', ':memberId']) {
        const patternSegments = [...segments];
        patternSegments[i] = param;
        candidates.push(`${method} ${patternSegments.join('/')}`);
      }
    }
  }

  return candidates;
}

/**
 * Express middleware that enforces RBAC permissions based on route.
 * Should be mounted BEFORE route handlers.
 *
 * Public routes (webhooks, portals, public forms) are skipped.
 */
export function rbacMiddleware(): express.RequestHandler {
  // Paths that are public and should never be permission-checked
  const publicPrefixes = [
    '/api/quotes/public',
    '/api/survey/',
    '/api/portal/',
    '/api/pay/',
    '/api/public/',
    '/api/invitations/accept',
    '/api/invitations/verify',
    '/api/billing/plans',
    '/api/ai/health',
    '/api/integrations-providers',
    '/api/payment-requests/',  // public status check
    '/api/security/csp-report',
    '/api/messages/inbound',   // Twilio webhook
    '/api/messages/status',    // Twilio webhook
    '/api/webhooks/',          // Payment webhooks
    '/api/referrals/track',
    '/api/referrals/validate',
    '/api/memory-graph/',      // Internal tool
    '/api/quotes/:id/track-view',
  ];

  return async (req, res, next) => {
    // Skip non-API routes
    if (!req.path.startsWith('/api')) return next();

    // Skip public routes
    for (const prefix of publicPrefixes) {
      if (req.path.startsWith(prefix)) return next();
    }

    // Find matching permission rule
    const method = req.method.toUpperCase();
    const candidates = normalisePathForMatch(method, req.path);

    let permissionKey: string | string[] | undefined;
    for (const candidate of candidates) {
      if (ROUTE_PERMISSIONS[candidate]) {
        permissionKey = ROUTE_PERMISSIONS[candidate];
        break;
      }
    }

    // No rule found — let route handler's own auth handle it
    if (!permissionKey) return next();

    // Authenticate
    const auth = await requireAuthedClient(req, res);
    if (!auth) return; // 401 already sent

    // Get user context
    const ctx = await getUserContext(auth.client, auth.user.id, auth.orgId);
    if (!ctx) {
      res.status(403).json({ error: 'No active membership found.' });
      return;
    }

    // Check permission(s)
    const keys = Array.isArray(permissionKey) ? permissionKey : [permissionKey];
    const allowed = keys.some((k) => hasPermission(ctx, k));

    if (!allowed) {
      res.status(403).json({ error: `Permission denied: ${keys.join(' or ')}` });
      return;
    }

    // Attach context for downstream handlers
    req.userContext = ctx;
    next();
  };
}
