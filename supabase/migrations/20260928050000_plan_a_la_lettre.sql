-- Plan multi-bureaux « à la lettre » (2026-09-25) : deux écarts refermés.
--
-- 1. L2 — create_incident choisissait le bureau par `memberships … limit 1`
--    (sans ordre) : un incident déclaré dans Vision pouvait être rangé dans
--    Coquin. Il suit maintenant le bureau actif (current_org_id : en-tête du
--    bureau, adhésion ACTIVE vérifiée).
-- 2. §2.2 — au transfert, le client garde son numéro s'il est libre dans le
--    bureau cible (comparaison par chiffres) ; sinon un nouveau numéro.

create or replace function public.create_incident(p_title text, p_type text, p_severity text, p_description text default null::text, p_detection text default 'manual'::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid;
  v_id  uuid;
begin
  v_org := public.current_org_id();
  if v_org is null or not public.has_org_membership(auth.uid(), v_org) then
    raise exception 'No organization context';
  end if;
  if not public.has_org_admin_role(auth.uid(), v_org) then
    raise exception 'Only org admin/owner can declare incidents';
  end if;

  insert into public.security_incidents(
    org_id, incident_type, severity, status, title, description,
    detected_by, detection_method
  ) values (
    v_org, p_type, coalesce(p_severity,'low'), 'detected', p_title, p_description,
    auth.uid(), p_detection
  ) returning id into v_id;

  insert into public.incident_timeline(incident_id, actor_id, event_type, payload)
  values (v_id, auth.uid(), 'status_change', jsonb_build_object('to','detected','via','create_incident'));

  insert into public.audit_events(org_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, auth.uid(), 'incident_declared', 'security_incident', v_id,
    jsonb_build_object('type', p_type, 'severity', p_severity));

  return v_id;
end $function$;

create or replace function public._client_dans_bureau(p_client uuid, p_cible uuid, p_uid uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id uuid;
  v_src uuid;
  v_groupe uuid;
  v_numero text;
begin
  if p_client is null then return null; end if;

  select t.id_cible into v_id
    from public.transferts_bureaux t
    join public.clients c on c.id = t.id_cible and c.deleted_at is null
   where t.entite = 'client' and t.id_source = p_client and t.org_cible = p_cible
   order by t.fait_le desc limit 1;
  if v_id is not null then return v_id; end if;

  -- Le client garde son numéro s'il est libre dans le bureau cible (plan §2.2).
  perform pg_advisory_xact_lock(hashtextextended(p_cible::text || ':client', 0));
  select case when c.client_number is not null and not exists (
           select 1 from public.clients x
            where x.org_id = p_cible and x.deleted_at is null
              and nullif(regexp_replace(x.client_number, '\D', '', 'g'), '') = nullif(regexp_replace(c.client_number, '\D', '', 'g'), ''))
         then c.client_number end
    into v_numero
    from public.clients c where c.id = p_client;

  insert into public.clients (
    client_number, org_id, first_name, last_name, company, email, phone, address, status, notes,
    city, province, postal_code, country, street_number, street_name, latitude, longitude, place_id,
    display_as_company, billing_same_as_service, billing_address, lead_status, source, lead_source,
    title, value, description, phones, email_label, tags, tax_exempt,
    sms_consent_at, email_consent_at, email_opt_out_at, email_opt_out_reason,
    assigned_to, created_by
  )
  select v_numero, p_cible, c.first_name, c.last_name, c.company, c.email, c.phone, c.address, c.status, c.notes,
         c.city, c.province, c.postal_code, c.country, c.street_number, c.street_name, c.latitude, c.longitude, c.place_id,
         c.display_as_company, c.billing_same_as_service, c.billing_address, c.lead_status, c.source, c.lead_source,
         c.title, c.value, c.description, c.phones, c.email_label, c.tags, c.tax_exempt,
         c.sms_consent_at, c.email_consent_at, c.email_opt_out_at, c.email_opt_out_reason,
         public._membre_actif_ou_nul(c.assigned_to, p_cible), p_uid
    from public.clients c
   where c.id = p_client
  returning id into v_id;

  select c.org_id into v_src from public.clients c where c.id = p_client;
  select o.company_group_id into v_groupe from public.orgs o where o.id = p_cible;
  insert into public.transferts_bureaux (company_group_id, entite, org_source, id_source, org_cible, id_cible, fait_par, details)
  values (v_groupe, 'client', v_src, p_client, p_cible, v_id, p_uid, jsonb_build_object('copie_liee', true));
  return v_id;
end;
$function$;
