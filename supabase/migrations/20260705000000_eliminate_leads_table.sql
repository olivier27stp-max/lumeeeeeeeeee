/* ═══════════════════════════════════════════════════════════════
   Migration — Eliminate the `leads` table

   A "lead" is no longer a distinct entity: it becomes a `clients`
   row with status = 'lead'. The funnel status (the old leads.status
   slug: new_prospect / no_response / quote_sent / closed_won /
   closed_lost) is preserved on clients.lead_status. The pipeline
   kanban position stays in pipeline_deals.stage (unchanged).

   Strategy (minimal-churn, validated with product):
   - Every lead already has a client_id (migration 20260327000000).
   - Merge lead-only columns onto the linked client.
   - KEEP every `lead_id` column (pipeline_deals, job_intents, jobs,
     quotes, bookings) but REPOINT its FK + values to clients(id).
     So `lead_id` now holds a CLIENT id; the ~30 code touchpoints
     that read `lead_id` keep working unchanged.
   - Rewrite only the functions/triggers/views that query the
     `public.leads` TABLE (swap to clients, status='lead').
   - Drop the leads↔clients bridge objects, then DROP TABLE leads.

   NOTE: prod holds test data only, so this is safe to run
   destructively. Migration must be applied + smoke-tested manually
   (no auto-apply on push).
   ═══════════════════════════════════════════════════════════════ */

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- 1. Extend `clients` with the lead-only columns
--    (email_blind / phone_blind already exist from advanced_security)
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS lead_status   text,
  ADD COLUMN IF NOT EXISTS source        text,
  ADD COLUMN IF NOT EXISTS title         text,
  ADD COLUMN IF NOT EXISTS user_id       uuid,
  ADD COLUMN IF NOT EXISTS assigned_to   uuid,
  ADD COLUMN IF NOT EXISTS assigned_team text,
  ADD COLUMN IF NOT EXISTS value         numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tags          text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS schedule      jsonb,
  ADD COLUMN IF NOT EXISTS line_items    jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS description   text,
  ADD COLUMN IF NOT EXISTS notes         text;

-- ───────────────────────────────────────────────────────────────
-- 2. Migrate lead-only data onto the linked client.
--    DISTINCT ON keeps the most recently updated lead per client.
-- ───────────────────────────────────────────────────────────────
UPDATE public.clients c
SET lead_status   = src.status,
    source        = COALESCE(c.source, src.source),
    title         = COALESCE(c.title, src.title),
    user_id       = COALESCE(c.user_id, src.user_id),
    assigned_to   = COALESCE(c.assigned_to, src.assigned_to),
    assigned_team = COALESCE(c.assigned_team, src.assigned_team),
    value         = COALESCE(NULLIF(c.value, 0), src.value, 0),
    tags          = CASE WHEN c.tags IS NULL OR c.tags = '{}' THEN COALESCE(src.tags, '{}') ELSE c.tags END,
    schedule      = COALESCE(c.schedule, src.schedule),
    line_items    = CASE WHEN c.line_items IS NULL OR c.line_items = '[]'::jsonb THEN COALESCE(src.line_items, '[]'::jsonb) ELSE c.line_items END,
    description   = COALESCE(c.description, src.description),
    notes         = COALESCE(c.notes, src.notes),
    email_blind   = COALESCE(c.email_blind, src.email_blind),
    phone_blind   = COALESCE(c.phone_blind, src.phone_blind),
    updated_at    = now()
FROM (
  SELECT DISTINCT ON (client_id)
    client_id, status, source, title, user_id, assigned_to, assigned_team,
    value, tags, schedule, line_items, description, notes,
    email_blind, phone_blind
  FROM public.leads
  WHERE client_id IS NOT NULL
    AND deleted_at IS NULL
  ORDER BY client_id, updated_at DESC
) src
WHERE src.client_id = c.id;

-- ───────────────────────────────────────────────────────────────
-- 3. Repoint every `lead_id` FK + values from leads.id -> clients.id
--    (drop FK first so the value rewrite cannot violate it).
-- ───────────────────────────────────────────────────────────────

-- 3a. pipeline_deals.lead_id (NOT NULL, CASCADE) + backfill client_id
ALTER TABLE public.pipeline_deals DROP CONSTRAINT IF EXISTS pipeline_deals_lead_id_fkey;
UPDATE public.pipeline_deals pd
SET lead_id = l.client_id
FROM public.leads l
WHERE pd.lead_id = l.id;
UPDATE public.pipeline_deals SET client_id = lead_id WHERE client_id IS NULL;
ALTER TABLE public.pipeline_deals
  ADD CONSTRAINT pipeline_deals_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.clients(id) ON DELETE CASCADE;

-- 3b. job_intents.lead_id (NOT NULL, CASCADE)
ALTER TABLE public.job_intents DROP CONSTRAINT IF EXISTS job_intents_lead_id_fkey;
UPDATE public.job_intents ji
SET lead_id = l.client_id
FROM public.leads l
WHERE ji.lead_id = l.id;
ALTER TABLE public.job_intents
  ADD CONSTRAINT job_intents_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.clients(id) ON DELETE CASCADE;

-- 3c. jobs.lead_id (nullable, SET NULL)
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_lead_id_fkey;
UPDATE public.jobs j
SET lead_id = l.client_id
FROM public.leads l
WHERE j.lead_id = l.id;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.clients(id) ON DELETE SET NULL;

-- 3d. quotes.lead_id (nullable, SET NULL)
ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_lead_id_fkey;
UPDATE public.quotes q
SET lead_id = l.client_id
FROM public.leads l
WHERE q.lead_id = l.id;
ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.clients(id) ON DELETE SET NULL;

-- 3e. bookings.lead_id (nullable, SET NULL)
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_lead_id_fkey;
UPDATE public.bookings b
SET lead_id = l.client_id
FROM public.leads l
WHERE b.lead_id = l.id;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.clients(id) ON DELETE SET NULL;

-- ───────────────────────────────────────────────────────────────
-- 4. Rewrite functions/triggers/views that query the public.leads
--    TABLE. All `lead_id` column references are kept (they now point
--    at clients). Only the leads-table reads switch to clients.
-- ───────────────────────────────────────────────────────────────

-- 4a. create_pipeline_deal — read the client instead of the lead
CREATE OR REPLACE FUNCTION public.create_pipeline_deal(
  p_lead_id    uuid,
  p_title      text,
  p_value      numeric,
  p_stage      text    DEFAULT 'new',
  p_notes      text    DEFAULT NULL,
  p_pipeline_id uuid   DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_client public.clients%rowtype;
  v_stage text;
  v_deal_id uuid;
BEGIN
  SELECT * INTO v_client
  FROM public.clients
  WHERE id = p_lead_id
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_client.id IS NULL THEN
    RAISE EXCEPTION 'Client not found';
  END IF;

  v_stage := CASE lower(trim(coalesce(p_stage, '')))
    WHEN 'new'           THEN 'new'
    WHEN 'contacted'     THEN 'contacted'
    WHEN 'estimate_sent' THEN 'estimate_sent'
    WHEN 'estimate sent' THEN 'estimate_sent'
    WHEN 'follow_up'     THEN 'follow_up'
    WHEN 'follow-up'     THEN 'follow_up'
    WHEN 'won'           THEN 'won'
    WHEN 'closed'        THEN 'closed'
    WHEN 'lost'          THEN 'lost'
    WHEN 'qualified'     THEN 'new'
    WHEN 'contact'       THEN 'contacted'
    WHEN 'quote_sent'    THEN 'estimate_sent'
    WHEN 'quote sent'    THEN 'estimate_sent'
    ELSE 'new'
  END;

  INSERT INTO public.pipeline_deals (
    org_id, created_by, lead_id, client_id, stage, value, title, notes, lost_at
  )
  VALUES (
    coalesce(v_client.org_id, public.current_org_id()),
    coalesce(auth.uid(), v_client.created_by),
    v_client.id,
    v_client.id,
    v_stage,
    coalesce(p_value, 0),
    coalesce(nullif(trim(p_title), ''), 'New deal'),
    nullif(trim(p_notes), ''),
    CASE WHEN v_stage = 'lost' THEN now() ELSE NULL END
  )
  RETURNING id INTO v_deal_id;

  RETURN v_deal_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_pipeline_deal(uuid, text, numeric, text, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.create_pipeline_deal(uuid, text, numeric, text, text, uuid) TO authenticated, service_role;

-- 4b. create_job_from_intent — resolve client directly (p_lead_id is a client id)
CREATE OR REPLACE FUNCTION public.create_job_from_intent(
  p_intent_id uuid,
  p_lead_id uuid,
  p_title text,
  p_address text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_estimated_minutes integer DEFAULT NULL,
  p_start_at timestamptz DEFAULT NULL,
  p_timezone text DEFAULT 'America/Montreal',
  p_force_create_another boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_intent public.job_intents%rowtype;
  v_client public.clients%rowtype;
  v_job_id uuid;
  v_end_at timestamptz;
  v_status text;
BEGIN
  SELECT * INTO v_intent
  FROM public.job_intents
  WHERE id = p_intent_id AND deleted_at IS NULL
  FOR UPDATE;

  IF v_intent.id IS NULL THEN
    RAISE EXCEPTION 'Intent not found';
  END IF;

  IF v_intent.status != 'pending' AND NOT p_force_create_another THEN
    RAISE EXCEPTION 'Intent already consumed';
  END IF;

  SELECT * INTO v_client
  FROM public.clients
  WHERE id = p_lead_id AND deleted_at IS NULL;

  IF v_client.id IS NULL THEN
    RAISE EXCEPTION 'Client not found. Cannot create job.';
  END IF;

  v_end_at := NULL;
  IF p_start_at IS NOT NULL AND p_estimated_minutes IS NOT NULL THEN
    v_end_at := p_start_at + (p_estimated_minutes || ' minutes')::interval;
  END IF;

  v_status := CASE WHEN p_start_at IS NOT NULL THEN 'scheduled' ELSE 'draft' END;

  INSERT INTO public.jobs (
    org_id, created_by, client_id, lead_id, title, property_address, notes,
    scheduled_at, end_at, status
  ) VALUES (
    v_client.org_id, v_uid, v_client.id, v_client.id,
    COALESCE(NULLIF(trim(p_title), ''), 'New Job'),
    COALESCE(NULLIF(trim(p_address), ''), v_client.address, ''),
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    p_start_at, v_end_at, v_status
  )
  RETURNING id INTO v_job_id;

  IF p_start_at IS NOT NULL AND v_end_at IS NOT NULL THEN
    INSERT INTO public.schedule_events (
      org_id, created_by, job_id, start_time, end_time, timezone, status
    ) VALUES (
      v_client.org_id, v_uid, v_job_id, p_start_at, v_end_at,
      COALESCE(p_timezone, 'America/Montreal'), 'scheduled'
    );
  END IF;

  UPDATE public.job_intents
  SET status = 'consumed', consumed_at = now()
  WHERE id = p_intent_id;

  RETURN jsonb_build_object(
    'job_id', v_job_id,
    'client_id', v_client.id,
    'lead_id', v_client.id,
    'status', v_status
  );
END;
$fn$;

-- 4c. sync_lead_stage_from_deal — write the funnel status onto the client
CREATE OR REPLACE FUNCTION public.sync_lead_stage_from_deal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_stage text;
BEGIN
  IF new.lead_id IS NULL THEN
    RETURN new;
  END IF;

  v_stage := case lower(coalesce(new.stage, 'qualified'))
    when 'qualified' then 'qualified'
    when 'quote sent' then 'quote_sent'
    when 'contact' then 'contacted'
    when 'closed' then 'closed'
    when 'lost' then 'lost'
    else 'qualified'
  end;

  UPDATE public.clients
  SET lead_status = v_stage,
      updated_at = now()
  WHERE id = new.lead_id
    AND org_id = new.org_id
    AND deleted_at IS NULL;

  RETURN new;
END;
$fn$;

-- 4d. soft_delete_client — drop leads cascade; cascade deals by client_id
CREATE OR REPLACE FUNCTION public.soft_delete_client(p_org_id uuid, p_client_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
  v_now timestamptz := now();
  v_client integer := 0;
  v_jobs integer := 0;
  v_pipeline_deals integer := 0;
BEGIN
  IF v_uid = '00000000-0000-0000-0000-000000000000'::uuid THEN
    NULL;
  ELSIF NOT public.has_org_admin_role(v_uid, p_org_id) THEN
    RAISE EXCEPTION 'Only owner/admin can delete clients' USING errcode = '42501';
  END IF;

  UPDATE public.clients
  SET deleted_at = v_now, updated_at = v_now
  WHERE id = p_client_id AND org_id = p_org_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_client = ROW_COUNT;

  UPDATE public.jobs
  SET deleted_at = v_now, updated_at = v_now
  WHERE client_id = p_client_id AND org_id = p_org_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_jobs = ROW_COUNT;

  UPDATE public.pipeline_deals
  SET deleted_at = v_now, updated_at = v_now
  WHERE client_id = p_client_id AND org_id = p_org_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_pipeline_deals = ROW_COUNT;

  RETURN jsonb_build_object(
    'client', v_client,
    'jobs', v_jobs,
    'leads', 0,
    'pipeline_deals', v_pipeline_deals,
    'other_rows', 0
  );
END;
$fn$;

-- 4e. archive_client — drop leads cascade; cascade deals by client_id
CREATE OR REPLACE FUNCTION public.archive_client(p_org_id uuid, p_client_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_client integer := 0;
  v_jobs integer := 0;
  v_tasks integer := 0;
  v_automations integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING errcode = '42501';
  END IF;
  IF NOT public.has_org_admin_role(v_uid, p_org_id) THEN
    RAISE EXCEPTION 'Only owner/admin can archive clients' USING errcode = '42501';
  END IF;

  UPDATE public.clients
  SET deleted_at = v_now, updated_at = v_now
  WHERE id = p_client_id AND org_id = p_org_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_client = ROW_COUNT;

  UPDATE public.jobs
  SET deleted_at = v_now, updated_at = v_now
  WHERE client_id = p_client_id AND org_id = p_org_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_jobs = ROW_COUNT;

  UPDATE public.pipeline_deals
  SET deleted_at = v_now, updated_at = v_now
  WHERE client_id = p_client_id AND org_id = p_org_id AND deleted_at IS NULL;

  UPDATE public.tasks
  SET status = 'cancelled'
  WHERE org_id = p_org_id
    AND entity_type = 'client'
    AND entity_id = p_client_id
    AND status IN ('pending', 'in_progress');
  GET DIAGNOSTICS v_tasks = ROW_COUNT;

  UPDATE public.automation_scheduled_tasks
  SET status = 'cancelled', completed_at = v_now
  WHERE org_id = p_org_id
    AND entity_type = 'client'
    AND entity_id = p_client_id
    AND status = 'pending';
  GET DIAGNOSTICS v_automations = ROW_COUNT;

  RETURN jsonb_build_object(
    'client', v_client,
    'jobs', v_jobs,
    'leads', 0,
    'tasks', v_tasks,
    'automations', v_automations
  );
END;
$$;

-- 4f. delete_client_cascade — drop leads delete; delete deals by client_id
CREATE OR REPLACE FUNCTION public.delete_client_cascade(
  p_org_id uuid,
  p_client_id uuid,
  p_deleted_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_client integer := 0;
  v_jobs integer := 0;
  v_pipeline_deals integer := 0;
  v_invoices integer := 0;
  v_invoice_items integer := 0;
  v_payments integer := 0;
  v_schedule_events integer := 0;
  v_job_line_items integer := 0;
BEGIN
  DELETE FROM public.schedule_events
  WHERE job_id IN (SELECT id FROM public.jobs WHERE client_id = p_client_id AND org_id = p_org_id);
  GET DIAGNOSTICS v_schedule_events = ROW_COUNT;

  DELETE FROM public.job_line_items
  WHERE job_id IN (SELECT id FROM public.jobs WHERE client_id = p_client_id AND org_id = p_org_id);
  GET DIAGNOSTICS v_job_line_items = ROW_COUNT;

  DELETE FROM public.payments
  WHERE invoice_id IN (SELECT id FROM public.invoices WHERE client_id = p_client_id AND org_id = p_org_id);
  GET DIAGNOSTICS v_payments = ROW_COUNT;

  DELETE FROM public.invoice_items
  WHERE invoice_id IN (SELECT id FROM public.invoices WHERE client_id = p_client_id AND org_id = p_org_id);
  GET DIAGNOSTICS v_invoice_items = ROW_COUNT;

  DELETE FROM public.invoices WHERE client_id = p_client_id AND org_id = p_org_id;
  GET DIAGNOSTICS v_invoices = ROW_COUNT;

  DELETE FROM public.pipeline_deals
  WHERE client_id = p_client_id AND org_id = p_org_id;
  GET DIAGNOSTICS v_pipeline_deals = ROW_COUNT;

  DELETE FROM public.jobs WHERE client_id = p_client_id AND org_id = p_org_id;
  GET DIAGNOSTICS v_jobs = ROW_COUNT;

  DELETE FROM public.clients WHERE id = p_client_id AND org_id = p_org_id;
  GET DIAGNOSTICS v_client = ROW_COUNT;

  RETURN jsonb_build_object(
    'client', v_client,
    'jobs', v_jobs,
    'leads', 0,
    'pipeline_deals', v_pipeline_deals,
    'invoices', v_invoices,
    'invoice_items', v_invoice_items,
    'payments', v_payments,
    'schedule_events', v_schedule_events,
    'job_line_items', v_job_line_items
  );
END;
$fn$;

-- 4g. delete_lead_and_optional_client — p_lead_id is the client id
CREATE OR REPLACE FUNCTION public.delete_lead_and_optional_client(
  p_org_id uuid,
  p_lead_id uuid,
  p_also_delete_client boolean default false,
  p_deleted_by uuid default null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := coalesce(p_deleted_by, auth.uid());
  v_deals int := 0;
  v_tasks int := 0;
  v_lead_lists int := 0;
  v_job_intents int := 0;
  v_client_deleted int := 0;
  v_client_result jsonb := '{}'::jsonb;
  v_exists int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING errcode = '42501';
  END IF;
  IF p_org_id IS NULL OR p_lead_id IS NULL THEN
    RAISE EXCEPTION 'p_org_id and p_lead_id are required' USING errcode = '22023';
  END IF;
  IF NOT public.has_org_membership(v_uid, p_org_id) THEN
    RAISE EXCEPTION 'Not a member of this org' USING errcode = '42501';
  END IF;

  SELECT count(*) INTO v_exists
  FROM public.clients WHERE id = p_lead_id AND org_id = p_org_id;
  IF v_exists = 0 THEN
    RAISE EXCEPTION 'Lead not found' USING errcode = 'P0002';
  END IF;

  IF to_regclass('public.tasks') IS NOT NULL THEN
    BEGIN
      EXECUTE 'delete from public.tasks where org_id = $1 and lead_id = $2' USING p_org_id, p_lead_id;
      GET DIAGNOSTICS v_tasks = ROW_COUNT;
    EXCEPTION WHEN others THEN v_tasks := 0; END;
  END IF;

  IF to_regclass('public.lead_lists') IS NOT NULL THEN
    BEGIN
      EXECUTE 'delete from public.lead_lists where lead_id = $1' USING p_lead_id;
      GET DIAGNOSTICS v_lead_lists = ROW_COUNT;
    EXCEPTION WHEN others THEN v_lead_lists := 0; END;
  END IF;

  DELETE FROM public.job_intents WHERE org_id = p_org_id AND lead_id = p_lead_id;
  GET DIAGNOSTICS v_job_intents = ROW_COUNT;

  DELETE FROM public.pipeline_deals WHERE org_id = p_org_id AND lead_id = p_lead_id;
  GET DIAGNOSTICS v_deals = ROW_COUNT;

  IF p_also_delete_client THEN
    v_client_result := public.delete_client_cascade(p_org_id, p_lead_id, v_uid);
    v_client_deleted := coalesce((v_client_result->>'client')::int, 0);
  END IF;

  INSERT INTO public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_org_id, v_uid, 'lead.deleted', 'lead', p_lead_id,
    jsonb_build_object(
      'deals', v_deals, 'tasks', v_tasks, 'lead_lists', v_lead_lists,
      'job_intents', v_job_intents, 'client_deleted', v_client_deleted
    )
  );

  RETURN jsonb_build_object(
    'lead', 1,
    'deals', v_deals,
    'jobs_unlinked', 0,
    'tasks', v_tasks,
    'lead_lists', v_lead_lists,
    'job_intents', v_job_intents,
    'client_deleted', v_client_deleted
  );
END;
$$;

-- 4h. delete_lead_cascade — p_lead_id is the client id
CREATE OR REPLACE FUNCTION public.delete_lead_cascade(
  p_org_id uuid,
  p_lead_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deals int := 0;
BEGIN
  DELETE FROM public.pipeline_deals WHERE lead_id = p_lead_id AND org_id = p_org_id;
  GET DIAGNOSTICS v_deals = ROW_COUNT;

  BEGIN EXECUTE 'delete from public.tasks where lead_id = $1' USING p_lead_id; EXCEPTION WHEN others THEN NULL; END;
  BEGIN EXECUTE 'delete from public.lead_lists where lead_id = $1' USING p_lead_id; EXCEPTION WHEN others THEN NULL; END;
  DELETE FROM public.job_intents WHERE lead_id = p_lead_id;

  RETURN jsonb_build_object('deals', v_deals);
END;
$$;

-- 4i. restore_lead — p_lead_id is the client id
CREATE OR REPLACE FUNCTION public.restore_lead(p_org_id uuid, p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lead integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING errcode = '42501';
  END IF;
  IF NOT public.has_org_admin_role(v_uid, p_org_id) THEN
    RAISE EXCEPTION 'Only owner/admin can restore leads' USING errcode = '42501';
  END IF;

  UPDATE public.clients
  SET deleted_at = null, deleted_by = null, archived_at = null, archived_by = null
  WHERE id = p_lead_id AND org_id = p_org_id AND archived_at IS NOT NULL;
  GET DIAGNOSTICS v_lead = ROW_COUNT;

  UPDATE public.pipeline_deals
  SET deleted_at = null, archived_at = null, archived_by = null
  WHERE lead_id = p_lead_id AND org_id = p_org_id AND archived_at IS NOT NULL;

  RETURN jsonb_build_object('lead', v_lead);
END;
$$;

-- 4j. anonymize_lead — p_lead_id is the client id
CREATE OR REPLACE FUNCTION public.anonymize_lead(p_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.clients
  SET first_name = 'ANONYMIZED', last_name = '', title = null, company = null,
      email = null, phone = null, address = null, notes = null,
      tags = array[]::text[], updated_at = now()
  WHERE id = p_lead_id;
END;
$$;

-- 4k. anonymize_inactive_leads — operate on lead-clients
CREATE OR REPLACE FUNCTION public.anonymize_inactive_leads(p_months int default 24)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $FUNC$
DECLARE
  v_cutoff timestamptz := now() - make_interval(months => p_months);
  v_count bigint := 0;
BEGIN
  WITH updated AS (
    UPDATE public.clients
       SET first_name = 'ANONYMIZED', last_name = '', title = null, company = null,
           email = null, phone = null, address = null, notes = null,
           tags = array[]::text[], updated_at = now()
     WHERE status = 'lead'
       AND updated_at < v_cutoff
       AND (first_name IS DISTINCT FROM 'ANONYMIZED' OR email IS NOT NULL OR phone IS NOT NULL)
       AND coalesce(lead_status, '') NOT IN ('closed_won', 'won')
    RETURNING id, org_id
  )
  INSERT INTO public.audit_events(org_id, actor_id, action, entity_type, entity_id, metadata)
  SELECT org_id, null, 'anonymize', 'lead', id, jsonb_build_object('method','retention_24m','cutoff',v_cutoff)
    FROM updated;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $FUNC$;

REVOKE ALL ON FUNCTION public.anonymize_inactive_leads(int) FROM public;
GRANT EXECUTE ON FUNCTION public.anonymize_inactive_leads(int) TO service_role;

-- 4l. list_archived_items — archived lead-clients come from clients
CREATE OR REPLACE FUNCTION public.list_archived_items(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clients jsonb;
  v_leads jsonb;
  v_jobs jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'type', 'client',
    'name', concat_ws(' ', c.first_name, c.last_name),
    'company', c.company, 'email', c.email, 'status', c.status,
    'archived_at', c.archived_at, 'archived_by', c.archived_by
  ) order by c.archived_at desc), '[]'::jsonb)
  INTO v_clients
  FROM public.clients c
  WHERE c.org_id = p_org_id AND c.archived_at IS NOT NULL AND coalesce(c.status, '') <> 'lead';

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id, 'type', 'lead',
    'name', concat_ws(' ', l.first_name, l.last_name),
    'company', l.company, 'email', l.email, 'status', l.lead_status,
    'archived_at', l.archived_at, 'archived_by', l.archived_by
  ) order by l.archived_at desc), '[]'::jsonb)
  INTO v_leads
  FROM public.clients l
  WHERE l.org_id = p_org_id AND l.archived_at IS NOT NULL AND l.status = 'lead';

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', j.id, 'type', 'job',
    'name', coalesce(j.title, 'Job #' || j.job_number),
    'client_name', j.client_name, 'status', j.status, 'job_number', j.job_number,
    'archived_at', j.archived_at, 'archived_by', j.archived_by
  ) order by j.archived_at desc), '[]'::jsonb)
  INTO v_jobs
  FROM public.jobs j
  WHERE j.org_id = p_org_id AND j.archived_at IS NOT NULL;

  RETURN jsonb_build_object('clients', v_clients, 'leads', v_leads, 'jobs', v_jobs);
END;
$$;

-- 4m. rpc_insights_overview — count lead-clients
CREATE OR REPLACE FUNCTION public.rpc_insights_overview(
  p_org uuid default null, p_from date default null, p_to date default null
)
RETURNS TABLE (
  new_leads_count bigint, converted_quotes_count bigint, new_oneoff_jobs_count bigint,
  invoiced_value_cents bigint, revenue_cents bigint, requests_count bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid; v_from_date date; v_to_date date; v_from_ts timestamptz; v_to_exclusive timestamptz;
  v_has_job_type boolean; v_has_payments boolean;
  v_new_leads bigint := 0; v_converted_quotes bigint := 0; v_new_oneoff_jobs bigint := 0;
  v_invoiced_cents bigint := 0; v_revenue_cents bigint := 0; v_requests bigint := null;
  v_has_requests boolean; v_requests_has_org boolean; v_requests_has_created boolean;
  v_requests_has_deleted boolean; v_requests_sql text;
BEGIN
  v_org := coalesce(p_org, public.current_org_id());
  IF v_org IS NULL THEN RAISE EXCEPTION 'Unable to resolve org_id'; END IF;
  IF NOT public.has_org_membership(auth.uid(), v_org) THEN RAISE EXCEPTION 'Not allowed for this organization'; END IF;

  v_from_date := least(coalesce(p_from, date_trunc('month', current_date)::date), coalesce(p_to, current_date));
  v_to_date := greatest(coalesce(p_from, date_trunc('month', current_date)::date), coalesce(p_to, current_date));
  v_from_ts := v_from_date::timestamptz;
  v_to_exclusive := (v_to_date + 1)::timestamptz;

  v_has_job_type := exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='job_type');
  v_has_payments := to_regclass('public.payments') is not null;

  SELECT count(*) INTO v_new_leads
  FROM public.clients l
  WHERE l.org_id = v_org AND l.status = 'lead' AND l.deleted_at IS NULL
    AND l.created_at >= v_from_ts AND l.created_at < v_to_exclusive;

  SELECT count(*) INTO v_converted_quotes
  FROM public.jobs j
  WHERE j.org_id = v_org AND j.deleted_at IS NULL AND j.lead_id IS NOT NULL
    AND j.created_at >= v_from_ts AND j.created_at < v_to_exclusive;

  SELECT count(*) INTO v_new_oneoff_jobs
  FROM public.jobs j
  WHERE j.org_id = v_org AND j.deleted_at IS NULL
    AND j.created_at >= v_from_ts AND j.created_at < v_to_exclusive
    AND (not v_has_job_type OR coalesce(nullif(lower(trim(j.job_type)), ''), 'one_off') = 'one_off');

  SELECT coalesce(sum(i.total_cents), 0)::bigint INTO v_invoiced_cents
  FROM public.invoices i
  WHERE i.org_id = v_org AND i.deleted_at IS NULL AND i.status in ('sent', 'partial', 'paid')
    AND coalesce(i.issued_at, i.created_at) >= v_from_ts AND coalesce(i.issued_at, i.created_at) < v_to_exclusive;

  IF v_has_payments THEN
    SELECT coalesce(sum(p.amount_cents), 0)::bigint INTO v_revenue_cents
    FROM public.payments p
    WHERE p.org_id = v_org AND p.deleted_at IS NULL AND p.paid_at >= v_from_ts AND p.paid_at < v_to_exclusive;
  ELSE
    SELECT coalesce(sum(i.paid_cents), 0)::bigint INTO v_revenue_cents
    FROM public.invoices i
    WHERE i.org_id = v_org AND i.deleted_at IS NULL AND i.paid_at IS NOT NULL
      AND i.paid_at >= v_from_ts AND i.paid_at < v_to_exclusive;
  END IF;

  v_has_requests := to_regclass('public.requests') is not null;
  IF v_has_requests THEN
    v_requests_has_org := exists (select 1 from information_schema.columns where table_schema='public' and table_name='requests' and column_name='org_id');
    v_requests_has_created := exists (select 1 from information_schema.columns where table_schema='public' and table_name='requests' and column_name='created_at');
    v_requests_has_deleted := exists (select 1 from information_schema.columns where table_schema='public' and table_name='requests' and column_name='deleted_at');
    IF v_requests_has_org AND v_requests_has_created THEN
      v_requests_sql := 'select count(*) from public.requests r where r.org_id = $1 and r.created_at >= $2 and r.created_at < $3';
      IF v_requests_has_deleted THEN v_requests_sql := v_requests_sql || ' and r.deleted_at is null'; END IF;
      EXECUTE v_requests_sql INTO v_requests USING v_org, v_from_ts, v_to_exclusive;
    END IF;
  END IF;

  RETURN QUERY SELECT v_new_leads, v_converted_quotes, v_new_oneoff_jobs, v_invoiced_cents, v_revenue_cents, v_requests;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_insights_overview(uuid, date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_insights_overview(uuid, date, date) TO authenticated, service_role;

-- 4n. rpc_insights_lead_conversion — lead-clients + jobs.lead_id (-> clients)
CREATE OR REPLACE FUNCTION public.rpc_insights_lead_conversion(
  p_org uuid default null, p_from date default null, p_to date default null
)
RETURNS TABLE (leads_created bigint, leads_closed bigint, conversion_rate numeric, breakdown jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid; v_from_date date; v_to_date date; v_from_ts timestamptz; v_to_exclusive timestamptz;
  v_has_payments boolean; v_created bigint := 0; v_closed bigint := 0; v_rate numeric := 0; v_breakdown jsonb := null;
BEGIN
  v_org := coalesce(p_org, public.current_org_id());
  IF v_org IS NULL THEN RAISE EXCEPTION 'Unable to resolve org_id'; END IF;
  IF NOT public.has_org_membership(auth.uid(), v_org) THEN RAISE EXCEPTION 'Not allowed for this organization'; END IF;

  v_from_date := least(coalesce(p_from, date_trunc('month', current_date)::date), coalesce(p_to, current_date));
  v_to_date := greatest(coalesce(p_from, date_trunc('month', current_date)::date), coalesce(p_to, current_date));
  v_from_ts := v_from_date::timestamptz;
  v_to_exclusive := (v_to_date + 1)::timestamptz;
  v_has_payments := to_regclass('public.payments') is not null;

  SELECT count(*) INTO v_created
  FROM public.clients l
  WHERE l.org_id = v_org AND l.status = 'lead' AND l.deleted_at IS NULL
    AND l.created_at >= v_from_ts AND l.created_at < v_to_exclusive;

  SELECT count(*) INTO v_closed
  FROM public.jobs j
  WHERE j.org_id = v_org AND j.deleted_at IS NULL AND j.lead_id IS NOT NULL
    AND j.created_at >= v_from_ts AND j.created_at < v_to_exclusive;

  IF v_created > 0 THEN v_rate := round((v_closed::numeric / v_created::numeric), 4); ELSE v_rate := 0; END IF;

  IF v_has_payments THEN
    WITH created_source AS (
      SELECT coalesce(nullif(trim(l.source), ''), 'Unknown') AS source_key, count(*)::bigint AS leads_created
      FROM public.clients l
      WHERE l.org_id = v_org AND l.status = 'lead' AND l.deleted_at IS NULL
        AND l.created_at >= v_from_ts AND l.created_at < v_to_exclusive
      GROUP BY 1
    ),
    closed_source AS (
      SELECT coalesce(nullif(trim(l.source), ''), 'Unknown') AS source_key, count(*)::bigint AS leads_closed
      FROM public.jobs j
      JOIN public.clients l ON l.id = j.lead_id AND l.org_id = j.org_id AND l.deleted_at IS NULL
      WHERE j.org_id = v_org AND j.deleted_at IS NULL AND j.lead_id IS NOT NULL
        AND j.created_at >= v_from_ts AND j.created_at < v_to_exclusive
      GROUP BY 1
    ),
    revenue_source AS (
      SELECT coalesce(nullif(trim(l.source), ''), 'Unknown') AS source_key, coalesce(sum(p.amount_cents), 0)::bigint AS revenue_cents
      FROM public.payments p
      JOIN public.jobs j ON j.id = p.job_id AND j.org_id = p.org_id AND j.deleted_at IS NULL AND j.lead_id IS NOT NULL
      JOIN public.clients l ON l.id = j.lead_id AND l.org_id = j.org_id AND l.deleted_at IS NULL
      WHERE p.org_id = v_org AND p.deleted_at IS NULL AND p.paid_at >= v_from_ts AND p.paid_at < v_to_exclusive
      GROUP BY 1
    ),
    source_keys AS (
      SELECT source_key FROM created_source UNION
      SELECT source_key FROM closed_source UNION
      SELECT source_key FROM revenue_source
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'source', sk.source_key,
      'leads_created', coalesce(cs.leads_created, 0),
      'leads_closed', coalesce(cl.leads_closed, 0),
      'revenue_cents', coalesce(rs.revenue_cents, 0)
    ) order by sk.source_key), '[]'::jsonb)
    INTO v_breakdown
    FROM source_keys sk
    LEFT JOIN created_source cs ON cs.source_key = sk.source_key
    LEFT JOIN closed_source cl ON cl.source_key = sk.source_key
    LEFT JOIN revenue_source rs ON rs.source_key = sk.source_key;
  ELSE
    WITH created_source AS (
      SELECT coalesce(nullif(trim(l.source), ''), 'Unknown') AS source_key, count(*)::bigint AS leads_created
      FROM public.clients l
      WHERE l.org_id = v_org AND l.status = 'lead' AND l.deleted_at IS NULL
        AND l.created_at >= v_from_ts AND l.created_at < v_to_exclusive
      GROUP BY 1
    ),
    closed_source AS (
      SELECT coalesce(nullif(trim(l.source), ''), 'Unknown') AS source_key, count(*)::bigint AS leads_closed
      FROM public.jobs j
      JOIN public.clients l ON l.id = j.lead_id AND l.org_id = j.org_id AND l.deleted_at IS NULL
      WHERE j.org_id = v_org AND j.deleted_at IS NULL AND j.lead_id IS NOT NULL
        AND j.created_at >= v_from_ts AND j.created_at < v_to_exclusive
      GROUP BY 1
    ),
    source_keys AS (
      SELECT source_key FROM created_source UNION SELECT source_key FROM closed_source
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'source', sk.source_key,
      'leads_created', coalesce(cs.leads_created, 0),
      'leads_closed', coalesce(cl.leads_closed, 0),
      'revenue_cents', 0
    ) order by sk.source_key), '[]'::jsonb)
    INTO v_breakdown
    FROM source_keys sk
    LEFT JOIN created_source cs ON cs.source_key = sk.source_key
    LEFT JOIN closed_source cl ON cl.source_key = sk.source_key;
  END IF;

  RETURN QUERY SELECT v_created, v_closed, v_rate, v_breakdown;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_insights_lead_conversion(uuid, date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_insights_lead_conversion(uuid, date, date) TO authenticated, service_role;

-- 4o. rpc_insights_period_comparison — count lead-clients
CREATE OR REPLACE FUNCTION public.rpc_insights_period_comparison(
  p_org uuid default null, p_from date default null, p_to date default null
)
RETURNS TABLE (metric text, current_value bigint, previous_value bigint, change_pct numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid; v_from date; v_to date; v_days int; v_prev_from date; v_prev_to date;
  v_from_ts timestamptz; v_to_ex timestamptz; v_prev_from_ts timestamptz; v_prev_to_ex timestamptz; v_has_payments boolean;
BEGIN
  v_org := coalesce(p_org, current_org_id());
  IF v_org IS NULL THEN RAISE EXCEPTION 'Unable to resolve org_id'; END IF;
  IF NOT has_org_membership(auth.uid(), v_org) THEN RAISE EXCEPTION 'Not allowed'; END IF;

  v_from := coalesce(p_from, date_trunc('month', current_date)::date);
  v_to := coalesce(p_to, current_date);
  v_days := greatest(v_to - v_from + 1, 1);
  v_prev_from := v_from - v_days; v_prev_to := v_from - 1;
  v_from_ts := v_from::timestamptz; v_to_ex := (v_to + 1)::timestamptz;
  v_prev_from_ts := v_prev_from::timestamptz; v_prev_to_ex := v_from::timestamptz;
  v_has_payments := to_regclass('public.payments') is not null;

  RETURN QUERY
  WITH cur AS (
    SELECT
      (select count(*) from clients where org_id = v_org and status = 'lead' and deleted_at is null and created_at >= v_from_ts and created_at < v_to_ex) as leads,
      (select count(*) from jobs where org_id = v_org and deleted_at is null and created_at >= v_from_ts and created_at < v_to_ex) as jobs,
      (select coalesce(sum(total_cents),0) from invoices where org_id = v_org and deleted_at is null and status in ('sent','partial','paid') and coalesce(issued_at,created_at) >= v_from_ts and coalesce(issued_at,created_at) < v_to_ex) as invoiced,
      (select count(*) from jobs where org_id = v_org and deleted_at is null and lead_id is not null and created_at >= v_from_ts and created_at < v_to_ex) as conversions,
      (select count(*) from invoices where org_id = v_org and deleted_at is null and status = 'paid' and paid_at >= v_from_ts and paid_at < v_to_ex) as paid_invoices
  ),
  prev AS (
    SELECT
      (select count(*) from clients where org_id = v_org and status = 'lead' and deleted_at is null and created_at >= v_prev_from_ts and created_at < v_prev_to_ex) as leads,
      (select count(*) from jobs where org_id = v_org and deleted_at is null and created_at >= v_prev_from_ts and created_at < v_prev_to_ex) as jobs,
      (select coalesce(sum(total_cents),0) from invoices where org_id = v_org and deleted_at is null and status in ('sent','partial','paid') and coalesce(issued_at,created_at) >= v_prev_from_ts and coalesce(issued_at,created_at) < v_prev_to_ex) as invoiced,
      (select count(*) from jobs where org_id = v_org and deleted_at is null and lead_id is not null and created_at >= v_prev_from_ts and created_at < v_prev_to_ex) as conversions,
      (select count(*) from invoices where org_id = v_org and deleted_at is null and status = 'paid' and paid_at >= v_prev_from_ts and paid_at < v_prev_to_ex) as paid_invoices
  )
  SELECT 'new_leads'::text, cur.leads::bigint, prev.leads::bigint, case when prev.leads > 0 then round(((cur.leads - prev.leads)::numeric / prev.leads) * 100, 1) else null end from cur, prev
  UNION ALL
  SELECT 'new_jobs', cur.jobs, prev.jobs, case when prev.jobs > 0 then round(((cur.jobs - prev.jobs)::numeric / prev.jobs) * 100, 1) else null end from cur, prev
  UNION ALL
  SELECT 'invoiced_value', cur.invoiced, prev.invoiced, case when prev.invoiced > 0 then round(((cur.invoiced - prev.invoiced)::numeric / prev.invoiced) * 100, 1) else null end from cur, prev
  UNION ALL
  SELECT 'conversions', cur.conversions, prev.conversions, case when prev.conversions > 0 then round(((cur.conversions - prev.conversions)::numeric / prev.conversions) * 100, 1) else null end from cur, prev
  UNION ALL
  SELECT 'paid_invoices', cur.paid_invoices, prev.paid_invoices, case when prev.paid_invoices > 0 then round(((cur.paid_invoices - prev.paid_invoices)::numeric / prev.paid_invoices) * 100, 1) else null end from cur, prev;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_insights_period_comparison(uuid, date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_insights_period_comparison(uuid, date, date) TO authenticated, service_role;

-- 4p. rpc_insights_budget_vs_actual — count lead-clients in `la` CTE
CREATE OR REPLACE FUNCTION public.rpc_insights_budget_vs_actual(p_org uuid default null, p_from date default null, p_to date default null)
RETURNS TABLE (month_label text, metric text, target_value bigint, actual_value bigint, variance_pct numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_from date; v_to date;
BEGIN
  v_org := coalesce(p_org, current_org_id());
  IF v_org IS NULL THEN RAISE EXCEPTION 'Unable to resolve org_id'; END IF;
  IF auth.uid() IS NOT NULL AND NOT has_org_membership(auth.uid(), v_org) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  v_from := coalesce(p_from, date_trunc('year',current_date)::date);
  v_to := coalesce(p_to, current_date);

  RETURN QUERY
  WITH months AS (SELECT generate_series(date_trunc('month',v_from)::date, date_trunc('month',v_to)::date, '1 month'::interval)::date AS m),
  tg AS (SELECT month, metric AS tm, target_value FROM budget_targets WHERE org_id=v_org AND month>=v_from AND month<=v_to),
  ra AS (SELECT date_trunc('month',coalesce(i.paid_at,i.issued_at))::date AS m, coalesce(sum(i.total_cents),0)::bigint AS v FROM invoices i WHERE i.org_id=v_org AND i.deleted_at IS NULL AND i.status='paid' AND coalesce(i.paid_at,i.issued_at)>=v_from::timestamptz AND coalesce(i.paid_at,i.issued_at)<(v_to+1)::timestamptz GROUP BY 1),
  ja AS (SELECT date_trunc('month',j.created_at)::date AS m, count(*)::bigint AS v FROM jobs j WHERE j.org_id=v_org AND j.deleted_at IS NULL AND j.created_at>=v_from::timestamptz AND j.created_at<(v_to+1)::timestamptz GROUP BY 1),
  la AS (SELECT date_trunc('month',l.created_at)::date AS m, count(*)::bigint AS v FROM clients l WHERE l.org_id=v_org AND l.status='lead' AND l.deleted_at IS NULL AND l.created_at>=v_from::timestamptz AND l.created_at<(v_to+1)::timestamptz GROUP BY 1)
  SELECT to_char(mo.m,'Mon YY'), 'revenue'::text, coalesce(t.target_value,0), coalesce(r.v,0), CASE WHEN coalesce(t.target_value,0)>0 THEN round(((coalesce(r.v,0)-t.target_value)::numeric/t.target_value)*100,1) ELSE NULL END
  FROM months mo LEFT JOIN tg t ON t.month=mo.m AND t.tm='revenue' LEFT JOIN ra r ON r.m=mo.m WHERE coalesce(t.target_value,0)>0 OR coalesce(r.v,0)>0
  UNION ALL
  SELECT to_char(mo.m,'Mon YY'), 'jobs', coalesce(t.target_value,0), coalesce(j.v,0), CASE WHEN coalesce(t.target_value,0)>0 THEN round(((coalesce(j.v,0)-t.target_value)::numeric/t.target_value)*100,1) ELSE NULL END
  FROM months mo LEFT JOIN tg t ON t.month=mo.m AND t.tm='jobs' LEFT JOIN ja j ON j.m=mo.m WHERE coalesce(t.target_value,0)>0 OR coalesce(j.v,0)>0
  UNION ALL
  SELECT to_char(mo.m,'Mon YY'), 'leads', coalesce(t.target_value,0), coalesce(l.v,0), CASE WHEN coalesce(t.target_value,0)>0 THEN round(((coalesce(l.v,0)-t.target_value)::numeric/t.target_value)*100,1) ELSE NULL END
  FROM months mo LEFT JOIN tg t ON t.month=mo.m AND t.tm='leads' LEFT JOIN la l ON l.m=mo.m WHERE coalesce(t.target_value,0)>0 OR coalesce(l.v,0)>0
  ORDER BY 1, 2;
END;
$$;

-- 4q. search_global_source — leads search now sourced from lead-clients
CREATE OR REPLACE FUNCTION public.search_global_source(p_org uuid, p_q text)
RETURNS TABLE (
  entity_type text, entity_id uuid, title text, subtitle text, extra_status text,
  extra_amount_cents integer, extra_currency text, extra_date text,
  extra_client_id uuid, extra_client_name text, created_at timestamptz, rank double precision
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, extensions
AS $$
  with args as (
    select p_org as org_id, trim(coalesce(p_q, '')) as raw_q, lower(trim(coalesce(p_q, ''))) as q,
      public.normalize_phone_digits(p_q) as q_digits, auth.uid() as user_id
  ),
  guard as (
    select 1 as ok from args a
    where a.raw_q <> '' and a.org_id is not null and public.has_org_membership(a.user_id, a.org_id)
  ),
  query_terms as (
    select a.q, a.q_digits, ('%' || a.q || '%')::text as pattern,
      plainto_tsquery('simple', a.q) as tsq,
      case when length(a.q_digits) >= 4 then ('%' || a.q_digits || '%')::text else null end as phone_pattern
    from args a join guard g on true
  ),
  clients_ranked as (
    select 'client'::text as entity_type, c.id as entity_id,
      coalesce(nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), nullif(c.company, ''), 'Client') as title,
      coalesce(nullif(c.company, ''), nullif(c.email, ''), nullif(c.phone, ''), nullif(c.address, ''), 'Client') as subtitle,
      c.status as extra_status, null::integer as extra_amount_cents, null::text as extra_currency,
      null::text as extra_date, null::uuid as extra_client_id, null::text as extra_client_name, c.created_at,
      (ts_rank_cd(to_tsvector('simple', lower(concat_ws(' ', c.first_name, c.last_name, c.company, c.email, c.phone, c.address))), qt.tsq) * 2.0
        + greatest(
            similarity(lower(concat_ws(' ', c.first_name, c.last_name, c.company)), qt.q),
            similarity(lower(coalesce(c.email, '')), qt.q),
            similarity(lower(coalesce(c.phone, '')), qt.q),
            similarity(lower(coalesce(c.address, '')), qt.q),
            case when qt.phone_pattern is not null and public.normalize_phone_digits(c.phone) like qt.phone_pattern then 0.9 else 0.0 end
          ))::double precision as rank
    from public.clients c join query_terms qt on true
    where c.org_id = p_org and c.deleted_at is null
      and (
        lower(concat_ws(' ', c.first_name, c.last_name, c.company, c.email, c.phone, c.address)) ilike qt.pattern
        or similarity(lower(concat_ws(' ', c.first_name, c.last_name, c.company, c.email, c.phone)), qt.q) > 0.12
        or to_tsvector('simple', lower(concat_ws(' ', c.first_name, c.last_name, c.company, c.email, c.phone, c.address))) @@ qt.tsq
        or (qt.phone_pattern is not null and public.normalize_phone_digits(c.phone) like qt.phone_pattern)
      )
  ),
  jobs_ranked as (
    select 'job'::text as entity_type, j.id as entity_id,
      coalesce(nullif(j.title, ''), nullif(j.job_number, ''), 'Job') as title,
      coalesce(nullif(j.client_name, ''), nullif(j.property_address, ''), nullif(j.status, ''), nullif(j.job_number, ''), 'Job') as subtitle,
      j.status as extra_status, j.total_cents as extra_amount_cents, j.currency as extra_currency,
      j.scheduled_at::text as extra_date, j.client_id as extra_client_id, j.client_name as extra_client_name, j.created_at,
      (ts_rank_cd(to_tsvector('simple', lower(concat_ws(' ', j.title, j.job_number, j.client_name, j.property_address, j.notes, j.status))), qt.tsq) * 2.0
        + greatest(similarity(lower(coalesce(j.title, '')), qt.q), similarity(lower(coalesce(j.client_name, '')), qt.q), similarity(lower(coalesce(j.property_address, '')), qt.q)))::double precision as rank
    from public.jobs j join query_terms qt on true
    where j.org_id = p_org and j.deleted_at is null
      and (
        lower(concat_ws(' ', j.title, j.job_number, j.client_name, j.property_address, j.notes, j.status)) ilike qt.pattern
        or similarity(lower(concat_ws(' ', j.title, j.job_number, j.client_name, j.property_address, j.notes)), qt.q) > 0.12
        or to_tsvector('simple', lower(concat_ws(' ', j.title, j.job_number, j.client_name, j.property_address, j.notes, j.status))) @@ qt.tsq
      )
  ),
  lead_candidates as (
    select l.id as entity_id,
      coalesce(nullif(pd.title, ''), nullif(trim(concat_ws(' ', l.first_name, l.last_name)), ''), 'Lead') as title,
      coalesce(nullif(pd.stage, ''), nullif(l.phone, ''), nullif(l.email, ''), 'Lead') as subtitle,
      l.lead_status as extra_status, pd.value::integer as extra_amount_cents, null::text as extra_currency,
      null::text as extra_date, null::uuid as extra_client_id, null::text as extra_client_name,
      coalesce(pd.created_at, l.created_at) as created_at,
      (ts_rank_cd(to_tsvector('simple', lower(concat_ws(' ', pd.title, pd.notes, pd.stage, l.first_name, l.last_name, l.company, l.title, l.email, l.phone))), qt.tsq) * 2.0
        + greatest(similarity(lower(coalesce(pd.title, '')), qt.q), similarity(lower(concat_ws(' ', l.first_name, l.last_name)), qt.q), similarity(lower(coalesce(l.email, '')), qt.q)))::double precision as rank,
      row_number() over (
        partition by l.id
        order by (ts_rank_cd(to_tsvector('simple', lower(concat_ws(' ', pd.title, pd.notes, pd.stage, l.first_name, l.last_name, l.company, l.title, l.email, l.phone))), qt.tsq) * 2.0
          + greatest(similarity(lower(coalesce(pd.title, '')), qt.q), similarity(lower(concat_ws(' ', l.first_name, l.last_name)), qt.q), similarity(lower(coalesce(l.email, '')), qt.q))) desc,
          coalesce(pd.created_at, l.created_at) desc
      ) as rn
    from public.pipeline_deals pd
    join public.clients l on l.id = pd.lead_id and l.org_id = p_org and l.deleted_at is null and l.status = 'lead'
    join query_terms qt on true
    where pd.org_id = p_org and pd.deleted_at is null
      and (
        lower(concat_ws(' ', pd.title, pd.notes, pd.stage, l.first_name, l.last_name, l.company, l.title, l.email, l.phone)) ilike qt.pattern
        or similarity(lower(concat_ws(' ', pd.title, pd.notes, pd.stage, l.first_name, l.last_name, l.company, l.title, l.email, l.phone)), qt.q) > 0.12
        or to_tsvector('simple', lower(concat_ws(' ', pd.title, pd.notes, pd.stage, l.first_name, l.last_name, l.company, l.title, l.email, l.phone))) @@ qt.tsq
      )
  ),
  leads_ranked as (
    select 'lead'::text as entity_type, lc.entity_id, lc.title, lc.subtitle, lc.extra_status,
      lc.extra_amount_cents, lc.extra_currency, lc.extra_date, lc.extra_client_id, lc.extra_client_name, lc.created_at, lc.rank
    from lead_candidates lc where lc.rn = 1
  ),
  invoices_ranked as (
    select 'invoice'::text as entity_type, i.id as entity_id,
      coalesce(nullif(i.invoice_number, ''), 'Invoice') as title,
      coalesce(nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), nullif(trim(c.company), ''), coalesce(i.subject, 'Invoice')) as subtitle,
      i.status as extra_status, i.total_cents as extra_amount_cents, 'CAD'::text as extra_currency,
      i.due_date::text as extra_date, i.client_id as extra_client_id,
      coalesce(nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), nullif(trim(c.company), ''), 'Unknown') as extra_client_name, i.created_at,
      (ts_rank_cd(to_tsvector('simple', lower(concat_ws(' ', i.invoice_number, i.subject, c.first_name, c.last_name, c.company, c.email))), qt.tsq) * 2.0
        + greatest(similarity(lower(coalesce(i.invoice_number, '')), qt.q), similarity(lower(concat_ws(' ', c.first_name, c.last_name, c.company)), qt.q)))::double precision as rank
    from public.invoices i
    left join public.clients c on c.id = i.client_id and c.org_id = p_org
    join query_terms qt on true
    where i.org_id = p_org and i.deleted_at is null
      and (
        lower(concat_ws(' ', i.invoice_number, i.subject, c.first_name, c.last_name, c.company, c.email)) ilike qt.pattern
        or similarity(lower(concat_ws(' ', i.invoice_number, i.subject, c.first_name, c.last_name, c.company)), qt.q) > 0.12
        or to_tsvector('simple', lower(concat_ws(' ', i.invoice_number, i.subject, c.first_name, c.last_name, c.company, c.email))) @@ qt.tsq
      )
  ),
  quotes_ranked as (
    select 'quote'::text as entity_type, q2.id as entity_id,
      coalesce(nullif(q2.quote_number, ''), 'Quote') as title,
      coalesce(nullif(q2.title, ''), nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), nullif(trim(c.company), ''),
        coalesce(nullif(trim(concat_ws(' ', l.first_name, l.last_name)), ''), 'Quote')) as subtitle,
      q2.status as extra_status, q2.total_cents as extra_amount_cents, q2.currency as extra_currency,
      q2.valid_until::text as extra_date, q2.client_id as extra_client_id,
      coalesce(nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), nullif(trim(c.company), ''),
        nullif(trim(concat_ws(' ', l.first_name, l.last_name)), ''), 'Unknown') as extra_client_name, q2.created_at,
      (ts_rank_cd(to_tsvector('simple', lower(concat_ws(' ', q2.quote_number, q2.title, q2.notes, c.first_name, c.last_name, c.company, l.first_name, l.last_name))), qt.tsq) * 2.0
        + greatest(similarity(lower(coalesce(q2.quote_number, '')), qt.q), similarity(lower(coalesce(q2.title, '')), qt.q), similarity(lower(concat_ws(' ', c.first_name, c.last_name, c.company)), qt.q)))::double precision as rank
    from public.quotes q2
    left join public.clients c on c.id = q2.client_id and c.org_id = p_org
    left join public.clients l on l.id = q2.lead_id and l.org_id = p_org
    join query_terms qt on true
    where q2.org_id = p_org and q2.deleted_at is null
      and (
        lower(concat_ws(' ', q2.quote_number, q2.title, q2.notes, c.first_name, c.last_name, c.company, l.first_name, l.last_name)) ilike qt.pattern
        or similarity(lower(concat_ws(' ', q2.quote_number, q2.title, q2.notes, c.first_name, c.last_name, c.company)), qt.q) > 0.12
        or to_tsvector('simple', lower(concat_ws(' ', q2.quote_number, q2.title, q2.notes, c.first_name, c.last_name, c.company, l.first_name, l.last_name))) @@ qt.tsq
      )
  ),
  requests_ranked as (
    select 'request'::text as entity_type, fs.id as entity_id,
      coalesce(nullif(trim(concat_ws(' ', fs.first_name, fs.last_name)), ''), 'Request') as title,
      coalesce(nullif(fs.company, ''), nullif(fs.email, ''), nullif(fs.phone, ''), nullif(fs.city, ''), 'Request') as subtitle,
      null::text as extra_status, null::integer as extra_amount_cents, null::text as extra_currency,
      fs.created_at::text as extra_date, fs.client_id as extra_client_id,
      coalesce(nullif(trim(concat_ws(' ', fs.first_name, fs.last_name)), ''), 'Unknown') as extra_client_name, fs.created_at,
      (ts_rank_cd(to_tsvector('simple', lower(concat_ws(' ', fs.first_name, fs.last_name, fs.company, fs.email, fs.phone, fs.street_address, fs.city, fs.notes))), qt.tsq) * 2.0
        + greatest(similarity(lower(concat_ws(' ', fs.first_name, fs.last_name, fs.company)), qt.q), similarity(lower(coalesce(fs.email, '')), qt.q), similarity(lower(coalesce(fs.phone, '')), qt.q),
            case when qt.phone_pattern is not null and public.normalize_phone_digits(fs.phone) like qt.phone_pattern then 0.9 else 0.0 end))::double precision as rank
    from public.form_submissions fs join query_terms qt on true
    where fs.org_id = p_org
      and (
        lower(concat_ws(' ', fs.first_name, fs.last_name, fs.company, fs.email, fs.phone, fs.street_address, fs.city, fs.notes)) ilike qt.pattern
        or similarity(lower(concat_ws(' ', fs.first_name, fs.last_name, fs.company, fs.email, fs.phone)), qt.q) > 0.12
        or to_tsvector('simple', lower(concat_ws(' ', fs.first_name, fs.last_name, fs.company, fs.email, fs.phone, fs.street_address, fs.city, fs.notes))) @@ qt.tsq
        or (qt.phone_pattern is not null and public.normalize_phone_digits(fs.phone) like qt.phone_pattern)
      )
  ),
  teams_ranked as (
    select 'team'::text as entity_type, t.id as entity_id, t.name as title, null::text as subtitle,
      null::text as extra_status, null::integer as extra_amount_cents, null::text as extra_currency,
      null::text as extra_date, null::uuid as extra_client_id, null::text as extra_client_name, t.created_at,
      (ts_rank_cd(to_tsvector('simple', lower(coalesce(t.name, ''))), qt.tsq) * 2.0 + similarity(lower(coalesce(t.name, '')), qt.q))::double precision as rank
    from public.teams t join query_terms qt on true
    where t.org_id = p_org and t.deleted_at is null
      and (lower(t.name) ilike qt.pattern or similarity(lower(coalesce(t.name, '')), qt.q) > 0.12 or to_tsvector('simple', lower(coalesce(t.name, ''))) @@ qt.tsq)
  ),
  events_ranked as (
    select 'event'::text as entity_type, se.id as entity_id,
      coalesce(nullif(j.title, ''), nullif(j.job_number, ''), 'Event') as title,
      coalesce(nullif(j.client_name, ''), to_char(se.start_time, 'Mon DD, YYYY HH24:MI')) as subtitle,
      j.status as extra_status, null::integer as extra_amount_cents, null::text as extra_currency,
      se.start_time::text as extra_date, j.client_id as extra_client_id, j.client_name as extra_client_name, se.created_at,
      (ts_rank_cd(to_tsvector('simple', lower(concat_ws(' ', j.title, j.job_number, j.client_name))), qt.tsq) * 2.0
        + greatest(similarity(lower(coalesce(j.title, '')), qt.q), similarity(lower(coalesce(j.client_name, '')), qt.q)))::double precision as rank
    from public.schedule_events se
    join public.jobs j on j.id = se.job_id and j.org_id = p_org
    join query_terms qt on true
    where se.org_id = p_org and se.deleted_at is null
      and (
        lower(concat_ws(' ', j.title, j.job_number, j.client_name)) ilike qt.pattern
        or similarity(lower(concat_ws(' ', j.title, j.job_number, j.client_name)), qt.q) > 0.12
        or to_tsvector('simple', lower(concat_ws(' ', j.title, j.job_number, j.client_name))) @@ qt.tsq
      )
  )
  select * from clients_ranked
  union all select * from jobs_ranked
  union all select * from leads_ranked
  union all select * from invoices_ranked
  union all select * from quotes_ranked
  union all select * from requests_ranked
  union all select * from teams_ranked
  union all select * from events_ranked;
$$;

REVOKE ALL ON FUNCTION public.search_global_source(uuid, text) FROM public;

-- ───────────────────────────────────────────────────────────────
-- 5. Drop the leads↔clients bridge objects (no longer needed)
-- ───────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_cascade_client_delete_to_leads ON public.clients;
DROP FUNCTION IF EXISTS public.sync_lead_to_client();
DROP FUNCTION IF EXISTS public.cascade_client_delete_to_leads();
DROP FUNCTION IF EXISTS public.ensure_client_for_lead(uuid, uuid, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.resolve_client_id_for_lead(uuid);
DROP FUNCTION IF EXISTS public.create_lead_with_client(uuid, uuid, uuid, text, text, text, text, text, text, text, text, numeric, text);
DROP FUNCTION IF EXISTS public.auto_convert_lead_to_deal_and_job(uuid);
DROP FUNCTION IF EXISTS public.soft_delete_lead(uuid, uuid);

-- ───────────────────────────────────────────────────────────────
-- 6. Drop the leads_active view, then the leads table
-- ───────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.leads_active;
DROP TABLE IF EXISTS public.leads CASCADE;

-- ───────────────────────────────────────────────────────────────
-- 7. Helpful indexes on clients for the lead workflow
-- ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_clients_org_lead_status ON public.clients (org_id, lead_status) WHERE status = 'lead';
CREATE INDEX IF NOT EXISTS idx_clients_org_source      ON public.clients (org_id, source)      WHERE status = 'lead';
CREATE INDEX IF NOT EXISTS idx_clients_org_assigned_to ON public.clients (org_id, assigned_to) WHERE status = 'lead';

-- Recreate clients_active so its `select *` exposes the newly added columns.
CREATE OR REPLACE VIEW public.clients_active WITH (security_invoker = true) AS
  SELECT * FROM public.clients WHERE deleted_at IS NULL;
GRANT SELECT ON public.clients_active TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
