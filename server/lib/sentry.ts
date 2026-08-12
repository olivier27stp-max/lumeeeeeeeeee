/**
 * Sentry — server-side error tracking
 *
 * Active only if SENTRY_DSN env var is set. No-op otherwise (dev default).
 * See docs/operations/sentry_setup.md for enrollment steps.
 */

import type { Express } from 'express';
import { createRequire } from 'node:module';

// Lazy-load @sentry/node so the dependency is optional until installed.
// Le serveur roule en ESM ("type": "module") : `require` n'existe pas au
// runtime, il faut le fabriquer via createRequire.
const nodeRequire = createRequire(import.meta.url);
let sentryNode: any = null;

export function initSentry(app: Express): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.log('[sentry] SENTRY_DSN not set — error tracking disabled');
    return;
  }
  try {
    sentryNode = nodeRequire('@sentry/node');
    sentryNode.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      release: process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
      // Filter: never send health checks or auth token fragments
      beforeSend(event: any) {
        if (event.request?.url?.includes('/api/health')) return null;
        // Strip Authorization header
        if (event.request?.headers?.Authorization) event.request.headers.Authorization = '[redacted]';
        if (event.request?.headers?.authorization) event.request.headers.authorization = '[redacted]';
        return event;
      },
    });

    // Request handler must be the first middleware on the app
    app.use(sentryNode.Handlers?.requestHandler?.() ?? ((_req: any, _res: any, next: any) => next()));
    console.log('[sentry] initialized');
  } catch (e: any) {
    console.warn('[sentry] @sentry/node not installed — run: npm i @sentry/node', e?.message);
  }
}

export function attachSentryErrorHandler(app: Express): void {
  if (!sentryNode?.Handlers?.errorHandler) return;
  app.use(sentryNode.Handlers.errorHandler());
}

export function captureException(err: unknown, context?: Record<string, any>): void {
  if (!sentryNode) return;
  try {
    sentryNode.captureException(err, { extra: context });
  } catch { /* no-op */ }
}

/**
 * Signale l'échec d'une tâche de fond.
 *
 * Les crons attrapent leurs erreurs pour ne pas tuer la boucle `setInterval` —
 * une exception non gérée arrêterait la tâche pour de bon. Mais un `catch` qui
 * se contente d'un `console.error` rend la panne invisible : les journaux
 * Railway ne sont lus par personne, et une tâche qui échoue à chaque tick
 * pendant des semaines n'alerte jamais. Même raisonnement que dans `mailer.ts`.
 *
 * Le tag `cron` permet de filtrer par tâche dans Sentry.
 */
export function captureCronFailure(cronName: string, err: unknown): void {
  console.error(`[cron:${cronName}]`, (err as any)?.message || err);
  if (!sentryNode) return;
  try {
    sentryNode.withScope((scope: any) => {
      scope.setTag('cron', cronName);
      scope.setLevel('error');
      sentryNode.captureException(err instanceof Error ? err : new Error(String(err)));
    });
  } catch { /* no-op */ }
}

/**
 * Attache l'org de la requête courante au scope Sentry.
 *
 * Appelé depuis `requireAuthedClient`, le point de passage unique de toutes les
 * routes authentifiées. Sans ça, une alerte Sentry dit quelle ligne a planté
 * mais pas chez quel client — inexploitable pour le support.
 *
 * Volontairement PAS d'email : le nom de l'org identifie déjà le compte, et
 * c'est une donnée personnelle de moins transmise à un sous-traitant.
 *
 * Le nom de l'org n'est pas connu ici (`requireAuthedClient` ne le charge pas,
 * et une requête de plus par appel API serait un mauvais échange) — il est
 * résolu côté navigateur par `setSentryOrgContext`. L'`org_id` suffit à relier
 * les deux.
 */
export function setSentryRequestOrg(orgId: string, userId: string): void {
  if (!sentryNode?.getCurrentHub) return;
  try {
    const scope = sentryNode.getCurrentHub().getScope();
    if (!scope) return;
    scope.setUser({ id: userId });
    scope.setTag('org_id', orgId);
  } catch { /* no-op */ }
}
