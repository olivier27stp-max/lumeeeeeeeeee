-- ══════════════════════════════════════════════════════════════════════
-- Migration: RBAC v2 — Consolidate to 4 roles
-- Removes: manager, support, viewer
-- Keeps: owner, admin, sales_rep, technician
-- Adds: financial permission enforcement at DB level
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Step 1: Remap deprecated roles ─────────────────────────────────
-- manager → admin, support → sales_rep, viewer → sales_rep

UPDATE memberships SET role = 'admin' WHERE role = 'manager';
UPDATE memberships SET role = 'sales_rep' WHERE role = 'support';
UPDATE memberships SET role = 'sales_rep' WHERE role = 'viewer';

-- Also remap pending invitations
UPDATE invitations SET role = 'admin' WHERE role = 'manager';
UPDATE invitations SET role = 'sales_rep' WHERE role = 'support';
UPDATE invitations SET role = 'sales_rep' WHERE role = 'viewer';

-- ── Step 2: Remove 'department' scope ──────────────────────────────
UPDATE memberships SET scope = 'team' WHERE scope = 'department';
UPDATE invitations SET scope = 'team' WHERE scope = 'department';

-- ── Step 3: Update role constraints ────────────────────────────────

-- Memberships
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check
  CHECK (role IN ('owner', 'admin', 'sales_rep', 'technician'));

-- Invitations
ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_role_check;
ALTER TABLE invitations ADD CONSTRAINT invitations_role_check
  CHECK (role IN ('admin', 'sales_rep', 'technician'));

-- ── Step 4: Update scope constraints ───────────────────────────────

ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_scope_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_scope_check
  CHECK (scope IS NULL OR scope IN ('self', 'assigned', 'team', 'company'));

ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_scope_check;
ALTER TABLE invitations ADD CONSTRAINT invitations_scope_check
  CHECK (scope IS NULL OR scope IN ('self', 'assigned', 'team', 'company'));

-- ── Step 5: Sync permissions JSONB for remapped users ──────────────
-- Ensure migrated users get correct default permissions for their new role

-- For users migrated from manager → admin: ensure they have admin-level permissions
UPDATE memberships
SET permissions = jsonb_build_object(
  'clients.create', true, 'clients.read', true, 'clients.update', true, 'clients.delete', true,
  'leads.create', true, 'leads.read', true, 'leads.update', true, 'leads.delete', true, 'leads.assign', true,
  'quotes.create', true, 'quotes.read', true, 'quotes.update', true, 'quotes.delete', true, 'quotes.send', true, 'quotes.approve', true,
  'jobs.create', true, 'jobs.read', true, 'jobs.update', true, 'jobs.delete', true, 'jobs.assign', true, 'jobs.complete', true,
  'invoices.create', true, 'invoices.read', true, 'invoices.update', true, 'invoices.delete', true, 'invoices.send', true,
  'payments.read', true, 'payments.create', true, 'payments.refund', true,
  'messages.read', true, 'messages.send', true,
  'calendar.read', true, 'calendar.update', true,
  'map.access', true,
  'door_to_door.access', true, 'door_to_door.edit', true, 'door_to_door.convert', true,
  'users.invite', true, 'users.update_role', true, 'users.disable', true, 'users.delete', false,
  'settings.read', true, 'settings.update', true,
  'automations.read', true, 'automations.update', true,
  'integrations.read', true, 'integrations.update', true,
  'reports.read', true, 'analytics.view', true,
  'team.read', true, 'team.update', true,
  'gps.read', true,
  'timesheets.read', true, 'timesheets.update', true,
  'ai.use', true, 'ai.review', true, 'ai.admin', true,
  'financial.view_pricing', true, 'financial.view_invoices', true, 'financial.view_payments', true,
  'financial.view_reports', true, 'financial.view_analytics', true, 'financial.view_margins', true,
  'financial.export_data', true,
  'search.global', true
)
WHERE role = 'admin' AND (permissions IS NULL OR permissions = '{}'::jsonb);

-- ── Step 6: Ensure technicians have ZERO financial permissions ──────
-- This is a safety net: strip any financial permissions from technician memberships

UPDATE memberships
SET permissions = COALESCE(permissions, '{}'::jsonb)
  - 'financial.view_pricing'
  - 'financial.view_invoices'
  - 'financial.view_payments'
  - 'financial.view_reports'
  - 'financial.view_analytics'
  - 'financial.view_margins'
  - 'financial.export_data'
  - 'invoices.create' - 'invoices.read' - 'invoices.update' - 'invoices.delete' - 'invoices.send'
  - 'payments.read' - 'payments.create' - 'payments.refund'
  - 'reports.read' - 'analytics.view'
WHERE role = 'technician';

-- ── Step 7: Add activity log entry for audit trail ─────────────────

INSERT INTO activity_log (org_id, entity_type, entity_id, event_type, metadata)
SELECT DISTINCT org_id, 'system', gen_random_uuid()::text, 'rbac_migration_v2',
  jsonb_build_object(
    'description', 'RBAC v2 migration: consolidated to 4 roles (owner, admin, sales_rep, technician)',
    'removed_roles', '["manager", "support", "viewer"]',
    'migration_date', now()::text
  )
FROM memberships
WHERE org_id IS NOT NULL
LIMIT 100;

COMMIT;
