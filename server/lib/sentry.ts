/**
 * Sentry — server-side error tracking
 *
 * Active only if SENTRY_DSN env var is set. No-op otherwise (dev default).
 * See docs/operations/sentry_setup.md for enrollment steps.
 */

import type { Express } from 'express';

// Lazy-load @sentry/node so the dependency is optional until installed
let sentryNode: any = null;

export function initSentry(app: Express): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.log('[sentry] SENTRY_DSN not set — error tracking disabled');
    return;
  }
  try {
    sentryNode = require('@sentry/node');
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
