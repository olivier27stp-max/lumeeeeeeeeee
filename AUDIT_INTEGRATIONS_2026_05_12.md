# Integrations Audit — Lume CRM — 2026-05-12

Read-only audit of every third-party integration. Env values are NOT echoed; only their presence/shape is reported.

---

## TL;DR

Short answer to "Is Stripe connected? Is everything connected?":
**Stripe = YES, wired end-to-end (TEST mode keys, webhook handler correctly mounted before `express.json()`, Connect onboarding implemented). Everything else = MOSTLY, with notable gaps: PayPal env vars are NOT in `.env.local`, Sentry/Upstash/Resend are not configured, PII and Payments encryption keys are IDENTICAL (bad), Mr Lume agent has been stubbed out frontend-side, fal.ai key still present but Director Panel removed.**

| # | Service | Status | Critical issues |
|---|---|---|---|
| 1 | Stripe (platform + Connect) | wired, partially tested | TEST keys only; Connect untested e2e in this repo; `apiVersion` not pinned on any `new Stripe()` call |
| 2 | PayPal | partial | `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_ENV` **all missing from `.env.local`** — webhook will return 503 |
| 3 | Twilio SMS | wired | A2P 10DLC table exists, single global `TWILIO_PHONE_NUMBER` fallback still used; org-scoped numbers via auto-provisioning code path exists |
| 4 | Email (SMTP/Gmail) | wired | Resend NOT used despite CLAUDE.md mention; no bounce/complaint handling |
| 5 | Mapbox + Google Maps | wired | Both keys present; no evidence of HTTP referrer / domain restrictions enforced — must verify in dashboards |
| 6 | fal.ai | dead | Key present but Director Panel removed per memory — should be deleted |
| 7 | Ollama + Gemini (Mr Lume) | stubbed | Frontend agent is a no-op stub; `GEMINI_API_KEY` present but only used by `generic-providers.ts` validator |
| 8 | Supabase | wired | Service role NOT imported into `src/` (verified). Realtime used in 5 files |
| 9 | Sentry | NOT configured | `SENTRY_DSN` unset; `@sentry/node` lazy-loaded — should be set for prod |
| 10 | Upstash Redis | NOT configured | `UPSTASH_REDIS_REST_URL` unset → in-memory rate limit, breaks on multi-replica |
| 11 | PII Encryption Key | set | 32 bytes base64 OK, no rotation plan visible |
| 12 | Payments Encryption Key | **same value as PII key — security flaw** | violates separation of concerns |
| 13 | Voice / STT | none | No SpeechRecognition / Whisper integration in `src/` |
| 14 | Calendar (iCal/Google/Outlook) | none | No CalDAV / Google Calendar / Outlook sync — internal scheduling only |
| 15 | Supabase Storage | wired | Two buckets in use: `avatars` (public) and `attachments` (assumed public via `getPublicUrl`) |

Overall production-readiness for integrations: **~6.5/10**. Stripe core flow is solid; everything peripheral has known gaps.

---

## Per-integration deep-dive

### 1. Stripe — STATUS: wired (TEST mode)

**Env vars in `.env.local`:**
- `STRIPE_PUBLISHABLE_KEY` — present, `pk_test_...`
- `VITE_STRIPE_PUBLISHABLE_KEY` — present, same `pk_test_...`
- `STRIPE_SECRET_KEY` — present, `sk_test_...`
- `STRIPE_WEBHOOK_SECRET` — present, `whsec_...`
- `STRIPE_CONNECT_WEBHOOK_SECRET` — NOT present (env-validation marks optional). Stripe Connect events flow through the same `/api/webhooks/stripe` endpoint since `connectAccountId` is read from `event.account`.

**TEST vs LIVE separation:** all four Stripe keys are clearly TEST (`pk_test_`/`sk_test_`). No LIVE keys are mixed in. The `pk_` / `sk_` / `whsec_` prefixes are validated at startup by `server/lib/env-validation.ts`.

**Webhook mount order (critical):** verified at `server/index.ts:214`:
```
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json', limit: '1mb' }), stripeWebhookHandler);
// ...then at line 217:
app.use(express.json({ limit: '512kb' }));
```
Correctly mounted **before** `express.json()`. Signature verification uses raw body and will work.

**Webhook handler (`server/routes/payments.ts`):**
- Signature verified with `stripeWebhookClient.webhooks.constructEvent(...)`.
- Anti-replay: rejects events older than 300s.
- Idempotency via `webhook_events` table (`logWebhookEvent` checks for existing `stripe_event_id`).
- Events handled: `payment_intent.succeeded`, `payment_intent.payment_failed`, `account.updated`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`, `checkout.session.completed`. The subscription/invoice/refund/dispute handlers are present (matches the FIXES_APPLIED memo).
- Security: logs `stripe_webhook_missing_signature` / `stripe_webhook_invalid_signature` events.

**Stripe Connect (multi-tenant):**
- Express accounts created via `stripe.accounts.create({ type: 'express', country, capabilities: { card_payments, transfers } })` in `server/lib/stripe-connect.ts`.
- Onboarding link: `createOnboardingLink()` calls `stripe.accountLinks.create({ type: 'account_onboarding', return_url, refresh_url })`.
- Link expiry: there is a dedicated route `POST /api/connect/refresh-onboarding-link` that regenerates the link — same implementation as `create-onboarding-link`. So expired links are handled by the client re-calling refresh; not automatic, but functional.
- Destination charges: `createDestinationPaymentIntent` uses `application_fee_amount` (2.9% platform fee) and `transfer_data.destination` correctly.
- `account.updated` webhook syncs `charges_enabled` / `payouts_enabled` / `details_submitted` back to `connected_accounts` table.

**API version pinning:** `new Stripe(key)` is called in 9 places (`config.ts`, `stripe-connect.ts`, `payments.ts` x3, `quotes.ts` x3, `billing.ts`). **None of them pass `{ apiVersion: '...' }`.** This means Stripe defaults to whichever pinned version was set when the account was created — fine today, but a breaking-change risk when Stripe deprecates that version. **Recommend pinning explicitly** (e.g. `'2024-12-18.acacia'`).

**End-to-end status:** the platform charge flow + checkout subscription flow look complete and exercised (idempotency table `processed_checkout_sessions` exists). Connect destination charges are wired; refunds reverse the transfer. **Not seeing automated tests that drive a real Connect onboard → charge → refund cycle, so call this "wired, lightly tested."**

---

### 2. PayPal — STATUS: PARTIAL — webhook will 503

**Env vars expected:** `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_ENV`.
**Env vars present in `.env.local`:** **NONE.**

The webhook handler at `server/routes/payments.ts:1173` short-circuits with 503 if any of those three are missing. PayPal can still be configured **per-org** via the `payment_provider_settings` UI (encrypted secrets stored in `payment_provider_secrets`), but the webhook itself can never validate signatures without `PAYPAL_WEBHOOK_ID` at the platform level.

Webhook signature verification: implemented in `server/lib/payments.ts:1043` (`verifyPayPalWebhookSignature`).
Idempotency: uses the same `webhook_events` table + `provider_event_id` columns as Stripe — verified.

**Recommended fix:** if PayPal is supposed to be live in beta, add the four env vars. If not, document that PayPal is org-level only and skip the global webhook.

---

### 3. Twilio SMS — STATUS: wired

**Env vars:**
- `TWILIO_ACCOUNT_SID` — present, `AC...`
- `TWILIO_AUTH_TOKEN` — present, 32 chars
- `TWILIO_PHONE_NUMBER` — present, E.164 `+1...`

**Routes:**
- Send: `server/routes/messages.ts` and `server/routes/communications.ts`.
- Inbound webhook: `POST /api/messages/inbound` (line 104) — signature validated with `Twilio.validateRequest()`.
- Delivery callbacks: `POST /api/messages/status` (line 418) — signature validated.
- Both paths in `WEBHOOK_PATHS_EXEMPT_FROM_CSRF` list at `server/index.ts:164`.

**A2P 10DLC:** table created in migration `20260421000100_twilio_a2p_10dlc.sql`; helper at `server/lib/twilioA2P.ts`. Auto-provisioning of org-scoped SMS numbers wired at `server/routes/payments.ts:1561` (`provisionSmsForNewSubscription`) — called after a `checkout.session.completed` for plans where `plan.includes_sms = true`. Skip-if-exists via `communication_channels` lookup. Provisioning failures logged to `provisioning_events` table.

**Gap:** the platform `TWILIO_PHONE_NUMBER` is still used as a fallback throughout (`config.ts:20`). This is fine in dev but means single-tenant Twilio for any org that hasn't auto-provisioned yet. Recommend logging a warning when the fallback fires in prod.

---

### 4. Email — STATUS: wired (SMTP/Gmail, not Resend)

**Env vars:** `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` — all present (Gmail App Password). `RESEND_API_KEY` not set anywhere.

`CLAUDE.md` says "Email: Resend" but the actual sender is Nodemailer + Gmail SMTP (`server/lib/mailer.ts`). The memory note `Gmail SMTP` is correct; CLAUDE.md is stale.

Templates: `server/lib/email-templates/` (directory exists). i18n: not verified in this audit — there's no obvious FR/EN switch inside template rendering. Worth confirming with a dedicated pass.

**Bounce/complaint handling:** none. Gmail SMTP does not push delivery events back. Bounces appear only as `sendMail` rejections. For >10 customers this should move to Resend/Postmark with webhook-driven bounce list.

---

### 5. Mapbox + Google Maps — STATUS: wired, restriction status UNKNOWN

**Env vars (all `VITE_`-prefixed, exposed in JS bundle, which is expected for client-side maps):**
- `VITE_MAPBOX_TOKEN` — present, `pk.eyJ...`
- `VITE_GOOGLE_MAPS_API_KEY` — present, `AIza...`
- `VITE_GOOGLE_MAPS_MAP_ID` — present

Used in different places:
- Mapbox → FieldSales heatmap & related geo overlays (CSP allows `api.mapbox.com`, `*.tiles.mapbox.com`, `events.mapbox.com`).
- Google Maps → address autocomplete + map render (CSP allows `maps.googleapis.com`).
- `MAPBOX_GEOCODING_TOKEN` (server-side, no `VITE_` prefix) is referenced in `config.ts` for server geocoding but is NOT set in `.env.local` — geocode routes either fall back to Google or fail silently.

**Restrictions:** cannot verify from code. The Google key starts `AIzaSyA5...`; the Mapbox token has the standard `pk.eyJ1...` shape. **Both keys are visible in the browser bundle by design — they MUST be restricted by HTTP referrer (Google) and URL (Mapbox) in their respective dashboards.** Flag this as a manual verification item.

---

### 6. fal.ai — STATUS: dead weight

`FAL_API_KEY` set in `.env.local` line 26, comment says "Director Panel". Memory note `project_mr_lume_agent.md` says Director Panel was dropped. Grep for `FAL_API_KEY` in `server/` returns **zero matches**. CSP still allows `https://fal.run` and `https://queue.fal.run` in `connect-src` at `server/index.ts:112`.

**Recommendation:** delete the key from `.env.local`, remove the CSP entries, and revoke at fal.ai dashboard.

---

### 7. Ollama + Gemini (Mr Lume Agent) — STATUS: stubbed frontend

**Env vars:** `OLLAMA_URL=http://localhost:11434`, `GEMINI_API_KEY` (AIza...) both present.

Frontend: `src/features/agent/lib/agentApi.ts` is a stub. Top-of-file comment:
> "AI backend removed (cleanup Phase 4.2). The interactive chat is disabled. The only live endpoint is the external-agent login flow."

So the in-app Mr Lume chat does not currently call Gemini or Ollama. The only live external-agent flow is API-key → JWT exchange (`server/routes/agent-auth.ts`).

Server-side `GEMINI_API_KEY` is referenced once in `server/lib/integrations/providers/generic-providers.ts:176` — purely for validating a user-supplied Gemini key against `https://generativelanguage.googleapis.com/v1/models?key=...`. Not used for any actual generation.

**Recommendation:** if Mr Lume is dead, remove `GEMINI_API_KEY` and `OLLAMA_URL` from `.env.local`. If it's coming back, the README and CLAUDE.md need updating because they imply it's live.

---

### 8. Supabase — STATUS: wired

**Env vars:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` — all present.

**Service role import safety:** grep for `SUPABASE_SERVICE_ROLE_KEY|service_role` in `src/` returns only **comments/strings** in 3 files (`invoiceTemplatesApi.ts`, `pipelineApi.ts`, `Pipeline.tsx`), never an actual import. Service role stays server-side. **Verified.**

`env-validation.ts` actively enforces no `VITE_*service*` and no `VITE_*secret*` / `VITE_*auth_token*` env vars at startup.

**Realtime usage:** `supabase.channel(...)` in 5 files:
- `src/pages/Timesheets.tsx`, `Schedule.tsx`, `Dashboard.tsx`, `FieldSales.tsx`, `src/lib/noteBoardsApi.ts`.

All five are dashboard-like views where live updates have real UX value. Reasonable scope — no obvious abuse (e.g. no realtime on Clients/Leads which would be heavy).

---

### 9. Sentry — STATUS: NOT configured

`SENTRY_DSN` not in `.env.local`. Server boot log will print `[sentry] SENTRY_DSN not set — error tracking disabled`. Implementation at `server/lib/sentry.ts` is solid: lazy-loads `@sentry/node`, scrubs Authorization headers, ignores `/api/health`, supports `SENTRY_RELEASE` / `VERCEL_GIT_COMMIT_SHA`.

**Recommendation for prod:** set `SENTRY_DSN`, ensure `@sentry/node` is in `dependencies` (currently lazy-required, will warn if missing). With 5-50 beta clients you absolutely need this.

---

### 10. Upstash Redis — STATUS: NOT configured

`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` not in `.env.local`. Server boot log: `[rate-limiter] No UPSTASH_REDIS_REST_URL set, using in-memory rate limiting`.

`server/lib/rate-limiter.ts` correctly falls back, but in-memory rate limiting on multi-replica deploys (Vercel/Railway autoscaling) means each replica has its own counter — effectively multiplying the limit by replica count. With only one replica today it's fine; the moment scaling kicks in it's a brute-force vector.

**Recommendation:** provision an Upstash Redis instance for prod. Costs ~$0 at low volume.

---

### 11. PII Encryption Key — STATUS: set

`PII_ENCRYPTION_KEY` = 32 bytes base64. Validated at startup (`env-validation.ts:131`). **No documented rotation strategy in this repo.** `PAYMENTS_ENCRYPTION_KEY_PREVIOUS` is referenced in the validator (so the code supports a previous-key fallback) but there's no `scripts/rotate-pii-key.ts`. `scripts/ROTATE_KEYS_CHECKLIST.md` exists — worth opening to confirm it documents PII rotation.

---

### 12. Payments Encryption Key — STATUS: ❌ same value as PII key

```
PII_ENCRYPTION_KEY="5DEWonGNBI6y8R2S0wq+fZ17wkj/VzfZJToSs0wy9Lo="
PAYMENTS_ENCRYPTION_KEY="5DEWonGNBI6y8R2S0wq+fZ17wkj/VzfZJToSs0wy9Lo="
```
Identical. This violates the separation-of-concerns principle the comment in `.env.local` calls out ("generate separately"). If one key is compromised (e.g. dev laptop), both PII and stored payment provider secrets fall together.

**Recommended fix (P0 before prod):**
1. Generate a fresh 32-byte key for payments only.
2. Decrypt all `payment_provider_secrets` rows with the old key, re-encrypt with the new one.
3. Update `.env.local` and the deploy env.
4. Wipe the duplicate from git history if `.env.local` was ever committed (it shouldn't be).

---

### 13. Voice / STT — STATUS: none

Grep for `SpeechRecognition|whisper|speech.to.text` returns zero hits in `src/`. The memory note `project_mr_lume_agent.md` mentions voice input as a feature, but no client-side or server-side STT integration is present. This is consistent with the agent being stubbed (see §7).

---

### 14. Calendar integration — STATUS: none

Grep for `ical|caldav|google.?calendar|outlook` returns matches in 101 files, but spot-checking shows they're all "calendar" in the sense of the internal Schedule/Calendar UI page — no external ICS feed, no Google Calendar API import, no Outlook OAuth. Internal scheduling only.

---

### 15. Supabase Storage — STATUS: wired, bucket privacy unverified

`supabase.storage.from('...')` is called against two buckets:
- `avatars` — used in `src/pages/D2DOnboarding.tsx` for profile photos. Code uses `getPublicUrl` → bucket must be public-read.
- `attachments` — used in `JobDetails.tsx`, `ClientDetails.tsx`, `measurementApi.ts`. Code also uses `getPublicUrl` → bucket assumed public.

**Risk:** `attachments` likely contains customer documents (job photos, signed quotes, measurements). If the bucket is public, anyone with the URL can fetch the file. The URLs include a UUID path so they're unguessable, but they leak any time they're shared (email, browser history, Sentry breadcrumbs).

**Recommendation:** verify in Supabase dashboard:
1. `avatars` — public is acceptable.
2. `attachments` — should be **private** with signed URLs (`createSignedUrl(path, ttl)`) rather than `getPublicUrl`. This is a P1 hardening item.

---

## Cross-cutting issues

1. **Encryption key reuse (PII == Payments).** P0 fix.
2. **`apiVersion` not pinned on any `new Stripe()` call** — silent breakage risk when Stripe deprecates the implicit pinned version.
3. **No Sentry, no Upstash Redis in prod env.** Both code paths handle absence gracefully, but you lose error visibility and effective rate-limiting under load.
4. **Stale docs:** CLAUDE.md says Resend (wrong, it's Gmail SMTP) and AI Claude API (wrong, agent is stubbed). Either re-enable or update docs.
5. **fal.ai dead key & CSP entries** — clean up.
6. **PayPal webhook silently 503s** because platform-level PayPal env vars are absent. Decide: support PayPal at platform level (set the vars) or remove the webhook route.
7. **Attachments bucket likely public** — should switch to private + signed URLs.
8. **No automated test in this repo that drives Stripe Connect onboarding → charge → refund end-to-end.** Connect is "wired, untested in CI."

---

## Production readiness checklist

Blocking (must do before flipping LIVE keys):
- [ ] Generate a distinct `PAYMENTS_ENCRYPTION_KEY` and migrate existing ciphertext.
- [ ] Rotate the Supabase keys + `STRIPE_*` to LIVE values (currently TEST).
- [ ] Set `STRIPE_CONNECT_WEBHOOK_SECRET` (or confirm a single endpoint receives both direct + Connect events with one secret).
- [ ] Set `SENTRY_DSN` and install `@sentry/node` as a real dep.
- [ ] Provision Upstash Redis, set `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`.
- [ ] Decide PayPal: either set `PAYPAL_CLIENT_ID/SECRET/WEBHOOK_ID/ENV` or remove the global PayPal webhook route.
- [ ] Pin `apiVersion` on every `new Stripe(...)` (9 call sites).
- [ ] Move `attachments` Supabase bucket to private + switch to `createSignedUrl`.
- [ ] Verify Google Maps + Mapbox tokens are HTTP-referrer / URL restricted in their dashboards.
- [ ] Confirm `FRONTEND_URL` set to the production domain (currently `http://localhost:5173`).

Strongly recommended:
- [ ] Move email sender from Gmail SMTP to Resend/Postmark (bounce webhooks, deliverability).
- [ ] Remove `FAL_API_KEY` from env and `fal.run` from CSP if Director Panel is permanently gone.
- [ ] Remove `GEMINI_API_KEY` / `OLLAMA_URL` or restore Mr Lume — currently dead.
- [ ] Add a CI smoke test for Stripe Connect: create account → onboarding link → simulate `account.updated` webhook → assert `connected_accounts` row updated.
- [ ] Document key rotation in `scripts/ROTATE_KEYS_CHECKLIST.md` (verify it covers PII + payments separately).
- [ ] Log a WARN when the platform `TWILIO_PHONE_NUMBER` fallback is used in prod (so you can see which orgs haven't been provisioned).
