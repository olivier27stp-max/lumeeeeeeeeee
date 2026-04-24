# Code audit — Lume CRM

**Generated:** 2026-04-22
**Purpose:** honest snapshot of the codebase for the incoming developer.
Written by a coding agent during the hardening sprint on branch
`chore/hardening-2026-04-22`. Every finding is backed by a file:line
reference or a specific grep; nothing is decorative.

---

## TL;DR

Five axes were audited: code quality, security, architecture, tests,
dependencies. Ratings are not self-congratulation — they map to what a
senior reviewer will say out loud on day one.

| Axis | After this sprint | What still hurts |
|---|---|---|
| Security (code paths) | 9 / 10 | `/api/auth/*` needs a dedicated rate-limiter; Sentry handler is mounted after the global error handler |
| Dependencies | 9 / 10 | mapbox-gl vs leaflet duplication is a design call |
| Code quality | 7 / 10 | ~1,300 `any` across src+server; page-level `supabase.from(...)` bypasses the lib/* service layer |
| Architecture | 6 / 10 | Page-level god components (FieldSales 2304 LOC, NewJobModal 1498, App 1042) |
| Tests | 4 / 10 | Only 5 of 12 test files exercise real source; zero UI tests; zero Stripe/Twilio mocks |

**Compliance (Law 25 / PIPEDA / GDPR):** dispositif technique livré.
Final humain-only items: signed EFVP, named DPO, 24/7 on-call, subprocessor
list — all present in `docs/legal/`.

---

## What was done in the hardening sprint

Commits land on `chore/hardening-2026-04-22` in this order:

| Commit | Scope |
|---|---|
| `16ffd59` | Purge hardcoded Supabase keys from 7 qa/test scripts → `process.env` only, with fail-fast. Add `.gitignore` guard. |
| `f65702e` | Extract pure scheduler helpers to `server/lib/scheduler-utils.ts`; rewrite `tests/automation/scheduler.test.ts` to import the real source (21 tests against production code). |
| `baa5006` | Extract `PublicRoutes`, `TokenRoutes`, `useInactivityLogout`, `useCommandPaletteShortcut` from `App.tsx` (1149 → 1042 LOC). |
| `c12b767` | Move `supabaseAdmin.ts` from `src/lib/` to `server/lib/` to prevent service_role key leaking into the Vite bundle. |
| `a1b76ab` | Drop dead deps (`better-sqlite3`, `@google/genai`, `resend`); move `vite` / `@types/*` to devDependencies; add `engines.node`, `npm test` script, rename `react-example@0.0.0` → `lume-crm@0.1.0`; `npm audit` → 0 vulnerabilities. |
| `506468f` | Add `src/lib/safeStorage.ts`, `vitest.config.ts`, `tsconfig.server.json`; turn on three low-risk TS strict flags. |
| `2427459` | Finalize `subprocessor_list.md` (add Railway, drop Resend) and the CAI notification template. |
| `c52e5da` | Add `.github/workflows/ci.yml` — lint + test + prod audit on every PR. |

**Action required out-of-band (the code can't do this):** rotate the four
Supabase tokens that were in the purged scripts. The full values remain
in git history on `lume/main` at commits touching the qa-seed/qa-cleanup/
qa-fix/test-full-flow/test-full-system scripts — grep `sbp_` in that
history to find them. Then go to
<https://supabase.com/dashboard/account/tokens> and revoke the three
management tokens (prefixed `sbp_70d8ff…`, `sbp_77cb06…`, `sbp_7399ae…`),
plus regenerate the service_role key in Settings → API.

---

## Priority backlog for the incoming dev

### P0 — Finish the security rotation (out-of-band, not code)

1. Rotate the four Supabase keys listed above.
2. Confirm `Sentry.errorHandler()` is registered **before** the global
   Express error handler in `server/index.ts` (audit flagged it mounted
   after, so Sentry never sees the exceptions).
3. Add a dedicated rate-limiter on `/api/auth/*` (register, verify-email,
   resend-verification, register-checkout). Currently only the global
   300 req/min applies — too loose for credential-adjacent endpoints.
4. Drop the `admin.auth.admin.listUsers()` scan in
   `server/routes/auth.ts:154,210` (O(n) over every user per POST —
   timing-oracle-friendly enumeration). Replace with
   `admin.auth.admin.getUserByEmail()`.

### P1 — God components (the main "vibe-coded" signal)

Files > 1000 LOC that fetch data, mutate DB rows, render UI, and handle
routing all inside the same component. Listed by what a reviewer will
open first:

| File | LOC | What it mixes |
|---|---|---|
| `src/pages/FieldSales.tsx` | 2304 | map + territories + pins + stats + AI reco |
| `src/components/map-d2d/map-container.tsx` | 1532 | Mapbox wrapper, markers, clusters, popups |
| `src/components/NewJobModal.tsx` | 1498 | multi-step wizard (clients, services, teams, taxes, line items) |
| `src/pages/NoteCanvas.tsx` | 1385 | React Flow canvas + drawing + presence + comments |
| `src/pages/Timesheets.tsx` | 1342 | view + edit + approval + payroll |
| `src/pages/ClientDetails.tsx` | 1259 | 5 tabs, each its own feature |
| `src/pages/JobDetails.tsx` | 1144 | same pattern |
| `src/pages/Pipeline.tsx` | 1036 | Kanban — currently unused in nav (see App.tsx) |
| `src/App.tsx` | 1042 | routing + shell + subscription guard + sidebar |

Approach: extract feature hooks (`useClients`, `useJobs`, etc.) and slice
pages into `sections/`. Don't try to rewrite FieldSales in one PR —
split it tab by tab.

### P1 — Tests that look real but aren't

`tests/automation/scheduler.test.ts` was fixed in this sprint
(`f65702e`). Seven other files still re-implement the logic they claim
to test. A regression in production code will not trip them.

```
tests/automation/actions.test.ts           // reimplements logic inline
tests/automation/automation-engine.test.ts // reimplements logic inline
tests/automation/event-wiring.test.ts      // tests a local copy of the constant
tests/automation/workflow-scenarios.test.ts// tests object literals
tests/tenant-isolation/multi-tenant.test.ts// reimplements CompanyProvider logic
tests/courses/courses-permissions.test.ts  // "// mirrors server-side canEditCourse"
```

Pattern to follow: extract pure logic to a sibling `*-utils.ts` module
and import it from both the feature module and the test. See the
scheduler split (`server/lib/scheduler-utils.ts`) for the working
example.

### P2 — 1,300+ `any` in src/ + server/

Do not flip `noImplicitAny` globally — it breaks the build. Recommended
ramp:

1. Flip `strictNullChecks` for `src/lib/` only (a `tsconfig.lib.json`
   works) and pay down the null-handling bugs it surfaces.
2. Then do the same for `server/lib/`.
3. Then `server/routes/` (this one is heavy on `as any` around
   payments/billing — those are the files I'd review first anyway).
4. Last: page-level code.

### P2 — Page-level Supabase calls

Sixteen pages call `supabase.from('table').insert/update` directly,
bypassing the `src/lib/*Api.ts` service layer that exists for this
purpose:

```
ClientDetails, Clients, D2DDashboard, Dashboard, Insights, InvoiceEdit,
Invoices, JobDetails, Jobs, OnboardingFlow, QuoteDetails, RepProfile,
TeamMemberDetails, Timesheets, ActivityCenter, OnboardingWizard
```

Grep for `supabase.from(` under `src/pages/` and `src/components/` — any
hit is a candidate. Moving them into `src/lib/*Api.ts` means you can
add logging, retry, and validation in one place instead of 16.

### P3 — Silent `catch {}`

27 `try { ... } catch {}` blocks swallow errors, several on the billing
and onboarding critical paths:

- `src/pages/OnboardingFlow.tsx:218,268,297,300` — `provisionOrg()` and
  `/api/billing/onboarding` failures disappear silently.
- `src/App.tsx:213,238,391` — `profiles.onboarding_done` updates.
- `src/lib/workflowApi.ts:459,463` — JSON parse of webhook payloads
  (you'll never see a malformed webhook in production).

Either replace with `catch (e) { logger.error(...) }`, or — for the
`localStorage.setItem` cases — swap in `safeLocalStorage` from
`src/lib/safeStorage.ts` (added this sprint).

### P3 — Architecture smells the reviewer will flag

- `src/App.tsx` still owns the sidebar, permission wiring, the Routes
  tree, and the realtime SMS counter. Split into
  `src/components/layout/AppShell.tsx` + `src/routes/AppRoutes.tsx`.
- Three near-duplicate avatar components:
  `components/d2d/avatar.tsx`, `components/ui/UnifiedAvatar.tsx`,
  `components/ui/d2d-avatar.tsx`. "Unified" is aspirational, not
  factual — consolidate.
- Three stat cards with different names for the same shape:
  `DashboardCard`, `ui/StatCard`, `d2d/stat-card`.
- `components/quote/` vs `components/quotes/` — one has the preview
  renderer, the other the CRUD modals. Merge under one directory.
- `src/types.ts` (548 LOC of DB types) coexists with `src/types/`
  (utility types). Decide on one location.

### P4 — React Query is installed but used in ~11% of files

`@tanstack/react-query` is a runtime dependency but only 28 of 260
`.tsx` files use it. The rest fetch with `useState + useEffect`, so
there is no cache, no deduplication, and no automatic invalidation.
Any change to a client's data forces a manual refetch in every
consuming page. Convert new code to React Query by default; backfill
list pages opportunistically.

---

## Things the reviewer will probably bring up — and the honest answer

**"Why is `mapbox-gl` installed when `leaflet` is also installed?"**
`mapbox-gl` is only referenced in `src/components/map-d2d/map-container.tsx`.
Everywhere else uses `leaflet`. Either migrate the D2D map to leaflet
(saves ~800 KB gzipped) or commit to mapbox and delete leaflet. Not a
bug, a design decision.

**"Why is the CSP allowing `style-src 'unsafe-inline'`?"**
React, Tailwind, and Framer Motion all emit inline styles at runtime.
Enforcing nonces would require a CSP nonce pipeline and breaks HMR in
dev. `script-src` in production is strict (no `unsafe-inline`), which
is the one that actually matters. Document this in
`docs/security/csp.md` when you have time.

**"Why is `failed_login_attempts.INSERT` policy `WITH CHECK (true)`?"**
Because the user is *not authenticated* when we log a failed attempt —
we cannot gate this on `auth.uid()`. The Supabase advisor flags it, but
any tighter check blocks legitimate logging. This is intentional; don't
"fix" it without understanding the pre-auth flow.

**"Why are `scripts/qa-*.mjs` still in the repo?"**
Because they are seed/cleanup scripts for the hardening sprint's QA
dataset. They now read credentials from env vars and fail-fast if any
are missing (see `scripts/qa-seed.mjs:13-27` after `16ffd59`). If
you're not planning to run a QA seed again, delete them — they depend
on the Supabase Management API which is only useful for admin tooling.

---

## How to validate everything locally

```bash
# Requires Node >=20
npm ci            # fails if lock-file drift
npm run lint      # tsc --noEmit, must be silent
npm test          # vitest run, must report 261+ tests passing
npm audit --omit=dev --audit-level=high   # must be 0

# Spot-check the scheduler tests against the real source
npx vitest run tests/automation/scheduler.test.ts
```

All four must pass on `chore/hardening-2026-04-22`. The CI workflow
(`.github/workflows/ci.yml`) enforces the same chain on every PR.

---

## Appendix — files I did not touch

These were in the working tree when I started and stayed untouched so
the diff is easy to review:

- `src/components/map-d2d/map-container.tsx` — ongoing UI change
  (multi-select pin filters) that belongs in its own branch.
- `src/pages/Timesheets.tsx`, `src/components/DevRoleSwitcher.tsx` —
  pre-existing modifications, unrelated to the hardening work.
