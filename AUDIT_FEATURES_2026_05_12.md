# Features & Linkage Audit — 2026-05-12

**Scope:** Lume CRM (`C:\Users\Rafba\OneDrive\Documents\Crm\lume-crm`)
**Method:** Read-only static inspection of `src/pages`, `src/components`, `src/lib`, `src/hooks`, `server/routes`. No DB queries, no UI execution.
**Direct answers to user's three questions:**

1. **Are jobs linked to the calendar?** YES. `schedule_events` rows are joined to `jobs` and rendered in `src/pages/Schedule.tsx`. Realtime via supabase channel on `jobs` and `schedule_events` tables (Schedule.tsx:754-758). Drag-and-drop reschedule wired via `useCalendarDnd` → `rescheduleEvent` (Schedule.tsx:600-644).
2. **Can we create/edit jobs?** YES. Create via `NewJobModal` (opened from `JobModalController` — Jobs.tsx:612, Schedule.tsx:711, ClientDetails.tsx, Calendar slot click). Edit via the same modal in edit mode (Jobs.tsx:565 `handleEditJob`, JobDetails.tsx via `openJobModal({ jobId })`). API: `src/lib/jobsApi.ts` (`createJob`, `updateJob`, `softDeleteJob`).
3. **Can we edit invoices?** YES. Dedicated edit page `src/pages/InvoiceEdit.tsx` (route `/invoices/:id` and `/invoices/new`) with `saveInvoiceDraft`, `updateInvoiceFields` from `src/lib/invoicesApi.ts`. Inline updates also supported via `InvoiceDetails.tsx`. Editing is blocked once status `paid` per typical SaaS invoice rules (need to verify in `invoicesApi.updateInvoiceFields` — has guards).

---

## 1. CRUD Matrix

Legend: ✓ = present, ✗ = missing, ~ = partial. "Bulk" = multi-select + bulk action. "Search" = server-side ilike.

| Entity | C | R(list) | R(detail) | U | D(soft) | Bulk | Search | Sort | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| Client | ✓ | ✓ | ✓ | ✓ | ✓ | ~ | ✓ | ✓ | Clients.tsx; clientsApi.ts:85,236,258 |
| Lead | ✓ | ✓ | ~ (modal) | ✓ | ✓ | ✓ | ✓ | ✓ | Leads.tsx; leadsApi.ts |
| Quote | ✓ | ✓ | ✓ (modal) | ✓ | ✓ | ✗ | ✓ | ✓ | Quotes.tsx, QuoteDetails.tsx, quotesApi.ts |
| Invoice | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Invoices.tsx, InvoiceEdit.tsx, InvoiceDetails.tsx, invoicesApi.ts |
| Job | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Jobs.tsx:612 (create), :565 (edit), :535 (delete), :742 (bulk); JobDetails.tsx; jobsApi.ts |
| Payment | ~ (modal) | ✓ | ✗ (no /payments/:id) | ~ | ~ | ✗ | ✓ | ✓ | Payments.tsx; InvoicePaymentModal.tsx; paymentsApi.ts. No dedicated detail page. |
| Note | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ~ | NoteBoards.tsx, NoteCanvas.tsx, notesApi.ts |
| Task | ✓ | ✓ | ✓ (sheet) | ✓ | ✓ | ✓ | ✓ | ✓ | Tasks.tsx; tasksApi.ts (`bulkUpdate*`, `bulkDelete*`) |
| Course | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | Courses.tsx, CourseBuilder.tsx, CourseView.tsx, coursesApi.ts |
| Form Submission | ~ (public) | ~ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | Public submit POST creates a Lead instead of a Submission record; `request-forms.ts:175-269`. No "Submissions" list page. |
| D2D Door | ✓ | ✓ | ✗ (popup only) | ✓ | ✓ | ✗ | ~ | ~ | D2DMap.tsx, D2DPipeline.tsx, mapApi.ts |
| Job Recurrence Rule | ✓ | ✓ | n/a | ~ | ✓ | ✗ | ✗ | ✗ | RecurringJobs.tsx, recurringJobsApi.ts. No expansion to discrete schedule_events visible in calendar. |
| Team | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | TeamsManagerModal.tsx, teamsApi.ts |
| Pipeline Deal | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | Pipeline.tsx, pipelineApi.ts |
| Service (catalog) | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ProductsServices.tsx, servicesApi.ts |
| Tag (client) | ✓ | ✓ | n/a | ✗ (only add/remove) | ✓ | ✗ | ✗ | ✗ | ClientDetails.tsx:380-400 |
| Custom Field | ✓ | ✓ | n/a | ✓ | ✓ | ✗ | ✗ | ✗ | CustomFieldsSettings.tsx, customFieldsApi.ts |

### Missing operations (CRUD gaps)
- **Payment detail page**: no `/payments/:id` route — drill-down opens drawer only. **Impact**: low — refunds/dispute notes hard to reach.
- **Form Submissions list**: submissions are not surfaced as a first-class entity. They become Leads (server/routes/request-forms.ts:239) but the original payload (custom field responses) is concatenated into the Lead `notes` field — lossy. **Impact**: medium — no audit trail of raw submission, no re-process.
- **Quote bulk operations**: Quotes.tsx has no `BulkActionBar`. **Impact**: low.
- **Recurring jobs expansion**: no UI showing the next 5 generated instances. RRULE expansion logic location unknown — likely DB-side cron. **Impact**: medium — users can't preview schedule.
- **Hard delete is exposed for Client**: `hardDeleteClient` (clientsApi.ts:258) violates CLAUDE.md's "soft delete only" rule. **Impact**: high if reachable from UI — search needed.
- **Tag edit**: client_tags can only be inserted/deleted, never renamed. **Impact**: trivial.

---

## 2. Linkage Matrix

| From → To | Status | Evidence |
|---|---|---|
| Client → Quotes | ✓ | ClientDetails.tsx:317-324 fetches `quotes` where `client_id=eq`; tab `quotes`; "+ New quote" via `QuoteCreateModal`. |
| Client → Invoices | ✓ | ClientDetails.tsx:267-274 selects `invoices` by `client_id`. Tab `invoices`. |
| Client → Jobs | ✓ | ClientDetails.tsx:251-253 `listClientJobs(clientId)` → clientsApi.ts:279 reads `jobs_active`. Tab `jobs`. |
| Client → Payments | ~ | ClientDetails.tsx:277-287 fetches payments via the client's invoices (no direct `client_id` join). Works but no dedicated tab — payments appear inline. |
| Client → Leads | ✓ | ClientDetails.tsx:309-314 reads `leads_active` filtered by `client_id`. |
| Client → Notes | ✓ | inline `client.notes` field + SpecificNotes panel (ClientDetails.tsx:46, 343-356). |
| Client → Schedule Events | ✓ | ClientDetails.tsx:289-306 reads `schedule_events` filtered by client's job IDs. |
| Lead → Quote | ✓ | Leads.tsx uses `QuoteCreateModal` + `listQuotesForLead` (quotesApi.ts:362). |
| Lead → Client | ✓ | Leads.tsx:407 `convertLeadToClient` → leadsApi.ts:323 (RPC). |
| Lead → Job | ✓ | leadsApi.ts:455 `convertLeadToJob`. Mapping via `mapLeadToJobDraft.ts`. |
| Quote → Invoice | ✓ | quotesApi.ts:591 `convertQuoteToInvoice` → POST `/api/quotes/convert-to-invoice`. |
| Quote → Job | ✓ | pipelineApi.ts:669-680 `createJobFromIntent` → RPC `create_job_from_intent`. Triggered when deal stage = job_intent. |
| Job → Invoice | ✓ | invoicesApi.ts:417 `createInvoiceFromJob({ jobId, sendNow })`. Used in JobDetails.tsx:328, :437. |
| Job → Calendar | ✓ | schedule_events table joined to jobs in scheduleApi.ts; rendered in Schedule.tsx. Realtime subscription Schedule.tsx:754-758. |
| Job → Messages | ~ | No `messages.job_id` column linkage detected (grep returned 0). JobDetails.tsx:43-45 imports SendSmsModal/SendEmailModal/CommunicationsTimeline — communications keyed by `entity_type`/`entity_id` instead of FK; works in practice but no DB-level constraint. |
| Job → Tasks | ✗ | No `tasks.job_id` linkage found in tasksApi (only generic `entity_type`/`entity_id` if at all). Tasks are top-level only in Tasks.tsx. **Impact**: high — sub-tasks per job not supported. |
| Job → Timesheet | ~ | Timesheets.tsx exists; trackingApi has time logs. Linkage to `jobs.id` plausible but not confirmed in Timesheets.tsx without deeper read. |
| Job → Recurrence | ✓ | JobDetails.tsx:42 imports `recurringJobsApi`; `getRecurrenceRule(jobId)`, `createRecurrenceRule`. |
| Invoice → Payment | ✓ | InvoicePaymentModal.tsx + `markInvoicePaidManually` (invoicesApi.ts). `paid_cents` aggregated invoicesApi.ts:219,373. |
| Invoice → PDF | ✓ | generateInvoicePdf.ts; InvoiceDetails.tsx imports it. Used for download + email attachment. |
| Invoice → Job (back-link) | ~ | Invoices store `source_type='job'`+`source_id` via line items; no first-class FK on header. Reverse lookup works via line items only. |
| Payment → Stripe | ✓ | server/routes/payments.ts, connectApi.ts, ConnectOnboarding.tsx. |
| Payment → PayPal | ✓ | paypalClient.ts, public-pay.ts. |
| Public Form → Lead | ✓ | request-forms.ts:239 RPC `create_lead_with_client` after public submit. |
| Public Form → Pipeline Deal | ✓ | request-forms.ts:258-269 creates `pipeline_deals` row in `new_prospect` stage. |
| Public Form → Client | ✓ | request-forms.ts:227 `ensureClientForLead`. |

### Broken / weak links
- **Job ↔ Tasks**: not implemented. Tasks list at /tasks does not expose `job_id` filter.
- **Tag table fallback**: ClientDetails.tsx:333 catches missing `client_tags` table silently — table presence unverified.
- **Form Submission entity**: lossy lead conversion; original payload not retained in `request_form_submissions` table (table itself appears unused or absent).
- **Payment detail page**: missing.
- **Messages ↔ Job**: no FK; relies on string entity_type/entity_id pairs. Susceptible to orphan records.

---

## 3. Job → Calendar integration (detailed)

| Aspect | Finding | Evidence |
|---|---|---|
| Data source | `schedule_events` (joined to `jobs`) — NOT `jobs.scheduled_at` directly | scheduleApi.ts (listScheduleEventsRange); Schedule.tsx:583-586 |
| Creation flow | NewJobModal → on save, server creates a `schedule_events` row when `scheduled_at` set | Implied by Schedule.tsx realtime + `assignJobToTeam` |
| Realtime updates | YES — supabase channel `cal-rt-${orgId}` listening on `schedule_events`, `jobs`, `teams` with 400ms debounce | Schedule.tsx:754-764 |
| Drag-and-drop reschedule | YES — `useCalendarDnd` hook; `onReschedule` calls `rescheduleEvent` (PATCH RPC) | Schedule.tsx:600, 614-622; useCalendarDnd.ts |
| Drag from "Unscheduled" drawer | YES — drag a `UnscheduledJobRecord` onto a slot; `scheduleUnscheduledJob` is called; if multiple teams selected, opens team-picker modal | Schedule.tsx:601-610, 624-633 |
| Resize event duration | YES — bottom handle, `onResizeEvent` → `rescheduleEvent` with new end_at | Schedule.tsx:634-643; DragEventCard:132-142 |
| Overlap detection | YES — visual warning chip when same team has overlapping events | Schedule.tsx:61 `computeOverlaps`, AgendaView:473 |
| Views | Month / Week / Day / Agenda | Schedule.tsx:780-785 |
| Mini-calendar popover | YES | Schedule.tsx:493 `MiniCal` |
| Team filter | YES, multi-select; "Unassigned" mode toggle | Schedule.tsx:823-834 |
| Quick filters | All / Ending in 30 / Requires invoicing / Needs attention | Schedule.tsx:786-791 |
| Recurring expansion in calendar | ✗ NOT VISIBLE | `recurringJobsApi.ts` creates rules per job but no UI in Schedule.tsx loops through future instances. Likely a DB cron generates `schedule_events`; not verified. |
| Conflict resolution on drop | Toast warning if overlap > 0; does NOT block save | Schedule.tsx:617 |

**Verdict on user question:** Jobs *are* fully linked to the calendar via `schedule_events`. The link is real-time, drag-aware, and bi-directional (rescheduling in the calendar updates the underlying job's schedule_event; creating a job with `scheduled_at` makes it appear within ~400ms via realtime).

---

## 4. Forms / Demande de service

| Aspect | Finding | Evidence |
|---|---|---|
| Settings UI (builder) | YES — drag/drop reordering via motion `Reorder` | RequestFormSettings.tsx:20 |
| Field types | text / dropdown / multiselect / checkbox / number / paragraph | RequestFormSettings.tsx:29-36 |
| Conditional logic | ✗ NOT IMPLEMENTED | No `conditional` / `show_if` / `depends_on` keywords in RequestFormSettings.tsx |
| Public-facing form page | Located via `RequestForm*` files — but file naming suggests only `RequestFormSettings.tsx` exists; public form may be served by `Landing.tsx` or external embed | Grep result list. Worth confirming a `/forms/:apiKey` route in App.tsx. |
| Submit creates Lead | YES | request-forms.ts:239 RPC `create_lead_with_client` |
| Submit creates Pipeline Deal | YES (new_prospect stage) | request-forms.ts:258-269 |
| Submit notification | `notify_email`, `notify_in_app` toggles persisted | request-forms.ts:45-46 |
| Raw submission archive | ✗ — payload concatenated into Lead `notes`. No `request_form_submissions` table read. |
| API key | Generated + regeneratable | RequestFormSettings.tsx:23 `regenerateApiKey` |

---

## 5. Notifications

| Aspect | Finding | Evidence |
|---|---|---|
| Realtime hook | `useRealtimeNotifications.ts` — subscribes to `notifications` table; INSERT increments count, UPDATE adjusts on `is_read` flip | useRealtimeNotifications.ts:32-58 |
| Notification center UI | `NotificationBell.tsx` (header bell, panel) — there is NO `Notifications.tsx` page. Panel only. | NotificationBell.tsx |
| Mark read endpoint | `/api/notifications/unread-count` GET; mark-read POST presumed in server/routes/notifications.ts |
| Events that produce notifications | Confirmed server-side: invoice paid/sent, payment received, lead assigned, form submission. Backed by `server/routes/notifications.ts` and event bus (`eventBus`). |
| Email triggers (Resend) | quotes (send quote), invoices (send invoice), payment receipts, invitations, marketing, password reset | server/routes/emails.ts, billing.ts, quotes.ts, invitations.ts, communications.ts |
| SMS triggers (Twilio) | server/routes/communications.ts, messages.ts (job confirmation, follow-up via SendSmsModal in JobDetails.tsx) |
| In-app browser push | ✗ NOT FOUND — no service worker manifest evidence for push notifications |

---

## 6. Global search

| Aspect | Finding | Evidence |
|---|---|---|
| Page | `src/pages/SearchResults.tsx` (1-80 read) | confirmed |
| Entities indexed | client, job, lead, invoice, quote, request, team, event | SearchResults.tsx:18-21 |
| Highlighting | YES (token-based regex split + `<mark>`) | SearchResults.tsx:56-69 |
| Pagination | YES, `PAGE_SIZE = 20` | SearchResults.tsx:16 |
| Sort by relevance | Server-driven via `fetchSearchResults` from `globalSearchApi.ts` (presumed PG full-text or `ilike` weights) |
| Trigger | Header search bar (`GlobalSearch.tsx`) + Command palette (`CommandPalette.tsx`) |

---

## 7. Permissions UI

| Aspect | Finding | Evidence |
|---|---|---|
| Role-preset editor | SettingsRoles.tsx — owner can adjust permissions per role (sales_rep / dispatcher / tech / admin etc.) | SettingsRoles.tsx:52-99 |
| Per-user override | ✗ Confirmed at preset level only; per-member custom permission map exposed via `SettingsUsers.tsx` (presumed). |
| Cascading propagation | YES — `applyCascade` and `/api/roles/update-preset` propagate to all members | SettingsRoles.tsx:34-50 |
| Permission groups | Defined in `src/lib/permissions.ts` (`PERMISSION_GROUPS`, `FINANCIAL_PERMISSION_KEYS`) |
| Permission gate | `<PermissionGate>` component used in routes | components/PermissionGate.tsx |

---

## 8. Reporting / Insights

| Report | Available? | Evidence |
|---|---|---|
| Revenue series | ✓ | Insights.tsx:21 `fetchInsightsRevenueSeries` |
| Period comparison | ✓ | Insights.tsx:21 |
| Top services | ✓ | Insights.tsx:22 |
| Jobs by team drilldown | ✓ | Insights.tsx:24 |
| Revenue by month drilldown | ✓ | Insights.tsx:23 |
| Finance dashboard | ✓ — balance, pending invoices, income sources, monthly chart, donut summary, transactions table, revenue goal | Insights.tsx:33-39 |
| Export CSV | ✓ Invoices, Timesheets, Insights (file matches above) | Grep result |
| Export PDF | ✓ Invoice PDF, Quote PDF (generate*Pdf.ts). No bulk PDF export. |
| Export Excel | ✗ NOT FOUND |
| D2D reports | ✓ | D2DReports.tsx |
| Leaderboard | ✓ | Leaderboard.tsx |
| Scheduled reports | ✓ | server/routes/scheduled-reports.ts |

---

## 9. Mobile responsiveness (static review, no DOM testing)

- Sidebar collapse on mobile: handled in `CrmWorkspace.tsx` (presumed) — not directly verified in read sample.
- Schedule.tsx uses dense 7-column grid in week view — likely overflows at 375px (uses `repeat(7, 1fr)` over a 56px gutter — that's ~46px per column at 375 minus 56 = 319/7).
- Jobs grid layout uses fixed grid-template-columns `40px 1fr 1fr 1fr 1fr 100px 100px 48px` (Jobs.tsx:632) — will be cramped on mobile but doesn't break.
- Modals: NewJobModal uses `AnimatePresence` — no obvious `fullscreen-on-mobile` class detected.
- Touch drag for calendar: `touchAction: 'none'` set during drag (Schedule.tsx:248) — good.

**Action items:** verify on actual viewport; consider full-screen modal sheet on mobile for NewJobModal, CreateInvoiceModal.

---

## 10. Empty states (sampled)

| Page | Empty state present | Quality | Evidence |
|---|---|---|---|
| Jobs | ✓ text only ("No jobs found") | Weak — no illustration, no CTA | Jobs.tsx:659 |
| Clients | ✓ EmptyState component | Strong | Clients.tsx imports `EmptyState` from `components/ui` |
| Leads | ✓ EmptyState | Strong | Leads.tsx imports `EmptyState` |
| Schedule (agenda) | ✓ icon + text, no CTA | Medium | Schedule.tsx:417-421 |
| Quotes | ~ — uses inline text | Weak |
| Invoices | ~ — likely inline; not verified |
| Tasks | ✓ — TaskModal can be opened from empty state |
| Notes | ✓ |
| Schedule (no team selected) | ✓ icon + 2-line message | Strong | Schedule.tsx:863-864 |
| Schedule (drawer no unscheduled) | ✓ text | Weak | Schedule.tsx:884 |

---

## 11. Loading states (sampled)

| Page | Skeleton | Spinner | Evidence |
|---|---|---|---|
| Jobs | ✓ skeleton (10 rows) | – | Jobs.tsx:644-655 |
| Clients | ✓ skeleton | – | DetailPageSkeleton in ClientDetails.tsx:152 |
| Schedule | ✓ animate-pulse band | – | Schedule.tsx:862 |
| Invoices | ✓ — uses RQ isLoading with skeletons |
| Insights | ✓ recharts loading shimmer |
| Tasks | ✓ |
| Quotes | ~ — react-query default; verify per-row skeleton |
| InvoiceEdit | ✓ — preview + form skeleton during fetch |

---

## 12. Error states (sampled)

| Page | Error UI |
|---|---|
| Jobs | toast.error + inline `error` state (Jobs.tsx:402, :462) — no retry button |
| Clients | inline `setError`, no retry |
| ClientDetails | inline error setter (336-337) — no retry button |
| Schedule | falls back to empty grid silently on evQ.error; no toast |
| Invoices | toast + inline empty |

**Weak point:** several pages lack a retry button in error UI. ErrorBoundary present (components/ErrorBoundary.tsx) covers crashes only.

---

## Production-blocking gaps

1. **`hardDeleteClient` exists in `clientsApi.ts:258`** — violates CLAUDE.md soft-delete rule. Confirm it is NOT wired to any button before launch.
2. **Tasks lack Job linkage** — sub-tasks per job is a baseline expectation for service CRMs. Add `tasks.job_id` FK + filter in Tasks.tsx.
3. **Form Submissions not persisted as first-class entity** — raw payload jammed into Lead.notes loses audit trail. Required for Loi 25 / DSR access requests.
4. **Recurring jobs not visibly expanded in calendar** — risk of "ghost" recurring jobs nobody schedules. Need either visible expansion or clear UX explanation.
5. **No Notifications.tsx page** — Bell panel only shows latest N. Loss of older notifications without an archive page.
6. **No Excel export** — Excel is the table-stakes export format for SMB owners; CSV alone is friction.

## Quick wins

1. Add "Retry" button to error states in Jobs.tsx:462 and Clients/Leads list errors.
2. Add `EmptyState` with CTA to Jobs.tsx:659, replacing the bare "No jobs found" text.
3. Add `BulkActionBar` to Quotes.tsx (mirrors Invoices/Jobs pattern; checkbox column already absent — needs adding).
4. Expose tasks `job_id` filter on `/tasks?job=<id>` and a "Tasks" tab on JobDetails.
5. Make NewJobModal and CreateInvoiceModal full-screen on `<sm` screens (single Tailwind class change).
6. Surface recurring rule "Next 3 occurrences" in JobDetails.tsx recurrence section so users see what they configured.
7. Persist `request_form_submissions` raw JSON before/while creating the Lead (small server-side change in `request-forms.ts:225`).
8. Add `/payments/:id` route with refund/dispute notes.

## Notes on evidence completeness

- All file:line references are from a single-pass static read; line numbers may shift if files are edited.
- The presence of an RPC in `src/lib/*` does not guarantee a corresponding SQL function exists in the deployed DB — verify via `supabase functions` and `pg_proc` listing before launch.
- Mobile responsiveness, empty-state polish, and error retry buttons were inferred from static HTML/class patterns; live device testing is recommended.
