# Stripe & Payments Audit — 2026-05-12

Scope: `server/routes/payments.ts`, `billing.ts`, `connect.ts`, `public-pay.ts`, `payment-requests.ts`, `quotes.ts` (deposit path), `server/lib/stripe-connect.ts`, `server/lib/payments.ts`, `server/lib/crypto.ts`, related migrations and client pages. Findings ordered roughly by severity.

---

## 1. CRITICAL

### F-01 Plaintext-secret-as-key fallback (quote deposit path)
- File: `server/routes/quotes.ts:962-981`
- What: `if (orgSecrets?.stripe_secret_key_enc?.startsWith('sk_') && ...) { new Stripe(orgSecrets.stripe_secret_key_enc) ... }`. The code passes the *encrypted* column value directly to the Stripe SDK after a flimsy `sk_` startsWith check. Two pathologies: (a) a legacy/unencrypted secret stored in `stripe_secret_key_enc` would be used in clear (the column was designed to hold ciphertext only); (b) if any operator ever migrates plaintext secrets into the encrypted column the check would silently succeed and Stripe-side calls would work, masking the schema violation. Real ciphertext is base64 with no `sk_` prefix, so the branch is dead for properly encrypted rows — meaning Path 2 *never executes for correctly-configured tenants*, and quote-deposit silently falls through to Path 3 (platform key), charging the platform account instead of the org.
- Why: Funds for an org's quote deposit can end up on the platform's Stripe balance instead of the org's connected account. Also breaks PCI/payment-isolation guarantees and would leak plaintext keys if anyone ever stored unencrypted values.
- Severity: Critical
- Fix: Remove the `startsWith('sk_')` heuristic. Always `decryptSecret(stripe_secret_key_enc)` before instantiating Stripe, and reject if decryption fails. Better: route all quote deposits through the Connect destination-charge path and remove Paths 2 and 3 entirely.

### F-02 Quote deposit falls back to platform Stripe account
- File: `server/routes/quotes.ts:983-1006` (Path 3)
- What: When an org has no Connect account, deposit charges go to `STRIPE_SECRET_KEY` (the platform account). The payment_intent metadata contains `org_id`, but funds physically settle on the platform.
- Why: Comingling of platform and tenant funds. Cross-org refund/reconciliation impossible. Likely violates the Stripe Connect platform agreement and Canadian financial-services regs for fund custody.
- Severity: Critical
- Fix: Require Connect onboarding before accepting deposits; remove Path 3 fallback (or make it explicit "platform-billed deposit" that is never reconciled to the org).

### F-03 Webhook secret is global, not per-connected-account
- File: `server/routes/payments.ts:66-101`, `server/lib/config.ts` (`stripeWebhookSecret`)
- What: A single `STRIPE_WEBHOOK_SECRET` is used to verify both platform and Connect events. Connect webhooks delivered to `/api/webhooks/stripe` for any connected account succeed only if all orgs share the same webhook endpoint secret. If the platform also has Connect-specific webhook endpoint (different secret) it cannot be distinguished.
- Why: Either you cannot verify Connect events (they fail signature) and silently fall through to "invalid signature" rejection, or you've configured a single endpoint for both and lose the ability to rotate Connect secrets independently. The handler also does no check that `event.account` matches the org being updated for non-account.updated events.
- Severity: High–Critical
- Fix: Mount two endpoints (`/api/webhooks/stripe/platform` and `/api/webhooks/stripe/connect`) with separate secrets; constructEvent with each. Validate `event.account` against `connected_accounts` for Connect events.

### F-04 Refund authorization uses caller's org, but admin client reads payment by paymentId without binding to the connected account
- File: `server/routes/payments.ts:1036-1108`
- What: Refund route looks up `payments` by `id` filtered on `auth.orgId`. OK. But the actual Stripe refund call (`stripe.refunds.create({ payment_intent })`) is made with the *platform* Stripe client (`getPlatformStripe()`), not the connected account's Stripe context, even though destination charges are involved. For destination charges the refund must include `reverse_transfer: true` (it does) but Stripe also requires the request to be made on the platform key — that's fine — however there's no validation that the payment_intent actually belongs to a Connect account this org owns. A malicious admin who knows the `payment_intent` ID of another org could theoretically craft a `paymentId` row in their own org (via SQL or unrelated bug) to issue refunds on someone else's payments. Defense-in-depth missing.
- Severity: High
- Fix: Before calling Stripe, fetch `payment_intent.transfer_data.destination` from Stripe and assert it equals `connected_accounts.stripe_account_id` for the caller's org.

### F-05 PayPal webhook handler never verifies signatures when per-org webhook id is missing AND platform `paypalWebhookId` is null
- File: `server/lib/payments.ts:1025-1081`, `server/routes/payments.ts:1009-1032`
- What: `resolvePayPalWebhookId` returns null if no per-org webhook id and no platform one is set; then `verifyPayPalWebhookSignature` returns false → 400. Good. BUT the precheck at `payments.ts:1011` is `if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_SECRET || !paypalWebhookId)` → it short-circuits with 503 only if the *platform* env vars are missing. If the platform vars exist but the body's org has its own credentials, the verification will use platform creds to call PayPal's verify endpoint, which may fail signature checks for the org's own webhook. Mixed setup is brittle.
- Severity: High
- Fix: Make per-org PayPal webhook configuration mandatory; never fall back to platform creds for verification.

### F-06 PayPal capture-order trusts org binding via metadata-only check
- File: `server/routes/payments.ts:950-1005`
- What: `parseCustomId` reads `org_id` from JSON `custom_id` set during create-order. The check `if (custom.orgId && custom.orgId !== orgId)` rejects mismatch, BUT only if `custom.orgId` is set. If a forged PayPal order_id is supplied that has *no* custom_id (or custom_id missing org_id), the check passes and `createOrUpdatePayPalPaymentFromCapture` later throws — but if the metadata happens to contain a different `invoice_id`, the payment is inserted against that invoice under the caller's `orgId` (the `parseCustomId` later inside `createOrUpdatePayPalPaymentFromCapture` would re-read the same custom_id and throw, but the path is convoluted and one branch can mismatch).
- Severity: High
- Fix: Treat capture-order as strictly authoritative on `custom.orgId === orgId AND custom.invoiceId` matching an invoice owned by orgId; reject otherwise unconditionally.

### F-07 `payment_provider_secrets` selected via service-role with no rate limiting on settings GET
- File: `server/routes/payments.ts:299-337`, `server/lib/payments.ts:118-174`
- What: `/payments/settings` calls service-role to read publishable keys per request. Not a leak of secrets (publishable only), but the route is hit on every page visit, and there is no caching. Combined with the absence of a route-specific rate limit (the global `paymentLimiter` is mounted broadly but I see no explicit limiter on `/api/payments/settings`), this enables tenant enumeration via timing.
- Severity: Medium
- Fix: Cache provider settings per-org in memory for 30s; add a per-org rate limit.

---

## 2. HIGH

### F-08 Stripe webhook handler hardcodes 'CAD' fallback in critical paths
- File: `server/routes/payments.ts:158, 242`
- What: `currency: String(intent.currency || 'CAD').toUpperCase()`. If a Stripe intent ever returns empty currency (shouldn't but defensive code is wrong direction), USD orgs would be recorded in CAD. Worse, `server/lib/payments.ts:903` defaults insert payload `currency: (input.currency || 'CAD').toUpperCase()`. Multi-currency tenants get silent corruption.
- Severity: High
- Fix: Throw if currency is missing rather than defaulting.

### F-09 Public payment route uses `STRIPE_PUBLISHABLE_KEY` env var, not the connected account's
- File: `server/routes/public-pay.ts:169, 243`; also `quotes.ts:947`
- What: Response includes `publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || ''`. For destination charges that's correct (Elements always uses the platform pk). But the response can be `''` if env var unset, and the client mounts `<Elements stripe={null}>` which throws.
- Severity: High
- Fix: Validate `STRIPE_PUBLISHABLE_KEY` at boot; return 503 if absent.

### F-10 `payment_requests` lock can leave row stuck in 'processing' on error
- File: `server/routes/public-pay.ts:182-195`
- What: Atomic lock sets status to `processing`. If `createDestinationPaymentIntent` throws (network, Stripe down), control jumps to outer catch and the row remains `processing` forever. Subsequent attempts hit the 409 path and the customer can never pay.
- Severity: High
- Fix: Wrap PI-creation in a try/finally that resets `status` back to `pending` (and clears `stripe_payment_intent_id`) on failure.

### F-11 `payment_requests.status` enum is missing 'processing' value
- File: `supabase/migrations/20260405000000_lume_payments_connect.sql:70-71`
- What: The CHECK constraint is `status in ('pending', 'sent', 'paid', 'expired', 'cancelled')`. `public-pay.ts:185` updates status to `'processing'`. This update will be rejected by Postgres → the lock acquisition fails silently (the `select` returns null), so concurrent flows all get 409 "already processing" forever. The line of defense breaks on a real lock.
- Severity: Critical (bug; locks never actually held; PI creation then proceeds for every concurrent request — duplicate intents)
- Fix: Either add `'processing'` to the CHECK constraint, or use a different lock column (`locked_at timestamptz`).

### F-12 Webhook handler ignores `charge.refunded` / `charge.dispute.*` / `payment_intent.canceled` / `payment_intent.processing` / `payment_intent.requires_action`
- File: `server/routes/payments.ts:136-281`
- What: Only `payment_intent.succeeded`, `payment_intent.payment_failed`, `account.updated`, `checkout.session.completed` are handled. Refunds initiated in the Stripe Dashboard never update DB; disputes never raise alerts; manual cancellations leave PI in DB as pending forever.
- Severity: High
- Fix: Add handlers for `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`, `payment_intent.canceled`, `payout.failed`, `payout.paid`.

### F-13 Subscription webhooks completely unhandled
- File: `server/routes/payments.ts` webhook handler
- What: No handler for `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`. The SaaS billing flow only handles `checkout.session.completed` for activation. Renewal failures, downgrades, cancellations from the Stripe Customer Portal — none trigger DB updates. The `subscriptions` row stays `status='active'` until manually cleaned.
- Severity: High
- Fix: Implement the full subscription lifecycle webhook set; reconcile `subscriptions.status` with Stripe.

### F-14 Stripe webhook 5-min stale check returns 200 OK on stale event
- File: `server/routes/payments.ts:104-116`
- What: Stale events are logged and answered with `200 received: true, note: 'stale_event_ignored'`. Stripe interprets 200 as "delivered, do not retry," which is correct only if the event truly is stale and replayed. But the same 5-minute cutoff means *any* event delayed by Stripe's own infra (rare but happens) is dropped on the floor. No DLQ.
- Severity: Medium
- Fix: Still record in `webhook_events` even when stale, with status='skipped_stale'. Use `Stripe-Signature` `t=` timestamp tolerance (Stripe SDK already enforces 5min).

### F-15 `invoice.paid_cents` can drift past `total_cents` on partial-then-full webhook race
- File: `server/routes/payments.ts:171-197`
- What: Read-modify-write of `paid_cents`. Two webhooks fired close together (e.g. retry after timeout) both read `paid_cents=0`, both write `paid_cents=amount`. No row-level lock, no `UPDATE ... SET paid_cents = paid_cents + X`.
- Severity: High
- Fix: Use atomic SQL: `UPDATE invoices SET paid_cents = LEAST(total_cents, paid_cents + $X) ...` in a single statement, or rely on `insertOrUpdatePaymentIdempotent`'s dedup and recompute totals from `payments` aggregate.

### F-16 Refund-driven invoice update is non-atomic & lossy
- File: `server/routes/payments.ts:1111-1131`
- What: Same pattern as F-15. Also: `newPaid = max(0, paid_cents - payment.amount_cents)` ignores the case where `paid_cents` reflects multiple payments, so a refund of one payment subtracts its full amount even if `paid_cents` already included another partial refund/payment. Aggregates should be recomputed from the `payments` table.
- Severity: High
- Fix: Recompute `paid_cents` from `SUM(amount_cents) WHERE status='succeeded'` after each refund.

### F-17 No idempotency key on `paymentIntents.create` in `payments.ts:775` (legacy direct intent route)
- File: `server/routes/payments.ts:773-784`
- What: `stripeClient.paymentIntents.create(...)` is called with no idempotency key. If the client retries (double-click, network blip), two PIs are created for the same invoice.
- Severity: High
- Fix: Add `{ idempotencyKey: ... }` derived from `(orgId, invoiceId, balanceCents, minute_bucket)`.

### F-18 `connected_accounts` RLS policy is overly permissive on insert/update
- File: `supabase/migrations/20260405000000_lume_payments_connect.sql:47-59`
- What: Any org member (not admin/owner) can INSERT/UPDATE `connected_accounts`. A non-admin could in principle clobber `stripe_account_id` to a Stripe account they control and divert future payments.
- Severity: High
- Fix: Restrict insert/update to admin/owner via `is_org_admin_or_owner(...)` check function. Server-side routes already enforce this, but RLS defense-in-depth is the documented pattern (see CLAUDE.md).

### F-19 `payment_requests` RLS allows any org member to UPDATE status (including 'paid')
- File: Migration 20260405...:114-119
- What: Non-admin members can set status='paid' on any payment_request in their org via direct PostgREST. They could mark an invoice paid without actually paying.
- Severity: High
- Fix: Restrict UPDATE to service role; clients should only call backend routes which validate.

### F-20 Public token brute-force protection thin
- File: `server/routes/public-pay.ts:18-22`; rate limiter at `index.ts:232,245` (10 req/min/IP)
- What: 48-hex-char (24-byte) token = good entropy. But the rate limit is per-IP and applies to the whole `/api/pay/*` path. An attacker rotating IPs (cheap) could probe ~1M tokens/day. Tokens never expire by default (`expires_at` may be null), and there's no per-token attempt counter.
- Severity: Medium
- Fix: Add `expires_at` default (e.g. 30 days) at insert; add per-token failed-lookup counter; consider HMAC-signed token instead of stored random.

### F-21 `getInvoiceForOrg` doesn't filter by `status != cancelled`
- File: `server/lib/payments.ts:792-802`
- What: A cancelled invoice could still have a balance and accept a payment via `/payments/stripe/create-intent`. Status filter missing.
- Severity: Medium

---

## 3. MEDIUM

### F-22 `processed_checkout_sessions` insert race
- File: `server/routes/payments.ts:1164-1173, 1343-1356`
- What: Idempotency check is "SELECT then later INSERT," not an atomic upsert. Two concurrent webhook deliveries of the same `checkout.session.completed` (Stripe will retry) both pass the SELECT, both create users/orgs/subscriptions, and only the second INSERT fails on the unique constraint — too late. The "23505 → return" guard at L1354 returns silently *after* duplicate user/org/subscription rows were already created.
- Severity: High (duplicate orgs!) — moving up
- Fix: Pre-claim the session with an upfront INSERT `(session_id, status='in_progress')` ON CONFLICT DO NOTHING RETURNING; if no row returned, another worker is processing — exit early.

### F-23 `checkout.session.completed` handler runs ~10 sequential DB+API calls inside the webhook
- File: `server/routes/payments.ts:1157-1395`
- What: User creation, org creation, subscription insert, billing_profiles upsert, org address propagation, profile flag, Twilio provisioning, email send. The whole thing must finish in <30s or Stripe will retry, re-running the user/org creation race.
- Severity: Medium
- Fix: Make the webhook only enqueue a job; defer the heavy work to a background processor.

### F-24 Connect account `country` defaults to 'CA' regardless of org's actual country
- File: `server/routes/connect.ts:26`, `server/lib/stripe-connect.ts:30`
- What: `country = String(req.body.country || 'CA').toUpperCase()`. US org owners onboarding without explicit `country` get a Canadian Connect account.
- Severity: Medium
- Fix: Read `orgs.country` from DB; require explicit choice if absent.

### F-25 No verification that Stripe Connect capabilities are active before quoting/invoicing
- File: `server/routes/public-pay.ts:175-178`
- What: Only `charges_enabled` is checked. `transfers` capability may be in `pending` state, and the destination charge can still fail at confirm-time. Customer sees a generic error.
- Severity: Medium
- Fix: Check `payouts_enabled` and explicit capabilities map on the connected account row, and surface a friendly "this business is verifying its account" message.

### F-26 Application fee is global 2.9% regardless of plan
- File: `server/lib/stripe-connect.ts:115-119`
- What: Hardcoded 2.9% application fee — no DB field, no plan-level override. Pro/Enterprise customers pay the same platform cut.
- Severity: Medium (business)
- Fix: Move `APPLICATION_FEE_PERCENT` to `plans` table or `orgs.platform_fee_bps`.

### F-27 PayPal webhook does not log to `webhook_events`
- File: `server/routes/payments.ts:1009-1032`
- What: Stripe webhook calls `logWebhookEvent` for idempotency + auditing. PayPal webhook does not. If PayPal redelivers the same `PAYMENT.CAPTURE.COMPLETED`, idempotency is only guaranteed by `insertOrUpdatePaymentIdempotent` keyed on `provider_event_id`. That works, but the audit trail is missing.
- Severity: Medium

### F-28 PayPal capture-order idempotency key is `capture-${orderId}` — never time-bucketed
- File: `server/routes/payments.ts:981`
- What: Same key forever. If capture fails (network) then user retries — PayPal returns cached 422/4xx response forever. Stripe lib does the right thing on success but stuck on failure.
- Severity: Medium
- Fix: Include attempt counter or just don't pre-set request id on capture; PayPal natively dedupes.

### F-29 PayPal create-order idempotency uses `Math.floor(Date.now()/60_000)` bucketing
- File: `server/routes/payments.ts:914`
- What: Within a 60s window the same key dedupes, but if a user changes invoice amount within the same minute (won't here, but pattern-wise) they'd get the cached order. More importantly: the key includes `orgId-invoiceId` but not balance, so a quick edit of the invoice (impossible? invoice routes do allow edits) followed by re-request returns the old order.
- Severity: Low–Medium

### F-30 `console.log` includes user email and orgId
- File: `server/routes/payments.ts:1172, 1394, 1418, 1447`
- What: Logs `Subscription activated for ${userEmail}` and `SMS number ${result.phoneNumber} assigned to org ${orgId}`. Email + phone are PII. Combined with the project's PII redaction module, those should use the redacting logger.
- Severity: Medium
- Fix: Replace `console.log` with `server/lib/logger.ts` which redacts.

### F-31 Refund schema accepts `reason` as free text up to 500 chars
- File: `server/routes/payments.ts:9-13`
- What: The free-text `reason` is concatenated into `failure_reason` (`payments.ts:1104`) without sanitization. Not exploitable on its own but logs/UI rendering must escape. Also Stripe API only accepts specific enum values for `reason`; the code does map to enum at L1084 but stores raw input separately — that's fine.
- Severity: Low

### F-32 `getServiceClient()` used inside webhook even after auth-less verification — no cross-org metadata defense
- File: `server/routes/payments.ts:171-219`
- What: Webhook trusts `intent.metadata.org_id` for the invoice update. A compromised tenant could craft a PI with another org's invoice_id in metadata. The handler updates `invoices` filtering by `invoiceId` only (L196) — no `eq('org_id', metadata.orgId)`. Combined with how PIs are created server-side this is hard to exploit, BUT the defense is missing.
- Severity: Medium-High
- Fix: Add `.eq('org_id', metadata.orgId)` to the invoice update at L188-196.

### F-33 Quote-deposit webhook update lacks org scoping when `webhookOrgId` empty
- File: `server/routes/payments.ts:207-210`
- What: `if (webhookOrgId) qb = qb.eq('org_id', webhookOrgId)` — if metadata `org_id` is missing, the update runs unscoped. Same applies at L213-219 for `payment_requirements`.
- Severity: Medium
- Fix: Require `org_id`; reject the event with `webhook_events.status='failed'` if missing.

### F-34 Subscription `cancel_at_period_end` updated client-side only, no Stripe call
- File: `server/routes/billing.ts:484-510`
- What: `POST /billing/cancel` only updates Supabase. There's no `stripe.subscriptions.update(..., { cancel_at_period_end: true })`. Stripe will continue charging on renewal.
- Severity: Critical (for paying tenants who hit "Cancel")
- Fix: Resolve to `stripe_subscription_id`, call Stripe API; sync via webhook.

### F-35 No Stripe `subscriptions.create` ever called — `/billing/subscribe` only creates a one-shot PaymentIntent
- File: `server/routes/billing.ts:144-423`
- What: Recurring billing is fully simulated in DB (`subscriptions.current_period_end`). No Stripe-managed subscription exists. There is no autorenewal mechanism — when the period ends, nothing happens. Either there's a cron not visible here, or every tenant churns silently.
- Severity: Critical (business)
- Fix: Switch to Stripe `prices` + `subscriptions.create` flow, or implement an explicit cron-driven renewal that calls Stripe again at period-end.

### F-36 Stripe Tax not enabled; sales tax never collected for SaaS plans
- File: `server/routes/billing.ts:616-656` (create-checkout-session)
- What: `automatic_tax` not set; `tax_id_collection` not set; `taxes: null` passed to receipt email. GST/PST/HST owed by Canadian customers, sales-tax owed by US states with nexus — all uncollected.
- Severity: High (compliance)
- Fix: Enable `automatic_tax: { enabled: true }` on the Checkout Session; configure Stripe Tax in dashboard.

### F-37 Promo code race: `current_uses` increment is not atomic
- File: `server/routes/billing.ts:215`
- What: `update({ current_uses: promo.current_uses + 1 })` — classic lost-update under concurrent redemptions. A 1-use promo can be redeemed by multiple users simultaneously.
- Severity: Medium
- Fix: `update({ current_uses: sql\`current_uses + 1\` })` or use RPC with row lock.

### F-38 `/billing/create-checkout-session` is fully public — abuse vector
- File: `server/routes/billing.ts:540-663` (commented "PUBLIC — no auth required")
- What: Anyone can POST with arbitrary email, plan, and create unlimited Stripe Customers + Checkout Sessions. No rate limit visible on this path. Stripe customers pile up; can fingerprint test/live mode. Could also be used to spam-create checkout sessions targeting random emails (the success email is sent only on payment, but customer objects persist in Stripe).
- Severity: High
- Fix: Add a strict per-IP rate limiter on this endpoint; consider Cloudflare Turnstile/captcha; verify email reachability before creating Stripe customer.

### F-39 `auth.admin.listUsers()` called on every checkout session creation
- File: `server/routes/billing.ts:552`, `payments.ts:1199`
- What: Iterates ALL Supabase users to find one by email. Slow once tenant count grows. Also exposes a timing-oracle (slow vs fast → existence).
- Severity: Medium (perf + minor security)
- Fix: Use `admin.auth.admin.getUserByEmail` (if available) or `from('profiles').select('id').eq('email', email)`.

### F-40 `billing/onboarding` updates `orgs.email` to whatever the caller passes — could overwrite verified contact
- File: `server/routes/billing.ts:110-122`
- What: `orgs.email: email || undefined`. A member (non-admin) hitting `/billing/onboarding` could overwrite the org's contact email. Auth checks the user is signed in but not admin/owner; no `isOrgAdminOrOwner` gate.
- Severity: High (privilege)
- Fix: Require admin/owner role for onboarding writes affecting `orgs`.

### F-41 No CSRF token on JSON POST routes (only header-presence check)
- File: `server/index.ts:166-177`
- What: CSRF "check" is satisfied by `Content-Type: application/json` alone. Modern browsers do enforce CORS preflight on application/json, but for any route that accepts `*/*`, the form-based CSRF protection is bypassed. Stripe and payment routes accept JSON only — but the header-only gate is brittle.
- Severity: Medium
- Fix: Real CSRF token (double-submit cookie) for state-changing routes.

### F-42 `payments.ts` does not enforce `isOrgAdminOrOwner` on `/payments/stripe/balance` and `/payments/stripe/transactions`
- File: `server/routes/payments.ts:800-873`
- What: Any org member can read the org's Stripe balance and transaction list (including amounts, customer emails). For service businesses, regular techs/employees should not see revenue.
- Severity: Medium
- Fix: Add `isOrgAdminOrOwner` gate.

### F-43 `PaymentIntent` for invoice does not include `transfer_data` (no destination charge)
- File: `server/routes/payments.ts:773-784`
- What: This legacy route creates PIs on the *org's* Stripe key (not the platform's Connect path). That means orgs need their own Stripe account *and* the platform never collects application fees on this code path. Two payment models coexist (Connect for public-pay + quotes; direct for invoices via the create-intent route), creating accounting inconsistency.
- Severity: High (business)
- Fix: Unify all org-facing payments under Connect destination charges. Deprecate the org-keys path.

---

## 4. LOWER SEVERITY

### F-44 `Idempotency-Key` not used on `stripe.customers.create` or `paymentMethods.attach`
- File: `server/routes/billing.ts:235, 254-255, 451`
- What: Customer creation is not idempotent. Retry creates duplicate Stripe customers under the same email.
- Severity: Low–Medium
- Fix: Pass `{ idempotencyKey: 'cust-' + orgId }` (note: customer creation only needs to happen once anyway, so the surrounding logic should also gate on `billingProfile?.stripe_customer_id`).

### F-45 Webhook event TTL / cleanup missing
- File: Migration `20260405000000` `webhook_events`
- What: Table grows forever. No `created_at < now() - interval '90 days'` cleanup job.
- Severity: Low

### F-46 Plain integer `amount_cents` columns without `bigint`
- File: `payments` table extensions (migration 20260405...)
- What: 32-bit signed int caps at ~$21M. Fine today; will hit it for high-ticket orgs eventually.
- Severity: Low

### F-47 `getPaymentRequestByToken` does service-role lookup with no rate-limit defense beyond IP limiter
- File: `server/lib/stripe-connect.ts:223-232`
- What: Function uses service role and returns the entire row including `stripe_payment_intent_id`. Combined with F-20.
- Severity: Low

### F-48 Refund partial flow keeps `status='succeeded'` (line 1103) but still rewrites `failure_reason` field
- File: `server/routes/payments.ts:1100-1106`
- What: Misuse of `failure_reason` to store refund metadata. UI logic that interprets the field as "failure" displays bad strings to users.
- Severity: Low
- Fix: Add proper `refund_history jsonb` field.

### F-49 `refund.reason` filtering accepts only `duplicate|fraudulent|requested_by_customer`
- File: `server/routes/payments.ts:1084`
- What: OK Stripe-side, but the input validation allows any 500-char string then silently coerces to `requested_by_customer`. UX disconnect — user thinks they entered a custom reason; nothing is stored as the human reason.
- Severity: Low

### F-50 Stripe types pinned implicitly via `new Stripe(key)` with no API version
- File: Multiple — `server/routes/payments.ts:773, 816, 863`, `server/lib/stripe-connect.ts:13`, `server/routes/billing.ts:10`, `server/routes/quotes.ts:964, 989`
- What: No `apiVersion` set. Stripe pins to your account's default which can be unilaterally upgraded by Stripe. Schema drift can break parsing.
- Severity: Medium
- Fix: `new Stripe(key, { apiVersion: '2024-12-18.acacia' })` (or the version your code is tested against).

### F-51 Stripe Elements properly mounted (single provider), good — but `confirmParams.return_url` includes a query string from existing href
- File: `src/pages/PublicPayment.tsx:225`
- What: `return_url: \`${window.location.href.split('?')[0]}?result=success\`` — strips existing query. Fine, but the `result=success` parameter is *purely informational* and the actual success state is determined client-side via `setSucceeded(true)`. No server-side reconciliation: if the user closes the tab before `setSucceeded` runs, the UI shows "failed" even though Stripe accepted the payment. The webhook will eventually mark it paid, but the user gets a confusing error.
- Severity: Low (UX)

### F-52 No i18n on error strings returned by server
- File: All payment routes
- What: "Invoice not found", "Stripe keys are not configured", "Only owner/admin can issue refunds" — English only. The CRM is documented as FR/EN.
- Severity: Low

### F-53 `payments` indexes missing on `(provider, provider_payment_id)` and `(provider, provider_event_id)`
- File: Migration 20260405... only adds `payments_payment_request_id_idx`
- What: `findExistingPaymentByIdentifiers` does `.eq('provider', ...).eq('provider_event_id', ...)`. Without an index, each webhook scan is O(n) on the payments table.
- Severity: Medium
- Fix: Add composite unique indexes on `(provider, provider_event_id)` and `(provider, provider_payment_id)`.

### F-54 `stripe.balanceTransactions.list` swallows error silently
- File: `server/lib/payments.ts:561-563`
- What: `.catch(() => ({ data: [] }))`. Fees show as 0 if API call fails — wrong but invisible.
- Severity: Low

### F-55 Encryption key rotation path requires manual `PAYMENTS_ENCRYPTION_KEY_PREVIOUS` env var
- File: `src/lib/crypto.ts:24-30, 89`
- What: Documented, but no migration script visible to re-encrypt secrets with the new key. After rotation, every decrypt does two key-tries. If the previous key var is forgotten, all legacy secrets break.
- Severity: Medium (ops)

### F-56 PayPal `paypalRequestId` for create-order is bucketed per minute
- File: `server/routes/payments.ts:914`
- What: Same as Stripe minute bucketing — fine for retries, but if a user pays the same invoice via two different methods within 60s, PayPal dedupes and returns the prior order.
- Severity: Low

### F-57 No PCI-relevant logging hygiene check
- File: `payments.ts` overall
- What: Code never logs `req.body`, `intent.client_secret`, or card numbers — good. But the audit didn't find an automated guard / lint rule preventing future regressions.
- Severity: Low
- Fix: Add an ESLint rule banning `console.log(intent`, etc., or a redacting wrapper for Stripe responses.

### F-58 PayPal capture-order does not call `logSecurityEvent` on org mismatch (403 path)
- File: `server/routes/payments.ts:996-998`
- What: A cross-org attempt is silently 403'd. The Stripe webhook path uses `logSecurityEvent` for signature failures; same posture should apply.
- Severity: Low

### F-59 `paypalCreateOrderSchema` only validates `invoiceId` — no defense against passing extra trojan fields
- File: `server/lib/validation.ts:152-154`
- What: Schema is `z.object({ invoiceId })` without `.strict()`. Extra fields are stripped (Zod default). Fine. But neighboring `paymentSettingsSchema` uses `.passthrough()` which accepts arbitrary fields — those reach Stripe via `body` spread. The `saveProviderKeys` function only reads explicit fields, but the passthrough is fragile.
- Severity: Low

### F-60 No dunning / failed-renewal email path
- File: search across `server/routes/*` for `payment_failed` email
- What: `payment_intent.payment_failed` updates DB row to `failed` but sends no email to the customer or to the org owner. Combined with F-13 (no subscription webhooks), failed renewals are completely silent.
- Severity: High (UX/retention)

---

## Summary
- 5 Critical findings concentrated in: quote deposit fund mis-routing (F-01/F-02), webhook secret architecture (F-03), broken processing-lock (F-11), and SaaS subscription cancellation that doesn't reach Stripe (F-34/F-35).
- The codebase has good fundamentals: Stripe webhook signature is verified, raw-body mounting is correct, idempotency tables exist, encryption key rotation is supported, RLS is on every table. The recurring failure mode is **defense-in-depth gaps**: server-side auth checks exist but RLS doesn't mirror them; PI metadata is trusted without org cross-check; refund and webhook handlers don't validate Connect account ownership.
- Highest-leverage fixes: (1) collapse the three deposit paths to one Connect destination-charge path; (2) fix the `payment_requests` status enum so the lock works; (3) wire Stripe-managed subscriptions for SaaS billing; (4) add the missing subscription/refund/dispute webhook handlers; (5) enable Stripe Tax.
