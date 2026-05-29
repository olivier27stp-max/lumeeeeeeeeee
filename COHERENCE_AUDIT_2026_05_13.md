# Coherence Audit — 2026-05-13

Read-only audit performed after today's churn (9 features added, 4 removed, OneDrive partial revert + recovery, onboarding v2, VerifyEmailGate, BookDemoForm, P0/P1 hardening).

Scope: routing coherence, dead imports, orphan i18n keys, server-route mounts vs. frontend, end-to-end user flows, permissions, UI consistency.

---

## 🔴 BROKEN — fix before launch

### B1. Four "Activity" sub-tabs in Settings page link to 404 routes
File: `src/pages/Settings.tsx:575-581`
The settings sidebar still contains these `link:` entries:

| Sidebar label | Target path | Mounted in App.tsx? |
|---|---|---|
| Payment Reminders | `/settings/reminders` | NO |
| Checklist Templates | `/settings/checklists` | NO |
| QuickBooks | `/settings/quickbooks` | NO |
| Webhooks | `/settings/webhooks` | NO |

The corresponding page components (`ReminderSettings.tsx`, `ChecklistTemplates.tsx`, `QuickBooksExport.tsx`, `WebhookSettings.tsx`) exist in `src/pages/` but are NOT imported in `src/App.tsx` and NOT in `<Routes>`. Clicking any of these settings rows hits the catch-all `<Route path="*" element={<NotFound />}>` at `App.tsx:1134`.

Fix options:
- (a) Add the routes + imports in App.tsx if these features are meant to ship.
- (b) Remove the 4 sidebar items from `Settings.tsx` if the features were intentionally dropped.

Note: server-side, the matching routers (`reminders.ts`, `checklists.ts`, `quickbooks-export.ts`, `webhooks-config.ts`) are all still mounted at `server/index.ts:324, 328, 329, 371` — so backend is live but frontend can't reach them.

### B2. Server still mounts routers for the 4 removed features
File: `server/index.ts:76-80, 327-330, 333-335, 369`
- `bookingRouter` (line 76, mounted 335) — `/api/booking/*`
- `recurringInvoicesRouter` (77, 327) — public surface remains
- `routeOptimizationRouter` (79, 330)
- `campaignsRouter` (45, 369)

The frontend has no UI for these anymore. They're dead public API surface (auth-protected, but still extra attack surface + maintenance cost). Either delete the route files + remove mounts, OR re-add frontend pages. Same applies to `webhooks-config.ts`, `quickbooks-export.ts` (see B1 — backend mounted, frontend page exists but is not routed).

### B3. `useInactivityLogout` AND `useSessionTimeout` both active
File: `src/App.tsx:200, 344`
Both hooks fire on user activity:
- `useSessionTimeout(user?.id || null)` — line 200
- `useInactivityLogout(!!user)` — line 344
Likely duplicate of the same intent (30 min auto signout per CLAUDE.md). Could double-sign-out or compete. Verify only one is needed.

### B4. `Dashboard`, `Leads`, `FieldSales` imports unused in App.tsx (will not 404, but...)
File: `src/App.tsx:47, 51, 126`
- `Dashboard` imported but `/dashboard` route renders `MrLumePage` (line 1057).
- `Leads` imported but `/leads` redirects to `/quotes` (line 1060).
- `FieldSales` imported but `/field-sales` route uses `D2DMap` (line 1110).

Not broken at runtime, but dead imports. The page files (`Dashboard.tsx`, `Leads.tsx`, `FieldSales.tsx`) themselves are unreachable from the app shell.

### B5. `TenantGuard` component exists but is not wrapped around any detail route
File: `src/components/TenantGuard.tsx` (defined), `src/App.tsx:1063, 1065, 1073, 1077`
Detail routes `/clients/:id`, `/jobs/:id`, `/quotes/:id`, `/invoices/:id`, `/notes/:id`, `/courses/:id` rely purely on RLS to block cross-tenant access. RLS should hold, but the project includes a defense-in-depth `TenantGuard` it does not use. If audit hardening listed TenantGuard as a P0/P1 mitigation, the wrap is missing.

### B6. `RecurringJobs.tsx` page is orphaned
File: `src/pages/RecurringJobs.tsx`
The page is fully written and uses `recurringJobsApi`. Not imported, not routed. Either route it (likely `/jobs/recurring`) or delete it. `JobDetails.tsx:42` uses the same API for inline recurrence, so the API itself is live.

---

## 🟠 INCONSISTENT — should fix

### I1. Orphan i18n keys from removed features
File: `src/i18n/en.ts` (and parallel `fr.ts`)
Keys for dropped features still ship in the bundle:
- `nav.campaigns` (line 34), `campaigns.*` block (1612–1634+)
- `nav.bookings` (line 37), `booking.*` block (3218–3289+)
- `nav.recurringInvoices` (line 36), `recurringInvoices.*` (3292+)
- `nav.routeOptimization` (line 682)

User-facing impact: none (no consumer). Bundle bloat + future confusion. Either delete the keys or re-mount the features. Verify both `en.ts` and `fr.ts` are kept in sync.

### I2. `lib/bookingApi.ts` and `lib/routeOptimizationApi.ts` have no consumer
File: `src/lib/bookingApi.ts`, `src/lib/routeOptimizationApi.ts`
- `bookingApi.ts` — only self-references (types used internally). Grep shows zero importers.
- `routeOptimizationApi.ts` — imported only by `src/components/route-optimization/OptimizedRouteMap.tsx`, which is itself imported by nothing.
- `recurringInvoicesApi.ts` — needs verification but likely the same (no UI surface).

Dead client API surface.

### I3. `lib/webhooksApi.ts` referenced only by orphan page
File: `src/lib/webhooksApi.ts` -> `src/pages/WebhookSettings.tsx`
Both alive as files, both unreachable from the app. Same picture for `checklistsApi.ts` (consumed by `ChecklistTemplates.tsx` orphan + `JobChecklistsSection.tsx`, which is reachable from JobDetails — so the JobChecklists in-place feature IS live, just the standalone settings template page is not routed).

### I4. `confirm()` still used in 10 pages despite ConfirmDialog migration
Files (per grep):
- `src/pages/admin/DemoRequests.tsx`
- `src/pages/ClientDetails.tsx`
- `src/pages/Timesheets.tsx`
- `src/pages/Schedule.tsx`
- `src/pages/QuoteDetails.tsx`
- `src/pages/Jobs.tsx`
- `src/pages/JobDetails.tsx`
- `src/pages/Invoices.tsx`
- `src/pages/Leads.tsx`
- `src/pages/InvoiceDetails.tsx`

If `ConfirmDialog` is the standard, these are inconsistent (and look unprofessional under polished branding). Beta-blocker depending on QA bar.

### I5. `/api/booking` public rate limiter mounted but route is dead
File: `server/index.ts:332-335`
The `bookingPublicLimiter` (20 req/min) sits in front of `bookingRouter`. Since the front-end booking surface was removed, this is wasted middleware. Remove with B2.

---

## 🟡 DEAD CODE — safe to clean up

| Path | Why dead | Action |
|---|---|---|
| `src/lib/bookingApi.ts` | No importer | Delete |
| `src/lib/routeOptimizationApi.ts` | Only used by another orphan | Delete with `components/route-optimization/` |
| `src/lib/recurringInvoicesApi.ts` | No UI consumer | Delete (verify first) |
| `src/lib/webhooksApi.ts` | Only used by orphan page | Delete or re-route |
| `src/components/route-optimization/OptimizedRouteMap.tsx` | No importer | Delete |
| `src/pages/RecurringJobs.tsx` | Not routed | Delete or wire route |
| `src/pages/ChecklistTemplates.tsx` | Not routed | Delete or wire route |
| `src/pages/QuickBooksExport.tsx` | Not routed | Delete or wire route |
| `src/pages/ReminderSettings.tsx` | Not routed | Delete or wire route |
| `src/pages/WebhookSettings.tsx` | Not routed | Delete or wire route |
| `src/pages/Dashboard.tsx` | Replaced by MrLumePage at /dashboard | Delete or repurpose |
| `src/pages/Leads.tsx` | `/leads` -> redirect to /quotes | Delete |
| `src/pages/FieldSales.tsx` | `/field-sales` -> uses D2DMap | Delete |
| `src/pages/Availability.tsx` | `/availability` -> redirect to /timesheets | Delete |
| `src/pages/Pipeline.tsx` | `/pipeline` -> redirect to /dashboard | Delete |
| `src/pages/Chat.tsx` | Not routed | Verify, delete |
| `src/pages/QuoteTemplates.tsx` | Replaced by `QuotePresets` at `/quotes/templates` | Delete |
| `server/routes/booking.ts` | Dead public API | Delete + unmount |
| `server/routes/campaigns.ts` | Dead public API | Delete + unmount |
| `server/routes/recurring-invoices.ts` | Dead public API | Delete + unmount |
| `server/routes/route-optimization.ts` | Dead public API | Delete + unmount |
| i18n keys: `nav.campaigns`, `nav.bookings`, `nav.recurringInvoices`, `nav.routeOptimization`, blocks `campaigns.*`, `booking.*`, `recurringInvoices.*` | No consumer | Delete from `en.ts` + `fr.ts` |

---

## 🟢 VERIFIED OK

- **Signup -> demo flow**: `marketing/Contact.tsx` opens `BookDemoForm` modal -> `submitDemoRequest` -> `POST /api/public/book-demo` -> `server/routes/marketing.ts` (mounted at `server/index.ts:368`, rate-limited at :366). Admin views requests at `/platform-admin/demo-requests` (owner-only, `App.tsx:1132`). Flow is coherent.
- **Email verification gate**: `App.tsx:504-523` correctly skips OAuth users (`email_confirmed_at` auto-set), skips during `/auth/callback`, `/apps/callback`, `/verify-email`. Renders `VerifyEmailGate` for unverified email/password users.
- **Subscription guard**: `App.tsx:411-456, 530-544` — proper bypass via `VITE_BETA_BYPASS_EMAILS`, explicit `AccessBlocked` page with reason (`no_membership` | `no_subscription`), `/checkout` + `/checkout/success` + legal pages allowed through. Coherent.
- **Onboarding wizard v2**: `OnboardingWizard.tsx` posts to `/api/onboarding/complete`, `server/routes/onboarding.ts:41` handles profile + org + company_settings + industry presets + invitations atomically.
- **Login + MFA**: `pages/Auth.tsx:42-63` lists factors after sign-in, shows `MfaChallenge` if AAL1 + factors exist. Coherent.
- **Quote -> Job -> Invoice**: `QuoteDetails.tsx:233-239` — `convertQuoteToJob` -> navigate `/jobs/:id`, `convertQuoteToInvoice` -> navigate `/invoices/:id`. Status-gated on `quote.status === 'converted'`.
- **Client details tabs** (`ClientDetails.tsx`): tabs `active`, `completed`, `jobs`, `invoices`, `quotes`, `leads`, `specific_notes` all branch in JSX (lines 768-921).
- **Realtime SMS unread badge** + permissions filter for nav (`App.tsx:712-716`): correct CompanyProvider scoping.
- **Sidebar route coherence (excluding settings sub-tabs)**: every sidebar `path` in `App.tsx:665-723` resolves to a real `<Route>` in the Routes block. Permissions on nav match permissions on the route in every spot-check (clients, quotes, invoices, jobs, calendar, messages, timesheets, courses, payments, d2d-*, leaderboard, commissions, insights, tasks, automations, marketplace, platform-admin).

---

## Priority recommendation

For a beta launch the only true 🔴 blocker is **B1** (four broken settings rows). **B5** (TenantGuard not applied) matters if your hardening plan committed to it. **B2/B3/B4/B6** are silent/cosmetic at runtime but should be cleaned to avoid future confusion. All 🟠 and 🟡 can be deferred to a post-launch cleanup PR.
