-- ============================================================================
-- Le motif « garde sur auth.uid() + appel en service_role » cassait 5 features
-- ============================================================================
--
-- auth.uid() vaut NULL sous service_role. Une garde interne du type
--     if not public.has_org_admin_role(auth.uid(), v_org) then raise ...
-- refuse donc TOUT LE MONDE des lors que la fonction est appelee par le
-- serveur — y compris le serveur legitime.
--
-- Ce motif avait deja casse export_client_data (corrige par 20260751101900),
-- export_user_data (20260751102000) et anonymize_client (20260751102400).
-- Recherche systematique sur les 33 RPC appelees en service_role depuis
-- server/ : 5 fonctions supplementaires etaient inertes.
--
-- Features mortes reparees ici :
--   * team-compliance : suppression differee d'un membre (demande + annulation),
--     exigence MFA par membre           -> server/routes/team-compliance.ts
--   * rapports planifies : apercu et conversion des leads
--                                        -> server/lib/scheduled-reports.ts
--
-- POURQUOI RELACHER LA GARDE EST SUR — connexions verifiees une par une :
--   * team-compliance.ts:28-38 fait DEJA le controle complet avant l'appel :
--     403 si l'operation est cross-org, puis appel explicite a
--     has_org_admin_role -> 403 si l'appelant n'est pas admin. Le commentaire
--     ligne 21 documente meme la cause (« auth.uid() is NULL under the
--     service-role ») : la compensation etait deja en place cote route.
--   * scheduled-reports.ts : l'orgId provient du rapport planifie lui-meme,
--     donc du serveur, jamais d'une entree client.
--   * Les appels NAVIGATEUR restent gardes : auth.uid() y est renseigne, la
--     condition s'applique donc pleinement.
--
-- Verifie par execution :
--   service_role sur rpc_insights_overview        -> REUSSIT (1 ligne)
--   authentifie non membre de l'org ciblee        -> refuse
--                                    « Not allowed for this organization »
--
-- APPLIQUE EN PRODUCTION le 2026-07-31 a 03:16 UTC. Corps lus depuis
-- pg_proc.prosrc, jamais retranscrits.
-- ROLLBACK : retirer « auth.uid() is not null and » de chaque condition.
--
-- NON CORRIGE, demande une decision :
--   * create_incident() : la route incidents.ts ne fait AUCUN controle de role,
--     et la fonction derive l'org depuis auth.uid() sans parametre p_org.
--     Relacher la garde ne suffirait pas (v_org resterait NULL) : il faut
--     ajouter un parametre d'org ET un controle admin dans la route.
--   * list_member_audit_events() : garde imbriquee dans une requete
--     (and has_org_admin_role(...) ... if v_org is null then raise), forme
--     differente — a traiter separement.
-- ============================================================================

create or replace function public.cancel_hard_delete_member(p_member_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $LUMES$
declare v_org uuid; v_target uuid;
begin
  select org_id, user_id into v_org, v_target
    from public.team_members where id = p_member_id;
  if v_org is null then raise exception 'Team member not found'; end if;
  if auth.uid() is not null and not public.has_org_admin_role(auth.uid(), v_org) then
    raise exception 'Only org admin/owner can cancel deletion';
  end if;

  update public.team_members
     set deletion_scheduled_at = null,
         deletion_requested_by = null,
         updated_at = now()
   where id = p_member_id;

  -- Reactivate membership
  update public.memberships
     set status = 'active'
   where user_id = v_target and org_id = v_org;

  insert into public.audit_events(org_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, auth.uid(), 'cancel_hard_delete', 'team_member', p_member_id,
    jsonb_build_object('target_user', v_target));
end $LUMES$;

create or replace function public.request_hard_delete_member(p_member_id uuid, p_reassign_to uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $LUMES$
declare
  v_org       uuid;
  v_target    uuid;
  v_reassign_org uuid;
begin
  select org_id, user_id into v_org, v_target
    from public.team_members where id = p_member_id;
  if v_org is null then raise exception 'Team member not found'; end if;

  -- Caller must be admin or owner of this org
  if auth.uid() is not null and not public.has_org_admin_role(auth.uid(), v_org) then
    raise exception 'Only org admin/owner can request member deletion';
  end if;

  -- Cannot delete yourself via this flow
  if v_target = auth.uid() then
    raise exception 'Cannot request deletion of your own account here';
  end if;

  -- Reassignment target must be in the same org
  select org_id into v_reassign_org from public.memberships
    where user_id = p_reassign_to and org_id = v_org limit 1;
  if v_reassign_org is null then
    raise exception 'Reassignment target must be a member of the same organization';
  end if;

  -- Reassign ownership of records owned by this user in this org
  update public.leads  set created_by = p_reassign_to
    where org_id = v_org and created_by = v_target;
  update public.clients set created_by = p_reassign_to
    where org_id = v_org and created_by = v_target;
  update public.jobs   set created_by = p_reassign_to
    where org_id = v_org and created_by = v_target;

  -- Best-effort reassignment for assigned_to fields (ignore if columns don't exist)
  begin execute 'update public.leads set assigned_to = $1 where org_id = $2 and assigned_to = $3'
    using p_reassign_to, v_org, v_target; exception when undefined_column then null; end;
  begin execute 'update public.tasks set assigned_to = $1 where org_id = $2 and assigned_to = $3'
    using p_reassign_to, v_org, v_target; exception when undefined_column then null; end;

  -- Suspend team_member + schedule hard delete in 30 days
  update public.team_members
     set status = 'inactive',
         suspended_at = now(),
         deletion_scheduled_at = now() + interval '30 days',
         deletion_requested_by = auth.uid(),
         updated_at = now()
   where id = p_member_id;

  -- Revoke membership so they lose RLS access immediately
  update public.memberships
     set status = 'suspended'
   where user_id = v_target and org_id = v_org;

  insert into public.audit_events(org_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, auth.uid(), 'request_hard_delete', 'team_member', p_member_id,
    jsonb_build_object('target_user', v_target, 'reassigned_to', p_reassign_to, 'scheduled_at', now() + interval '30 days'));
end $LUMES$;

create or replace function public.set_member_mfa_required(p_member_id uuid, p_required boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $LUMES$
declare v_org uuid;
begin
  select org_id into v_org from public.team_members where id = p_member_id;
  if v_org is null then raise exception 'Team member not found'; end if;
  if auth.uid() is not null and not public.has_org_admin_role(auth.uid(), v_org) then
    raise exception 'Only org admin/owner can change MFA requirement';
  end if;

  update public.team_members
     set mfa_required = p_required, updated_at = now()
   where id = p_member_id;

  insert into public.audit_events(org_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, auth.uid(), 'set_mfa_required', 'team_member', p_member_id,
    jsonb_build_object('mfa_required', p_required));
end $LUMES$;

create or replace function public.rpc_insights_overview(p_org uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
returns TABLE(new_leads_count bigint, converted_quotes_count bigint, new_oneoff_jobs_count bigint, invoiced_value_cents bigint, revenue_cents bigint, requests_count bigint)
language plpgsql
volatile
security definer
set search_path = public
as $LUMES$
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
  if auth.uid() is not null and not public.has_org_membership(auth.uid(), v_org) THEN RAISE EXCEPTION 'Not allowed for this organization'; END IF;

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
$LUMES$;

create or replace function public.rpc_insights_lead_conversion(p_org uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
returns TABLE(leads_created bigint, leads_closed bigint, conversion_rate numeric, breakdown jsonb)
language plpgsql
volatile
security definer
set search_path = public
as $LUMES$
DECLARE
  v_org uuid; v_from_date date; v_to_date date; v_from_ts timestamptz; v_to_exclusive timestamptz;
  v_has_payments boolean; v_created bigint := 0; v_closed bigint := 0; v_rate numeric := 0; v_breakdown jsonb := null;
BEGIN
  v_org := coalesce(p_org, public.current_org_id());
  IF v_org IS NULL THEN RAISE EXCEPTION 'Unable to resolve org_id'; END IF;
  if auth.uid() is not null and not public.has_org_membership(auth.uid(), v_org) THEN RAISE EXCEPTION 'Not allowed for this organization'; END IF;

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
$LUMES$;

