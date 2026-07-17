-- ═══════════════════════════════════════════════════════════════
-- SÉCURITÉ CRITIQUE : gardes d'autorisation sur les suppressions en cascade.
--
-- Trou confirmé par test : delete_client_cascade / delete_job_cascade /
-- delete_lead_cascade (SECURITY DEFINER, grant authenticated) n'avaient
-- AUCUNE vérification — n'importe quel utilisateur authentifié de n'importe
-- quelle org pouvait supprimer définitivement les clients (avec jobs,
-- factures, paiements) de N'IMPORTE QUELLE autre compagnie (cross-tenant).
--
-- Garde : si auth.uid() est présent (appel client via PostgREST), exiger
-- owner/admin de p_org_id via has_org_admin_role(). Si auth.uid() est null,
-- l'appel vient du service_role (serveur Express) — de confiance. anon est
-- révoqué explicitement pour que ce raisonnement tienne.
--
-- Bonus : delete_lead_and_optional_client utilisait
-- coalesce(p_deleted_by, auth.uid()) — l'identité était SPOOFABLE en passant
-- le uuid d'un membre de l'org victime. Inversé : auth.uid() d'abord.
-- ═══════════════════════════════════════════════════════════════

-- 1. delete_client_cascade — corps identique à 20260705, garde ajoutée.
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
  v_uid uuid := auth.uid();
  v_client integer := 0;
  v_jobs integer := 0;
  v_pipeline_deals integer := 0;
  v_invoices integer := 0;
  v_invoice_items integer := 0;
  v_payments integer := 0;
  v_schedule_events integer := 0;
  v_job_line_items integer := 0;
BEGIN
  -- Garde : un appel utilisateur exige owner/admin de l'org.
  IF v_uid IS NOT NULL AND NOT public.has_org_admin_role(v_uid, p_org_id) THEN
    RAISE EXCEPTION 'Only owner/admin can permanently delete clients' USING errcode = '42501';
  END IF;

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

REVOKE ALL ON FUNCTION public.delete_client_cascade(uuid, uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_client_cascade(uuid, uuid, uuid) TO authenticated, service_role;

-- 2. delete_job_cascade — corps identique à 20260615, garde ajoutée.
CREATE OR REPLACE FUNCTION public.delete_job_cascade(
  p_org_id uuid,
  p_job_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_events int := 0;
  v_line_items int := 0;
BEGIN
  IF v_uid IS NOT NULL AND NOT public.has_org_admin_role(v_uid, p_org_id) THEN
    RAISE EXCEPTION 'Only owner/admin can permanently delete jobs' USING errcode = '42501';
  END IF;

  -- Unlink quotes (don't delete them — they belong to the client)
  UPDATE public.quotes SET job_id = NULL WHERE job_id = p_job_id AND org_id = p_org_id;

  -- Delete schedule events
  DELETE FROM public.schedule_events WHERE job_id = p_job_id AND org_id = p_org_id;
  GET DIAGNOSTICS v_events = ROW_COUNT;

  -- Delete line items (scopées via le job de l'org)
  DELETE FROM public.job_line_items
  WHERE job_id = p_job_id
    AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = p_job_id AND j.org_id = p_org_id);
  GET DIAGNOSTICS v_line_items = ROW_COUNT;

  -- Delete the job itself
  DELETE FROM public.jobs WHERE id = p_job_id AND org_id = p_org_id;

  RETURN jsonb_build_object(
    'job', p_job_id,
    'schedule_events', v_events,
    'line_items', v_line_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_job_cascade(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_job_cascade(uuid, uuid) TO authenticated, service_role;

-- 3. delete_lead_cascade — corps identique à 20260705, garde ajoutée
--    (+ tasks/job_intents scopés à l'org comme pipeline_deals).
CREATE OR REPLACE FUNCTION public.delete_lead_cascade(
  p_org_id uuid,
  p_lead_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_deals int := 0;
BEGIN
  IF v_uid IS NOT NULL AND NOT public.has_org_admin_role(v_uid, p_org_id) THEN
    RAISE EXCEPTION 'Only owner/admin can permanently delete leads' USING errcode = '42501';
  END IF;

  DELETE FROM public.pipeline_deals WHERE lead_id = p_lead_id AND org_id = p_org_id;
  GET DIAGNOSTICS v_deals = ROW_COUNT;

  BEGIN EXECUTE 'delete from public.tasks where lead_id = $1 and org_id = $2' USING p_lead_id, p_org_id; EXCEPTION WHEN others THEN NULL; END;
  BEGIN EXECUTE 'delete from public.lead_lists where lead_id = $1' USING p_lead_id; EXCEPTION WHEN others THEN NULL; END;
  DELETE FROM public.job_intents WHERE lead_id = p_lead_id AND org_id = p_org_id;

  RETURN jsonb_build_object('deals', v_deals);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_lead_cascade(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_lead_cascade(uuid, uuid) TO authenticated, service_role;

-- 4. delete_lead_and_optional_client — identité non spoofable :
--    auth.uid() PRIORITAIRE sur p_deleted_by (corps identique à 20260705 sinon).
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
  v_uid uuid := coalesce(auth.uid(), p_deleted_by);
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

REVOKE ALL ON FUNCTION public.delete_lead_and_optional_client(uuid, uuid, boolean, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_lead_and_optional_client(uuid, uuid, boolean, uuid) TO authenticated, service_role;
