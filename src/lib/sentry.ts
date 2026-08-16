/**
 * Sentry — client-side error tracking.
 *
 * Active only if VITE_SENTRY_DSN is set. No-op otherwise.
 * See docs/operations/sentry_setup.md.
 */

let sentryReact: any = null;

/**
 * Dernier contexte d'org reçu, gardé en attente.
 *
 * `initSentryClient()` charge le SDK par import dynamique et n'est pas awaité
 * dans main.tsx : CompanyContext peut donc résoudre l'org avant que le SDK
 * soit prêt. Sans ce report, ce tag serait perdu en silence et l'alerte
 * n'indiquerait plus le client concerné.
 */
let pendingOrgContext: OrgContext | null = null;
let orgContextApplied = false;

type OrgContext = { orgId: string; companyName: string | null; userId: string | null };

export async function initSentryClient(): Promise<void> {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  try {
    // Package name hidden from Vite dep scanner — only resolved at runtime
    // when VITE_SENTRY_DSN is set. Install with: npm i @sentry/react
    const pkg = ['@sentry', 'react'].join('/');
    // @ts-ignore — optional dep
    sentryReact = await import(/* @vite-ignore */ pkg);
    sentryReact.init({
      dsn,
      environment: import.meta.env.MODE,
      release: import.meta.env.VITE_SENTRY_RELEASE,
      // Sans cette intégration, `tracesSampleRate` ne mesure RIEN côté
      // navigateur : ni le chargement de page, ni les Core Web Vitals (LCP,
      // CLS, INP), ni les appels API. C'est ce qui laissait Insights vide.
      integrations: [sentryReact.browserTracingIntegration()],
      // 0.1 est un réglage pour gros trafic ; à notre volume il ne restait
      // presque rien à afficher. À redescendre si le quota devient serré.
      tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || '1.0'),
      // Ne pas mesurer les appels vers des domaines tiers (Stripe, Mapbox,
      // Google) : leur lenteur n'est pas la nôtre et brouillerait les données.
      tracePropagationTargets: [/^\//, /^https:\/\/lumecrm\.net/],
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
    // L'org a pu être résolue pendant le chargement du SDK — on la rejoue.
    if (pendingOrgContext && !orgContextApplied) applyOrgContext(pendingOrgContext);
  } catch (e) {
    console.warn('[sentry] @sentry/react not installed — run: npm i @sentry/react');
  }
}

export function captureClientException(err: unknown, context?: Record<string, unknown>): void {
  if (!sentryReact) return;
  try { sentryReact.captureException(err, { extra: context }); } catch { /* no-op */ }
}

/**
 * Attache l'org courante à toutes les erreurs suivantes.
 *
 * Sans ça, un email d'alerte Sentry indique la ligne qui a planté mais pas
 * chez quel client — inexploitable pour le support. On envoie l'id ET le nom :
 * un UUID seul ne se relie à aucun client de tête.
 *
 * Volontairement PAS d'email ni de nom d'utilisateur : le nom de l'org suffit
 * à identifier le compte, et c'est une donnée personnelle de moins transmise
 * à un sous-traitant.
 */
export function setSentryOrgContext(org: OrgContext | null): void {
  pendingOrgContext = org;
  orgContextApplied = false;
  if (!sentryReact) return; // rejoué à la fin de initSentryClient()
  applyOrgContext(org);
}

function applyOrgContext(org: OrgContext | null): void {
  try {
    if (!org) {
      sentryReact.setUser(null);
      sentryReact.setTag('org_id', undefined);
      sentryReact.setTag('org_name', undefined);
      orgContextApplied = true;
      return;
    }
    // `id` seul — surtout pas email/username (voir en-tête).
    sentryReact.setUser({ id: org.userId || undefined });
    sentryReact.setTag('org_id', org.orgId);
    sentryReact.setTag('org_name', org.companyName || 'unknown');
    orgContextApplied = true;
  } catch { /* no-op */ }
}
