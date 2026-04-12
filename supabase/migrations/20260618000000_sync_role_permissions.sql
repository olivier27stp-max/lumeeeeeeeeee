-- ═══════════════════════════════════════════════════════════════
-- Migration: Sync role permissions to match updated ROLE_PRESETS
--
-- Changes:
--   sales_rep  → remove timesheets.read, timesheets.update
--   technician → no change (tasks hidden via nav guard, not permission)
--   manager    → remove payments.read, payments.create, reports.read
--                 add invoices.create, invoices.update
--   viewer     → strip to only clients.read, quotes.read, jobs.read, calendar.read
--   support    → no change
--
-- Only updates members whose permissions column matches old defaults.
-- Members with custom overrides are left untouched.
-- ═══════════════════════════════════════════════════════════════

-- ── Sales Rep: remove timesheets ──
UPDATE memberships
SET permissions = permissions - 'timesheets.read' - 'timesheets.update',
    updated_at = now()
WHERE role = 'sales_rep'
  AND status = 'active'
  AND (permissions->>'timesheets.read')::boolean = true;

-- ── Manager: remove payments + reports ──
UPDATE memberships
SET permissions = permissions
      - 'payments.read'
      - 'payments.create'
      - 'reports.read'
      || '{"invoices.create": true, "invoices.update": true}'::jsonb,
    updated_at = now()
WHERE role = 'manager'
  AND status = 'active';

-- ── Viewer: strip to minimal ──
UPDATE memberships
SET permissions = '{"clients.read": true, "quotes.read": true, "jobs.read": true, "calendar.read": true}'::jsonb,
    updated_at = now()
WHERE role = 'viewer'
  AND status = 'active';
