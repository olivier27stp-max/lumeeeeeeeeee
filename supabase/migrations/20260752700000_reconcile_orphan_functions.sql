-- ============================================================================
-- Reconciliation de derive : capture des fonctions orphelines (2026-08-02)
-- ============================================================================
-- Ces 56 fonctions vivaient en PROD sans aucun CREATE dans les migrations
-- (appliquees hors pipeline, probablement via l'ancien deploy-functions.mjs).
-- Ce fichier fige leur definition EXACTE (pg_get_functiondef depuis la prod) pour
-- que le tree de migrations puisse reconstruire la prod. Applique a la prod = NO-OP.
-- 'check_function_bodies = off' (comportement pg_dump) : ne valide pas les corps
-- pendant la creation, robuste aux dependances non encore creees sur un rebuild.
-- (unaccent exclu : fonction d'extension.)
-- Drop de 3 fonctions MORTES (feature object_permissions jamais finie : table
-- inexistante, 0 policy, 0 fonction, 0 code).
-- ============================================================================

begin;
set local check_function_bodies = off;

drop function if exists public.grant_object_permission(uuid, text, uuid, uuid, text);
drop function if exists public.has_object_permission(uuid, uuid, text, uuid, text);
drop function if exists public.revoke_object_permission(uuid, text, uuid, uuid);

-- archive_record(p_org_id uuid, p_entity_type text, p_entity_id uuid, p_reason text, p_hard_delete boolean)
CREATE OR REPLACE FUNCTION public.archive_record(p_org_id uuid, p_entity_type text, p_entity_id uuid, p_reason text DEFAULT NULL::text, p_hard_delete boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row jsonb;
  v_result jsonb;
BEGIN
  IF NOT has_org_admin_role(auth.uid(), p_org_id) THEN
    RAISE EXCEPTION 'Admin role required to archive records';
  END IF;

  -- Snapshot the entity
  EXECUTE format(
    'SELECT to_jsonb(t.*) FROM %I t WHERE t.id = $1 AND t.org_id = $2',
    p_entity_type || 's'  -- table name = entity_type + 's'
  ) INTO v_row USING p_entity_id, p_org_id;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'Record not found: % %', p_entity_type, p_entity_id;
  END IF;

  -- Store in archive
  INSERT INTO archived_records (org_id, entity_type, entity_id, entity_data, archived_by, reason)
  VALUES (p_org_id, p_entity_type, p_entity_id, v_row, auth.uid(), p_reason)
  ON CONFLICT (org_id, entity_type, entity_id) DO UPDATE
    SET entity_data = EXCLUDED.entity_data, archived_by = EXCLUDED.archived_by, archived_at = now(), reason = EXCLUDED.reason;

  IF p_hard_delete THEN
    EXECUTE format('DELETE FROM %I WHERE id = $1 AND org_id = $2', p_entity_type || 's')
      USING p_entity_id, p_org_id;
    v_result := jsonb_build_object('archived', true, 'hard_deleted', true);
  ELSE
    -- Soft delete only
    EXECUTE format(
      'UPDATE %I SET deleted_at = now(), deleted_by = $3 WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL',
      p_entity_type || 's'
    ) USING p_entity_id, p_org_id, auth.uid();
    v_result := jsonb_build_object('archived', true, 'hard_deleted', false);
  END IF;

  RETURN v_result;
END;
$function$
;

-- audit_log_trigger()
CREATE OR REPLACE FUNCTION public.audit_log_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_action text;
  v_old jsonb := NULL;
  v_new jsonb := NULL;
  v_org_id uuid;
  v_entity_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'create';
    v_new := to_jsonb(NEW);
    v_org_id := NEW.org_id;
    v_entity_id := NEW.id;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Detect soft delete
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      v_action := 'soft_delete';
    ELSE
      v_action := 'update';
    END IF;
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_org_id := NEW.org_id;
    v_entity_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'hard_delete';
    v_old := to_jsonb(OLD);
    v_org_id := OLD.org_id;
    v_entity_id := OLD.id;
  END IF;

  INSERT INTO audit_events (org_id, actor_id, action, entity_type, entity_id, event_type, old_values, new_values, metadata)
  VALUES (
    v_org_id,
    auth.uid(),
    v_action,
    TG_TABLE_NAME,
    v_entity_id,
    TG_TABLE_NAME || '.' || v_action,
    v_old,
    v_new,
    jsonb_build_object('trigger', TG_NAME, 'op', TG_OP)
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$
;

-- automation_invoice_overdue_check()
CREATE OR REPLACE FUNCTION public.automation_invoice_overdue_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IN ('sent', 'partial')
    AND NEW.due_date < CURRENT_DATE
    AND (OLD.due_date IS NULL OR OLD.due_date >= CURRENT_DATE OR OLD.status != NEW.status)
    AND NEW.deleted_at IS NULL
  THEN
    INSERT INTO notifications (org_id, type, ref_id, title, body, message, entity_type, entity_id)
    VALUES (
      NEW.org_id, 'invoice_overdue', NEW.id,
      'Invoice overdue: ' || COALESCE(NEW.invoice_number, ''),
      'Invoice ' || COALESCE(NEW.invoice_number, '') || ' is past due.',
      'Invoice ' || COALESCE(NEW.invoice_number, '') || ' is past due.',
      'invoice', NEW.id
    );
  END IF;
  RETURN NEW;
END;
$function$
;

-- automation_job_completed()
CREATE OR REPLACE FUNCTION public.automation_job_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rule record;
  v_start_ms bigint;
  v_invoice_result jsonb;
BEGIN
  -- Only fire on status change to 'completed'
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NEW.status != 'completed' THEN RETURN NEW; END IF;
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;

  -- Set completed_at if not set
  IF NEW.completed_at IS NULL THEN
    NEW.completed_at := now() AT TIME ZONE 'America/Toronto';
  END IF;

  -- Check for active automation rules
  FOR v_rule IN
    SELECT * FROM automation_rules
    WHERE org_id = NEW.org_id
      AND entity_type = 'job'
      AND trigger_on = 'status_change'
      AND is_active = true
      AND deleted_at IS NULL
      AND (
        conditions->>'to_status' IS NULL
        OR conditions->>'to_status' = 'completed'
      )
    ORDER BY priority
  LOOP
    v_start_ms := extract(epoch from clock_timestamp()) * 1000;

    BEGIN
      -- Execute each action
      IF v_rule.actions @> '[{"type":"create_invoice"}]'::jsonb THEN
        SELECT create_invoice_from_job(NEW.org_id, NEW.id) INTO v_invoice_result;

        INSERT INTO automation_executions (org_id, rule_id, entity_type, entity_id, trigger_event, actions_run, status, duration_ms)
        VALUES (
          NEW.org_id, v_rule.id, 'job', NEW.id, 'status_change:completed',
          jsonb_build_array(jsonb_build_object('type', 'create_invoice', 'result', v_invoice_result)),
          'success',
          (extract(epoch from clock_timestamp()) * 1000 - v_start_ms)::int
        );
      END IF;

      IF v_rule.actions @> '[{"type":"send_notification"}]'::jsonb THEN
        INSERT INTO notifications (org_id, type, ref_id, title, body)
        VALUES (
          NEW.org_id, 'job_completed', NEW.id,
          'Job completed: ' || COALESCE(NEW.title, NEW.job_number),
          'Job #' || COALESCE(NEW.job_number, '') || ' has been marked as completed.'
        );

        INSERT INTO automation_executions (org_id, rule_id, entity_type, entity_id, trigger_event, actions_run, status, duration_ms)
        VALUES (
          NEW.org_id, v_rule.id, 'job', NEW.id, 'status_change:completed',
          '[{"type":"send_notification"}]'::jsonb,
          'success',
          (extract(epoch from clock_timestamp()) * 1000 - v_start_ms)::int
        );
      END IF;

    EXCEPTION WHEN OTHERS THEN
      INSERT INTO automation_executions (org_id, rule_id, entity_type, entity_id, trigger_event, actions_run, status, error_message, duration_ms)
      VALUES (
        NEW.org_id, v_rule.id, 'job', NEW.id, 'status_change:completed',
        v_rule.actions, 'error', SQLERRM,
        (extract(epoch from clock_timestamp()) * 1000 - v_start_ms)::int
      );
    END;
  END LOOP;

  RETURN NEW;
END;
$function$
;

-- automation_lead_stage_change()
CREATE OR REPLACE FUNCTION public.automation_lead_stage_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.stage IS DISTINCT FROM NEW.stage AND NEW.deleted_at IS NULL THEN
    INSERT INTO notifications (org_id, type, ref_id, title, body, metadata)
    VALUES (
      NEW.org_id, 'lead_stage_change', NEW.id,
      'Lead stage: ' || COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, ''),
      'Stage changed from ' || COALESCE(OLD.stage, 'none') || ' to ' || COALESCE(NEW.stage, 'none'),
      jsonb_build_object('from_stage', OLD.stage, 'to_stage', NEW.stage)
    );
  END IF;
  RETURN NEW;
END;
$function$
;

-- batch_restore(p_org_id uuid, p_entity_type text, p_entity_ids uuid[])
CREATE OR REPLACE FUNCTION public.batch_restore(p_org_id uuid, p_entity_type text, p_entity_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count int;
BEGIN
  IF NOT has_org_admin_role(auth.uid(), p_org_id) THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;

  EXECUTE format(
    'UPDATE %I SET deleted_at = NULL, deleted_by = NULL WHERE org_id = $1 AND id = ANY($2)',
    p_entity_type || 's'
  ) USING p_org_id, p_entity_ids;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('restored_count', v_count);
END;
$function$
;

-- batch_soft_delete(p_org_id uuid, p_entity_type text, p_entity_ids uuid[])
CREATE OR REPLACE FUNCTION public.batch_soft_delete(p_org_id uuid, p_entity_type text, p_entity_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count int;
BEGIN
  IF NOT has_org_membership(auth.uid(), p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  EXECUTE format(
    'UPDATE %I SET deleted_at = now(), deleted_by = $3 WHERE org_id = $1 AND id = ANY($2) AND deleted_at IS NULL',
    p_entity_type || 's'
  ) USING p_org_id, p_entity_ids, auth.uid();

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('deleted_count', v_count);
END;
$function$
;

-- build_client_fts_vector(r clients)
CREATE OR REPLACE FUNCTION public.build_client_fts_vector(r clients)
 RETURNS tsvector
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    setweight(to_tsvector('french_unaccent', coalesce(r.first_name, '')), 'A') ||
    setweight(to_tsvector('french_unaccent', coalesce(r.last_name, '')), 'A') ||
    setweight(to_tsvector('french_unaccent', coalesce(r.company, '')), 'B') ||
    setweight(to_tsvector('french_unaccent', coalesce(r.email, '')), 'C') ||
    setweight(to_tsvector('french_unaccent', coalesce(r.phone, '')), 'D') ||
    setweight(to_tsvector('french_unaccent', coalesce(r.address, '')), 'D');
$function$
;

-- build_invoice_fts_vector(r invoices)
CREATE OR REPLACE FUNCTION public.build_invoice_fts_vector(r invoices)
 RETURNS tsvector
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    setweight(to_tsvector('french_unaccent', coalesce(r.invoice_number, '')), 'A') ||
    setweight(to_tsvector('french_unaccent', coalesce(r.subject, '')), 'B');
$function$
;

-- build_job_fts_vector(r jobs)
CREATE OR REPLACE FUNCTION public.build_job_fts_vector(r jobs)
 RETURNS tsvector
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    setweight(to_tsvector('french_unaccent', coalesce(r.title, '')), 'A') ||
    setweight(to_tsvector('french_unaccent', coalesce(r.job_number, '')), 'A') ||
    setweight(to_tsvector('french_unaccent', coalesce(r.address, '')), 'B') ||
    setweight(to_tsvector('french_unaccent', coalesce(r.description, '')), 'C') ||
    setweight(to_tsvector('french_unaccent', coalesce(r.notes, '')), 'D');
$function$
;

-- business_days_between(p_start date, p_end date)
CREATE OR REPLACE FUNCTION public.business_days_between(p_start date, p_end date)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT COUNT(*)::int
  FROM generate_series(p_start, p_end - 1, '1 day'::interval) d
  WHERE EXTRACT(isodow FROM d) < 6;
$function$
;

-- clients_before_insert_set_org()
CREATE OR REPLACE FUNCTION public.clients_before_insert_set_org()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.org_id is null then
    select o into new.org_id
    from public.current_org_ids() o
    limit 1;
  end if;

  if new.org_id is null then
    raise exception 'org_id missing: user has no org membership';
  end if;

  return new;
end;
$function$
;

-- convert_currency(p_amount_cents integer, p_from_currency text, p_to_currency text, p_date date)
CREATE OR REPLACE FUNCTION public.convert_currency(p_amount_cents integer, p_from_currency text, p_to_currency text, p_date date DEFAULT CURRENT_DATE)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rate numeric;
BEGIN
  IF p_from_currency = p_to_currency THEN
    RETURN p_amount_cents;
  END IF;

  SELECT rate INTO v_rate
  FROM currency_rates
  WHERE base_currency = p_from_currency
    AND target_currency = p_to_currency
    AND valid_from <= p_date
    AND (valid_to IS NULL OR valid_to >= p_date)
  ORDER BY valid_from DESC
  LIMIT 1;

  IF v_rate IS NULL THEN
    -- Try reverse
    SELECT 1.0 / rate INTO v_rate
    FROM currency_rates
    WHERE base_currency = p_to_currency
      AND target_currency = p_from_currency
      AND valid_from <= p_date
      AND (valid_to IS NULL OR valid_to >= p_date)
    ORDER BY valid_from DESC
    LIMIT 1;
  END IF;

  IF v_rate IS NULL THEN
    RAISE EXCEPTION 'No exchange rate found for % → % on %', p_from_currency, p_to_currency, p_date;
  END IF;

  RETURN ROUND(p_amount_cents * v_rate)::int;
END;
$function$
;

-- create_or_get_invoice_from_job(p_org_id uuid, p_job_id uuid)
CREATE OR REPLACE FUNCTION public.create_or_get_invoice_from_job(p_org_id uuid, p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_job record;
  v_existing record;
  v_invoice_id uuid;
  v_invoice_number text;
  v_due_date date := (current_date + interval '14 days')::date;
  v_subtotal_cents integer := 0;
  v_tax_cents integer := 0;
  v_total_cents integer := 0;
  v_line_count integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_org_id is null or p_job_id is null then
    raise exception 'p_org_id and p_job_id are required' using errcode = '22023';
  end if;

  if not public.crm_is_org_admin(p_org_id, v_uid) then
    raise exception 'Only owner/admin can create invoice from job' using errcode = '42501';
  end if;

  select *
    into v_job
  from public.jobs j
  where j.id = p_job_id
    and j.org_id = p_org_id
    and j.deleted_at is null
  for update;

  if not found then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;

  if v_job.client_id is null then
    raise exception 'Job must have client_id' using errcode = '23514';
  end if;

  select i.id, i.status
    into v_existing
  from public.invoices i
  where i.org_id = p_org_id
    and i.job_id = p_job_id
    and i.deleted_at is null
  order by i.created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'invoice_id', v_existing.id,
      'already_exists', true,
      'status', v_existing.status
    );
  end if;

  v_subtotal_cents := greatest(
    coalesce(
      (v_job.subtotal * 100)::integer,
      v_job.total_cents,
      round(coalesce(v_job.total_amount, 0) * 100)::integer,
      0
    ),
    0
  );

  v_tax_cents := greatest(
    coalesce((v_job.tax_total * 100)::integer, 0),
    0
  );

  v_total_cents := greatest(
    coalesce(
      (v_job.total * 100)::integer,
      v_subtotal_cents + v_tax_cents,
      0
    ),
    0
  );

  v_invoice_number := public.crm_next_invoice_number(p_org_id);

  insert into public.invoices (
    org_id,
    created_by,
    client_id,
    job_id,
    invoice_number,
    status,
    subject,
    issued_at,
    due_date,
    subtotal_cents,
    tax_cents,
    total_cents,
    paid_cents,
    balance_cents,
    currency
  )
  values (
    p_org_id,
    v_uid,
    v_job.client_id,
    p_job_id,
    v_invoice_number,
    'draft',
    coalesce(nullif(trim(v_job.title), ''), 'Job invoice'),
    null,
    v_due_date,
    v_subtotal_cents,
    v_tax_cents,
    v_total_cents,
    0,
    v_total_cents,
    coalesce(v_job.currency, 'CAD')
  )
  returning id into v_invoice_id;

  -- Essaye de copier les lignes job_line_items si la table existe
  begin
    insert into public.invoice_items (org_id, invoice_id, description, qty, unit_price_cents, line_total_cents)
    select
      p_org_id,
      v_invoice_id,
      coalesce(nullif(trim(jli.name), ''), 'Job line item'),
      greatest(coalesce(jli.qty, 1), 0),
      greatest(coalesce(jli.unit_price_cents, 0), 0),
      greatest(round(coalesce(jli.qty, 1) * coalesce(jli.unit_price_cents, 0))::integer, 0)
    from public.job_line_items jli
    where jli.job_id = p_job_id
      and (jli.org_id = p_org_id or jli.org_id is null);

    get diagnostics v_line_count = row_count;
  exception
    when undefined_table then
      v_line_count := 0;
  end;

  -- Fallback: une ligne unique si aucune ligne item
  if v_line_count = 0 then
    insert into public.invoice_items (org_id, invoice_id, description, qty, unit_price_cents, line_total_cents)
    values (
      p_org_id,
      v_invoice_id,
      coalesce(nullif(trim(v_job.title), ''), 'Job service'),
      1,
      v_total_cents,
      v_total_cents
    );
  end if;

  -- Si la fonction existe, recalcul officiel
  if to_regprocedure('public.recalculate_invoice_totals(uuid)') is not null then
    perform public.recalculate_invoice_totals(v_invoice_id);
  end if;

  return jsonb_build_object(
    'ok', true,
    'invoice_id', v_invoice_id,
    'already_exists', false,
    'status', 'draft'
  );

exception
  when unique_violation then
    select i.id, i.status
      into v_existing
    from public.invoices i
    where i.org_id = p_org_id
      and i.job_id = p_job_id
      and i.deleted_at is null
    order by i.created_at desc
    limit 1;

    if found then
      return jsonb_build_object(
        'ok', true,
        'invoice_id', v_existing.id,
        'already_exists', true,
        'status', v_existing.status
      );
    end if;

    raise;
end;
$function$
;

-- crm_invoices_ensure_number()
CREATE OR REPLACE FUNCTION public.crm_invoices_ensure_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.invoice_number is null or btrim(new.invoice_number) = '' then
    new.invoice_number := public.crm_next_invoice_number(new.org_id);
  end if;

  if new.created_at is null then
    new.created_at := now();
  end if;
  if new.updated_at is null then
    new.updated_at := now();
  end if;

  return new;
end;
$function$
;

-- crm_is_org_admin(p_org_id uuid, p_user_id uuid)
CREATE OR REPLACE FUNCTION public.crm_is_org_admin(p_org_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.memberships m
    where m.org_id = p_org_id
      and m.user_id = coalesce(p_user_id, auth.uid())
      and m.role in ('owner','admin')
  );
$function$
;

-- crm_is_org_member(p_org_id uuid, p_user_id uuid)
CREATE OR REPLACE FUNCTION public.crm_is_org_member(p_org_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.memberships m
    where m.org_id = p_org_id
      and m.user_id = coalesce(p_user_id, auth.uid())
  );
$function$
;

-- crm_leads_stage_timestamps()
CREATE OR REPLACE FUNCTION public.crm_leads_stage_timestamps()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.stage := public.crm_normalize_lead_stage(new.stage);

  if new.stage = 'lost' then
    new.lost_at := coalesce(new.lost_at, now());
  elsif tg_op = 'update' and old.stage = 'lost' and new.stage <> 'lost' then
    new.lost_at := null;
  end if;

  if new.stage = 'closed' then
    new.closed_at := coalesce(new.closed_at, now());
  elsif tg_op = 'update' and old.stage = 'closed' and new.stage <> 'closed' then
    new.closed_at := null;
  end if;

  new.updated_at := now();
  return new;
end;
$function$
;

-- crm_normalize_lead_stage(p_value text)
CREATE OR REPLACE FUNCTION public.crm_normalize_lead_stage(p_value text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  v text := lower(trim(coalesce(p_value, '')));
begin
  if v in ('qualified','new','lead') then return 'qualified'; end if;
  if v in ('contacted','contact') then return 'contacted'; end if;
  if v in ('quote_sent','quote sent','proposal') then return 'quote_sent'; end if;
  if v in ('closed','won','converted') then return 'closed'; end if;
  if v in ('lost','dead','cancelled','canceled') then return 'lost'; end if;
  return 'qualified';
end;
$function$
;

-- enforce_tenant()
CREATE OR REPLACE FUNCTION public.enforce_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid;
begin
  v_org := public.current_org_id();
  if v_org is null then
    raise exception 'No org membership found for current user' using errcode = '42501';
  end if;

  if to_jsonb(new) ? 'org_id' then
    new.org_id := v_org;
  end if;

  if to_jsonb(new) ? 'created_by' and new.created_by is null then
    new.created_by := auth.uid();
  end if;

  return new;
end;
$function$
;

-- enforce_tenant_consistency()
CREATE OR REPLACE FUNCTION public.enforce_tenant_consistency()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'app'
AS $function$
      begin
        return new;
      end;
      $function$
;

-- find_duplicate_clients(p_org_id uuid, p_first_name text, p_last_name text, p_email text, p_phone text, p_threshold real)
CREATE OR REPLACE FUNCTION public.find_duplicate_clients(p_org_id uuid, p_first_name text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_threshold real DEFAULT 0.3)
 RETURNS TABLE(client_id uuid, first_name text, last_name text, email text, phone text, company text, similarity_score real)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    c.id, c.first_name, c.last_name, c.email, c.phone, c.company,
    GREATEST(
      CASE WHEN p_email IS NOT NULL AND c.email IS NOT NULL THEN
        CASE WHEN lower(c.email) = lower(p_email) THEN 1.0 ELSE similarity(c.email, p_email) END
      ELSE 0 END,
      CASE WHEN p_phone IS NOT NULL AND c.phone IS NOT NULL THEN
        similarity(regexp_replace(c.phone, '[^0-9]', '', 'g'), regexp_replace(p_phone, '[^0-9]', '', 'g'))
      ELSE 0 END,
      CASE WHEN p_first_name IS NOT NULL AND p_last_name IS NOT NULL THEN
        (similarity(c.first_name, p_first_name) + similarity(c.last_name, p_last_name)) / 2.0
      ELSE 0 END
    )::real AS similarity_score
  FROM clients c
  WHERE c.org_id = p_org_id AND c.deleted_at IS NULL
    AND (
      (p_email IS NOT NULL AND c.email IS NOT NULL AND (lower(c.email) = lower(p_email) OR similarity(c.email, p_email) > p_threshold))
      OR (p_phone IS NOT NULL AND c.phone IS NOT NULL AND similarity(regexp_replace(c.phone, '[^0-9]', '', 'g'), regexp_replace(p_phone, '[^0-9]', '', 'g')) > p_threshold)
      OR (p_first_name IS NOT NULL AND p_last_name IS NOT NULL AND (similarity(c.first_name, p_first_name) + similarity(c.last_name, p_last_name)) / 2.0 > p_threshold)
    )
  ORDER BY similarity_score DESC
  LIMIT 10;
END;
$function$
;

-- finish_job(p_org_id uuid, p_job_id uuid)
CREATE OR REPLACE FUNCTION public.finish_job(p_org_id uuid, p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_job_id uuid;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not public.crm_is_org_admin(p_org_id, v_user) then raise exception 'Only owner/admin can finish job' using errcode='42501'; end if;

  update public.jobs
  set status = 'completed',
      completed_at = coalesce(completed_at, now()),
      updated_at = now()
  where id = p_job_id and org_id = p_org_id and deleted_at is null
  returning id into v_job_id;

  if v_job_id is null then
    return jsonb_build_object('ok', false, 'error', 'Job not found');
  end if;

  return jsonb_build_object('ok', true, 'job_id', v_job_id);
end;
$function$
;

-- format_montreal_date(ts timestamp with time zone, fmt text)
CREATE OR REPLACE FUNCTION public.format_montreal_date(ts timestamp with time zone, fmt text DEFAULT 'YYYY-MM-DD HH24:MI'::text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT to_char(ts AT TIME ZONE 'America/Toronto', fmt);
$function$
;

-- generate_invoice_from_template(p_org_id uuid, p_template_id uuid, p_client_id uuid, p_job_id uuid, p_items jsonb, p_due_days integer)
CREATE OR REPLACE FUNCTION public.generate_invoice_from_template(p_org_id uuid, p_template_id uuid, p_client_id uuid, p_job_id uuid DEFAULT NULL::uuid, p_items jsonb DEFAULT '[]'::jsonb, p_due_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_template invoice_templates;
  v_inv_number text;
  v_inv_id uuid;
  v_subtotal int := 0;
  v_tax_cents int := 0;
  v_tps_rate numeric;
  v_tvq_rate numeric;
  v_item jsonb;
  v_line_total int;
BEGIN
  IF NOT has_org_membership(auth.uid(), p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_template FROM invoice_templates
  WHERE id = p_template_id AND org_id = p_org_id AND deleted_at IS NULL;

  IF v_template.id IS NULL THEN
    RAISE EXCEPTION 'Template not found';
  END IF;

  v_tps_rate := COALESCE((v_template.tax_config->>'tps_rate')::numeric, 5.0);
  v_tvq_rate := COALESCE((v_template.tax_config->>'tvq_rate')::numeric, 9.975);

  -- Calculate subtotal from items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_line_total := (COALESCE((v_item->>'qty')::numeric, 1) * COALESCE((v_item->>'unit_price_cents')::int, 0))::int;
    v_subtotal := v_subtotal + v_line_total;
  END LOOP;

  -- Calculate taxes (Quebec TPS + TVQ)
  v_tax_cents := ROUND(v_subtotal * (v_tps_rate + v_tvq_rate) / 100)::int;

  -- Get next invoice number
  SELECT invoice_next_number(p_org_id) INTO v_inv_number;

  -- Create invoice
  INSERT INTO invoices (
    org_id, created_by, client_id, job_id, invoice_number, status,
    subject, issued_at, due_date, subtotal_cents, tax_cents, total_cents,
    paid_cents, balance_cents, currency
  ) VALUES (
    p_org_id, auth.uid(), p_client_id, p_job_id, v_inv_number, 'draft',
    COALESCE(v_template.name, 'Invoice'),
    now(), CURRENT_DATE + p_due_days,
    v_subtotal, v_tax_cents, v_subtotal + v_tax_cents,
    0, v_subtotal + v_tax_cents,
    COALESCE(v_template.currency, 'CAD')
  ) RETURNING id INTO v_inv_id;

  -- Insert line items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO invoice_items (org_id, invoice_id, description, qty, unit_price_cents)
    VALUES (
      p_org_id, v_inv_id,
      COALESCE(v_item->>'description', ''),
      COALESCE((v_item->>'qty')::numeric, 1),
      COALESCE((v_item->>'unit_price_cents')::int, 0)
    );
  END LOOP;

  RETURN jsonb_build_object(
    'invoice_id', v_inv_id,
    'invoice_number', v_inv_number,
    'subtotal_cents', v_subtotal,
    'tax_cents', v_tax_cents,
    'total_cents', v_subtotal + v_tax_cents,
    'currency', COALESCE(v_template.currency, 'CAD'),
    'tax_breakdown', jsonb_build_object('tps', ROUND(v_subtotal * v_tps_rate / 100), 'tvq', ROUND(v_subtotal * v_tvq_rate / 100))
  );
END;
$function$
;

-- get_audit_log(p_org_id uuid, p_entity_type text, p_entity_id uuid, p_action text, p_from timestamp with time zone, p_to timestamp with time zone, p_limit integer, p_offset integer)
CREATE OR REPLACE FUNCTION public.get_audit_log(p_org_id uuid, p_entity_type text DEFAULT NULL::text, p_entity_id uuid DEFAULT NULL::uuid, p_action text DEFAULT NULL::text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, actor_id uuid, action text, entity_type text, entity_id uuid, event_type text, old_values jsonb, new_values jsonb, metadata jsonb, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT has_org_membership(auth.uid(), p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT ae.id, ae.actor_id, ae.action, ae.entity_type, ae.entity_id,
         ae.event_type, ae.old_values, ae.new_values, ae.metadata, ae.created_at
  FROM audit_events ae
  WHERE ae.org_id = p_org_id
    AND (p_entity_type IS NULL OR ae.entity_type = p_entity_type)
    AND (p_entity_id IS NULL OR ae.entity_id = p_entity_id)
    AND (p_action IS NULL OR ae.action = p_action)
    AND (p_from IS NULL OR ae.created_at >= p_from)
    AND (p_to IS NULL OR ae.created_at <= p_to)
  ORDER BY ae.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$function$
;

-- get_entity_activity(p_org_id uuid, p_entity_type text, p_entity_id uuid, p_limit integer)
CREATE OR REPLACE FUNCTION public.get_entity_activity(p_org_id uuid, p_entity_type text, p_entity_id uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(event_id uuid, action text, event_type text, actor_id uuid, metadata jsonb, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT has_org_membership(auth.uid(), p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT ae.id, ae.action, ae.event_type, ae.actor_id, ae.metadata, ae.created_at
  FROM audit_events ae
  WHERE ae.org_id = p_org_id
    AND ae.entity_type = p_entity_type
    AND ae.entity_id = p_entity_id
  ORDER BY ae.created_at DESC
  LIMIT p_limit;
END;
$function$
;

-- get_job(p_org_id uuid, p_job_id uuid)
CREATE OR REPLACE FUNCTION public.get_job(p_org_id uuid, p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_job jsonb;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not public.crm_is_org_member(p_org_id, v_user) then raise exception 'Forbidden' using errcode='42501'; end if;

  select to_jsonb(j.*) into v_job
  from public.jobs j
  where j.id = p_job_id and j.org_id = p_org_id and j.deleted_at is null;

  if v_job is null then
    return jsonb_build_object('ok', false, 'error', 'Job not found');
  end if;

  return jsonb_build_object('ok', true, 'job', v_job);
end;
$function$
;

-- has_org_role(p_user uuid, p_org uuid, p_roles text[])
CREATE OR REPLACE FUNCTION public.has_org_role(p_user uuid, p_org uuid, p_roles text[])
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_exists boolean := false;
begin
  if p_user is null or p_org is null then
    return false;
  end if;

  if to_regclass('public.memberships') is not null then
    select exists (
      select 1
      from public.memberships m
      where m.user_id = p_user
        and m.org_id = p_org
        and m.role = any(p_roles)
    ) into v_exists;
    if v_exists then return true; end if;
  end if;

  if to_regclass('public.org_memberships') is not null then
    execute $q$
      select exists(
        select 1 from public.org_memberships m
        where m.user_id = $1 and m.org_id = $2 and m.role = any($3)
      )
    $q$ into v_exists using p_user, p_org, p_roles;
    if v_exists then return true; end if;
  end if;

  if to_regclass('public.org_members') is not null then
    execute $q$
      select exists(
        select 1 from public.org_members m
        where m.user_id = $1 and m.org_id = $2 and m.role = any($3)
      )
    $q$ into v_exists using p_user, p_org, p_roles;
    if v_exists then return true; end if;
  end if;

  return false;
end;
$function$
;

-- job_line_items_set_totals()
CREATE OR REPLACE FUNCTION public.job_line_items_set_totals()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.qty := greatest(coalesce(new.qty,1),0);
  new.unit_price_cents := greatest(coalesce(new.unit_price_cents,0),0);
  new.total_cents := greatest(round(new.qty * new.unit_price_cents)::int,0);
  new.updated_at := now();
  return new;
end;
$function$
;

-- jobs_sync_totals()
CREATE OR REPLACE FUNCTION public.jobs_sync_totals()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'app'
AS $function$
begin
  if new.total_cents is null and new.total_amount is not null then
    new.total_cents := round(new.total_amount * 100)::integer;
  end if;
  if new.total_amount is null and new.total_cents is not null then
    new.total_amount := round(new.total_cents::numeric / 100, 2);
  end if;
  new.total_cents := coalesce(new.total_cents, 0);
  new.total_amount := coalesce(new.total_amount, round(new.total_cents::numeric / 100, 2));
  return new;
end;
$function$
;

-- leads_before_insert_enforce_scope()
CREATE OR REPLACE FUNCTION public.leads_before_insert_enforce_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid;
  v_org uuid;
begin
  v_user := auth.uid();

  -- SQL Editor / service role: exige valeurs explicites
  if v_user is null then
    if new.org_id is null then
      raise exception 'org_id is required when no auth context' using errcode = '23502';
    end if;
    if new.created_by is null then
      raise exception 'created_by is required when no auth context' using errcode = '23502';
    end if;
    return new;
  end if;

  v_org := public.current_org_id();
  if v_org is null then
    v_org := v_user;
  end if;

  new.org_id := v_org;
  new.created_by := v_user;

  return new;
end;
$function$
;

-- leads_force_org_id()
CREATE OR REPLACE FUNCTION public.leads_force_org_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  new.org_id := public.current_org_id();
  if new.org_id is null then
    raise exception 'missing org_id in auth context' using errcode = '42501';
  end if;
  return new;
end;
$function$
;

-- leads_set_updated_at()
CREATE OR REPLACE FUNCTION public.leads_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'app'
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$
;

-- mark_job_geocode_pending()
CREATE OR REPLACE FUNCTION public.mark_job_geocode_pending()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    if nullif(trim(coalesce(new.property_address, '')), '') is not null then
      new.geocode_status := coalesce(new.geocode_status, 'pending');
    end if;
    return new;
  end if;

  if coalesce(trim(old.property_address), '') is distinct from coalesce(trim(new.property_address), '') then
    new.geocode_status := 'pending';
    new.geocoded_at := null;
    new.latitude := null;
    new.longitude := null;
  end if;

  return new;
end;
$function$
;

-- normalize_lead_stage_value(p_value text)
CREATE OR REPLACE FUNCTION public.normalize_lead_stage_value(p_value text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  v text;
begin
  v := lower(trim(coalesce(p_value, '')));
  if v in ('qualified','new','nouveau') then
    return 'qualified';
  elsif v in ('quote_sent','quote sent','quote-sent','proposal','quoted') then
    return 'quote_sent';
  elsif v in ('contacted','contact','in_contact','in-contact') then
    return 'contacted';
  elsif v in ('closed','won','converted','complete','completed') then
    return 'closed';
  elsif v in ('lost','dead','cancelled','canceled') then
    return 'lost';
  else
    return 'qualified';
  end if;
end;
$function$
;

-- pipeline_deals_sync_value_columns()
CREATE OR REPLACE FUNCTION public.pipeline_deals_sync_value_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'app'
AS $function$
begin
  -- If app sends only value
  if new.value is not null and (new.value_cents is null or tg_op = 'INSERT') then
    new.value_cents := round(new.value * 100)::integer;
  end if;

  -- If app sends only value_cents
  if new.value_cents is not null and new.value is null then
    new.value := round((new.value_cents::numeric / 100.0), 2);
  end if;

  -- Final safety
  new.value := coalesce(new.value, 0);
  new.value_cents := coalesce(new.value_cents, round(new.value * 100)::integer);

  return new;
end;
$function$
;

-- purge_old_soft_deletes(p_org_id uuid, p_days integer)
CREATE OR REPLACE FUNCTION public.purge_old_soft_deletes(p_org_id uuid, p_days integer DEFAULT 90)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cutoff timestamptz := now() - (p_days || ' days')::interval;
  v_counts jsonb := '{}'::jsonb;
  tbl text;
  v_count int;
BEGIN
  IF NOT has_org_admin_role(auth.uid(), p_org_id) THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;

  FOR tbl IN SELECT unnest(ARRAY['clients','leads','jobs','invoices','pipeline_deals','schedule_events','notifications'])
  LOOP
    -- Archive before purge
    EXECUTE format(
      'INSERT INTO archived_records (org_id, entity_type, entity_id, entity_data, archived_by, reason)
       SELECT org_id, %L, id, to_jsonb(t.*), $2, ''auto_purge_'' || $3 || ''d''
       FROM %I t WHERE org_id = $1 AND deleted_at IS NOT NULL AND deleted_at < $4
       ON CONFLICT (org_id, entity_type, entity_id) DO NOTHING',
      rtrim(tbl, 's'), tbl
    ) USING p_org_id, auth.uid(), p_days, v_cutoff;

    EXECUTE format(
      'DELETE FROM %I WHERE org_id = $1 AND deleted_at IS NOT NULL AND deleted_at < $2',
      tbl
    ) USING p_org_id, v_cutoff;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object(tbl, v_count);
  END LOOP;

  -- Purge old audit events (keep 1 year)
  DELETE FROM audit_events WHERE org_id = p_org_id AND created_at < now() - INTERVAL '1 year';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('audit_events', v_count);

  RETURN v_counts;
END;
$function$
;

-- restore_archived_record(p_org_id uuid, p_entity_type text, p_entity_id uuid)
CREATE OR REPLACE FUNCTION public.restore_archived_record(p_org_id uuid, p_entity_type text, p_entity_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT has_org_admin_role(auth.uid(), p_org_id) THEN
    RAISE EXCEPTION 'Admin role required to restore records';
  END IF;

  -- Un-soft-delete
  EXECUTE format(
    'UPDATE %I SET deleted_at = NULL, deleted_by = NULL WHERE id = $1 AND org_id = $2',
    p_entity_type || 's'
  ) USING p_entity_id, p_org_id;

  -- Remove from archive
  DELETE FROM archived_records
  WHERE org_id = p_org_id AND entity_type = p_entity_type AND entity_id = p_entity_id;

  RETURN jsonb_build_object('restored', true);
END;
$function$
;

-- rpc_invoices_kpis_30d(p_org uuid)
CREATE OR REPLACE FUNCTION public.rpc_invoices_kpis_30d(p_org uuid DEFAULT NULL::uuid)
 RETURNS TABLE(past_due_count bigint, past_due_total_cents bigint, sent_not_due_count bigint, sent_not_due_total_cents bigint, draft_count bigint, draft_total_cents bigint, issued_30d_count bigint, issued_30d_total_cents bigint, avg_invoice_30d_cents bigint, avg_payment_time_days_30d numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid;
begin
  v_org := coalesce(p_org, public.current_org_id());
  if v_org is null then
    raise exception 'Unable to resolve org_id';
  end if;

  if auth.uid() is not null and not public.has_org_membership(auth.uid(), v_org) then
    raise exception 'Not allowed for this organization';
  end if;

  return query
  with base as (
    select *
    from public.invoices i
    where i.org_id = v_org
      and i.deleted_at is null
  ),
  overview as (
    select
      count(*) filter (
        where due_date < current_date
          and balance_cents > 0
          and status in ('sent', 'partial')
      ) as past_due_count,
      coalesce(sum(balance_cents) filter (
        where due_date < current_date
          and balance_cents > 0
          and status in ('sent', 'partial')
      ), 0)::bigint as past_due_total_cents,
      count(*) filter (
        where due_date >= current_date
          and balance_cents > 0
          and status in ('sent', 'partial')
      ) as sent_not_due_count,
      coalesce(sum(balance_cents) filter (
        where due_date >= current_date
          and balance_cents > 0
          and status in ('sent', 'partial')
      ), 0)::bigint as sent_not_due_total_cents,
      count(*) filter (
        where status = 'draft'
      ) as draft_count,
      coalesce(sum(total_cents) filter (
        where status = 'draft'
      ), 0)::bigint as draft_total_cents
    from base
  ),
  issued as (
    select
      count(*) as issued_30d_count,
      coalesce(sum(total_cents), 0)::bigint as issued_30d_total_cents
    from base
    where issued_at >= (now() - interval '30 days')
      and status in ('sent', 'partial', 'paid')
  ),
  payment as (
    select
      avg(extract(epoch from (paid_at - issued_at)) / 86400.0) as avg_payment_time_days_30d
    from base
    where paid_at is not null
      and issued_at is not null
      and paid_at >= (now() - interval '30 days')
      and paid_at >= issued_at
  )
  select
    o.past_due_count,
    o.past_due_total_cents,
    o.sent_not_due_count,
    o.sent_not_due_total_cents,
    o.draft_count,
    o.draft_total_cents,
    i.issued_30d_count,
    i.issued_30d_total_cents,
    case
      when i.issued_30d_count = 0 then 0::bigint
      else round(i.issued_30d_total_cents::numeric / i.issued_30d_count::numeric)::bigint
    end as avg_invoice_30d_cents,
    p.avg_payment_time_days_30d
  from overview o
  cross join issued i
  cross join payment p;
end;
$function$
;

-- rpc_revenue_by_currency(p_org_id uuid, p_from date, p_to date)
CREATE OR REPLACE FUNCTION public.rpc_revenue_by_currency(p_org_id uuid, p_from date DEFAULT (CURRENT_DATE - '30 days'::interval), p_to date DEFAULT CURRENT_DATE)
 RETURNS TABLE(currency text, total_cents bigint, payment_count integer, cad_equivalent_cents bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  if auth.uid() is not null and not public.has_org_membership(auth.uid(), p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    p.currency,
    SUM(p.amount_cents)::bigint AS total_cents,
    COUNT(*)::int AS payment_count,
    SUM(
      CASE WHEN p.currency = 'CAD' THEN p.amount_cents
      ELSE convert_currency(p.amount_cents, p.currency, 'CAD', p.payment_date::date)
      END
    )::bigint AS cad_equivalent_cents
  FROM payments p
  WHERE p.org_id = p_org_id
    AND p.deleted_at IS NULL
    AND p.status = 'succeeded'
    AND p.payment_date >= p_from
    AND p.payment_date < p_to + INTERVAL '1 day'
  GROUP BY p.currency;
END;
$function$
;

-- rpc_team_workload(p_org_id uuid, p_from date, p_to date)
CREATE OR REPLACE FUNCTION public.rpc_team_workload(p_org_id uuid, p_from date DEFAULT CURRENT_DATE, p_to date DEFAULT (CURRENT_DATE + 14))
 RETURNS TABLE(team_id uuid, team_name text, team_color text, scheduled_jobs integer, total_hours numeric, utilization_pct numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT has_org_membership(auth.uid(), p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    t.name,
    t.color_hex,
    COUNT(DISTINCT se.job_id)::int AS scheduled_jobs,
    ROUND(SUM(EXTRACT(EPOCH FROM (se.end_at - se.start_at)) / 3600)::numeric, 1) AS total_hours,
    -- utilization = scheduled hours / available hours
    ROUND(
      CASE WHEN avail.total_avail_hours > 0
        THEN (SUM(EXTRACT(EPOCH FROM (se.end_at - se.start_at)) / 3600) / avail.total_avail_hours * 100)::numeric
        ELSE 0
      END, 1
    ) AS utilization_pct
  FROM teams t
  LEFT JOIN schedule_events se ON se.team_id = t.id
    AND se.deleted_at IS NULL
    AND se.start_at >= p_from::timestamptz
    AND se.start_at < (p_to + 1)::timestamptz
  LEFT JOIN LATERAL (
    SELECT SUM((a.end_minute - a.start_minute) / 60.0 * (p_to - p_from + 1))::numeric AS total_avail_hours
    FROM availabilities a
    WHERE a.org_id = p_org_id AND a.team_id = t.id AND a.is_active = true
  ) avail ON TRUE
  WHERE t.org_id = p_org_id AND t.deleted_at IS NULL
  GROUP BY t.id, t.name, t.color_hex, avail.total_avail_hours;
END;
$function$
;

-- send_invoice(p_org_id uuid, p_invoice_id uuid, p_channel text, p_to text)
CREATE OR REPLACE FUNCTION public.send_invoice(p_org_id uuid, p_invoice_id uuid, p_channel text, p_to text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_invoice record;
  v_token text;
  v_link text;
  v_channel text := lower(trim(coalesce(p_channel,'email')));
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not public.crm_is_org_admin(p_org_id, v_user) then raise exception 'Only owner/admin can send invoice' using errcode='42501'; end if;
  if v_channel not in ('email','sms') then raise exception 'Invalid channel'; end if;

  select * into v_invoice
  from public.invoices
  where id = p_invoice_id and org_id = p_org_id and deleted_at is null
  for update;

  if v_invoice.id is null then
    raise exception 'Invoice not found';
  end if;

  v_token := coalesce(v_invoice.public_token, encode(gen_random_bytes(24), 'hex'));
  v_link := '/pay/' || v_token;

  update public.invoices
  set public_token = v_token,
      status = case when status = 'paid' then 'paid' else 'sent' end,
      sent_at = coalesce(sent_at, now()),
      issued_at = coalesce(issued_at, now()),
      updated_at = now()
  where id = p_invoice_id and org_id = p_org_id;

  insert into public.notifications(org_id, type, ref_id, message)
  values (
    p_org_id,
    'invoice_sent',
    p_invoice_id,
    case when v_channel='sms' then 'Invoice sent by SMS' else 'Invoice sent by email' end
  );

  return jsonb_build_object(
    'ok', true,
    'invoice_id', p_invoice_id,
    'status', 'sent',
    'channel', v_channel,
    'to', p_to,
    'payment_link', v_link
  );
end;
$function$
;

-- set_invoice_client_snapshot()
CREATE OR REPLACE FUNCTION public.set_invoice_client_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name  text;
  v_email text;
BEGIN
  IF NEW.client_id IS NOT NULL AND (NEW.client_name_snapshot IS NULL OR NEW.client_name_snapshot = '') THEN
    SELECT
      COALESCE(
        NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''),
        NULLIF(c.company, ''),
        'Unknown client'
      ),
      c.email
    INTO v_name, v_email
    FROM public.clients c
    WHERE c.id = NEW.client_id;

    NEW.client_name_snapshot  := COALESCE(NEW.client_name_snapshot,  v_name);
    NEW.client_email_snapshot := COALESCE(NEW.client_email_snapshot, v_email);
  END IF;
  RETURN NEW;
END;
$function$
;

-- sync_lead_or_client_contact()
CREATE OR REPLACE FUNCTION public.sync_lead_or_client_contact()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_full_name text;
begin
  v_full_name := nullif(trim(coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, '')), '');
  if new.contact_id is null then
    insert into public.contacts (org_id, full_name, email, phone)
    values (new.org_id, v_full_name, nullif(trim(new.email), ''), nullif(trim(new.phone), ''))
    returning id into new.contact_id;
  else
    update public.contacts
    set org_id = coalesce(new.org_id, org_id),
        full_name = coalesce(v_full_name, full_name),
        email = coalesce(nullif(trim(new.email), ''), email),
        phone = coalesce(nullif(trim(new.phone), ''), phone),
        updated_at = now()
    where id = new.contact_id;
  end if;
  return new;
end;
$function$
;

-- touch_org_billing_settings_updated_at()
CREATE OR REPLACE FUNCTION public.touch_org_billing_settings_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$
;

-- trg_auto_invoice_on_job_completed()
CREATE OR REPLACE FUNCTION public.trg_auto_invoice_on_job_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.org_id is null or new.id is null then return new; end if;
  if new.deleted_at is not null then return new; end if;

  if coalesce(old.status,'') <> 'completed' and new.status = 'completed' then
    perform public.create_invoice_from_job(new.org_id, new.id, false);
  end if;

  return new;
end;
$function$
;

-- trg_clients_fts_update()
CREATE OR REPLACE FUNCTION public.trg_clients_fts_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.fts_vector := build_client_fts_vector(NEW);
  RETURN NEW;
END;
$function$
;

-- trg_invoices_fts_update()
CREATE OR REPLACE FUNCTION public.trg_invoices_fts_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.fts_vector := build_invoice_fts_vector(NEW);
  RETURN NEW;
END;
$function$
;

-- trg_jobs_fts_update()
CREATE OR REPLACE FUNCTION public.trg_jobs_fts_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.fts_vector := build_job_fts_vector(NEW);
  RETURN NEW;
END;
$function$
;

-- trg_leads_fts_update()
CREATE OR REPLACE FUNCTION public.trg_leads_fts_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.fts_vector := build_lead_fts_vector(NEW);
  RETURN NEW;
END;
$function$
;

-- trg_normalize_lead_stage()
CREATE OR REPLACE FUNCTION public.trg_normalize_lead_stage()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.stage := public.normalize_lead_stage_value(new.stage);

  if new.stage = 'lost' then
    new.lost_at := coalesce(new.lost_at, now());
  elsif tg_op = 'UPDATE' and old.stage = 'lost' and new.stage <> 'lost' then
    new.lost_at := null;
  end if;

  if new.stage = 'closed' then
    new.closed_at := coalesce(new.closed_at, now());
  elsif tg_op = 'UPDATE' and old.stage = 'closed' and new.stage <> 'closed' then
    new.closed_at := null;
  end if;

  return new;
end;
$function$
;

-- trg_payment_to_invoice_paid()
CREATE OR REPLACE FUNCTION public.trg_payment_to_invoice_paid()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.invoice_id is null then
    return new;
  end if;
  if lower(coalesce(new.status,'')) <> 'succeeded' then
    return new;
  end if;

  perform public.webhook_payment_received(
    new.org_id,
    new.invoice_id,
    new.provider,
    new.provider_payment_id,
    new.amount_cents,
    new.provider_event_id
  );
  return new;
end;
$function$
;

-- upsert_job(p_org_id uuid, p_job_id uuid, p_payload jsonb)
CREATE OR REPLACE FUNCTION public.upsert_job(p_org_id uuid, p_job_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_job_id uuid;
  v_client_id uuid := nullif(trim(coalesce(p_payload->>'client_id','')), '')::uuid;
  v_lead_id uuid := nullif(trim(coalesce(p_payload->>'lead_id','')), '')::uuid;
  v_title text := coalesce(nullif(trim(coalesce(p_payload->>'title','')), ''), 'New job');
  v_status text := lower(coalesce(p_payload->>'status','draft'));
  v_start timestamptz := nullif(trim(coalesce(p_payload->>'start_at','')), '')::timestamptz;
  v_end timestamptz := nullif(trim(coalesce(p_payload->>'end_at','')), '')::timestamptz;
  v_property text := coalesce(nullif(trim(coalesce(p_payload->>'property_address','')), ''), '-');
  v_notes text := nullif(trim(coalesce(p_payload->>'notes','')), '');
  v_subtotal numeric := coalesce((p_payload->>'subtotal')::numeric, 0);
  v_tax_total numeric := coalesce((p_payload->>'tax_total')::numeric, 0);
  v_total numeric := coalesce((p_payload->>'total')::numeric, 0);
  v_tax_lines jsonb := coalesce(p_payload->'tax_lines', '[]'::jsonb);
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not public.crm_is_org_admin(p_org_id, v_user) then raise exception 'Only owner/admin can upsert jobs' using errcode='42501'; end if;

  v_status := case v_status
    when 'draft' then 'draft'
    when 'scheduled' then 'scheduled'
    when 'in_progress' then 'in_progress'
    when 'completed' then 'completed'
    when 'cancelled' then 'cancelled'
    when 'canceled' then 'cancelled'
    else 'draft'
  end;

  if p_job_id is null then
    insert into public.jobs(
      org_id, created_by, client_id, lead_id, title, status, scheduled_at, start_at, end_at,
      property_address, notes, subtotal, tax_total, total, tax_lines, total_amount, total_cents, currency
    )
    values(
      p_org_id, v_user, v_client_id, v_lead_id, v_title, v_status, v_start, v_start, v_end,
      v_property, v_notes, v_subtotal, v_tax_total, v_total, v_tax_lines, v_total, round(v_total * 100)::int, 'CAD'
    )
    returning id into v_job_id;
  else
    update public.jobs
    set client_id = coalesce(v_client_id, client_id),
        lead_id = coalesce(v_lead_id, lead_id),
        title = v_title,
        status = v_status,
        scheduled_at = v_start,
        start_at = v_start,
        end_at = v_end,
        property_address = v_property,
        notes = v_notes,
        subtotal = v_subtotal,
        tax_total = v_tax_total,
        total = v_total,
        tax_lines = v_tax_lines,
        total_amount = v_total,
        total_cents = round(v_total * 100)::int,
        updated_at = now()
    where id = p_job_id and org_id = p_org_id and deleted_at is null
    returning id into v_job_id;
  end if;

  if v_job_id is null then
    return jsonb_build_object('ok', false, 'error', 'Job upsert failed');
  end if;

  if v_start is not null and v_end is not null and v_end > v_start then
    insert into public.schedule_events(org_id, created_by, job_id, start_time, end_time, status, notes)
    values (p_org_id, v_user, v_job_id, v_start, v_end, 'scheduled', 'Primary visit');
  end if;

  return jsonb_build_object('ok', true, 'job_id', v_job_id);
end;
$function$
;

-- validate_e164(p_phone text)
CREATE OR REPLACE FUNCTION public.validate_e164(p_phone text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT p_phone ~ '^\+[1-9]\d{1,14}$';
$function$
;

-- webhook_payment_received(p_org_id uuid, p_invoice_id uuid, p_provider text, p_provider_payment_id text, p_amount_cents integer, p_provider_event_id text)
CREATE OR REPLACE FUNCTION public.webhook_payment_received(p_org_id uuid, p_invoice_id uuid, p_provider text, p_provider_payment_id text, p_amount_cents integer, p_provider_event_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_payment_id uuid;
begin
  if p_org_id is null or p_invoice_id is null then
    raise exception 'Missing org or invoice';
  end if;

  insert into public.payments(
    org_id, invoice_id, provider, provider_payment_id, provider_event_id, status, amount_cents, payment_date
  )
  values(
    p_org_id, p_invoice_id, coalesce(nullif(trim(p_provider),''),'manual'),
    nullif(trim(p_provider_payment_id),''),
    nullif(trim(p_provider_event_id),''),
    'succeeded',
    greatest(coalesce(p_amount_cents,0),0),
    now()
  )
  on conflict do nothing
  returning id into v_payment_id;

  update public.invoices
  set paid_cents = least(total_cents, paid_cents + greatest(coalesce(p_amount_cents,0),0)),
      balance_cents = greatest(0, total_cents - (paid_cents + greatest(coalesce(p_amount_cents,0),0))),
      status = case
        when (total_cents - (paid_cents + greatest(coalesce(p_amount_cents,0),0))) <= 0 then 'paid'
        when (paid_cents + greatest(coalesce(p_amount_cents,0),0)) > 0 then 'partial'
        else status
      end,
      paid_at = case
        when (total_cents - (paid_cents + greatest(coalesce(p_amount_cents,0),0))) <= 0 then coalesce(paid_at, now())
        else paid_at
      end,
      updated_at = now()
  where id = p_invoice_id and org_id = p_org_id and deleted_at is null;

  insert into public.notifications(org_id, type, ref_id, message)
  values (p_org_id, 'invoice_paid', p_invoice_id, 'Invoice paid');

  return jsonb_build_object('ok', true, 'invoice_id', p_invoice_id, 'payment_id', v_payment_id);
end;
$function$
;

commit;
