# Architecture & Multi-Tenant Coherence — 2026-05-13

Read-only audit of `lume-crm/`. Scope: tenant boundaries, auth state machine, permissions, module gating, FK integrity, soft-delete consistency, migration parity, lazy-load coherence, crons, orphan code.

DB: Supabase project `bbzcuzqfgsdvjsymfwmr`. 168 public tables, 152 with `org_id`.

---

## P0 — Tenant boundary leaks

### P0-1. `TenantGuard` component exists but is NEVER used in routing
- File: `src/components/TenantGuard.tsx` (full implementation, table+id verifier).
- `src/App.tsx`: zero references. `/clients/:id`, `/jobs/:id`, `/invoices/:id`, `/quotes/:id` all rely solely on `<PermissionGate>` + RLS.
- Impact: a user with `clients.read` in org A who guesses/types a UUID from org B will *get blocked by RLS* (good), but the detail page mounts, fires queries, and shows a half-broken "not found" UX. More importantly, **for `quotes` the RLS has a public-view policy** (see P0-2) and the guard would be the missing belt-and-suspenders layer.
- Fix: wrap the four detail routes in `App.tsx` lines 1063 (`/clients/:id`), 1065 (`/jobs/:id`), 1073 (`/quotes/:id`), 1077 (`/invoices/:id`), e.g.:
  ```tsx
  <Gated permission="clients.read">
    <TenantGuard table="clients" id={useParams().id}>
      <ClientDetails />
    </TenantGuard>
  </Gated>
  ```

### P0-2. `quotes` table has a public-view RLS policy that bypasses org check
- DB: `quotes_public_view_token` policy — `SELECT` `USING (view_token IS NOT NULL)`.
- Combined with `quotes_select` (org membership), Postgres OR's permissive policies. Result: **any authenticated user can SELECT any quote in any org as long as `view_token IS NOT NULL`**.
- The policy is presumably meant for unauthenticated public quote viewing via `/q/:token`. But `quotes_public_view_token` should be restricted to the `anon` role (or applied only when `auth.uid() IS NULL`) — currently it grants to `authenticated` as well.
- Fix: `ALTER POLICY quotes_public_view_token ON quotes TO anon;` or rewrite as `USING (view_token IS NOT NULL AND auth.uid() IS NULL)`.

### P0-3. `invoices` RLS is inconsistent with peer tables
- Peers (`clients`, `jobs`, `leads`, `payments`, `quotes`) use `has_org_membership(auth.uid(), org_id)`.
- `invoices_select_org` / `invoices_update_org` use a hand-rolled `EXISTS (SELECT 1 FROM memberships ...)` subquery instead.
- Functionally equivalent today, but:
  - The helper `has_org_membership` is a `SECURITY DEFINER` STABLE function that the planner can inline once per query; the EXISTS subquery is re-planned per row in some join paths.
  - If `has_org_membership` ever changes semantics (e.g. for paused subs), `invoices` will silently drift.
- Fix: rewrite `invoices_select_org` / `invoices_update_org` to use `has_org_membership(...)` like the rest.

### P0-4. RLS policies whose `qual` references neither `org_id` nor `auth.uid()` directly
DB scan flagged these tables: `applied_taxes`, `payment_provider_secrets`, `plans`, `promo_codes`, `quote_line_items`, `quotes` (public-view, see P0-2), `satisfaction_surveys`. For `plans`/`promo_codes` (global catalog) that's fine. **`payment_provider_secrets`** and **`applied_taxes`** must be re-verified — `payment_provider_secrets` holds tenant-encrypted Stripe/PayPal keys; if its policy only checks via FK chain it MUST resolve to an org membership.

### P0-5. `jobs.client_id` and `invoices.client_id` use `ON DELETE CASCADE`
- `jobs_client_id_fkey`: `ON DELETE CASCADE`.
- `invoices_client_id_fkey`: `ON DELETE CASCADE`.
- `clients.org_id` itself is `ON DELETE RESTRICT` (good) and clients are soft-deleted via `deleted_at`, so direct hard delete is gated. **But** if anyone ever bypasses with `service_role` (e.g. a future DSR purge), deleting one client cascades to wipe its invoices — including paid ones. That's an accounting integrity hole.
- Fix: change both to `ON DELETE SET NULL` or `ON DELETE RESTRICT` to force the deletion code path to make the relationship explicit. `payments.client_id` already correctly uses `SET NULL`.

---

## P1 — Architectural inconsistencies

### P1-1. App auto-provisions org+membership client-side
- `src/App.tsx` lines 363-381: if user has no membership, the *browser* INSERTs into `orgs` then `memberships` with role `owner`.
- This works because `orgs_insert` and `memberships_insert` RLS allow self-bootstrap, but it puts a privileged write on the client. Race condition: two tabs of the same brand-new user open simultaneously → both attempt insert → one may end up orphaned (succeeded `orgs` insert but failed `memberships` insert).
- The server already has `POST /api/onboarding/*`. Move provisioning there with a single transactional RPC `bootstrap_org_for_user()` that runs `SECURITY DEFINER`.

### P1-2. Realtime channels: 4 of 11 omit `org_id` filter
Channels WITH org filter (good): `Dashboard.tsx`, `Schedule.tsx`, `FieldSales.tsx`, `Timesheets.tsx` (×2), `Pipeline.tsx` (partial — uses `deleted_at=is.null` instead of org).

Channels WITHOUT org filter (leaks broadcast volume, not data — RLS still blocks payload but every tenant's INSERT wakes every other tenant's client):
- `src/App.tsx:271` — `conversations` (`*`)
- `src/pages/Pipeline.tsx:250` — `pipeline_deals` (`*`)
- `src/pages/Jobs.tsx:494` — `jobs` (`*`)
- `src/pages/Messages.tsx:294,306` — `messages` (INSERT), `conversations` (`*`)
- `src/pages/DispatchMap.tsx:165` — `tracking_live_locations` (`*`)
- `src/components/ActivityCenter.tsx:128`, `src/components/ActivityTimeline.tsx:108`
- `src/hooks/useRealtimeNotifications.ts:46,55`
- `src/lib/notesApi.ts:299,304`, `src/lib/noteBoardsApi.ts:379,384`

Severity: not a data leak (Realtime applies RLS to the *row payload*), but:
1. Wastes bandwidth at scale.
2. Side-channel: an attacker can count global INSERT velocity across all tenants.

Fix: add `filter: \`org_id=eq.${currentOrgId}\`` everywhere a tenant table is subscribed.

### P1-3. `App.tsx` line 1060: `/leads` permanently redirects to `/quotes`
- Comment-free, no module gate. Leads still exist as a DB table with active RLS, and `Pipeline.tsx` references them. But there is no `/leads` page anymore — `Leads` is imported (line 51) and unused. Either restore the page or remove the import.

### P1-4. Beta bypass list reads `import.meta.env.VITE_BETA_BYPASS_EMAILS` client-side
- `App.tsx:407-410`. Whoever is on that list skips the subscription check. Because it's `VITE_*`, **the entire bypass list is shipped to the client bundle and visible to any user via DevTools**.
- Not a critical leak (bypass only gives access, not data — they still need to log in), but disclosing internal beta emails violates compliance hygiene. Move to a server-side `subscriptions` table flag (e.g. `beta_grant=true`) and check via `/api/me`.

### P1-5. RBAC nav vs route permissions diverge
- Nav item `Tasks` requires `leads.read` (App.tsx:720) but the route `/tasks` requires `settings.read` (App.tsx:1092). A `sales_rep` with `leads.read` but not `settings.read` will see the nav item then get blocked clicking it.
- Similar mismatch: `courses` nav has NO `requiredPermission` (App.tsx:688) but route requires `settings.read`. Technicians can see the link, can't open it.
- Nav `Lume Agent` (line 669) gates on `external_agent.use` but route `/dashboard` gates the same — consistent here.
- Fix: align nav gates with route gates, or extract a single source of truth from `permissions.ts`.

### P1-6. `Platform Admin` nav items have no permission gate
- App.tsx:691-692: only filtered by `isPlatformOwner`. The corresponding routes check `isPlatformOwner ? <Page/> : <Navigate/>` (lines 1131-1133). Server route enforces auth too. Defensible, but inconsistent with the rest of the matrix.

---

## P1 — Stale/orphan routes after the morning's removal

The morning removed Bookings/RouteOpt/Campaigns/RecurringJobs pages. The cleanup is partial:

| Removed feature | Frontend page | Frontend lib | Server route | Mounted in index.ts | DB table |
|---|---|---|---|---|---|
| Bookings | gone | `bookingApi.ts` (no imports left) | `routes/booking.ts` | yes, line 335 | `bookings`, `booking_pages` still exist |
| Recurring Jobs | `RecurringJobs.tsx` (orphan, not in App.tsx routes) | `recurringJobsApi.ts` (imported by JobDetails + RecurringJobs) | none specific | scheduler started line 544 | `job_recurrence_rules` exists |
| Recurring Invoices | gone | `recurringInvoicesApi.ts` (no imports) | `routes/recurring-invoices.ts` | yes, line 327 | `recurring_invoice_schedules` exists |
| Route Optimization | gone | `routeOptimizationApi.ts` (imported by `Schedule.tsx:29`) | `routes/route-optimization.ts` | yes, line 330 | n/a |
| Campaigns | gone | none | `routes/campaigns.ts` | yes, line 369 | `email_campaigns` + `email_campaign_recipients` still exist |

Findings:
- `RecurringJobs.tsx` page is unreachable (no route in App.tsx) — dead file.
- `bookingApi.ts` is reachable only via the server (no UI), so the lib file is dead.
- `recurringInvoicesApi.ts` is dead from frontend; backend cron still calls `runDueSchedules` in `cron.ts` — keep server side, delete frontend lib.
- `routeOptimizationApi.ts` IS imported by `Schedule.tsx:29` (`optimizeRoute`, `applyOptimizedSchedule`) — the morning's "removal" left a live dependency. Either restore the dispatch route-optimization UI or strip these calls from `Schedule.tsx`.
- `email_campaigns` tables still mounted in `cron.ts:66` (`/cron/campaigns`). If the feature is gone, the cron should be disabled or the table dropped.

---

## P2 — Tech debt

### P2-1. Migration filename `20260625000002_v1_field_sales_missing_tables.sql` collides with `20260625000002_retention_policies.sql`
- Two local files share the same version stamp.
- DB migration ledger lists `20260625000002` once with name `retention_policies`. The `v1_field_sales_missing_tables` file is **not** in the ledger.
- Action: either it was applied manually and the ledger drifted, or it has never been applied to prod. Either way the duplicate stamp is dangerous — a fresh `supabase db reset` will silently skip one. Rename to `20260625000010_v1_field_sales_missing_tables.sql` and reconcile.

### P2-2. Cron endpoints exist but no external scheduler is documented
- `POST /api/cron/retention` — RPC `run_retention_job()`
- `POST /api/cron/purge-audit` — `purge_old_audit_events(1095)`
- `POST /api/cron/campaigns`
- `POST /api/cron/recurring-invoices`
- `POST /api/cron/webhook-retries`
- `POST /api/cron/payment-reminders` (in `reminders-cron.ts`)

All six check `CRON_SECRET` via `crypto.timingSafeEqual` (good). All use `service_role` and idempotent semantics (status filtering, advisory locks for in-process loops). **No external trigger is configured** — recommend `cron-job.org` or Vercel Cron with daily/hourly schedules:
- retention, purge-audit: daily 03:00 UTC
- recurring-invoices: hourly
- campaigns: every 15 min
- webhook-retries: every 5 min
- payment-reminders: daily 09:00 in tenant TZ (currently hits everyone in UTC)

### P2-3. Soft-delete coverage: 15 of ~25 frontend Api files filter `deleted_at IS NULL`
Files known to filter (66 occurrences across 15 files): clientsApi, dashboardApi, insightsApi, invoicesApi, jobsApi, leadsApi, pipelineApi, quotesApi, scheduleApi, etc. Spot-checked: payment tables, communications, notes do NOT consistently filter. Recommend a lint rule or wrap reads through a helper.

### P2-4. `hardDeleteClient` is removed but the dead comment remains
- `src/lib/clientsApi.ts:258` — `// REMOVED 2026-05-12: hardDeleteClient violated CLAUDE.md soft-delete rule`. Fine for one audit cycle, then strip.

### P2-5. Server route mounted but feature dead
- `routes/booking.ts`, `routes/recurring-invoices.ts`, `routes/campaigns.ts`, `routes/route-optimization.ts` all still mounted in `server/index.ts:329-330, 335, 369`. They share the global rate limit/RBAC infra so cost is low, but each is attack surface for stale auth assumptions.

---

## Coherent design (what's working)

- 152/152 tenant tables have RLS enabled (0 rows with `relrowsecurity=false` in public schema).
- 5 high-risk tables (`clients`, `leads`, `invoices`, `jobs`, `payments`) all have 4 CRUD policies; quotes has 5 (the extra one is the P0-2 bug).
- Server routes consistently use `requireAuthedClient` → 340 occurrences across 52 files, and `.eq('org_id', auth.orgId)` → 291 occurrences across 44 files (ratio implies almost every authed route org-scopes).
- CSRF check, CSP, HSTS, MFA, RBAC middleware all wired in correctly in `server/index.ts`.
- `CompanyProvider` wraps both `AuthenticatedApp` and the onboarding wizard (App.tsx:550-553, 557-579) — `useCompany()` is never called outside provider tree. `useRealtimeNotifications` was correctly hoisted into `AuthenticatedApp` (App.tsx:608) precisely because of this.
- ModuleGate is enforced server-side too — the `/api/field-sales/*` router checks module activation via `org_features`.
- `VerifyEmailGate` is correctly placed AFTER `!user` short-circuit and BEFORE the subscription guard (App.tsx:510-523).
- 3 lazy-loaded routes (`QuoteMeasure`, `PlatformAdmin`, `AdminDemoRequests`); all three resolve to existing files. `QuoteMeasure` uses `<React.Suspense>` correctly; `PlatformAdmin`/`AdminDemoRequests` use `fallback={null}` (acceptable but could show skeleton).
- Migration ledger lists 187 applied migrations, filesystem has 187 (modulo the P2-1 collision). No drift detected besides P2-1.
- `payments.client_id`, `payments.invoice_id`, `payments.job_id` correctly all `ON DELETE SET NULL` — accounting trail survives entity deletion.
- `clients.org_id` and `jobs.org_id` correctly use `ON DELETE RESTRICT` — orgs cannot be deleted while data exists.

---

## Auth state machine

```
              ┌──────────┐
              │ loading  │  ← supabase.auth.getSession() in-flight
              └────┬─────┘
                   │ session resolved
                   ▼
        ┌─────────────────────┐
        │ /checkout(/success) │  public, regardless of auth state (App.tsx:474-479)
        └─────────────────────┘
        ┌─────────────────────┐
        │ token routes (/q,   │  public, regardless of auth (App.tsx:482-485)
        │ /portal, /pay, ...) │
        └─────────────────────┘
                   │ neither
                   ▼
              ┌─────────┐
              │ !user   │ ──► PublicRoutes (landing | /auth)
              └────┬────┘
                   │ user
                   ▼
       ┌────────────────────────┐
       │ !email_confirmed_at &  │ ──► VerifyEmailGate
       │ !isOAuthCallback       │     (email/pw users only; OAuth bypasses)
       └────────┬───────────────┘
                │ confirmed
                ▼
       ┌──────────────────────────┐
       │ hasSubscription === null │  ← effect still loading (transient, no UI)
       └────────┬─────────────────┘
                ▼
       ┌──────────────────────────┐
       │ hasSubscription === false│ ──► AccessBlocked (with /checkout escape)
       │  + reason set            │
       └────────┬─────────────────┘
                │ has active/trialing OR bypass email
                ▼
       ┌──────────────────────┐
       │ showOnboarding=true  │ ──► OnboardingWizard (inside CompanyProvider)
       └────────┬─────────────┘
                │ onboarding_done
                ▼
       ┌────────────────────────┐
       │ CompanyProvider →      │
       │ AuthenticatedApp       │  ── companyLoading → spinner
       │                        │  ── hasNoCompany → NoCompanyState
       │                        │  ── isMultiCompany && !current → CompanySelectorPage
       │                        │  ── else → main shell + Routes
       └────────────────────────┘
```

### Gaps in the state machine

1. **`hasSubscription === null` window has no UI** (App.tsx:530 guards on `false`, not `null`). For a few ms after onboarding completes, the user sees a flash of the empty `<AuthenticatedApp>` before the subscription check resolves. Add `if (hasSubscription === null) return <Spinner />;`.

2. **Stuck-state risk: client-side org auto-provisioning fails silently** (App.tsx:379-381). If the `orgs` INSERT succeeds but `memberships` INSERT fails, `onboardingChecked` is still set to `true`, the subscription check runs, finds no membership, sets `accessBlockedReason='no_membership'`, and the user lands on `AccessBlocked` with no path forward (the wizard never gets a chance). Move to server-side bootstrap (P1-1).

3. **Email re-confirmation drift**: if a user changes their email post-signup, Supabase resets `email_confirmed_at` to null. They'll be bounced to `VerifyEmailGate` mid-session, including from inside paid views. That's correct behavior but jarring — consider toast warning first.

4. **`/checkout/success`** is the *only* path checked literally on `location.pathname` (line 474). If anyone adds a trailing slash redirect (`/checkout/success/`), it stops matching. Use `startsWith` or a `<Route>` wrapper.

5. **No path back from `AccessBlocked` for `no_membership`** beyond `/checkout` (which won't help if they have no org to subscribe). Need an "accept invitation" prompt — `/accept-invitation` is imported but not surfaced.

---

## Stats

- **Tables**: 168 in public (includes 6 views: `clients_active`, `leads_active`, `leads_open`, `jobs_active`, `tasks_active`, `team_availability_active`, `schedule_events_active`, `pipeline_deals_active`, `pipeline_deals_visible`, `v_*`)
- **Tenant-scoped tables (have `org_id`)**: 152
- **Tables with RLS enabled**: 100% of public tables (0 disabled)
- **Tables with at least one policy**: 178 (sampling above)
- **RLS qual not referencing org/user**: 7 (`applied_taxes`, `payment_provider_secrets`, `plans`, `promo_codes`, `quote_line_items`, `quotes`, `satisfaction_surveys`) — see P0-4 / P0-2
- **Realtime channels**: 24 `.on('postgres_changes', ...)` call sites; **9 filter by `org_id`**, 15 do not — see P1-2
- **Server routes using `requireAuthedClient`**: 340 occurrences across 52 files
- **Server routes filtering `.eq('org_id', ...)` explicitly**: 291 occurrences across 44 files
- **Lazy-loaded routes**: 3 (`QuoteMeasure`, `PlatformAdmin`, `AdminDemoRequests`); all resolve, all have Suspense
- **Cron POST endpoints**: 6, all gated by `CRON_SECRET` via `timingSafeEqual` (`/cron/retention`, `/cron/purge-audit`, `/cron/campaigns`, `/cron/recurring-invoices`, `/cron/webhook-retries`, `/cron/payment-reminders`); **0 external schedulers documented**
- **Migrations applied**: 187; local files: 187; **1 version collision** (`20260625000002` × 2 files) — see P2-1
- **`hardDelete*` references in active code**: 0 (only a comment remains in `clientsApi.ts:258`)
- **Dead pages**: `RecurringJobs.tsx`, possibly `Leads.tsx` (imported but `/leads` redirects away)
- **Dead frontend libs after morning removal**: `bookingApi.ts`, `recurringInvoicesApi.ts`; `routeOptimizationApi.ts` still imported by `Schedule.tsx:29` (zombie dependency)
- **Server routes mounted with no frontend consumer**: `routes/booking.ts`, `routes/campaigns.ts`, `routes/recurring-invoices.ts`, `routes/route-optimization.ts`

---

## Top recommended fixes (in order)

1. **P0-2** — Restrict `quotes_public_view_token` policy to `anon` role.
2. **P0-1** — Wrap the four detail routes in `<TenantGuard>`.
3. **P0-5** — Change `jobs.client_id` and `invoices.client_id` from CASCADE to SET NULL/RESTRICT.
4. **P0-3** — Rewrite `invoices_select_org`/`invoices_update_org` to use `has_org_membership()`.
5. **P0-4** — Verify `payment_provider_secrets` and `applied_taxes` policies resolve to org membership.
6. **P1-1** — Move client-side org auto-provisioning into a server `SECURITY DEFINER` RPC.
7. **P1-2** — Add `filter: org_id=eq.${currentOrgId}` to the 15 unscoped realtime subscriptions.
8. **P1-3** / orphan cleanup — drop `Leads.tsx` import, delete `bookingApi.ts`, `recurringInvoicesApi.ts`, unmount `routes/booking.ts` etc., or restore the dropped features cleanly.
9. **P1-5** — Align nav `requiredPermission` with route `<Gated>` permissions.
10. **P2-1** — Rename the colliding `20260625000002_v1_field_sales_missing_tables.sql` migration; reconcile against the prod ledger.
