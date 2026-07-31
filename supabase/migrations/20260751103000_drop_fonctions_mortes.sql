-- ============================================================================
-- Supprime 8 fonctions mortes — verdict etabli sur TROIS axes independants
-- ============================================================================
--
-- La question « reparer ou supprimer ? » a ete tranchee par la mesure, pas par
-- l'intuition. Trois sources concordantes :
--
--   1. TRAFIC REEL — pg_stat_statements collecte depuis le 2026-07-08 (23 jours,
--      4651 requetes distinctes). En ne comptant QUE les requetes enveloppees
--      par PostgREST (pgrst_source), donc le trafic applicatif et non mes
--      propres tests : **0 appel** pour les 8.
--      Controle de validite : list_archived_items en compte 9 et
--      export_client_data 2 sur la meme periode — la mesure capte donc bien
--      les appels navigateur.
--
--   2. CODE — 0 appelant dans src/, server/ et mobile/ sur main, ET sur
--      TOUTES les branches distantes (y compris les branches Dependabot et
--      feat/mobile-profile-web-parity).
--
--   3. BASE — aucun trigger, aucune tache cron, et aucune fonction exterieure
--      a ce groupe ne les appelle. Le graphe de dependances est un ilot ferme :
--        create_minimal_client_for_deal <- create_client_and_deal
--        create_minimal_job_for_deal    <- create_client_and_deal,
--                                          create_deal_with_job,
--                                          create_lead_and_deal
--      Les parents, eux, n'ont aucun appelant.
--
-- Plusieurs etaient de toute facon CASSEES :
--   * create_client_and_deal insere stage='Qualified', refuse par
--     pipeline_deals_stage_check qui n'accepte que new_prospect / no_response /
--     quote_sent / closed_won / closed_lost ;
--   * create_lead_quick insere dans la table `leads`, SUPPRIMEE du schema ;
--   * update_lead_stage et create_deal_with_job portent encore tout l'ancien
--     vocabulaire ('Contact', 'Quote Sent', 'Closed', 'Lost').
--
-- ⚠️ create_lead_with_client N'EST PAS supprimee, deliberement.
--    Elle n'a aucun appelant sur main, mais elle est appelee a TROIS endroits
--    sur la branche feat/mobile-profile-web-parity (booking.ts:323,
--    leads.ts:59, request-forms.ts:239). La supprimer poserait une mine pour
--    la fusion du travail mobile. Verifie : elle ne depend d'aucune des 8.
--
-- ROLLBACK : les definitions COMPLETES sont conservees en commentaire a la fin
-- de ce fichier. Les recoller suffit a tout restaurer a l'identique.
-- ============================================================================

drop function if exists public.create_client_and_deal(p_full_name text, p_email text, p_phone text, p_title text, p_value numeric, p_notes text, p_org_id uuid);
drop function if exists public.create_deal_with_job(p_lead_id uuid, p_title text, p_value numeric, p_stage text, p_notes text, p_pipeline_id uuid);
drop function if exists public.create_lead_and_deal(p_full_name text, p_email text, p_address text, p_phone text, p_title text, p_value numeric, p_notes text, p_org_id uuid);
drop function if exists public.get_or_create_qualified_stage(p_org_id uuid);
drop function if exists public.update_lead_stage(p_org_id uuid, p_lead_id uuid, p_stage text);
drop function if exists public.create_lead_quick(p_full_name text, p_email text, p_phone text, p_org_id uuid);
drop function if exists public.create_minimal_client_for_deal(p_org_id uuid, p_created_by uuid, p_contact_id uuid, p_full_name text, p_email text, p_phone text);
drop function if exists public.create_minimal_job_for_deal(p_org_id uuid, p_created_by uuid, p_client_id uuid, p_title text);

-- ============================================================================
-- ROLLBACK — definitions integrales au moment de la suppression
-- ============================================================================
/*

-- ---- create_client_and_deal ----
CREATE OR REPLACE FUNCTION public.create_client_and_deal(p_full_name text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_title text DEFAULT NULL::text, p_value numeric DEFAULT 0, p_notes text DEFAULT NULL::text, p_org_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org_id uuid := coalesce(p_org_id, public.current_org_id());
  v_created_by uuid := auth.uid();
  v_contact_id uuid;
  v_client_id uuid;
  v_job_id uuid;
  v_deal_id uuid;
begin
  insert into public.contacts (org_id, full_name, email, phone)
  values (v_org_id, nullif(trim(p_full_name), ''), nullif(trim(p_email), ''), nullif(trim(p_phone), ''))
  returning id into v_contact_id;

  v_client_id := public.create_minimal_client_for_deal(
    v_org_id, v_created_by, v_contact_id, p_full_name, p_email, p_phone
  );

  v_job_id := public.create_minimal_job_for_deal(
    v_org_id, v_created_by, v_client_id, coalesce(nullif(trim(p_title), ''), trim(p_full_name) || ' deal')
  );

  insert into public.pipeline_deals (
    org_id, created_by, lead_id, client_id, job_id, stage, title, value, notes
  )
  values (
    v_org_id, v_created_by, null, v_client_id, v_job_id, 'Qualified',
    coalesce(nullif(trim(p_title), ''), trim(p_full_name) || ' deal'),
    coalesce(p_value, 0),
    nullif(trim(p_notes), '')
  )
  returning id into v_deal_id;

  return jsonb_build_object(
    'deal_id', v_deal_id,
    'client_id', v_client_id,
    'job_id', v_job_id
  );
end;
$function$


-- ---- create_deal_with_job ----
CREATE OR REPLACE FUNCTION public.create_deal_with_job(p_lead_id uuid, p_title text, p_value numeric, p_stage text, p_notes text, p_pipeline_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_deal_id uuid;
  v_org_id uuid;
  v_created_by uuid;
  v_client_id uuid;
  v_job_id uuid;
begin
  select l.org_id, coalesce(l.created_by, auth.uid()), l.converted_to_client_id
    into v_org_id, v_created_by, v_client_id
  from public.leads l
  where l.id = p_lead_id;

  if v_org_id is null then
    raise exception 'Lead not found';
  end if;

  v_job_id := public.create_minimal_job_for_deal(v_org_id, v_created_by, v_client_id, coalesce(nullif(trim(p_title), ''), 'New Deal Job'));

  insert into public.pipeline_deals (
    org_id, created_by, lead_id, client_id, job_id, stage, title, value, notes
  )
  values (
    v_org_id, v_created_by, p_lead_id, v_client_id, v_job_id,
    case when p_stage in ('Qualified', 'Contact', 'Quote Sent', 'Closed', 'Lost') then p_stage else 'Qualified' end,
    coalesce(nullif(trim(p_title), ''), 'New Deal'),
    coalesce(p_value, 0),
    nullif(trim(p_notes), '')
  )
  returning id into v_deal_id;

  return v_deal_id;
end;
$function$


-- ---- create_lead_and_deal ----
CREATE OR REPLACE FUNCTION public.create_lead_and_deal(p_full_name text, p_email text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_title text DEFAULT NULL::text, p_value numeric DEFAULT 0, p_notes text DEFAULT NULL::text, p_org_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org_id uuid := coalesce(p_org_id, public.current_org_id());
  v_created_by uuid := auth.uid();
  v_first_name text := coalesce(nullif(split_part(coalesce(p_full_name, ''), ' ', 1), ''), 'Unknown');
  v_last_name text := coalesce(
    nullif(trim(substr(coalesce(p_full_name, ''), length(split_part(coalesce(p_full_name, ''), ' ', 1)) + 1)), ''),
    'Lead'
  );
  v_contact_id uuid;
  v_lead_id uuid;
  v_job_id uuid;
  v_deal_id uuid;
begin
  if v_org_id is null then
    raise exception 'No organization context' using errcode = '42501';
  end if;

  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if not public.has_org_membership(auth.uid(), v_org_id) then
    raise exception 'Not a member of this org' using errcode = '42501';
  end if;

  if not public.has_org_admin_role(auth.uid(), v_org_id) then
    raise exception 'Only owner/admin can create leads' using errcode = '42501';
  end if;

  insert into public.contacts (org_id, full_name, email, phone)
  values (
    v_org_id,
    nullif(trim(p_full_name), ''),
    nullif(trim(p_email), ''),
    nullif(trim(p_phone), '')
  )
  returning id into v_contact_id;

  insert into public.leads (
    org_id, created_by, user_id, first_name, last_name, email, address, phone, status, stage, contact_id
  )
  values (
    v_org_id,
    v_created_by,
    v_created_by,
    v_first_name,
    v_last_name,
    nullif(trim(p_email), ''),
    nullif(trim(p_address), ''),
    nullif(trim(p_phone), ''),
    'qualified',
    'qualified',
    v_contact_id
  )
  returning id into v_lead_id;

  v_job_id := public.create_minimal_job_for_deal(
    v_org_id,
    v_created_by,
    null,
    coalesce(nullif(trim(p_title), ''), trim(p_full_name) || ' deal')
  );

  insert into public.pipeline_deals (
    org_id, created_by, lead_id, client_id, job_id, stage, title, value, notes
  )
  values (
    v_org_id,
    v_created_by,
    v_lead_id,
    null,
    v_job_id,
    'Qualified',
    coalesce(nullif(trim(p_title), ''), trim(p_full_name) || ' deal'),
    coalesce(p_value, 0),
    nullif(trim(p_notes), '')
  )
  returning id into v_deal_id;

  return jsonb_build_object(
    'deal_id', v_deal_id,
    'lead_id', v_lead_id,
    'job_id', v_job_id
  );
end;
$function$


-- ---- get_or_create_qualified_stage ----
CREATE OR REPLACE FUNCTION public.get_or_create_qualified_stage(p_org_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_stage_id uuid;
begin
  -- essaie de trouver un stage Qualified
  select ps.id
    into v_stage_id
  from public.pipeline_stages ps
  where ps.org_id = p_org_id
    and lower(ps.name) = 'qualified'
  order by ps.position asc
  limit 1;

  if v_stage_id is not null then
    return v_stage_id;
  end if;

  -- si absent, crée les stages de base si nécessaires
  insert into public.pipeline_stages (org_id, name, position)
  select p_org_id, s.name, s.position
  from (values
    ('Lead', 1),
    ('Qualified', 2),
    ('Proposal', 3),
    ('Negotiation', 4),
    ('Closed', 5)
  ) as s(name, position)
  where not exists (
    select 1
    from public.pipeline_stages x
    where x.org_id = p_org_id
      and lower(x.name) = lower(s.name)
  );

  -- récupère Qualified après insertion
  select ps.id
    into v_stage_id
  from public.pipeline_stages ps
  where ps.org_id = p_org_id
    and lower(ps.name) = 'qualified'
  order by ps.position asc
  limit 1;

  if v_stage_id is null then
    raise exception 'Unable to resolve Qualified stage for org %', p_org_id;
  end if;

  return v_stage_id;
end;
$function$


-- ---- update_lead_stage ----
CREATE OR REPLACE FUNCTION public.update_lead_stage(p_org_id uuid, p_lead_id uuid, p_stage text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_stage text := public.crm_normalize_lead_stage(p_stage);
  v_count int := 0;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not public.crm_is_org_admin(p_org_id, v_user) then raise exception 'Only owner/admin can update stage' using errcode='42501'; end if;

  update public.leads
  set stage = v_stage,
      lost_at = case when v_stage='lost' then coalesce(lost_at, now()) else null end,
      closed_at = case when v_stage='closed' then coalesce(closed_at, now()) else null end,
      updated_at = now()
  where id = p_lead_id and org_id = p_org_id and deleted_at is null;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'Lead not found');
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='pipeline_deals' and column_name='stage'
  ) then
    update public.pipeline_deals
    set stage = case v_stage
      when 'qualified' then 'Qualified'
      when 'contacted' then 'Contact'
      when 'quote_sent' then 'Quote Sent'
      when 'closed' then 'Closed'
      when 'lost' then 'Lost'
      else 'Qualified'
    end,
    updated_at = now()
    where lead_id = p_lead_id
      and org_id = p_org_id
      and deleted_at is null;
  end if;

  return jsonb_build_object('ok', true, 'lead_id', p_lead_id, 'stage', v_stage);
end;
$function$


-- ---- create_lead_quick ----
CREATE OR REPLACE FUNCTION public.create_lead_quick(p_full_name text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_org_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_full_name text := coalesce(nullif(trim(p_full_name), ''), 'Unknown Lead');
  v_first_name text;
  v_last_name text;
  v_org_id uuid;
  v_contact_id uuid;
  v_lead_id uuid;
begin
  v_org_id := coalesce(p_org_id, public.current_org_id());
  v_first_name := split_part(v_full_name, ' ', 1);
  v_last_name := nullif(trim(substr(v_full_name, length(v_first_name) + 1)), '');
  v_last_name := coalesce(v_last_name, 'Lead');

  insert into public.contacts (org_id, full_name, email, phone)
  values (
    v_org_id,
    v_full_name,
    nullif(trim(p_email), ''),
    nullif(trim(p_phone), '')
  )
  returning id into v_contact_id;

  insert into public.leads (
    org_id,
    created_by,
    first_name,
    last_name,
    email,
    phone,
    status,
    contact_id
  )
  values (
    v_org_id,
    auth.uid(),
    coalesce(nullif(trim(v_first_name), ''), 'Unknown'),
    coalesce(nullif(trim(v_last_name), ''), 'Lead'),
    nullif(trim(p_email), ''),
    nullif(trim(p_phone), ''),
    'new',
    v_contact_id
  )
  returning id into v_lead_id;

  return v_lead_id;
end;
$function$


-- ---- create_minimal_client_for_deal ----
CREATE OR REPLACE FUNCTION public.create_minimal_client_for_deal(p_org_id uuid, p_created_by uuid, p_contact_id uuid, p_full_name text, p_email text, p_phone text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_first_name text := coalesce(nullif(split_part(coalesce(p_full_name, ''), ' ', 1), ''), 'Unknown');
  v_last_name  text := coalesce(
                         nullif(trim(substr(coalesce(p_full_name, ''),
                           length(split_part(coalesce(p_full_name, ''), ' ', 1)) + 1)), ''),
                         'Client');
  v_client_id uuid;
begin
  insert into public.clients (
    org_id, created_by, contact_id,
    first_name, last_name, email, phone, status
  )
  values (
    p_org_id,
    p_created_by,
    p_contact_id,
    v_first_name,
    v_last_name,
    nullif(trim(coalesce(p_email, '')), ''),
    nullif(trim(coalesce(p_phone, '')), ''),
    'active'
  )
  returning id into v_client_id;

  return v_client_id;
end;
$function$


-- ---- create_minimal_job_for_deal ----
CREATE OR REPLACE FUNCTION public.create_minimal_job_for_deal(p_org_id uuid, p_created_by uuid, p_client_id uuid, p_title text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_job_id uuid;
begin
  insert into public.jobs (
    org_id,
    created_by,
    client_id,
    title,
    property_address,
    status
  )
  values (
    p_org_id,
    coalesce(p_created_by, auth.uid()),
    p_client_id,
    coalesce(nullif(trim(p_title), ''), 'New Deal Job'),
    '-',
    'draft'
  )
  returning id into v_job_id;

  return v_job_id;
end;
$function$


*/
