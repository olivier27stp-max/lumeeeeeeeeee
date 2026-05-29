# Security & Multi-Tenant State — 2026-05-13

Snapshot of production posture (Supabase prod ref `bbzcuzqfgsdvjsymfwmr`) after the 2026-05-12 fix session.

---

## P0 — actively exploitable in prod

### P0-1. `webhook_payment_received` — SECURITY DEFINER + EXECUTE granted to `authenticated`, no caller-org check

**Evidence:**
```
SECURITY DEFINER, auth_can_exec = true
body: inserts into public.payments(...) and updates public.invoices SET status='paid' / paid_at / paid_cents
       WHERE id = p_invoice_id AND org_id = p_org_id
no auth.uid() check; no has_org_membership(...) check
```

**Attack scenario:** Any authenticated user from org A can call:
```
select webhook_payment_received(
  '<org_B_uuid>', '<org_B_invoice_uuid>', 'manual', 'fake', 999999999, 'evt_x'
);
```
and mark another tenant's invoice as paid, insert a fake payment row, and fire a notification — full financial-data tampering across tenants.

**Fix:** revoke EXECUTE from authenticated/anon; only `service_role` should call this (it's a webhook helper). Or add `if not has_org_membership(auth.uid(), p_org_id) then raise exception ...`.

---

### P0-2. `invalidate_all_sessions(p_user_id, p_reason)` — DEFINER, no caller check

**Evidence:** function body has zero authorization — directly `UPDATE active_sessions SET is_valid=false WHERE user_id=p_user_id`. EXECUTE granted to `authenticated`.

**Attack scenario:** Any logged-in user calls `select invalidate_all_sessions('<victim_uuid>', 'lol')` and force-logs-out arbitrary other users (DoS against any account, including platform owner).

**Fix:** require `auth.uid() = p_user_id` OR `has_org_admin_role(auth.uid(), ...)` with proper org context; or revoke from authenticated.

---

### P0-3. `seed_automation_presets(p_org_id)` — DEFINER, no caller membership check

**Evidence:** Inserts 20+ automation_rules rows targeting any `p_org_id`. No `has_org_membership` / `has_org_admin_role` check anywhere in the body. EXECUTE → authenticated.

**Attack scenario:** Any authenticated user calls `seed_automation_presets('<victim_org_id>')` and:
- pollutes another tenant's automation_rules with active `send_sms` / `send_email` rules,
- via `ON CONFLICT DO UPDATE` can overwrite their existing preset configs.
Combined with the customizable preset templating, this enables SMS/email injection against the victim's customers using their Twilio/Resend credentials.

**Fix:** add `if not has_org_admin_role(auth.uid(), p_org_id) then raise exception ...` at top.

---

### P0-4. 13 STABLE-volatility functions performing DML

Query 3 returned 13 rows (should be 0). Every function below is declared `STABLE SECURITY DEFINER` but executes `INSERT/UPDATE`:

```
archive_client, batch_restore, batch_soft_delete, create_job_from_lead,
finish_job, finish_job_and_prepare_invoice, restore_client, restore_job,
restore_lead, rpc_reschedule_event, rpc_unschedule_job,
soft_delete_client_conditional, update_lead_stage
```

**Why it's P0:** Postgres caches `STABLE` function results within a statement — this is the showstopper bug class from earlier today. Symptoms: subsequent calls in the same transaction return cached jsonb (no DML re-executed), `for update` locks may be skipped, and `GET DIAGNOSTICS ROW_COUNT` becomes nondeterministic. Some of these are wrapped in HTTP handlers where the same function is called multiple times within request-scoped transactions — silent data corruption / no-op writes.

**Fix:** `ALTER FUNCTION public.<name>(...) VOLATILE;` for each. They should all be VOLATILE since they mutate state.

---

## P1 — fix this week

### P1-1. `grant_object_permission` / `revoke_object_permission` — DEFINER, callable by authenticated, no `verify_org_access` on target user

`grant_object_permission` checks `has_org_admin_role(auth.uid(), p_org_id)` (good) but does not verify `p_user_id` is a member of `p_org_id`. An admin of org A could potentially grant a non-member arbitrary read on rows in org A. Lower severity because target user still needs RLS to read the underlying row, but defense-in-depth: assert `has_org_membership(p_user_id, p_org_id)`.

### P1-2. `batch_soft_delete_clients` — DEFINER, no auth check at all

Function body lists no `auth.uid()` validation, no `has_org_membership`. EXECUTE → authenticated. Same exploit shape as P0-3 but limited to soft-delete (still destructive). Fix: gate on `has_org_admin_role(auth.uid(), p_org_id)`.

### P1-3. `batch_soft_delete` (generic, dynamic SQL with `format(%I)`) — DEFINER

Uses `EXECUTE format('UPDATE %I SET deleted_at = now() ... ', p_entity_type || 's')` and only checks `has_org_membership` (any member, not admin). Two issues:
- Any org member (not just admin) can mass-soft-delete clients/jobs/leads/invoices/quotes.
- The `p_entity_type` parameter has no allow-list; if a member passes `'pg_'`, `'auth_'`, … they target arbitrary tables. Postgres `%I` quoting prevents SQL injection but does NOT restrict which existing table is hit — any public table with `org_id`/`id`/`deleted_at`/`deleted_by` columns is fair game.

**Fix:** enforce a whitelist of entity types; require admin role.

### P1-4. `connected_accounts_delete_org` policy has a typo bug

```
qual: (org_id = auth.uid()) OR (EXISTS ... memberships ...)
```
`org_id = auth.uid()` will never match (uuid columns of different domains) but the intent is unclear — looks like a copy-paste error. Effectively the second clause runs and lets *any member* (not admin) delete Stripe-connected account rows. Should be `has_org_admin_role(auth.uid(), org_id)`.

### P1-5. `plans` table public-readable to anon (`qual: true`)

Intentional (pricing page needs it). Verify no internal columns (e.g., `stripe_price_id`, internal cost data) are exposed via the row — query showed all columns are readable. Audit the `plans` schema for any private columns.

### P1-6. `satisfaction_surveys_select_anon` — qual = `true`

Anon role can SELECT every satisfaction survey across all tenants. The intent is "client opens survey link" but the filter should match a token (e.g., `WHERE token = current_setting('request.jwt.claims') ->> 'survey_token'` or restrict to rows where a public token is set), not blanket `true`. Currently exposes customer satisfaction text and ratings across all tenants to any anon user.

**Fix:** narrow to `(submitted_at IS NULL AND token IS NOT NULL)` or similar, matching the public-link pattern used for quotes.

### P1-7. `quote_views_insert_anon` — anon can write tracking rows for any non-deleted invoice

```
with_check: EXISTS (SELECT 1 FROM invoices i WHERE i.id = quote_views.invoice_id AND i.deleted_at IS NULL)
```
Any anon can insert fake `quote_views` rows for any invoice_id they guess (uuid v4 is hard to guess, but no token gate). Pollution of analytics, not a leak. Low priority; consider gating on `i.view_token IS NOT NULL`.

---

## P2 — defense-in-depth gaps

### P2-1. Tables without `org_id` (43 found)

Most are intentional (`plans`, `promo_codes`, `profiles`, `orgs`, `demo_requests`, `rate_limits`, `secret_rotation_log`, `webhook_events`, child tables linked via parent FK).

Worth verifying are scoped through parent FK in RLS:
- `quote_line_items`, `quote_sections`, `quote_attachments`, `quote_send_log`, `quote_status_history`, `quote_views`
- `note_items`, `note_connections`, `note_entity_links`, `note_history`, `notes_checklist`, `notes_files`, `notes_tags`
- `board_comments`, `board_drawings`, `board_votes`
- `course_lessons`, `course_modules`, `course_progress`, `course_assignments`
- `fs_challenge_participants`, `fs_gps_points`
- `tax_group_items`, `applied_taxes`
- `workflow_edges`, `workflow_nodes`, `workflow_logs`
- `incident_timeline`, `lead_lists`, `lists`, `pipelines`, `client_tags`, `referrals`, `field_sales_team_members`, `dead_letters`

Each should be spot-audited — their policies must verify the parent row's `org_id` matches `has_org_membership(auth.uid(), parent.org_id)`. Without `org_id` on the row, a buggy policy means cross-tenant access. (Did not verify all 43 in this pass.)

### P2-2. 57 functions with EXECUTE granted to `anon`

The vast majority are trigger functions, helpers, and pure utilities (FTS builders, timestamp setters, `unaccent`, `haversine_distance`, `validate_e164`, etc.). Two worth re-reading because anon can call them directly:

- `ai_on_message_insert` / `ai_set_updated_at` / `ai_enforce_org_scope` — trigger funcs; anon calling them directly does nothing meaningful but Postgres doesn't restrict direct invocation. Low risk.
- `crm_is_org_admin`, `crm_is_org_member`, `has_org_admin_role`, `has_org_membership` — anon can probe membership of `(any_user_id, any_org_id)` pairs. Returns boolean. Information leak (allows enumeration of which users belong to which orgs). Should be `authenticated` only.

### P2-3. `STABLE SECURITY DEFINER` business RPCs — admin gate uses `has_org_admin_role(auth.uid(), org_id)` consistently

For the curated subset I inspected (`archive_client`, `restore_*`, `update_lead_stage`, `finish_job`, `soft_delete_client_conditional`, `rpc_reschedule_event`, `rpc_unschedule_job`, `create_job_from_lead`, `finish_job_and_prepare_invoice`, `rpc_database_stats`, `grant_object_permission`), the authorization check is present and correct. Once STABLE→VOLATILE is fixed (P0-4), these are safe.

### P2-4. Server routes — service-role usage spot-check

73 files use `getServiceClient()`. Sampled:
- `server/routes/jobs.ts` `/jobs/assign-team`: explicitly fetches `job.org_id`, then `isOrgMember(auth.user.id, jobRow.org_id)`. ✓
- `server/routes/platform-admin.ts`: gated by `requirePlatformOwner` (matches `platformOwnerId` env). ✓
- `server/routes/marketing.ts` `/admin/demo-requests*`: all three endpoints gated by `requirePlatformOwner`. ✓
- `server/routes/public-pay.ts`: token-based access (`getPaymentRequestByToken`), then service-role used to update only the specific payment_request row. ✓

Full audit of all 73 not done — pattern looks healthy in the sample.

### P2-5. Realtime channels — all checked OK

All five `supabase.channel(...)` call sites include `filter: 'org_id=eq.${currentOrgId}'` in their `postgres_changes` config:
- `src/pages/Dashboard.tsx` (pipeline_deals, jobs, schedule_events)
- `src/pages/Schedule.tsx` (schedule_events, jobs, teams)
- `src/pages/FieldSales.tsx` (tracking_live_locations)
- `src/pages/Timesheets.tsx` (time_entries, tracking_live_locations)
- `src/lib/noteBoardsApi.ts` (presence channel scoped to single boardId)

No cross-tenant realtime leak.

### P2-6. `import.meta.env` audit — clean

All 31 references are `VITE_*` prefixed or the safe built-ins `DEV` / `MODE`. No server-only env vars leaking to the client bundle.

### P2-7. Hardcoded secrets in source — clean

Grep for `ghp_|sk_live_|sk_test_|whsec_|eyJhbGc` across `src/`, `server/`, `supabase/` found only:
- Placeholder strings in UI integrations (`'ghp_...'`, `'sk_live_... or sk_test_...'`)
- Validation refinements in `env-validation.ts` (`v.startsWith('whsec_')`)

No real keys committed.

### P2-8. Invitation flow — token entropy OK, single-use OK, expiry OK

- Token: `crypto.randomBytes(32).toString('hex')` → 256 bits.
- Storage: only `token_hash` (SHA-256) persisted. Plaintext sent in email link, never in DB.
- Single-use: status flipped to `accepted` after consumption.
- Expiry: 48h (Loi 25 short-lived).
- Rate-limit: `invitationLimiter` (Redis) on `/invitations/accept`.

Healthy. One minor: legacy `token` column lookup path still exists in `findInvitationByToken` — once all legacy invitations have expired, drop the `token` plaintext column.

### P2-9. `demo_requests` RLS

```
demo_requests_platform_admin: ALL, qual: auth.uid()::text = current_setting('app.platform_owner_id', true)
```
Restricted to one specific user via session setting. As long as the setting is not writable by RLS (it's a postgres setting), this is locked down. Verified the create-account endpoint additionally requires `requirePlatformOwner` at HTTP layer. ✓

---

## What's good

- RLS enabled on 100% of public tables (177 / 177).
- 0 tables with RLS enabled but 0 policies.
- All anon-readable policies are intentional public-facing surfaces (plans, quote view-by-token, public quote_views insert) except P1-6 (surveys).
- All payment-secret tables (`payment_provider_secrets`) restricted to `service_role` only.
- All Realtime subscriptions tenant-filtered.
- No `VITE_*`-violating env-var leakage to the client bundle.
- No hardcoded keys committed.
- Invitation flow has good token hygiene.
- Demo-requests admin path is double-gated (RLS + HTTP middleware).
- Webhook events (`webhook_events`) explicitly deny ALL to anon/authenticated — only service_role writes.

---

## Stats

- **177** tables in `public` schema, all with RLS enabled
- **0** tables with RLS enabled but no policies
- **~600+** total policies across the schema
- **9** anon-accessible policies (7 intentional public surfaces, 2 worth re-narrowing — P1-6 surveys broad SELECT, P1-7 quote_views insert)
- **57** functions with EXECUTE granted to anon (mostly triggers/utilities; 4 membership probes worth restricting — P2-2)
- **140+** SECURITY DEFINER functions executable by authenticated; sampled, 3 confirmed unsafe (P0-1, P0-2, P0-3) + 2 weak (P1-1, P1-2)
- **13** STABLE functions doing DML — P0-4
- **73** server route files using `getServiceClient()` (service-role); sample of 4 routes confirms proper tenant gating
- **5** Realtime channel subscriptions in `src/`, all tenant-filtered
- **31** `import.meta.env.*` references in `src/`, all VITE_* or DEV/MODE
- **0** hardcoded secrets found in source

---

## Suggested remediation order

1. Run `ALTER FUNCTION ... VOLATILE;` for the 13 functions in P0-4 (one migration, low risk).
2. Patch P0-1 (`webhook_payment_received`): revoke EXECUTE from authenticated, or add membership check.
3. Patch P0-2 (`invalidate_all_sessions`): add `auth.uid() = p_user_id` self-check.
4. Patch P0-3 (`seed_automation_presets`): add `has_org_admin_role(auth.uid(), p_org_id)` guard at top.
5. Patch P1-1, P1-2, P1-3, P1-4 in a single hardening migration.
6. Narrow `satisfaction_surveys_select_anon` (P1-6).
7. Move `has_org_membership` / `has_org_admin_role` / `crm_is_org_*` EXECUTE to authenticated only (P2-2).
8. Full audit of the 43 tables without `org_id` to confirm parent-FK RLS policies (P2-1).
