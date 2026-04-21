# Sentry — enrollment & setup

## 1. Create the Sentry project (5 min)

1. Go to https://sentry.io → Sign up (free plan = 5k errors/month).
2. Create an organization `lume-crm`.
3. Create TWO projects:
   - `lume-frontend` (platform: React)
   - `lume-backend` (platform: Node.js / Express)
4. For each project, copy the **DSN** from Settings → Projects → [project] → Client Keys.

## 2. Install dependencies

```bash
cd lume-crm
npm install @sentry/react @sentry/node
```

## 3. Add env vars

Add to `.env.local` (local dev) and your Vercel/hosting env:

```bash
# ── Sentry ────────────────────────────────────────────
SENTRY_DSN=https://xxx@oyyy.ingest.sentry.io/zzz         # backend project DSN
VITE_SENTRY_DSN=https://xxx@oyyy.ingest.sentry.io/aaa    # frontend project DSN
SENTRY_TRACES_SAMPLE_RATE=0.1                            # 10% of transactions traced
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
```

## 4. Wire the client

Edit [src/main.tsx](../../src/main.tsx), add the call **before** `ReactDOM.createRoot`:

```ts
import { initSentryClient } from './lib/sentry';
initSentryClient();   // non-blocking, no-op if DSN missing
```

## 5. Wire the server

Edit [server/index.ts](../../server/index.ts):

```ts
// ── AFTER `const app = express();` and BEFORE any route handler ──
import { initSentry, attachSentryErrorHandler } from './lib/sentry';
initSentry(app);

// ── AFTER all routes, BEFORE your final error middleware ──
attachSentryErrorHandler(app);
```

## 6. Test

```bash
# Force a test exception in prod
curl -X POST https://[your-domain]/api/health -H 'X-Force-Error: 1'
```

You should see the error appear in the Sentry dashboard within ~30 seconds.

## 7. Alerts

In Sentry → Alerts:

- New issue in `lume-backend` severity >= error → email `alerts@lumecrm.ca`
- `unauthorized_access` audit event (tag) → Slack/email
- Spike alert: > 10 errors in 5 minutes → page on-call

## 8. Retention & PII

- Default retention: 90 days (free plan).
- PII filtering: `beforeSend` / `beforeBreadcrumb` hooks in `server/lib/sentry.ts` and `src/lib/sentry.ts` already redact emails, phones, and Authorization headers. Review periodically.

## 9. Release tracking (optional but recommended)

Add to your Vercel deploy step:

```bash
SENTRY_RELEASE=$VERCEL_GIT_COMMIT_SHA
VITE_SENTRY_RELEASE=$VERCEL_GIT_COMMIT_SHA
```

Sentry will then correlate errors with the specific commit that introduced them.
