# Performance Audit — 2026-05-12

Scope: Lume CRM (`lume-crm/`). Read-only audit. Build output measured: `dist/assets/index-Cx0JECbL.js` = **5,756,636 bytes (5.49 MB raw, ~1.58 MB gzip)** — almost everything in a single chunk.

---

## Showstoppers (likely causing user-perceived lag)

### S1. Monolithic JS chunk — 5.49 MB single bundle
- **Where:** `dist/assets/index-Cx0JECbL.js` (entire SPA in one file).
- **Cause:** `src/App.tsx:43-127` synchronously imports ~65 page components (Dashboard, Clients, Jobs, Schedule, Pipeline, FieldSales, DispatchMap, NoteCanvas, CourseBuilder, CourseView, PlatformAdmin — all eagerly imported). Only `QuoteMeasure` (line 89) and `PlatformAdmin` (line 150) use `React.lazy`. Vite's default chunking is left untouched — `vite.config.ts` has **no `manualChunks`, no `build.rollupOptions`**.
- **Impact:** Cold start downloads 5.49 MB + parses ~12-20 MB of JS even for users who only open Clients. On 4G this is 8-15s before Time-to-Interactive. **This is the #1 cause of perceived lag.**
- **Fix:** add `React.lazy()` around every page in `App.tsx`; add `build.rollupOptions.output.manualChunks` for `mapbox-gl`, `@fullcalendar/*`, `recharts`, `@xyflow/react`, `jspdf`, `html2canvas`, `leaflet`, `react-leaflet`, `motion`. Expected: main chunk drops to ~600-900 KB.

### S2. `useRealtimeNotifications` runs an unscoped global subscription
- **Where:** `src/hooks/useRealtimeNotifications.ts:22-28` and `:32-58`.
- **Issue:** `supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('is_read', false)` — **no `org_id` filter**, no user filter. Relies entirely on RLS. The realtime channel subscribes to `INSERT`/`UPDATE` on the whole `notifications` table.
- **Impact:** Every notification across every tenant is shipped to every browser tab over WebSocket; the client filters in JS. As tenant count grows, this fans out exponentially and floods the client. Combined with the channel never being released until logout, this can hang the tab.
- **Fix:** add `.eq('org_id', currentOrgId)` to both the count fetch and the realtime filter (`{ event: 'INSERT', schema: 'public', table: 'notifications', filter: \`org_id=eq.${orgId}\` }`).

### S3. `App.tsx` sidebar polls `quotes` + `invoices` every 60s for every user
- **Where:** `src/App.tsx:518-531` — `setInterval(load, 60_000)` for `pendingQuotes` + `overdueInvoices` count queries.
- **Impact:** Two background HTTP round-trips per minute for every signed-in tab forever. Cheap individually but causes a constant network buzz and `react-query` cache churn for navigation badges.
- **Fix:** push to realtime channel already opened in S2, or back off to 5 min, or move to a single RPC.

### S4. Sequential gating in App boot — 2 round-trips block the first paint
- **Where:** `src/App.tsx:272-293` (auth), `:303-360` (onboarding + auto-provision), `:365-399` (beta-bypass HTTP, then `memberships`, then `subscriptions`).
- **Issue:** Three sequential effects gated on `user`: auth → onboarding membership check → beta-bypass fetch → subscriptions check. All run before the app shell renders any route. App also reads `sms-unread` (`:233-265`) and `pendingQuotes/overdueInvoices` (`:518`) **separately** instead of one RPC.
- **Impact:** 4-6 sequential Supabase round-trips before the user sees their first page. On 200 ms RTT that is ~1-1.5s of blank screen post-login.
- **Fix:** combine into one `Promise.all` or move to a server-side `/api/me/bootstrap` RPC returning `{user, org, role, subscription, betaBypass, smsUnread, pendingQuotes, overdueInvoices}` in one round-trip.

---

## High-impact wins (top 5)

1. **Code-split routes** (`App.tsx:43-127`) — convert every `import Page from './pages/X'` to `const Page = React.lazy(() => import('./pages/X'))`. Wrap `<Routes>` in `<React.Suspense>`. Estimated savings: **3-4 MB off initial bundle**.
2. **Add Vite `manualChunks`** in `vite.config.ts` for heavy vendor libs (`mapbox-gl` ~800 KB, `@fullcalendar` ~400 KB, `recharts` ~350 KB, `@xyflow/react` ~250 KB, `leaflet` + `react-leaflet` ~250 KB, `jspdf` ~280 KB, `html2canvas` ~200 KB, `motion` ~150 KB). Browser can parallelise & cache vendor chunks across releases. Estimated: **-200 ms parse cost per page nav**.
3. **Scope `useRealtimeNotifications` to org** (`src/hooks/useRealtimeNotifications.ts:22-58`) — cuts WebSocket fan-out per tenant from O(orgs) to O(1).
4. **Bootstrap RPC** to collapse 4-6 sequential auth/org/subscription/badges fetches into one (S4). Estimated: **-800 ms first-page render**.
5. **Lazy-load PDF/canvas paths** — `src/lib/generateInvoicePdf.ts:1` and `src/lib/generateQuotePdf.ts:1` import `jspdf` at top-level, so it gets eagerly bundled even though only ~5% of sessions print PDFs. Convert to `await import('jspdf')` inside the generator function. Estimated: **-280 KB on initial load**.

---

## DB-side (queries, indexes, realtime)

### DB1. RLS `auth_rls_initplan` — many policies re-evaluate `auth.*()` per row
- Supabase performance advisor returns the `auth_rls_initplan` lint on many tables (starting with `connected_accounts_insert_org`, `connected_accounts_update_org`, etc., see full output `tool-results/toolu_01CsPFk5jYv3YxNQ5ZhN46gi.json`).
- **Impact:** N-row scans pay an `auth.uid()` cost per row. On lists of 1000+ rows this is silently 50-200 ms extra per query.
- **Fix:** rewrite policies to `(select auth.uid())` per Supabase docs — wraps it as an InitPlan evaluated once.

### DB2. Multiple permissive policies on same role/action
- Advisor returns `multiple_permissive_policies` lints — Postgres must OR-evaluate each policy for every row.
- **Fix:** consolidate duplicate policies (typically a legacy `*_select_all` plus newer `*_select_org_member`).

### DB3. Foreign keys: **no missing FK indexes detected**
- Ran `pg_constraint` join against `pg_index` — empty result. All FKs are covered. Good.

### DB4. `pipeline_deals_visible` JOIN explosion
- `src/lib/pipelineApi.ts:270-294` (`listPipelineDeals`) selects `lead → contact`, `client → contact`, `job` — five joined tables — **with no `.limit()` and no pagination**. Returns the entire pipeline.
- **Impact:** A growing org with 5,000 deals returns 5,000×(lead+contact+client+contact+job) rows — multi-megabyte JSON. Page hangs on parse.
- **Fix:** add `.limit(500)` per stage or stage-by-stage fetch + virtual scrolling.

### DB5. `clientsApi.listClients` uses `select('*')`
- `src/lib/clientsApi.ts:94`. Pulls 20+ columns (incl. `notes`, addresses) when the list view only needs ~8.
- **Fix:** explicit column list. Saves ~30-50% payload per row.

### DB6. `buildSearchFilter` runs **12 ILIKE clauses** per search
- `src/lib/clientsApi.ts:67-83` — `first_name`, `last_name`, `company`, `email`, `phone`, `address` × 2 accent variants = 12 `ILIKE '%q%'` clauses OR'd together.
- **Impact:** sequential scan on `clients`. No `pg_trgm` GIN index referenced.
- **Fix:** add `CREATE INDEX clients_search_trgm ON clients USING gin ((first_name || ' ' || last_name || ' ' || coalesce(company,'')) gin_trgm_ops)`; switch query to `.textSearch()` or single column.

### DB7. Dashboard: 11 parallel queries, some unbounded
- `src/lib/dashboardApi.ts:138-247` — `dealsQuery`, `allLeadsQuery` (line 215) and `outstandingInvoicesQuery` (line 190) have no `.limit()` and no date floor. On a mature tenant these scan the entire history every refresh (every 60s when the realtime channel fires).
- **Fix:** add `.limit(500)` defensively and a `.gte('created_at', last_90_days)` for `allLeadsQuery`.

### DB8. Realtime channel fan-out — 14 places open channels
- Found in `Jobs.tsx`, `Timesheets.tsx`, `FieldSales.tsx`, `App.tsx`, `Schedule.tsx`, `Pipeline.tsx`, `Messages.tsx`, `Dashboard.tsx`, `DispatchMap.tsx`, `notesApi.ts`, `ActivityTimeline.tsx`, `ActivityCenter.tsx`, `useRealtimeNotifications.ts`, `noteBoardsApi.ts`. App-wide channels (`Dashboard.tsx:53`, `Timesheets.tsx:400,409`, `useRealtimeNotifications.ts:32`) all subscribe on `*` event for whole tables. Each table change pings every connected browser.
- **Fix:** add `filter: 'org_id=eq.${orgId}'` everywhere (only `Schedule.tsx:754-758` actually does this); drop subscriptions when the relevant tab is not visible.

### DB9. `Dashboard.tsx` realtime — unscoped `schedule_events`
- `src/pages/Dashboard.tsx:56` — `{ event: '*', schema: 'public', table: 'schedule_events' }` with no org filter. Same global-broadcast issue as DB8.

### DB10. `App.tsx` sms-unread realtime — unscoped
- `src/App.tsx:259` — `{ event: '*', schema: 'public', table: 'conversations' }` with no filter. Every conversation update for every tenant wakes every tab.

### DB11. Several manual `loadData()` + realtime "INSERT" causes double-fetch
- `src/pages/Timesheets.tsx:400` — realtime callback calls `loadData(); loadMySession()` (two queries) on every `time_entries` event, with **no debounce**. A bulk import of time entries will fire dozens of refetches.
- **Fix:** add a 400-500 ms debouncer like `Schedule.tsx` does (`:740,748`).

### DB12. Pipeline: no `.limit()` anywhere
- `src/lib/pipelineApi.ts` — none of `listPipelineDeals` / `getPipelineDealById` / `listScheduleEventsForJob` paginate.

---

## Frontend (bundle, rendering, hydration)

### F1. Heavy deps imported eagerly though page-specific
- `@paypal/react-paypal-js` — `src/components/InvoicePaymentModal.tsx:6` (modal only opens on invoice payment).
- `mapbox-gl` — `src/components/map-d2d/map-container.tsx:2` (only D2D map).
- `leaflet` + `react-leaflet` + `react-leaflet-cluster` — `src/pages/FieldSales.tsx:3-6`, `DispatchMap.tsx`, `Timesheets.tsx`, `components/map/*`.
- `recharts` — `src/components/insights/finance/*`.
- `@xyflow/react` — `src/components/notes/*Node.tsx` (NoteCanvas only).
- `jspdf` — `src/lib/generateInvoicePdf.ts`, `src/lib/generateQuotePdf.ts`.
- All currently live in the single 5.49 MB chunk because of S1.
- **Fix:** with route-level lazy loading (S1) these naturally split out; for non-route components also use `React.lazy` (e.g. `const InvoicePaymentModal = React.lazy(...)`).

### F2. `framer-motion`/`motion` used in 67 files
- Reported by grep on `motion/react`. Includes the sidebar (`App.tsx:655`) with `layoutId="sidebar-active"` (line 749) using spring animation — runs on every nav.
- **Impact:** `motion` is ~150 KB and forces a render-on-resize listener globally. Spring layout animations on long lists (e.g. Pipeline kanban) cause sustained 60 fps jank on mid-tier devices.
- **Fix:** swap simple fade/slide motions for CSS transitions (`transition-transform`); only keep `motion` where layout-animation is genuinely needed.

### F3. `Toaster` re-evaluates `matchMedia` on every render
- `src/App.tsx:638` — `position={typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches ? 'bottom-center' : 'top-right'}`. Runs on every parent rerender (every nav, every keystroke that triggers App state).
- **Fix:** memoize with `useMemo`.

### F4. `App.tsx` rebuilds navSections + 60-item array on every render
- `src/App.tsx:570-625` — `navSections`, `filteredNavSections`, `moreNavItems` rebuilt on every render of `AuthenticatedApp`. Each item passes inline objects/funcs to children inside `motion.aside`. Since `App.tsx` re-renders on every notification / sms count change / location change, sidebar layout-animations re-trigger.
- **Fix:** wrap nav builders in `useMemo([permsCtx.role, permsCtx.permissions, venteModule.isEnabled, language, isPlatformOwner])`.

### F5. `FieldSales.tsx` is 2,306 lines, **0 `useMemo`/`useCallback`/`memo`**
- Confirmed via grep: 0 matches for `useMemo|useCallback|React.memo` in `src/pages/FieldSales.tsx`.
- It renders Leaflet markers, polygons, polylines, marker clusters, GPS live reps. Every state change rebuilds all marker arrays. Combined with the realtime subscription at `:1335`, this is a perf disaster on >100 pins.
- **Fix:** memoize marker arrays by ID; extract `<MarkerLayer items={items}>` child wrapped in `React.memo`.

### F6. Pages > 1000 lines — refactor candidates with render-cost
1,385 NoteCanvas, 1,342 Timesheets, 1,259 ClientDetails, 1,144 JobDetails, 1,103 CourseBuilder, 1,064 OnboardingFlow, 1,063 AppMarketplace, 1,036 Pipeline, 1,028 Clients.

### F7. `Pipeline.tsx` deals re-rendered on any drag
- `src/pages/Pipeline.tsx:46-71` — `KanbanColumn` is not memoized; each `DealCard` not memoized. With 100+ deals, every dnd move re-renders all columns.
- **Fix:** `React.memo(KanbanColumn)` and `React.memo(DealCard)` with stable handlers.

### F8. `useQuery` adoption is partial (10 files use it; 65+ pages don't)
- `useQuery|useMutation`: 52 occurrences across 10 files. Pages like Clients, FieldSales, ClientDetails still use raw `useState + useEffect + supabase.from(...)`. No cross-page cache hit when navigating Clients → Client detail → Clients.
- **Fix:** migrate list/detail pages to `useQuery` keyed by `['clients', orgId, page, q]`; reuse on back-nav.

### F9. `useOfflineCache` runs `localStorage.getItem` synchronously at mount
- `src/hooks/useOfflineCache.ts:22-31` — `JSON.parse(localStorage.getItem(...))` in `useState` initializer. For Dashboard (`dashboard` key) the payload can be 100 KB+, blocking the main thread for ~30-80 ms on slow phones.
- **Fix:** read in `useEffect` not in the initializer.

### F10. Search filter computed inline causing 12-clause ILIKE re-fetch on every keystroke
- `src/pages/Messages.tsx:66-79` debounces 300 ms — OK. But `src/pages/Clients.tsx` (state at line 81-82) — verify debounce is applied to the listClients call.

### F11. `index-CKYcDNi4.css` = 302 KB
- `dist/assets/index-CKYcDNi4.css` 309,471 bytes. Tailwind v4 should tree-shake but bundle is large for an SPA. Likely many unused utility classes from arbitrary `[14px]` values + leaflet.css + fullcalendar CSS shipped together.
- **Fix:** ensure Tailwind `content` paths exclude `node_modules`; lazy-import `leaflet/dist/leaflet.css` and `@fullcalendar/...` CSS only in their routes.

### F12. `leaflet.css` loaded for every user
- `src/main.tsx:10` — `import 'leaflet/dist/leaflet.css';` at root. Users who never open a map page still get it.

### F13. Sidebar `motion.aside` width animation
- `src/App.tsx:655-666` — `animate={{ width: sidebarExpanded ? 232 : 56 }}` triggers full layout shift; everything in `<main>` repaints/reflows. Tracking hover (`isSidebarHovered`) makes this fire frequently.
- **Fix:** use a CSS transition (`transition-[width] duration-200`) instead of motion — GPU compositor handles width cheaper than React.

---

## Server (Express, middleware)

### E1. ~60 routers imported at boot
- `server/index.ts:22-70` synchronously imports every route + every cron module. First request is fine but boot uses ~150 MB and slows cold start (Vercel/Fly edge re-warm).
- **Fix:** lazy `await import()` cron-only routers (`scheduled-reports`, `cron`, `platform-admin`) at startup tail.

### E2. Double rate-limiter stack
- `server/index.ts:245-277` — when Redis is available, in-memory limiters are skipped, but `leadCreateLimiter`, `quoteTokenLimiter`, `surveyLimiter`, `formSubmitLimiter`, `platformAdminLimiter`, `cspReportLimiter`, `securityLimiter` are **always** registered alongside their Redis equivalents. Every request hits a `Map.get + setInterval` sweep plus a Redis round-trip.
- **Fix:** guard all of them behind `if (!useRedis)` like the others; or use Redis as the only source of truth.

### E3. `setInterval` sweep on rate-limit map runs forever
- `server/index.ts:202-207` — 5-min sweep iterates the whole `rateLimitStore`. Negligible but accumulates per limiter instance: ~10 limiters × `setInterval` = 10 timers.

### E4. `app.get('*')` reads `index.html` from disk on every navigation
- `server/index.ts:426-430` — comment says "fresh from disk every time" to avoid stale HTML. Cheap individually but on cold filesystem every SPA route nav (including 404s) hits `fs.readFile`. Reading and serving with `etag` + `Cache-Control: no-store` is fine, but at high traffic this is wasted IO.
- **Fix:** read once at boot, watch `dist/index.html` with `fs.watch`, swap in memory on change.

### E5. Heavy import chain in workflow bridge per-request
- `server/index.ts:373-421` — `app.post('/api/workflows/execute-action')` does **6 dynamic `await import()` calls per request** (`./lib/supabase.js`, `./lib/actions/index.js`, `./lib/config.js` ...). After first call they are cached, but the await chain adds latency on the first hit per worker.
- **Fix:** hoist these imports to the top of the file.

### E6. CSP duplicated per request via `setHeader`
- `server/index.ts:89-126` — builds CSP string on **every request**. The string is static.
- **Fix:** compute once at module top.

### E7. CORS callback per request — fine but synchronous `new URL(origin)`
- `server/index.ts:130-153`. OK as-is for normal traffic but could be a `Set` lookup.

### E8. Sentry adds two middleware layers
- `initSentry(app)` line 86 + `attachSentryErrorHandler(app)` line 487 — when `SENTRY_DSN` set, every request flows through it. Acceptable.

### E9. No HTTP cache headers on `express.static(distPath)`
- `server/index.ts:370` — `app.use(express.static(distPath))` defaults to no `Cache-Control: max-age=31536000, immutable` for hashed assets. Browsers will revalidate the 5.49 MB chunk on every visit.
- **Fix:** `express.static(distPath, { maxAge: '1y', immutable: true })`. Massive win for return visits.

### E10. Connection pooling
- Server creates Supabase clients on-demand (`getServiceClient()` per request). Without a singleton or `pgbouncer`, each Postgres call opens a fresh connection — limits throughput under burst. Verify `lib/supabase.ts` caches the client.

---

## Quick wins (< 1h)

| # | Where | Fix | Impact |
|---|-------|-----|--------|
| Q1 | `src/App.tsx:43-127` | Convert all `import Page` → `React.lazy(...)` and wrap `<Routes>` in `<React.Suspense fallback={<Loading/>}>` | -3 MB initial JS |
| Q2 | `vite.config.ts` | Add `build.rollupOptions.output.manualChunks` for mapbox/leaflet/fullcalendar/recharts/xyflow/jspdf/html2canvas/motion | Parallel download + cache reuse |
| Q3 | `src/hooks/useRealtimeNotifications.ts:22,33` | Add `.eq('org_id', orgId)` + `filter: 'org_id=eq.${orgId}'` | Stops cross-tenant fan-out |
| Q4 | `src/App.tsx:259` | Add `filter: 'org_id=eq.${oid}'` to `conversations` channel | Cuts realtime traffic |
| Q5 | `src/pages/Dashboard.tsx:56` | Add `filter: 'org_id=eq.${orgId}'` to schedule_events channel | Same |
| Q6 | `src/App.tsx:529` | Change `60_000` → `300_000` (5 min) or remove in favor of realtime | -4 req/min/user |
| Q7 | `src/App.tsx:638` | Memoize `position` with `useMemo` keyed on a media-query listener | Stop calling `matchMedia` per render |
| Q8 | `src/lib/clientsApi.ts:94` | `select('*')` → explicit column list | -40% payload |
| Q9 | `src/lib/generateInvoicePdf.ts:1`, `generateQuotePdf.ts:1` | Move `import jspdf` inside the function as `await import('jspdf')` | -280 KB initial |
| Q10 | `server/index.ts:370` | `express.static(distPath, { maxAge: '1y', immutable: true })` | Eliminates re-download |
| Q11 | `src/main.tsx:10` | Move `leaflet/dist/leaflet.css` import into the leaflet-using pages | -15 KB CSS |
| Q12 | `server/index.ts:89-126` | Pre-build CSP string at module scope | Tiny per-request win |
| Q13 | `src/pages/Timesheets.tsx:400` | Debounce realtime callback (400-500 ms) like `Schedule.tsx:740` | Stops refetch storms |
| Q14 | `src/lib/dashboardApi.ts:215,190` | Add `.limit(500)` to `allLeadsQuery` and `outstandingInvoicesQuery` | Bounded queries |
| Q15 | `src/App.tsx:655` | Replace `motion.aside` width animation with CSS `transition-[width]` | Less reflow on toggle |

---

## Bigger refactors

### R1. App bootstrap RPC
Combine auth + org/membership + subscription + onboarding-flag + sms-unread + pending-quotes + overdue-invoices + beta-bypass into one `/api/me/bootstrap` route returning a single JSON. Replaces 4-6 sequential round-trips in `App.tsx:267-531`. Estimated: **-800 ms TTI post-login**.

### R2. Pipeline pagination + virtualization
`src/pages/Pipeline.tsx` + `src/lib/pipelineApi.ts`. Today every deal is hydrated with 5 joined tables and rendered. Move to per-stage paginated fetch (`.limit(50)` + load-more) and use `react-virtual` for cards. Required before tenants hit ~500 deals.

### R3. Migrate list pages to `react-query`
Clients, Jobs, Leads, Quotes, Invoices, Payments, Tasks, Pipeline still use `useState/useEffect`. Standardize on `useQuery` keyed by `['entity', orgId, params]` to get free dedup, background refetch, navigation cache.

### R4. RLS policy rewrite
Apply Supabase `auth_rls_initplan` fix sweep — wrap `auth.uid()` in `(select auth.uid())` across all policies, then run the advisor again. Will likely cut median query latency 20-40% on large tables.

### R5. Realtime consolidation
Replace 14 page-level `supabase.channel(...)` subscriptions with a single app-wide channel multiplexer that fans events out to subscribers by table+org_id. Reduces WebSocket message volume, simplifies cleanup, kills per-page leak risk.

### R6. Split `FieldSales.tsx` (2,306 lines)
Extract `MapLayer`, `MarkerCluster`, `TerritoryLayer`, `LiveRepsLayer` as memoized children. Currently a single render of this page redraws everything Leaflet on any state change.

### R7. Replace `motion/react` with CSS where layout-anim is not needed
67 files import motion. Audit each: keep `motion` only for `AnimatePresence` exit animations or `layoutId` shared transitions. Replace simple fades with CSS — shrinks bundle, eliminates extra component tree.

### R8. Drop the eager `import { toast } from 'sonner'` dynamic-load pattern
`src/App.tsx:283` lazy-loads sonner inline `import('sonner').then(({toast})=>...)` — but `Toaster` from sonner is statically imported at line 63 anyway, so sonner is in the main chunk. Just import toast statically.

---

## Findings summary
**33 findings.** Showstopper is the 5.49 MB unsplit bundle (S1) compounded by an unscoped global realtime subscription (S2) and a 4-6 round-trip boot sequence (S4). Fixing S1, S2, S4, Q3, Q4, Q5, Q9, Q10 should make the "feels laggy" complaint disappear for most users.
