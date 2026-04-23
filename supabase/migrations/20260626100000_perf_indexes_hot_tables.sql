-- ═══════════════════════════════════════════════════════════════
-- Performance indexes — hot multi-tenant tables
-- Adds composite indexes on (org_id, <frequent filter>) pairs to
-- eliminate full-table scans on queries we know are in the hot path:
--   • audit_events — written on every API request, filtered on read
--   • communication_messages — listed by job/client often
--   • field_house_profiles — territory/status filters on every map view
--   • fs_rep_stat_snapshots — leaderboard read path
--   • jobs / quotes / invoices / form_submissions — search expansion
--   • notifications — unread badge polled frequently
-- Uses IF NOT EXISTS so this is safe to re-run.
-- ═══════════════════════════════════════════════════════════════

-- audit_events (if table exists — guard with DO block)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_events') THEN
    CREATE INDEX IF NOT EXISTS idx_audit_events_org_entity_action
      ON public.audit_events (org_id, entity_type, action, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_events_org_created
      ON public.audit_events (org_id, created_at DESC);
  END IF;
END $$;

-- communication_messages (or messages, depending on schema)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'communication_messages') THEN
    CREATE INDEX IF NOT EXISTS idx_comm_messages_org_job
      ON public.communication_messages (org_id, job_id) WHERE job_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_comm_messages_org_client
      ON public.communication_messages (org_id, client_id) WHERE client_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_comm_messages_org_created
      ON public.communication_messages (org_id, created_at DESC);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'messages') THEN
    CREATE INDEX IF NOT EXISTS idx_messages_org_conversation_created
      ON public.messages (org_id, conversation_id, created_at DESC);
  END IF;
END $$;

-- field_house_profiles — geo/status filters
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'field_house_profiles') THEN
    CREATE INDEX IF NOT EXISTS idx_fhp_org_status_territory
      ON public.field_house_profiles (org_id, current_status, territory_id);
    CREATE INDEX IF NOT EXISTS idx_fhp_org_updated
      ON public.field_house_profiles (org_id, updated_at DESC);
  END IF;
END $$;

-- fs_rep_stat_snapshots — leaderboard queries
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'fs_rep_stat_snapshots') THEN
    CREATE INDEX IF NOT EXISTS idx_fs_snapshots_org_period_start
      ON public.fs_rep_stat_snapshots (org_id, period, period_start DESC);
    CREATE INDEX IF NOT EXISTS idx_fs_snapshots_org_user_period
      ON public.fs_rep_stat_snapshots (org_id, user_id, period, period_start DESC);
  END IF;
END $$;

-- field_house_events — realtime rep stats
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'field_house_events') THEN
    CREATE INDEX IF NOT EXISTS idx_fhe_org_user_created
      ON public.field_house_events (org_id, user_id, created_at DESC);
  END IF;
END $$;

-- jobs / quotes / invoices / form_submissions — search expansion by client_id
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'jobs') THEN
    CREATE INDEX IF NOT EXISTS idx_jobs_org_client_created
      ON public.jobs (org_id, client_id, created_at DESC) WHERE deleted_at IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'quotes') THEN
    CREATE INDEX IF NOT EXISTS idx_quotes_org_client_created
      ON public.quotes (org_id, client_id, created_at DESC) WHERE deleted_at IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'invoices') THEN
    CREATE INDEX IF NOT EXISTS idx_invoices_org_client_created
      ON public.invoices (org_id, client_id, created_at DESC) WHERE deleted_at IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'form_submissions') THEN
    CREATE INDEX IF NOT EXISTS idx_form_submissions_org_client_created
      ON public.form_submissions (org_id, client_id, created_at DESC);
  END IF;
END $$;

-- memberships — user lookup by org
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'memberships') THEN
    CREATE INDEX IF NOT EXISTS idx_memberships_org_user
      ON public.memberships (org_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_memberships_org_team
      ON public.memberships (org_id, team_id) WHERE team_id IS NOT NULL;
  END IF;
END $$;

-- notifications — unread count polling is called on every page
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications') THEN
    CREATE INDEX IF NOT EXISTS idx_notifications_org_user_read
      ON public.notifications (org_id, user_id, read_at)
      WHERE read_at IS NULL;
  END IF;
END $$;

-- leads / clients — soft-delete filtered lookup
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'leads') THEN
    CREATE INDEX IF NOT EXISTS idx_leads_org_created_active
      ON public.leads (org_id, created_at DESC) WHERE deleted_at IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'clients') THEN
    CREATE INDEX IF NOT EXISTS idx_clients_org_created_active
      ON public.clients (org_id, created_at DESC) WHERE deleted_at IS NULL;
  END IF;
END $$;

-- activity_log — written from many code paths, filtered by org+entity
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'activity_log') THEN
    CREATE INDEX IF NOT EXISTS idx_activity_log_org_created
      ON public.activity_log (org_id, created_at DESC);
  END IF;
END $$;

ANALYZE;
