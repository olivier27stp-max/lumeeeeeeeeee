# LUME CRM — Full Production-Readiness Audit

**Date:** 2026-03-05
**Auditor:** Principal Full-Stack Engineer + Supabase Security Auditor
**Scope:** Full codebase review (frontend + Express API + Supabase backend)

---

## I. CURRENT STATE MAP

### Framework & Stack
- **Frontend:** React 19 + Vite + TailwindCSS 4 + React Router 7 + TanStack Query 5
- **Backend:** Express 4 API server (`server/index.ts`, ~2500 lines)
- **Database:** Supabase (PostgreSQL + RLS + 53+ RPCs)
- **Payments:** Stripe + PayPal (per-org keys, encrypted at rest)
- **Maps:** Leaflet + react-leaflet
- **Calendar:** FullCalendar + @dnd-kit drag-and-drop
- **Build:** Vite SPA (no SSR)

### Key Routes (src/App.tsx)
| Route | Page | Status |
|-------|------|--------|
| `/dashboard` | Dashboard | Working |
| `/pipeline` | Pipeline (Kanban) | Working |
| `/leads` | Leads CRUD | Mostly working |
| `/clients` | Clients CRUD | Mostly working |
| `/clients/:id` | Client detail | Working |
| `/jobs` | Jobs list | Working |
| `/jobs/:id` | Job detail | Working |
| `/schedule` | Calendar/Schedule | Working |
| `/calendar` | **Duplicate** of /schedule | Redundant |
| `/invoices` | Invoices list | Working |
| `/invoices/:id` | Invoice detail | Working |
| `/insights` | Analytics | Partially working |
| `/payments` | Payments & Payouts | Working |
| `/payment-settings` | Stripe/PayPal config | Working |
| `/tasks` | Task manager | Working (basic) |
| `/settings` | Settings | **NON-FUNCTIONAL** |
| `/search` | Search results | Working |

### Supabase Tables Used in Code
| Table | Files that query it |
|-------|-------------------|
| `profiles` | dashboardApi.ts, jobsApi.ts, Settings.tsx |
| `clients` / `clients_active` | clientsApi.ts, jobsApi.ts, invoicesApi.ts, dashboardApi.ts, pipelineApi.ts |
| `leads` / `leads_active` | leadsApi.ts, pipelineApi.ts, jobsApi.ts, Tasks.tsx |
| `jobs` / `jobs_active` | jobsApi.ts, scheduleApi.ts, dashboardApi.ts, insightsApi.ts, pipelineApi.ts |
| `job_line_items` | jobsApi.ts |
| `schedule_events` | scheduleApi.ts, dashboardApi.ts, pipelineApi.ts |
| `pipeline_deals` | pipelineApi.ts, dashboardApi.ts |
| `teams` | teamsApi.ts, scheduleApi.ts, insightsApi.ts |
| `invoices` / `invoice_items` | invoicesApi.ts |
| `invoice_templates` | invoicesApi.ts |
| `org_billing_settings` | invoicesApi.ts |
| `payments` | (server-side only) |
| `payment_provider_settings` | (server-side only) |
| `payment_provider_secrets` | stripeClient.ts, paypalClient.ts |
| `memberships` | jobsApi.ts |
| `tasks` | Tasks.tsx |
| `job_intents` | pipelineApi.ts |
| `contacts` | (used by RPCs) |
| `availabilities` | (used by RPCs) |
| `notifications` | (schema only, no UI reads) |
| `audit_events` | (written by RPCs) |

### RPCs Used in Code
| RPC | File |
|-----|------|
| `current_org_id` | orgApi, dashboardApi, jobsApi, clientsApi, pipelineApi, scheduleApi |
| `rpc_create_job_with_optional_schedule` | jobsApi |
| `rpc_schedule_job` | jobsApi, scheduleApi, pipelineApi |
| `rpc_reschedule_event` | scheduleApi |
| `rpc_unschedule_job` | jobsApi, scheduleApi |
| `create_pipeline_deal` | pipelineApi |
| `set_deal_stage` | pipelineApi |
| `create_job_from_intent` | pipelineApi |
| `get_available_slots` | pipelineApi |
| `delete_lead_and_optional_client` | pipelineApi |
| `convert_lead_to_client` | leadsApi |
| `create_client_with_duplicate_handling` | clientsApi |
| `soft_delete_job` | jobsApi |
| `soft_delete_client` | clientsApi |
| `delete_client_cascade` | clientsApi |
| `rpc_invoices_kpis_30d` | invoicesApi |
| `rpc_list_invoices` | invoicesApi |
| `rpc_create_invoice_draft` | invoicesApi |
| `rpc_save_invoice_draft` | invoicesApi |
| `finish_job_and_prepare_invoice` | invoicesApi |
| `send_invoice` | invoicesApi |
| `rpc_payments_overview_kpis` | paymentsApi |
| `rpc_list_payments` | paymentsApi |
| `rpc_insights_overview` | insightsApi |
| `rpc_insights_revenue_series` | insightsApi |
| `rpc_insights_lead_conversion` | insightsApi |
| `rpc_insights_invoices_summary` | insightsApi |

---

## II. TOP ISSUES (Prioritized)

---

### P0 — Critical / Blocks Core Functionality

---

#### P0-1: Missing `profiles` table — Dashboard, Jobs, Settings all break

**Symptom:** Dashboard shows "User" instead of name, Settings page shows nothing, salesperson dropdown is empty.

**Proof:**
- `src/lib/dashboardApi.ts:135` → `.from('profiles').select('full_name,avatar_url,company_name')`
- `src/lib/jobsApi.ts:714` → `.from('profiles').select('id, full_name')`
- `src/pages/Settings.tsx:29` → `.from('profiles').select('*')`
- **No `CREATE TABLE profiles` exists in any migration file.**

**Root cause:** The `profiles` table is expected to exist (commonly auto-created by Supabase Auth trigger) but is not in the migrations. If the Supabase project doesn't have it, all these queries return errors.

**Fix:** Add to migration (see Section III).

**Test:** After migration, verify Settings page loads profile data; verify salesperson dropdown in NewJobModal shows team members.

---

#### P0-2: Missing `invoice_templates` table — Invoice preview/send breaks

**Symptom:** `listInvoiceTemplates()` throws a PostgREST error. The InvoicePreviewModal cannot load templates.

**Proof:**
- `src/lib/invoicesApi.ts:453-461` → `.from('invoice_templates').select('id,name,content,is_default,updated_at')`
- **No `CREATE TABLE invoice_templates` exists in any migration file.**

**Root cause:** Table never created.

**Fix:** Add to migration (see Section III).

**Test:** Open InvoicePreviewModal → template dropdown should load without errors.

---

#### P0-3: Missing `org_billing_settings` table — Invoice preview breaks

**Symptom:** `getOrgBillingSettings()` throws a PostgREST error.

**Proof:**
- `src/lib/invoicesApi.ts:464-468` → `.from('org_billing_settings').select('*').maybeSingle()`
- **No `CREATE TABLE org_billing_settings` exists in any migration file.**

**Root cause:** Table never created.

**Fix:** Add to migration (see Section III).

**Test:** Open InvoicePreviewModal → billing settings load without error.

---

#### P0-4: Settings page is a non-functional mockup — 6 dead buttons, no save

**Symptom:** Users click "Change Avatar", "Enable" (2FA), "Upgrade", "Manage in Stripe Portal", or Dark Mode toggle — nothing happens. Profile name changes are discarded on navigation (no save button).

**Proof:**
- `src/pages/Settings.tsx:91` → `<button>Change Avatar</button>` — no `onClick`
- `src/pages/Settings.tsx:117` → `<button>Enable</button>` — no `onClick`
- `src/pages/Settings.tsx:169` → `<button>Upgrade</button>` — no `onClick`
- `src/pages/Settings.tsx:177-179` → "Manage in Stripe Portal" — no `onClick`
- `src/pages/Settings.tsx:213-215` → Dark Mode toggle — CSS-only, no state/handler
- `src/pages/Settings.tsx:98` → `<input defaultValue={profile?.full_name}>` — uncontrolled, no save

**Root cause:** Page was designed as a UI mockup and never wired up.

**Fix:** Either: (a) Wire up profile save with `supabase.from('profiles').update(...)` and add handlers, or (b) Display "Coming Soon" banners on unimplemented features so users aren't confused. Minimum viable fix below.

---

#### P0-5: No CORS middleware on Express server — API calls fail in production

**Symptom:** All `/api/*` calls from the frontend fail with CORS errors when frontend and API are on different origins.

**Proof:** `server/index.ts` — no `cors()` middleware import or usage anywhere in the file. The Vite proxy handles this in dev, but in production (separate origins), CORS headers are missing.

**Root cause:** Express server was only tested behind Vite's dev proxy.

**Fix:**
```bash
npm install cors @types/cors
```
```typescript
// server/index.ts — add at top after imports
import cors from 'cors';

// After const app = express();
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
```

**Test:** Deploy frontend and API on separate origins → API calls should succeed.

---

#### P0-6: `searchActiveClients()` broken filter logic — wrong clients shown in invoice creation

**Symptom:** When creating an invoice, the client search may return inactive/deleted clients, or the search filter may not work at all.

**Proof:** `src/lib/invoicesApi.ts:234-239`:
```typescript
// First .or() — search filter
request = request.or(`first_name.ilike.%${safe}%,...`);
// Second .or() — status filter (REPLACES first .or() context!)
request = request.or('status.is.null,status.eq.active,status.eq.Active');
```

**Root cause:** Two consecutive `.or()` calls in Supabase don't combine — the second one replaces the filter context. The result is that either search is ignored OR status filter is ignored.

**Fix:** Combine into a single filter using PostgREST `and()`:
```typescript
// src/lib/invoicesApi.ts — replace lines 231-239 with:
const q = query.q.trim();
const statusFilter = 'status.is.null,status.eq.active,status.eq.Active';
if (q) {
  const safe = q.replace(/,/g, ' ');
  const searchFilter = `first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,company.ilike.%${safe}%,email.ilike.%${safe}%`;
  request = request.or(searchFilter).or(statusFilter);
  // Actually, the correct approach is:
  // request = request.or(statusFilter).or(searchFilter);
  // But PostgREST .or() always applies to the top-level.
  // The real fix is to use the view `clients_active` (which already filters deleted)
  // and only apply the search .or():
}
// Since clients_active already excludes deleted_at IS NOT NULL,
// and the status filter is about 'active' vs 'lead' vs 'inactive',
// the simplest correct fix:
if (q) {
  const safe = q.replace(/,/g, ' ');
  request = request.or(
    `first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,company.ilike.%${safe}%,email.ilike.%${safe}%`
  );
}
request = request.in('status', ['active', 'Active', null]);
```

Better fix using `.in()` for status and `.or()` for search only:
```typescript
// Replace lines 231-239 in invoicesApi.ts:
const q = query.q.trim();
if (q) {
  const safe = q.replace(/,/g, ' ');
  request = request.or(
    `first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,company.ilike.%${safe}%,email.ilike.%${safe}%`
  );
}
// status filter — use .or() only once; clients_active already excludes soft-deleted
request = request.or('status.is.null,status.eq.active');
```

**Test:** Create invoice → search for a client by name → verify only active clients appear.

---

#### P0-7: `normalizeStatusValue()` makes Jobs KPIs always zero

**Symptom:** The "Late", "Requires Invoicing", and "Action Required" KPI counters on the Jobs page always show 0.

**Proof:** `src/lib/jobsApi.ts:99-116`:
```typescript
function normalizeStatusValue(status: string): string {
  // ...
  if (normalized === 'late' || normalized === 'action_required' ...) return 'draft';
  if (normalized === 'requires_invoicing') return 'completed';
}
```
Then in `getJobsKpis()` (line 274-276):
```typescript
const late = jobs.filter(j => normalizeStatusValue(j.status) === 'late').length; // always 0!
const requiresInvoicing = jobs.filter(j => normalizeStatusValue(j.status) === 'requires_invoicing').length; // always 0!
```

**Root cause:** `normalizeStatusValue('late')` returns `'draft'`, never `'late'`. So filtering for `'late'` always returns 0. Same for `requires_invoicing` and `action_required`.

**Fix:** In `getJobsKpis()`, filter on the RAW status, not the normalized one:
```typescript
// src/lib/jobsApi.ts — replace lines 271-276:
const rawStatuses = (data || []).map((row: any) => ({
  ...mapJob(row),
  _rawStatus: String(row.status || '').toLowerCase(),
}));

const late = rawStatuses.filter(j => j._rawStatus === 'late').length;
const requiresInvoicing = rawStatuses.filter(j => j._rawStatus === 'requires_invoicing').length;
const actionRequired = rawStatuses.filter(j => j._rawStatus === 'action_required').length;
```

However, the DB constraint on `jobs.status` only allows `('draft','scheduled','in_progress','completed','cancelled')`. These KPI statuses (`late`, `requires_invoicing`, `action_required`) don't exist in the DB at all. This means:

**The real root cause:** These KPIs are for statuses that **cannot exist** in the database due to the CHECK constraint. Either:
- (a) Add these statuses to the CHECK constraint, OR
- (b) Derive them from other fields (e.g., `late` = scheduled but past due; `requires_invoicing` = completed + `requires_invoicing = true`; `action_required` = custom logic)

**Recommended fix (option b):**
```typescript
const late = jobs.filter(j => {
  const raw = String((data || [])[jobs.indexOf(j)]?.status || '');
  return raw === 'scheduled' && j.scheduled_at && new Date(j.scheduled_at) < now;
}).length;
const requiresInvoicing = jobs.filter(j => j.requires_invoicing && normalizeStatusValue(j.status) === 'completed').length;
const actionRequired = 0; // Define business rule
```

**Test:** Create a completed job with `requires_invoicing = true` → KPI "Requires Invoicing" should show 1.

---

### P1 — High Priority

---

#### P1-1: Dashboard queries run unscoped if `current_org_id()` fails

**Symptom:** If the `current_org_id` RPC fails or returns null, the dashboard shows data from ALL organizations (filtered only by RLS).

**Proof:** `src/lib/dashboardApi.ts:119-123`:
```typescript
async function getCurrentOrgId(): Promise<string | null> {
  const { data, error } = await supabase.rpc('current_org_id');
  if (error) return null; // Swallows error!
  return (data as string | null) || null;
}
```
Then line 173: `if (orgId) { /* apply filters */ }` — if null, no org filter is applied.

**Root cause:** Error swallowing + conditional filter application.

**Fix:**
```typescript
// src/lib/dashboardApi.ts — replace getCurrentOrgId:
async function getCurrentOrgId(): Promise<string> {
  const { data, error } = await supabase.rpc('current_org_id');
  if (error) throw new Error('Failed to resolve organization context.');
  const orgId = (data as string | null) || null;
  if (!orgId) throw new Error('No organization context found. Please refresh.');
  return orgId;
}
```

**Test:** Verify dashboard shows only current org's data.

---

#### P1-2: `insightsApi.fetchInsightsJobsSummary()` has NO org_id filter — cross-org data leak

**Symptom:** Insights "Jobs" tab shows jobs from ALL organizations.

**Proof:** `src/lib/insightsApi.ts:153-161`:
```typescript
supabase.from('jobs').select('id,team_id,scheduled_at,status')
  .is('deleted_at', null)
  .gte('created_at', fromIso)
  .lt('created_at', toIsoExclusive)
// No .eq('org_id', ...) anywhere!

supabase.from('teams').select('id,name').is('deleted_at', null)
// No .eq('org_id', ...) either!
```

**Root cause:** Only function in insightsApi that uses direct queries instead of RPCs, and org_id filter was forgotten.

**Fix:**
```typescript
// src/lib/insightsApi.ts — add org_id filtering
import { getCurrentOrgIdOrThrow } from './orgApi';

export async function fetchInsightsJobsSummary(params: { from: string; to: string }): Promise<InsightsJobsSummary> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { fromIso, toIsoExclusive } = toIsoRange(params.from, params.to);

  const [{ data: jobsRows, error: jobsError }, { data: teamsRows, error: teamsError }] = await Promise.all([
    supabase.from('jobs').select('id,team_id,scheduled_at,status')
      .eq('org_id', orgId) // ADD THIS
      .is('deleted_at', null)
      .gte('created_at', fromIso)
      .lt('created_at', toIsoExclusive),
    supabase.from('teams').select('id,name')
      .eq('org_id', orgId) // ADD THIS
      .is('deleted_at', null),
  ]);
  // ... rest unchanged
}
```

**Test:** With 2+ orgs, verify Insights Jobs tab only shows current org data.

---

#### P1-3: `getJobsKpis()` loads ALL jobs into memory — performance bomb

**Symptom:** Jobs page becomes extremely slow as the database grows. Browser may crash with thousands of jobs.

**Proof:** `src/lib/jobsApi.ts:266`:
```typescript
let request = supabase.from('jobs_active').select('*'); // No limit!
```

**Root cause:** KPIs are computed client-side by fetching every single job.

**Fix:** Use the existing `get_job_kpis` RPC that already exists in the database:
```typescript
export async function getJobsKpis(params: { status?: string; jobType?: string; q?: string }): Promise<JobsKpis> {
  const { data: orgId } = await supabase.rpc('current_org_id');
  const { data, error } = await supabase.rpc('get_job_kpis', {
    p_org_id: orgId,
    p_status: params.status || null,
    p_job_type: params.jobType || null,
    p_q: params.q || null,
  });
  if (error) throw error;
  // Map RPC result to JobsKpis interface
  const row = Array.isArray(data) ? data[0] : data;
  return { /* map fields */ };
}
```

Alternatively, add `.limit(5000)` as an immediate safeguard while refactoring.

**Test:** Seed 10,000+ jobs → Jobs page should still load quickly.

---

#### P1-4: `getJobTypes()` loads all jobs to extract distinct types — no limit

**Symptom:** Slow page load on Jobs page filter dropdown.

**Proof:** `src/lib/jobsApi.ts:297`:
```typescript
const { data } = await supabase.from('jobs_active').select('job_type').not('job_type', 'is', null);
// No limit — fetches every row
```

**Fix:** Add `.limit(500)` or create a server-side distinct query.

---

#### P1-5: Supabase client created with placeholder credentials on missing env vars

**Symptom:** App loads but all Supabase calls silently fail with network errors. No clear error message to the user.

**Proof:** `src/lib/supabase.ts:14-17`:
```typescript
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key'
);
```

**Root cause:** Instead of throwing, fallback values create a client that makes requests to a non-existent URL.

**Fix:**
```typescript
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Check your .env file.');
}
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

---

#### P1-6: Currency default mismatch across codebase

**Symptom:** Amounts may display as CAD in some places and USD in others for the same data.

**Proof:**
- `src/lib/invoicesApi.ts:132` → `formatMoneyFromCents(cents, currency = 'USD')`
- `src/lib/paymentsApi.ts` → `formatMoneyFromCents` defaults to `'CAD'`
- `server/index.ts` → `insertOrUpdatePaymentIdempotent` defaults to `'CAD'`
- `server/index.ts` → `normalizeCurrency` defaults to `'USD'`
- `server/index.ts` → `buildPayPalPayoutSummary` hardcodes `'USD'`
- DB `jobs.currency` defaults to `'CAD'`, `payments.currency` defaults to `'CAD'`

**Root cause:** No single source of truth for default currency.

**Fix:** Standardize to `'CAD'` (matches DB defaults):
```typescript
// src/lib/invoicesApi.ts:132
export function formatMoneyFromCents(cents: number, currency = 'CAD') {

// server/index.ts — normalizeCurrency:
return (raw || 'CAD').toUpperCase().trim();

// server/index.ts — buildPayPalPayoutSummary:
// Replace hardcoded 'USD' with org currency from DB
```

---

#### P1-7: `pipelineApi.ts` — `createQuickScheduleEvent()` missing org_id

**Symptom:** Schedule events created from the pipeline drawer may not have an org_id, causing them to be invisible to RLS-filtered queries.

**Proof:** `src/lib/pipelineApi.ts` — the insert payload for `schedule_events` does not include `org_id`.

**Root cause:** The `crm_enforce_scope` trigger should set `org_id` on insert via `current_org_id()`, so this may work if the trigger is active. However, if `current_org_id()` returns NULL (new user, no membership), the event will have a NULL org_id and be orphaned.

**Fix:** Pass `org_id` explicitly:
```typescript
const orgId = await getCurrentOrgIdOrThrow();
// Include org_id in insert payload
```

---

#### P1-8: `pipelineApi.getPipelineDealById()` returns soft-deleted deals

**Symptom:** Clicking on a deal that was recently deleted still opens the drawer with stale data.

**Proof:** `src/lib/pipelineApi.ts` — `getPipelineDealById()` does NOT filter `.is('deleted_at', null)`, while `listPipelineDeals()` does.

**Fix:** Add `.is('deleted_at', null)` to `getPipelineDealById()`.

---

#### P1-9: Clients page KPIs computed from current page only

**Symptom:** The "Total Clients", "Active", etc. cards change as users paginate, showing misleading counts.

**Proof:** `src/pages/Clients.tsx` — KPI values are derived from `clients` query data (paginated), not from a separate total count query.

**Fix:** Add a separate KPI query that counts all clients (with filters), or use the `count` value from the paginated query for the total and run a separate `.select('status', { count: 'exact' }).eq('status', 'active')` etc.

---

#### P1-10: Leads page — MoreVertical (⋮) button has no handler

**Symptom:** Per-row action menu button renders but does nothing on click.

**Proof:** `src/pages/Leads.tsx` — The `<MoreVertical>` icon is rendered without an `onClick` prop.

**Fix:** Either add a dropdown menu with actions (Edit, Delete, Convert), or remove the button.

---

### P2 — Medium Priority

---

#### P2-1: `buildSearchFilter()` doesn't escape LIKE wildcards

**Files:** `src/lib/jobsApi.ts:198-207`, `src/lib/clientsApi.ts`, `src/lib/leadsApi.ts`

**Symptom:** A user searching for `%` or `_` gets all results instead of matching the literal character.

**Fix:** Escape special chars: `search.replace(/%/g, '\\%').replace(/_/g, '\\_')`

---

#### P2-2: Webhook signature verification uses global keys, not per-org

**Files:** `server/index.ts` lines 31, 2487-2510

**Symptom:** If orgs have different Stripe/PayPal accounts, webhook verification will fail for all but the global-key org.

**Fix:** Look up the org from the webhook payload, then verify against that org's stored webhook secret.

---

#### P2-3: Error details leak to API clients

**File:** `server/index.ts` — many `catch` blocks return `error?.message` directly.

**Fix:** Return generic messages to clients; log details server-side.

---

#### P2-4: `userId === orgId` authorization shortcut

**File:** `server/index.ts` lines 198, 216

**Symptom:** `isOrgMember` and `isOrgAdminOrOwner` treat `userId === orgId` as auto-authorized.

**Risk:** If a user creates an org with their own user ID as the org ID, they bypass membership checks.

**Fix:** Remove this shortcut or validate that the org actually exists.

---

#### P2-5: `geocodeApi.ts` — fire-and-forget with no error handling

**File:** `src/lib/geocodeApi.ts`

**Fix:** Check `response.ok` and surface errors.

---

#### P2-6: `JobDetails.tsx` — "Send via SMS" button is misleading

**File:** `src/pages/JobDetails.tsx`

**Fix:** Rename to "View Invoice" or "Copy Link".

---

#### P2-7: Duplicate `/calendar` and `/schedule` routes

**File:** `src/App.tsx`

**Fix:** Remove `/calendar` or redirect it to `/schedule`.

---

#### P2-8: Legacy/unused components: `EditJobModal.tsx`, `JobDetailsModal.tsx`

**Files:** `src/components/EditJobModal.tsx`, `src/components/JobDetailsModal.tsx`

**Risk:** Confusing for developers; hardcoded team names in EditJobModal.

**Fix:** Delete both files if confirmed unused.

---

#### P2-9: `index.html` title says "My Google AI Studio App"

**File:** `index.html:5`

**Fix:** Change to `<title>LUME CRM</title>`.

---

#### P2-10: Dashboard bell icon (notifications) has no handler

**File:** `src/pages/Dashboard.tsx`

**Fix:** Either wire up notifications panel or remove the bell icon.

---

#### P2-11: Mixed French/English UI text

**Files:** `src/pages/Leads.tsx` (sort labels "Plus récent"/"Plus ancien"), `src/lib/supabase.ts` (console error in French)

**Fix:** Standardize to English.

---

#### P2-12: `Tasks.tsx` uses direct Supabase calls instead of lib/ pattern

**File:** `src/pages/Tasks.tsx`

**Risk:** Inconsistent patterns, no org_id filtering (relies solely on RLS), no pagination.

**Fix:** Extract to `lib/tasksApi.ts`, add org_id filter, add pagination.

---

#### P2-13: No rate limiting on payment endpoints

**File:** `server/index.ts`

**Risk:** Payment intent/order creation can be abused.

**Fix:** Add rate limiting middleware (e.g., `express-rate-limit`) on `/api/payments/*` routes.

---

## III. SQL MIGRATION — Missing Pieces

> **IMPORTANT:** This migration only ADDS what's missing. It does NOT drop or modify existing tables.

```sql
-- Migration: 20260305240000_missing_tables_and_fixes.sql
-- Purpose: Add tables referenced in code but missing from schema

BEGIN;

-- ============================================================
-- 1. profiles table (referenced by dashboardApi, jobsApi, Settings)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name  text,
  avatar_url text,
  company_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users can read any profile in their org (for salesperson dropdown)
CREATE POLICY profiles_select_own ON public.profiles FOR SELECT
  USING (id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.memberships m1
    JOIN public.memberships m2 ON m1.org_id = m2.org_id
    WHERE m1.user_id = auth.uid() AND m2.user_id = profiles.id
  ));

CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY profiles_insert_own ON public.profiles FOR INSERT
  WITH CHECK (id = auth.uid());

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    COALESCE(NEW.raw_user_meta_data ->> 'avatar_url', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Only create trigger if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created'
  ) THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END;
$$;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS trg_profiles_set_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 2. invoice_templates table (referenced by invoicesApi)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.invoice_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL DEFAULT public.current_org_id(),
  name       text NOT NULL,
  content    jsonb NOT NULL DEFAULT '{}',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE public.invoice_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY invoice_templates_select_org ON public.invoice_templates FOR SELECT
  USING (public.has_org_membership(auth.uid(), org_id));
CREATE POLICY invoice_templates_insert_org ON public.invoice_templates FOR INSERT
  WITH CHECK (public.has_org_membership(auth.uid(), org_id));
CREATE POLICY invoice_templates_update_org ON public.invoice_templates FOR UPDATE
  USING (public.has_org_membership(auth.uid(), org_id));
CREATE POLICY invoice_templates_delete_org ON public.invoice_templates FOR DELETE
  USING (public.has_org_membership(auth.uid(), org_id));

DROP TRIGGER IF EXISTS trg_invoice_templates_set_updated_at ON public.invoice_templates;
CREATE TRIGGER trg_invoice_templates_set_updated_at
  BEFORE UPDATE ON public.invoice_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 3. org_billing_settings table (referenced by invoicesApi)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.org_billing_settings (
  org_id       uuid PRIMARY KEY,
  company_name text,
  address      text,
  email        text,
  phone        text,
  logo_url     text,
  tax_number   text,
  footer_note  text,
  currency     text NOT NULL DEFAULT 'CAD',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.org_billing_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_billing_settings_select_org ON public.org_billing_settings FOR SELECT
  USING (public.has_org_membership(auth.uid(), org_id));
CREATE POLICY org_billing_settings_insert_admin ON public.org_billing_settings FOR INSERT
  WITH CHECK (public.has_org_admin_role(auth.uid(), org_id));
CREATE POLICY org_billing_settings_update_admin ON public.org_billing_settings FOR UPDATE
  USING (public.has_org_admin_role(auth.uid(), org_id));

DROP TRIGGER IF EXISTS trg_org_billing_settings_set_updated_at ON public.org_billing_settings;
CREATE TRIGGER trg_org_billing_settings_set_updated_at
  BEFORE UPDATE ON public.org_billing_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 4. Backfill profiles for existing auth users
-- ============================================================
INSERT INTO public.profiles (id, full_name, avatar_url)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data ->> 'full_name', ''),
  COALESCE(u.raw_user_meta_data ->> 'avatar_url', '')
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 5. Missing RLS on audit_events (write-only, no direct reads)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'audit_events' AND policyname = 'audit_events_select_org'
  ) THEN
    ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
    CREATE POLICY audit_events_select_org ON public.audit_events FOR SELECT
      USING (public.has_org_membership(auth.uid(), org_id));
    CREATE POLICY audit_events_insert_org ON public.audit_events FOR INSERT
      WITH CHECK (public.has_org_membership(auth.uid(), org_id));
  END IF;
END;
$$;

-- ============================================================
-- 6. Ensure invoices has currency column (referenced in code)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'currency'
  ) THEN
    ALTER TABLE public.invoices ADD COLUMN currency text NOT NULL DEFAULT 'CAD';
  END IF;
END;
$$;

COMMIT;
```

---

## IV. DEPLOYMENT CHECKLIST

### Supabase Configuration

- [ ] **Run migration** `20260305240000_missing_tables_and_fixes.sql` in SQL Editor
- [ ] **Auth settings:**
  - Site URL → your production frontend URL
  - Redirect URLs → add production callback URL
  - Disable email confirmation if testing, enable for production
  - Enable Google OAuth provider (used in Auth.tsx)
- [ ] **RLS verification** — run in SQL Editor:
```sql
-- Verify all tables have RLS enabled
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename NOT LIKE 'pg_%'
ORDER BY tablename;

-- Verify every table with data has at least one policy
SELECT t.tablename, COUNT(p.policyname) as policy_count
FROM pg_tables t
LEFT JOIN pg_policies p ON t.tablename = p.tablename AND t.schemaname = p.schemaname
WHERE t.schemaname = 'public'
GROUP BY t.tablename
HAVING COUNT(p.policyname) = 0;
```
- [ ] **Storage:** Verify `client_files` bucket exists if file uploads are planned
- [ ] **Realtime:** Verify `job_intents` and `notifications` are in the realtime publication
- [ ] **Edge Functions:** None used — N/A
- [ ] **pg_cron:** Verify `cleanup_lost_pipeline_deals_daily` and `cleanup_lost_leads_10d_daily` are active

### Frontend Deployment

- [ ] **Environment variables** (Vercel/Netlify dashboard):
  - `VITE_SUPABASE_URL` — your Supabase project URL
  - `VITE_SUPABASE_ANON_KEY` — your Supabase anon/public key
  - `GEMINI_API_KEY` — (if AI features used)
- [ ] **Build command:** `npm run build` (outputs to `dist/`)
- [ ] **Publish directory:** `dist`
- [ ] **SPA fallback:** Configure `/*` → `index.html` rewrite (Vercel: vercel.json, Netlify: _redirects)
- [ ] **Fix `index.html` title:** "LUME CRM" instead of "My Google AI Studio App"
- [ ] **No localhost callbacks:** Verify Supabase Auth redirect URLs don't include localhost

### Express API Deployment

- [ ] **Environment variables:**
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `PAYMENTS_ENCRYPTION_KEY`
  - `STRIPE_SECRET_KEY` (global, for webhook verification)
  - `STRIPE_WEBHOOK_SECRET`
  - `PAYPAL_CLIENT_ID` (global, for webhook verification)
  - `PAYPAL_SECRET`
  - `API_PORT` (default: 3001)
  - `FRONTEND_URL` (for CORS)
  - `NOMINATIM_BASE_URL` (for geocoding)
- [ ] **Install CORS:** `npm install cors @types/cors` and add middleware
- [ ] **No localhost in Stripe/PayPal webhook URLs**
- [ ] **Deployment target:** Ensure Express runs on a persistent server (not serverless/edge)

### Smoke Tests (10 actions to verify in UI)

1. [ ] **Sign up** → creates profile row → redirects to Dashboard
2. [ ] **Dashboard loads** → shows user name, KPI cards, today's map
3. [ ] **Create a lead** (Pipeline → Quick Add) → appears in Qualified column
4. [ ] **Drag deal** from Qualified → Closed → job intent created → job creation prompt
5. [ ] **Create a job** (Jobs → New Job) → fills title, client, schedule, line items → saves successfully
6. [ ] **Schedule a job** (Schedule → drag unscheduled job to calendar) → event appears
7. [ ] **Complete a job** (Job Details → change status to Completed) → invoice creation prompt
8. [ ] **Create an invoice** (Invoices → Create Invoice) → select client → add items → save draft
9. [ ] **Pay an invoice** (Invoice Details → Pay Now) → Stripe/PayPal flow completes
10. [ ] **Settings page** → displays profile info (after P0-4 fix)

---

## V. SUMMARY

| Priority | Count | Impact |
|----------|-------|--------|
| **P0** | 7 | Blocks core features or causes data errors |
| **P1** | 10 | Degraded experience, performance, or security |
| **P2** | 13 | UX issues, code quality, minor risks |
| **Total** | **30** | |

**Top 3 actions to unblock production:**
1. Run the SQL migration to create `profiles`, `invoice_templates`, `org_billing_settings`
2. Add CORS to Express server
3. Fix `searchActiveClients()` broken filter and `normalizeStatusValue()` KPI bug
