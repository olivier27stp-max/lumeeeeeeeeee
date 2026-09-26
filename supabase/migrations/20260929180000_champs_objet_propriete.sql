-- Champs personnalisés — refonte « comme GoHighLevel », PR 5 : l'objet « Propriété ».
--
-- Décision de la Phase 3 (validée) : les propriétés d'un client (adresse de
-- service) portent leurs propres champs — type de toiture, code de la barrière,
-- superficie du terrain — distincts du client (qui peut en avoir plusieurs).
--
--   · cf_object_type += 'property' ; custom_field_values.property_id, clé
--     étrangère COMPOSITE (org_id, property_id) → properties (org_id, id),
--     ON DELETE CASCADE comme les autres entités ; une valeur par champ et par
--     propriété (index unique) ; les deux CHECK d'entité incluent la propriété.
--   · RLS : cf_parent_visible prend la propriété (la RLS de properties
--     s'applique, fonction SECURITY INVOKER) ; les quatre policies des valeurs
--     sont recréées à l'identique avec ce 7e argument. Écrire exige
--     clients.update (une propriété appartient au client).
--   · Filtre, tri, recherche, doublons, export « lisible » d'un client, et
--     effacement d'un client (anonymize_client) incluent la propriété.
-- Les fonctions sont reprises de pg_get_functiondef (staging = prod, 2026-09-29) ;
-- seules les lignes de la propriété changent.

alter type public.cf_object_type add value if not exists 'property';

alter table public.custom_field_values add column if not exists property_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'custom_field_values_property_fk') then
    alter table public.custom_field_values
      add constraint custom_field_values_property_fk foreign key (org_id, property_id)
      references public.properties (org_id, id) on delete cascade;
  end if;
end $$;
create unique index if not exists custom_field_values_property_uniq on public.custom_field_values (field_id, property_id) where property_id is not null;
create index if not exists custom_field_values_property_idx on public.custom_field_values (property_id) where property_id is not null;

alter table public.custom_field_values drop constraint if exists custom_field_values_une_entite;
alter table public.custom_field_values add constraint custom_field_values_une_entite
  check (num_nonnulls(client_id, deal_id, job_id, quote_id, invoice_id, property_id) = 1);
alter table public.custom_field_values drop constraint if exists custom_field_values_entite_du_type;
alter table public.custom_field_values add constraint custom_field_values_entite_du_type check (
  case object_type::text
    when 'client' then client_id is not null
    when 'deal' then deal_id is not null
    when 'job' then job_id is not null
    when 'quote' then quote_id is not null
    when 'invoice' then invoice_id is not null
    when 'property' then property_id is not null
    else null::boolean
  end);

-- ── Visibilité du parent (RLS des valeurs) ───────────────────────────────────
create or replace function public.cf_parent_visible(p_org uuid, p_client uuid, p_deal uuid, p_job uuid, p_quote uuid, p_invoice uuid, p_property uuid)
 returns boolean
 language sql
 stable
 set search_path to ''
as $function$
  select case
    when p_client   is not null then exists (select 1 from public.clients    e where e.org_id = p_org and e.id = p_client)
    when p_deal     is not null then exists (select 1 from public.deals      e where e.org_id = p_org and e.id = p_deal)
    when p_job      is not null then exists (select 1 from public.jobs       e where e.org_id = p_org and e.id = p_job)
    when p_quote    is not null then exists (select 1 from public.quotes     e where e.org_id = p_org and e.id = p_quote)
    when p_invoice  is not null then exists (select 1 from public.invoices   e where e.org_id = p_org and e.id = p_invoice)
    when p_property is not null then exists (select 1 from public.properties e where e.org_id = p_org and e.id = p_property)
    else false
  end;
$function$;
revoke all on function public.cf_parent_visible(uuid, uuid, uuid, uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.cf_parent_visible(uuid, uuid, uuid, uuid, uuid, uuid, uuid) to authenticated, service_role;

drop policy if exists custom_field_values_select on public.custom_field_values;
create policy custom_field_values_select on public.custom_field_values for select to authenticated using (
     ((client_id is not null) and (client_id in (select e.id from public.clients e)))
  or ((deal_id is not null) and (deal_id in (select e.id from public.deals e)))
  or ((job_id is not null) and (job_id in (select e.id from public.jobs e)))
  or ((quote_id is not null) and (quote_id in (select e.id from public.quotes e)))
  or ((invoice_id is not null) and (invoice_id in (select e.id from public.invoices e)))
  or ((property_id is not null) and (property_id in (select e.id from public.properties e))));
drop policy if exists custom_field_values_insert on public.custom_field_values;
create policy custom_field_values_insert on public.custom_field_values for insert to authenticated with check (
  public.member_has_permission((select auth.uid()), org_id, public.cf_cle_permission_ecriture(object_type))
  and public.cf_parent_visible(org_id, client_id, deal_id, job_id, quote_id, invoice_id, property_id));
drop policy if exists custom_field_values_update on public.custom_field_values;
create policy custom_field_values_update on public.custom_field_values for update to authenticated
  using (public.member_has_permission((select auth.uid()), org_id, public.cf_cle_permission_ecriture(object_type))
         and public.cf_parent_visible(org_id, client_id, deal_id, job_id, quote_id, invoice_id, property_id))
  with check (public.member_has_permission((select auth.uid()), org_id, public.cf_cle_permission_ecriture(object_type))
         and public.cf_parent_visible(org_id, client_id, deal_id, job_id, quote_id, invoice_id, property_id));
drop policy if exists custom_field_values_delete on public.custom_field_values;
create policy custom_field_values_delete on public.custom_field_values for delete to authenticated using (
  public.member_has_permission((select auth.uid()), org_id, public.cf_cle_permission_ecriture(object_type))
  and public.cf_parent_visible(org_id, client_id, deal_id, job_id, quote_id, invoice_id, property_id));

-- L'ancienne signature n'est plus référencée par aucune policy.
drop function if exists public.cf_parent_visible(uuid, uuid, uuid, uuid, uuid, uuid);

-- ── Permission d'écriture et clés réservées ───────────────────────────────────
create or replace function public.cf_cle_permission_ecriture(p_object public.cf_object_type)
 returns text
 language sql
 immutable
 set search_path to ''
as $function$
  select case p_object::text
    when 'client' then 'clients.update'
    when 'deal' then 'leads.update'
    when 'job' then 'jobs.update'
    when 'quote' then 'quotes.update'
    when 'invoice' then 'invoices.update'
    when 'property' then 'clients.update'
  end;
$function$;

create or replace function public.cf_cles_standard(p_object public.cf_object_type)
 returns text[]
 language sql
 immutable
 set search_path to ''
as $function$
  select case p_object::text
    when 'client'  then array['first_name','last_name','name','company','email','phone','address','city','province','postal_code','status','source','notes','created_at','updated_at']
    when 'deal'    then array['title','stage','pipeline','source','assigned_user','amount','probability','expected_close_date','lost_reason','status','created_at','updated_at']
    when 'job'     then array['title','job_number','status','client','address','scheduled_at','total','notes','created_at','updated_at']
    when 'quote'   then array['title','quote_number','status','client','total','valid_until','notes','created_at','updated_at']
    when 'invoice' then array['invoice_number','status','client','total','due_date','balance','notes','created_at','updated_at']
    when 'property' then array['name','address','city','province','postal_code','country','client','kind','is_primary','created_at','updated_at']
  end;
$function$;

-- ── Filtres (table de l'objet) ────────────────────────────────────────────────
create or replace function public.cf_filtrer_brut(p_org uuid, p_object public.cf_object_type, p_conditions jsonb, p_ids uuid[] default null::uuid[])
 returns setof uuid
 language plpgsql
 stable
 set search_path to ''
as $function$
declare
  c jsonb;
  f public.custom_fields%rowtype;
  v_table text;
  v_col text;
  v_fuseau text := public.cf_fuseau(p_org);
  v_where text := '';
begin
  -- Garde tenant : membre de l'org (ou le serveur en service_role).
  if (select auth.uid()) is null then
    if coalesce((select auth.role()), '') <> 'service_role' then
      raise exception 'Non authentifié.' using errcode = '42501';
    end if;
  elsif not public.has_org_membership((select auth.uid()), p_org) then
    raise exception 'Permission refusée.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_conditions, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_conditions, '[]'::jsonb)) > 25 then
    raise exception 'Conditions invalides (25 au plus).' using errcode = '22023';
  end if;
  v_table := case p_object::text when 'client' then 'clients' when 'deal' then 'deals' when 'job' then 'jobs'
                           when 'quote' then 'quotes' when 'invoice' then 'invoices' when 'property' then 'properties' end;
  v_col := p_object::text || '_id';
  for c in select * from jsonb_array_elements(coalesce(p_conditions, '[]'::jsonb)) loop
    select * into f from public.custom_fields
     where id = (c->>'field_id')::uuid and org_id = p_org and object_type = p_object;
    if not found then raise exception 'Champ inconnu dans le filtre.' using errcode = '22023'; end if;
    v_where := v_where || ' and ' || public.cf_condition_sql(f, c, v_fuseau, v_col);
  end loop;
  return query execute format(
    'select e.id from public.%I e where e.org_id = $1 and ($2::uuid[] is null or e.id = any($2))%s',
    v_table, v_where)
    using p_org, p_ids;
end $function$;

create or replace function public.cf_filtrer(p_org uuid, p_object public.cf_object_type, p_conditions jsonb, p_ids uuid[] default null::uuid[])
 returns setof uuid
 language plpgsql
 stable
 set search_path to ''
as $function$
declare
  v_ids uuid[] := array(select public.cf_filtrer_brut(p_org, p_object, p_conditions, p_ids));
begin
  -- Visibilité : la RLS du parent, sur les seules lignes retenues.
  return query execute format('select e.id from public.%I e where e.id = any($1) and e.org_id = $2',
    case p_object::text when 'client' then 'clients' when 'deal' then 'deals' when 'job' then 'jobs'
                  when 'quote' then 'quotes' when 'invoice' then 'invoices' when 'property' then 'properties' end)
    using v_ids, p_org;
end $function$;

-- ── Lectures qui rendent l'entité ─────────────────────────────────────────────
create or replace function public.cf_ordre_ids(p_field uuid, p_asc boolean default true)
 returns setof uuid
 language sql
 stable
 security invoker
 set search_path to ''
as $function$
  select coalesce(v.client_id, v.deal_id, v.job_id, v.quote_id, v.invoice_id, v.property_id)
    from public.custom_field_values v
    left join public.custom_field_options o on o.id = v.value_option_id
   where v.field_id = p_field
   order by
     case when p_asc then v.value_number end asc nulls last,
     case when not p_asc then v.value_number end desc nulls last,
     case when p_asc then v.value_money_cents end asc nulls last,
     case when not p_asc then v.value_money_cents end desc nulls last,
     case when p_asc then coalesce(v.value_timestamp, v.value_date::timestamptz) end asc nulls last,
     case when not p_asc then coalesce(v.value_timestamp, v.value_date::timestamptz) end desc nulls last,
     case when p_asc then o.position end asc nulls last,
     case when not p_asc then o.position end desc nulls last,
     case when p_asc then v.value_boolean end asc nulls last,
     case when not p_asc then v.value_boolean end desc nulls last,
     case when p_asc then lower(coalesce(v.value_text, v.value_normalized)) end asc nulls last,
     case when not p_asc then lower(coalesce(v.value_text, v.value_normalized)) end desc nulls last,
     v.created_at desc
   limit 10000
$function$;

create or replace function public.cf_rechercher(p_org uuid, p_q text, p_limit integer default 20)
 returns table(object_type public.cf_object_type, entity_id uuid, field_id uuid, field_label text, value_text text)
 language sql
 stable
 set search_path to ''
as $function$
  select v.object_type, coalesce(v.client_id, v.deal_id, v.job_id, v.quote_id, v.invoice_id, v.property_id), f.id, f.label,
         coalesce(v.value_text, v.value_normalized)
    from public.custom_field_values v
    join public.custom_fields f on f.id = v.field_id
   where v.org_id = p_org
     and f.is_searchable and f.archived_at is null
     and length(btrim(coalesce(p_q, ''))) >= 2
     and v.value_normalized like '%' || replace(replace(lower(btrim(p_q)), '%', '\%'), '_', '\_') || '%'
   order by v.updated_at desc
   limit least(greatest(coalesce(p_limit, 20), 1), 50);
$function$;

create or replace function public.cf_doublons(p_field uuid)
 returns table(value_normalized text, nb bigint, entites uuid[])
 language sql
 stable
 set search_path to ''
as $function$
  select v.value_normalized, count(*),
         array_agg(coalesce(v.client_id, v.deal_id, v.job_id, v.quote_id, v.invoice_id, v.property_id))
    from public.custom_field_values v
   where v.field_id = p_field and v.value_normalized is not null
   group by v.value_normalized
  having count(*) > 1
   order by count(*) desc
   limit 50;
$function$;

create or replace function public.cf_valeurs_lisibles(p_client uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'object_type', v.object_type,
           'entity_id', coalesce(v.client_id, v.deal_id, v.job_id, v.quote_id, v.invoice_id, v.property_id),
           'field', f.label, 'key', f.key, 'type', f.field_type,
           'value', coalesce(v.value_text, v.value_number::text, v.value_money_cents::text, v.value_date::text,
                             v.value_timestamp::text, o.label,
                             case v.value_boolean when true then 'oui' when false then 'non' end,
                             (select string_agg(mo.label, ', ') from public.custom_field_value_options vo
                                join public.custom_field_options mo on mo.id = vo.option_id where vo.value_id = v.id)),
           'updated_at', v.updated_at) order by f.label), '[]'::jsonb)
    from public.custom_field_values v
    join public.custom_fields f on f.id = v.field_id
    left join public.custom_field_options o on o.id = v.value_option_id
   where v.client_id = p_client
      or v.deal_id in (select d.id from public.deals d where d.client_id = p_client)
      or v.job_id in (select j.id from public.jobs j where j.client_id = p_client)
      or v.quote_id in (select q.id from public.quotes q where q.client_id = p_client)
      or v.invoice_id in (select i.id from public.invoices i where i.client_id = p_client)
      or v.property_id in (select p.id from public.properties p where p.client_id = p_client);
$function$;

-- ── Effacement d'un client (Loi 25) : les valeurs de ses propriétés aussi ─────
create or replace function public.anonymize_client(p_client_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid;
  v_contact_id uuid;
  v_cols text;
  v_sql text;
begin
  select org_id, contact_id into v_org, v_contact_id
    from public.clients where id = p_client_id;
  if v_org is null then raise exception 'Client not found'; end if;
  -- N3.5 (audit 2026-07-31) : auth.uid() est NULL en service_role, donc
  -- has_org_admin_role(NULL, ...) renvoyait false et l'effacement echouait pour
  -- TOUT LE MONDE. On n'exige le role admin que d'un appelant authentifie ;
  -- le chemin serveur est borne par la verification d'org faite dans la route.
  if auth.uid() is not null and not public.has_org_admin_role(auth.uid(), v_org) then
    raise exception 'Only org admin/owner can anonymize clients';
  end if;

  -- Build SET clause dynamically from columns that actually exist
  select string_agg(
    case column_name
      when 'first_name' then 'first_name=''ANONYMIZED'''
      when 'last_name'  then 'last_name='''''
      else column_name || '=null'
    end, ', ')
    into v_cols
    from information_schema.columns
   where table_schema='public' and table_name='clients'
     and column_name in ('first_name','last_name','company','email','phone',
                         'address','address_line1','address_line2','street_number','street_name',
                         'city','province','postal_code','country',
                         'latitude','longitude','place_id','notes',
                         'sms_consent_at','email_consent_at');

  v_sql := format(
    'update public.clients set %s, deleted_at=coalesce(deleted_at, now()), updated_at=now() where id = %L',
    v_cols, p_client_id);
  execute v_sql;

  if v_contact_id is not null then
    update public.contacts
       set full_name='ANONYMIZED', email=null, phone=null,
           address_line1=null, address_line2=null,
           city=null, province=null, postal_code=null, country=null
     where id = v_contact_id;
  end if;

  -- champs personnalisés (2026-09-26) : valeurs du client, de ses deals et (2026-09-29) de ses propriétés.
  delete from public.custom_field_values
   where client_id = p_client_id
      or deal_id in (select d.id from public.deals d where d.client_id = p_client_id)
      or property_id in (select p.id from public.properties p where p.client_id = p_client_id);

  insert into public.audit_events(org_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, auth.uid(), 'anonymize', 'client', p_client_id, jsonb_build_object('method','dsr_erasure'));
end $function$;
