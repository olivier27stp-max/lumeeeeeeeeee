/**
 * Sentry — client-side error tracking.
 *
 * Active only if VITE_SENTRY_DSN is set. No-op otherwise.
 * See docs/operations/sentry_setup.md.
 */

let sentryReact: any = null;

export async function initSentryClient(): Promise<void> {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  try {
    // @ts-ignore — optional dep, install with: npm i @sentry/react
    sentryReact = await import(/* @vite-ignore */ '@sentry/react');
    sentryReact.init({
      dsn,
      environment: import.meta.env.MODE,
      release: import.meta.env.VITE_SENTRY_RELEASE,
      tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || '0.1'),
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      // Strip PII-looking strings from breadcrumbs
      beforeBreadcrumb(breadcrumb: any) {
        if (breadcrumb.category === 'console' && typeof breadcrumb.message === 'string') {
          breadcrumb.message = breadcrumb.message
            .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
            .replace(/\b\d{10,}\b/g, '[phone]');
        }
        return breadcrumb;
      },
    });
  } catch (e) {
    console.warn('[sentry] @sentry/react not installed — run: npm i @sentry/react');
  }
}

export function captureClientException(err: unknown, context?: Record<string, unknown>): void {
  if (!sentryReact) return;
  try { sentryReact.captureException(err, { extra: context }); } catch { /* no-op */ }
}
