-- ═══════════════════════════════════════════════════════════════
-- Transfert d'un client entre bureaux : ses étiquettes suivent
--
-- `_client_dans_bureau` copiait `clients.tags`, une colonne morte : les vraies
-- étiquettes vivent dans `client_tags`. Un client transféré arrivait donc
-- sans étiquettes. Seul ajout : la copie des lignes de client_tags.
--
-- Définition reprise de la PROD (pg_get_functiondef, md5
-- 1e221d7f0b5ab97d4058d8e7fa4f9391, identique en staging le 2026-09-28).
--
-- ROLLBACK : rejouer la définition de 20260928050000_plan_a_la_lettre.sql.
-- ═══════════════════════════════════════════════════════════════

begin;

CREATE OR REPLACE FUNCTION public._client_dans_bureau(p_client uuid, p_cible uuid, p_uid uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- Les étiquettes suivent le client (2026-09-28) : elles vivent dans
  -- client_tags ; la colonne clients.tags copiée plus haut est morte.
  insert into public.client_tags (client_id, tag)
  select v_id, ct.tag from public.client_tags ct where ct.client_id = p_client
  on conflict (client_id, tag) do nothing;

  select c.org_id into v_src from public.clients c where c.id = p_client;
  select o.company_group_id into v_groupe from public.orgs o where o.id = p_cible;
  insert into public.transferts_bureaux (company_group_id, entite, org_source, id_source, org_cible, id_cible, fait_par, details)
  values (v_groupe, 'client', v_src, p_client, p_cible, v_id, p_uid, jsonb_build_object('copie_liee', true));
  return v_id;
end;
$function$
;

revoke all on function public._client_dans_bureau(uuid, uuid, uuid) from public, anon, authenticated;

commit;
