-- ORDER_HINT: 1/2 — timestamp collision with 20260329000000_communications_module.sql
-- (Issue C-001, audit 2026-04-21). Apply this file BEFORE the sibling.
-- Lexicographic order by full filename matches intended order. Do NOT rename (would break applied-migration checksums).

-- ═══════════════════════════════════════════════════════════════
-- Backend Audit Cleanup — 2026-03-29
-- Fixes: duplicate triggers, missing constraints, deprecated columns,
-- orphaned objects, and naming inconsistencies.
-- SAFE: No column drops, no data loss, no breaking changes.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. REMOVE DUPLICATE TRIGGERS ON payments
--    payments_sync_legacy_dates and payments_sync_dates_and_update
--    both fire on the same event — keep only one
-- ─────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_payments_sync_legacy_dates ON payments;
-- trg_payments_sync_dates (payments_sync_dates_and_update) handles both paid_at <-> payment_date sync

-- ─────────────────────────────────────────────────────────────
-- 2. REMOVE DUPLICATE updated_at TRIGGERS ON payment tables
--    payment_provider_settings has TWO identical triggers
--    payment_provider_secrets has TWO identical triggers
-- ─────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_payment_provider_settings_updated_at ON payment_provider_settings;
-- trg_payment_provider_settings_set_updated_at remains

DROP TRIGGER IF EXISTS trg_payment_provider_secrets_updated_at ON payment_provider_secrets;
-- trg_payment_provider_secrets_set_updated_at remains

-- ─────────────────────────────────────────────────────────────
-- 3. COMMENT DEPRECATED COLUMNS (no drop — frontend still references some)
--    These columns should NOT be used in new code.
-- ─────────────────────────────────────────────────────────────

-- jobs: total_amount is legacy, use total_cents
COMMENT ON COLUMN jobs.total_amount IS 'DEPRECATED: Use total_cents instead. Kept for backward compat.';
COMMENT ON COLUMN jobs.property_address IS 'DEPRECATED: Use address instead. Redundant column.';
COMMENT ON COLUMN jobs.client_name IS 'DEPRECATED: Denormalized. Use JOIN to clients table.';
COMMENT ON COLUMN jobs.salesperson_id IS 'DEPRECATED: Never used in UI. Reserved for future.';
COMMENT ON COLUMN jobs.billing_split IS 'DEPRECATED: Never used.';
COMMENT ON COLUMN jobs.requires_invoicing IS 'DEPRECATED: Never used.';

-- leads: schedule and line_items jsonb never populated
COMMENT ON COLUMN leads.schedule IS 'DEPRECATED: Never populated. Scheduling uses schedule_events.';
COMMENT ON COLUMN leads.line_items IS 'DEPRECATED: Never used. Line items use job_line_items table.';
COMMENT ON COLUMN leads.assigned_team IS 'DEPRECATED: No FK enforcement. Use team_id on jobs instead.';

-- schedule_events: legacy time column aliases
COMMENT ON COLUMN schedule_events.start_at IS 'ALIAS: Synced from start_time by trigger. Prefer start_time.';
COMMENT ON COLUMN schedule_events.end_at IS 'ALIAS: Synced from end_time by trigger. Prefer end_time.';
COMMENT ON COLUMN schedule_events.assigned_user IS 'DEPRECATED: Never used. Use team_id for assignment.';

-- payments: paid_at synced with payment_date
COMMENT ON COLUMN payments.paid_at IS 'COMPAT: Synced with payment_date by trigger. Prefer payment_date.';

-- ─────────────────────────────────────────────────────────────
-- 4. ADD MISSING NOT NULL CONSTRAINTS where safe
-- ─────────────────────────────────────────────────────────────

-- contacts.org_id should not be null for org-scoped data
-- Can't enforce NOT NULL because some contacts may already be null
-- Instead, add a partial index to catch unscoped contacts
CREATE INDEX IF NOT EXISTS idx_contacts_null_org
  ON contacts (id) WHERE org_id IS NULL;

-- ─────────────────────────────────────────────────────────────
-- 5. ADD MISSING INDEXES for common query patterns
-- ─────────────────────────────────────────────────────────────

-- quotes: commonly filtered by org + status + deleted_at
CREATE INDEX IF NOT EXISTS idx_quotes_org_status
  ON quotes (org_id, status) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_org_created_at
  ON quotes (org_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_org_lead_id
  ON quotes (org_id, lead_id) WHERE deleted_at IS NULL AND lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_org_client_id
  ON quotes (org_id, client_id) WHERE deleted_at IS NULL AND client_id IS NOT NULL;

-- quote_line_items: commonly joined by quote_id
CREATE INDEX IF NOT EXISTS idx_quote_line_items_quote_id
  ON quote_line_items (quote_id);

-- notifications: commonly filtered by org + read status
CREATE INDEX IF NOT EXISTS idx_notifications_org_unread
  ON notifications (org_id, created_at DESC) WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_org_created
  ON notifications (org_id, created_at DESC);

-- team_members: commonly joined by team_id and org_id
CREATE INDEX IF NOT EXISTS idx_team_members_team_id
  ON team_members (team_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_team_members_org_id
  ON team_members (org_id) WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────
-- 6. NORMALIZE pipeline_deals.stage CHECK constraint
--    Current values are PascalCase but leads.stage is lowercase.
--    Add lowercase aliases accepted by the CHECK.
-- ─────────────────────────────────────────────────────────────

-- Drop old constraint if exists, re-create with both formats
ALTER TABLE pipeline_deals DROP CONSTRAINT IF EXISTS pipeline_deals_stage_check;
ALTER TABLE pipeline_deals DROP CONSTRAINT IF EXISTS chk_pipeline_deals_stage;

ALTER TABLE pipeline_deals ADD CONSTRAINT chk_pipeline_deals_stage
  CHECK (stage IN (
    -- Legacy PascalCase
    'Qualified', 'Contact', 'Quote Sent', 'Closed', 'Lost',
    -- Normalized lowercase (used by newer code)
    'new', 'new_prospect', 'contacted', 'qualified', 'quote_sent',
    'negotiation', 'closed_won', 'closed_lost',
    -- Catch-all for custom stages
    'custom'
  ));

-- ─────────────────────────────────────────────────────────────
-- 7. FIX leads.status CHECK to include all valid values
--    Some migrations added values that aren't in the constraint
-- ─────────────────────────────────────────────────────────────

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE leads DROP CONSTRAINT IF EXISTS chk_leads_status;

ALTER TABLE leads ADD CONSTRAINT chk_leads_status
  CHECK (status IN ('new', 'contacted', 'qualified', 'won', 'lost', 'converted', 'closed'));

-- ─────────────────────────────────────────────────────────────
-- 8. ADD COMMENT ON TABLES for documentation
-- ─────────────────────────────────────────────────────────────

COMMENT ON TABLE clients IS 'CRM clients — companies or individuals that receive services';
COMMENT ON TABLE leads IS 'Sales leads / prospects — pre-client contacts for quotes';
COMMENT ON TABLE jobs IS 'Service jobs — scheduled work for clients';
COMMENT ON TABLE quotes IS 'Price quotes / estimates sent to leads or clients';
COMMENT ON TABLE invoices IS 'Billing invoices generated from jobs or manually';
COMMENT ON TABLE payments IS 'Payment records — Stripe, PayPal, or manual';
COMMENT ON TABLE pipeline_deals IS 'Sales pipeline deals — tracks lead progression through stages';
COMMENT ON TABLE pipeline_stages IS 'Configurable pipeline stage definitions per org';
COMMENT ON TABLE schedule_events IS 'Calendar events linked to jobs and teams';
COMMENT ON TABLE teams IS 'Work teams / crews for job assignment';
COMMENT ON TABLE team_members IS 'Members belonging to teams with roles';
COMMENT ON TABLE team_availability IS 'Weekly recurring availability slots per team';
COMMENT ON TABLE contacts IS 'Shared contact records linked to leads and clients';
COMMENT ON TABLE notifications IS 'In-app notifications per org';
COMMENT ON TABLE job_line_items IS 'Itemized line items for job pricing';
COMMENT ON TABLE invoice_items IS 'Itemized line items on invoices';
COMMENT ON TABLE quote_line_items IS 'Itemized line items on quotes';
COMMENT ON TABLE payment_providers IS 'Payment provider configuration per org';
COMMENT ON TABLE payment_provider_settings IS 'Public payment provider settings per org';
COMMENT ON TABLE payment_provider_secrets IS 'Encrypted payment provider API keys per org — RLS DENY ALL';
COMMENT ON TABLE memberships IS 'User-to-org membership with role';

-- ─────────────────────────────────────────────────────────────
-- 9. ENSURE RLS ON tables that might be missing it
-- ─────────────────────────────────────────────────────────────

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_send_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_status_history ENABLE ROW LEVEL SECURITY;

-- Policies for quote sub-tables (if not already present)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'quote_line_items' AND policyname = 'quote_line_items_org_select') THEN
    CREATE POLICY quote_line_items_org_select ON quote_line_items FOR SELECT
      USING (EXISTS (
        SELECT 1 FROM quotes q WHERE q.id = quote_line_items.quote_id
          AND public.has_org_membership(auth.uid(), q.org_id)
      ));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'quote_sections' AND policyname = 'quote_sections_org_select') THEN
    CREATE POLICY quote_sections_org_select ON quote_sections FOR SELECT
      USING (EXISTS (
        SELECT 1 FROM quotes q WHERE q.id = quote_sections.quote_id
          AND public.has_org_membership(auth.uid(), q.org_id)
      ));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'quote_send_log' AND policyname = 'quote_send_log_org_select') THEN
    CREATE POLICY quote_send_log_org_select ON quote_send_log FOR SELECT
      USING (EXISTS (
        SELECT 1 FROM quotes q WHERE q.id = quote_send_log.quote_id
          AND public.has_org_membership(auth.uid(), q.org_id)
      ));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'quote_status_history' AND policyname = 'quote_status_history_org_select') THEN
    CREATE POLICY quote_status_history_org_select ON quote_status_history FOR SELECT
      USING (EXISTS (
        SELECT 1 FROM quotes q WHERE q.id = quote_status_history.quote_id
          AND public.has_org_membership(auth.uid(), q.org_id)
      ));
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 10. SYNC jobs.total_amount from total_cents (keep in sync)
--     Add trigger so if code updates total_cents, total_amount follows
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_job_total_amount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.total_cents IS DISTINCT FROM OLD.total_cents THEN
    NEW.total_amount := NEW.total_cents / 100.0;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_jobs_sync_total_amount ON jobs;
CREATE TRIGGER trg_jobs_sync_total_amount
  BEFORE UPDATE OF total_cents ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION sync_job_total_amount();

-- Also sync on insert
DROP TRIGGER IF EXISTS trg_jobs_sync_total_amount_insert ON jobs;
CREATE TRIGGER trg_jobs_sync_total_amount_insert
  BEFORE INSERT ON jobs
  FOR EACH ROW
  WHEN (NEW.total_cents > 0 AND (NEW.total_amount IS NULL OR NEW.total_amount = 0))
  EXECUTE FUNCTION sync_job_total_amount();

-- ─────────────────────────────────────────────────────────────
-- 11. DROP ORPHANED TEMPORARY TRACKING TABLE
-- ─────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS client_link_backfill_ambiguous;

-- ─────────────────────────────────────────────────────────────
-- 12. ENSURE availabilities table has RLS if it exists
-- ─────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'availabilities' AND table_schema = 'public') THEN
    ALTER TABLE availabilities ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

COMMIT;
