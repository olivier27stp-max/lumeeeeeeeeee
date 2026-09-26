-- Champs personnalisés — refonte « comme GoHighLevel », PR 4 : trois types de plus.
--
--   · checkbox (« Case à cocher ») : oui / non, dans une colonne à elle,
--     value_boolean. Filtre « est » oui / non : « non » inclut les fiches jamais
--     cochées (une case vide n'est pas cochée) — même sémantique dans les trois
--     moteurs (ici, src/lib/champs/filtres.ts, src/lib/champs/filtresListe.ts).
--   · url : texte, http(s) seulement (pas de javascript:, pas de data:), cherchable
--     et filtrable comme un texte.
--   · file (« Fichier ») : le fichier va dans le bucket PRIVÉ custom-field-files,
--     sous <org_id>/<uuid>/<nom> ; la valeur est ce chemin (value_text). Le
--     trigger refuse un chemin qui n'est pas dans le dossier de l'entreprise du
--     champ : impossible de rattacher le fichier d'une autre entreprise. Lecture
--     par URL signée (policies storage : membres de l'entreprise seulement).
--     Filtres : « est vide / n'est pas vide ».
--
-- Les fonctions redéfinies ici sont celles de 20260926100000 telles qu'en
-- prod/staging (relues par pg_get_functiondef le 2026-09-29) ; seules les
-- lignes des deux nouveaux types changent. `create or replace` garde les droits.
-- Les nouvelles valeurs d'énum ne sont utilisées que dans des corps plpgsql
-- (évalués à l'exécution) : elles peuvent être ajoutées dans la même migration.

alter type public.cf_field_type add value if not exists 'checkbox';
alter type public.cf_field_type add value if not exists 'url';
alter type public.cf_field_type add value if not exists 'file';

alter table public.custom_field_values add column if not exists value_boolean boolean;

-- ── Validation d'une valeur ──────────────────────────────────────────────────
create or replace function public.cf_valeur_avant_ecriture()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
declare
  f public.custom_fields%rowtype;
  v_dec integer;
  v_min numeric;
  v_max numeric;
begin
  select * into f from public.custom_fields where id = new.field_id;
  if not found then
    raise exception 'Champ personnalisé introuvable.' using errcode = '23503';
  end if;
  new.object_type := f.object_type;
  new.unique_enforced := f.is_unique;

  -- Seule la colonne du type peut être remplie.
  if f.field_type in ('single_line', 'multi_line', 'phone', 'email', 'url', 'file') then
    if num_nonnulls(new.value_number, new.value_money_cents, new.value_date, new.value_timestamp, new.value_option_id, new.value_boolean) > 0 then
      raise exception '« % » attend du texte.', f.label using errcode = '22023';
    end if;
  elsif f.field_type = 'number' then
    if num_nonnulls(new.value_text, new.value_money_cents, new.value_date, new.value_timestamp, new.value_option_id, new.value_boolean) > 0 then
      raise exception '« % » attend un nombre.', f.label using errcode = '22023';
    end if;
  elsif f.field_type = 'monetary' then
    if num_nonnulls(new.value_text, new.value_number, new.value_date, new.value_timestamp, new.value_option_id, new.value_boolean) > 0 then
      raise exception '« % » attend un montant.', f.label using errcode = '22023';
    end if;
  elsif f.field_type = 'date' then
    if num_nonnulls(new.value_text, new.value_number, new.value_money_cents, new.value_option_id, new.value_boolean) > 0
       or (coalesce((f.config->>'include_time')::boolean, false) and new.value_date is not null)
       or (not coalesce((f.config->>'include_time')::boolean, false) and new.value_timestamp is not null) then
      raise exception '« % » attend une date%.', f.label,
        case when coalesce((f.config->>'include_time')::boolean, false) then ' et une heure' else '' end
        using errcode = '22023';
    end if;
  elsif f.field_type = 'dropdown_single' then
    if num_nonnulls(new.value_text, new.value_number, new.value_money_cents, new.value_date, new.value_timestamp, new.value_boolean) > 0 then
      raise exception '« % » attend une option de la liste.', f.label using errcode = '22023';
    end if;
  elsif f.field_type = 'dropdown_multi' then
    if num_nonnulls(new.value_text, new.value_number, new.value_money_cents, new.value_date, new.value_timestamp, new.value_option_id, new.value_boolean) > 0 then
      raise exception '« % » attend des options de la liste.', f.label using errcode = '22023';
    end if;
  elsif f.field_type = 'checkbox' then
    if num_nonnulls(new.value_text, new.value_number, new.value_money_cents, new.value_date, new.value_timestamp, new.value_option_id) > 0 then
      raise exception '« % » attend oui ou non.', f.label using errcode = '22023';
    end if;
  end if;

  -- Validation et normalisation par type.
  new.value_normalized := null;
  if f.field_type = 'email' and new.value_text is not null then
    new.value_text := btrim(new.value_text);
    if new.value_text !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception '« % » attend une adresse courriel valide.', f.label using errcode = '22023';
    end if;
    new.value_normalized := lower(new.value_text);
  elsif f.field_type = 'url' and new.value_text is not null then
    new.value_text := btrim(new.value_text);
    -- http(s) seulement : un lien « javascript: » ou « data: » affiché sur une fiche serait un piège.
    if new.value_text !~* '^https?://[^\s/$.?#][^\s]*$' or length(new.value_text) > 2000 then
      raise exception '« % » attend une adresse web (https://…).', f.label using errcode = '22023';
    end if;
    new.value_normalized := lower(new.value_text);
  elsif f.field_type = 'file' and new.value_text is not null then
    -- Chemin dans custom-field-files : <org du champ>/<uuid>/<nom>. Jamais le fichier d'une autre entreprise.
    if new.value_text !~ ('^' || f.org_id::text || '/[0-9a-f-]{36}/[^/]{1,200}$') then
      raise exception '« % » attend un fichier téléversé.', f.label using errcode = '22023';
    end if;
    new.value_normalized := lower(regexp_replace(new.value_text, '^.*/', ''));
  elsif f.field_type = 'phone' and new.value_text is not null then
    new.value_normalized := public.cf_normaliser_telephone(new.value_text);
    if new.value_normalized is null then
      raise exception '« % » attend un numéro de téléphone valide.', f.label using errcode = '22023';
    end if;
    new.value_text := new.value_normalized;
  elsif f.field_type in ('single_line', 'multi_line') and new.value_text is not null then
    if f.field_type = 'single_line' and new.value_text ~ '\n' then
      raise exception '« % » tient sur une ligne.', f.label using errcode = '22023';
    end if;
    new.value_normalized := lower(btrim(regexp_replace(new.value_text, '\s+', ' ', 'g')));
  elsif f.field_type = 'number' and new.value_number is not null then
    v_dec := nullif(f.config->>'decimals', '')::integer;
    v_min := nullif(f.config->>'min', '')::numeric;
    v_max := nullif(f.config->>'max', '')::numeric;
    if v_dec is not null then new.value_number := round(new.value_number, v_dec); end if;
    if v_min is not null and new.value_number < v_min then
      raise exception '« % » doit être au moins %.', f.label, v_min using errcode = '22023';
    end if;
    if v_max is not null and new.value_number > v_max then
      raise exception '« % » doit être au plus %.', f.label, v_max using errcode = '22023';
    end if;
    new.value_normalized := new.value_number::text;
  elsif f.field_type = 'monetary' and new.value_money_cents is not null then
    new.value_currency := upper(coalesce(new.value_currency, nullif(f.config->>'currency', ''), 'CAD'));
    new.value_normalized := new.value_money_cents::text;
  elsif f.field_type = 'checkbox' and new.value_boolean is not null then
    new.value_normalized := new.value_boolean::text;
  end if;
  if f.field_type <> 'monetary' then new.value_currency := null; end if;

  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
    new.updated_at := now();
    new.created_at := old.created_at;
  end if;
  return new;
end $function$;

-- ── Écriture d'une valeur (value_boolean en plus) ─────────────────────────────
create or replace function public.cf_ecrire_valeur(p_field uuid, p_entity uuid, p_cols jsonb, p_options uuid[] default null::uuid[], p_version integer default null::integer)
 returns jsonb
 language plpgsql
 set search_path to ''
as $function$
declare
  f public.custom_fields%rowtype;
  v public.custom_field_values%rowtype;
  v_col text;
  v_ancien jsonb;
  v_anciennes uuid[] := '{}';
  v_nouv public.custom_field_values%rowtype;
  v_identique boolean;
begin
  select * into f from public.custom_fields where id = p_field;
  if not found then raise exception 'Champ introuvable.' using errcode = 'P0002'; end if;
  if f.archived_at is not null then raise exception '« % » est archivé.', f.label using errcode = '22023'; end if;
  v_col := f.object_type::text || '_id';

  execute format('select * from public.custom_field_values where field_id = $1 and %I = $2 for update', v_col)
    into v using p_field, p_entity;

  if v.id is not null then
    select coalesce(array_agg(option_id order by option_id), '{}') into v_anciennes
      from public.custom_field_value_options where value_id = v.id;
    v_ancien := jsonb_build_object(
      'value_text', v.value_text, 'value_number', v.value_number, 'value_money_cents', v.value_money_cents,
      'value_date', v.value_date, 'value_timestamp', v.value_timestamp, 'value_option_id', v.value_option_id,
      'value_boolean', v.value_boolean,
      'options', to_jsonb(v_anciennes));
  end if;

  -- Vider
  if p_cols is null or jsonb_typeof(p_cols) = 'null' then
    if v.id is null then
      return jsonb_build_object('changed', false, 'conflict', false, 'version', null, 'old', null);
    end if;
    if p_version is not null and v.version <> p_version then
      return jsonb_build_object('changed', false, 'conflict', true, 'version', v.version, 'old', v_ancien);
    end if;
    delete from public.custom_field_values where id = v.id;
    return jsonb_build_object('changed', true, 'conflict', false, 'version', null, 'old', v_ancien);
  end if;

  -- Déjà cette valeur ? (rejeu) → rien à faire, même si la version attendue a vieilli.
  if v.id is not null then
    v_identique :=
          v.value_text is not distinct from (p_cols->>'value_text')
      and v.value_number is not distinct from (p_cols->>'value_number')::numeric
      and v.value_money_cents is not distinct from (p_cols->>'value_money_cents')::bigint
      and v.value_date is not distinct from (p_cols->>'value_date')::date
      and v.value_timestamp is not distinct from (p_cols->>'value_timestamp')::timestamptz
      and v.value_option_id is not distinct from (p_cols->>'value_option_id')::uuid
      and v.value_boolean is not distinct from (p_cols->>'value_boolean')::boolean
      and v_anciennes = coalesce((select array_agg(x order by x) from unnest(p_options) x), '{}');
    if v_identique then
      return jsonb_build_object('changed', false, 'conflict', false, 'version', v.version, 'old', v_ancien);
    end if;
    if p_version is not null and v.version <> p_version then
      return jsonb_build_object('changed', false, 'conflict', true, 'version', v.version, 'old', v_ancien);
    end if;
    update public.custom_field_values set
      value_text = p_cols->>'value_text',
      value_number = (p_cols->>'value_number')::numeric,
      value_money_cents = (p_cols->>'value_money_cents')::bigint,
      value_currency = nullif(p_cols->>'value_currency', ''),
      value_date = (p_cols->>'value_date')::date,
      value_timestamp = (p_cols->>'value_timestamp')::timestamptz,
      value_option_id = (p_cols->>'value_option_id')::uuid,
      value_boolean = (p_cols->>'value_boolean')::boolean,
      updated_by = (select auth.uid())
    where id = v.id
    returning * into v_nouv;
  else
    execute format(
      'insert into public.custom_field_values (org_id, field_id, object_type, %I, value_text, value_number,
         value_money_cents, value_currency, value_date, value_timestamp, value_option_id, value_boolean)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning *', v_col)
      into v_nouv
      using f.org_id, p_field, f.object_type, p_entity, p_cols->>'value_text', (p_cols->>'value_number')::numeric,
            (p_cols->>'value_money_cents')::bigint, nullif(p_cols->>'value_currency', ''),
            (p_cols->>'value_date')::date, (p_cols->>'value_timestamp')::timestamptz, (p_cols->>'value_option_id')::uuid,
            (p_cols->>'value_boolean')::boolean;
  end if;

  if f.field_type = 'dropdown_multi' then
    delete from public.custom_field_value_options
     where value_id = v_nouv.id and not (option_id = any (coalesce(p_options, '{}')));
    insert into public.custom_field_value_options (org_id, field_id, value_id, option_id)
    select f.org_id, f.id, v_nouv.id, x from unnest(coalesce(p_options, '{}')) x
    on conflict do nothing;
  end if;

  return jsonb_build_object('changed', true, 'conflict', false, 'version', v_nouv.version, 'old', v_ancien);
end $function$;

-- ── Copie devis → job → facture (value_boolean suit) ─────────────────────────
create or replace function public.cf_copier_valeurs(p_org uuid, p_de text, p_de_id uuid, p_vers text, p_vers_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_nb integer := 0;
  r record;
  v_nouvelle uuid;
  v_option uuid;
  v_existe boolean;
begin
  if p_de not in ('client', 'deal', 'job', 'quote', 'invoice')
     or p_vers not in ('client', 'deal', 'job', 'quote', 'invoice') then
    raise exception 'cf_copier_valeurs : objet invalide (% → %)', p_de, p_vers;
  end if;
  if p_de_id is null or p_vers_id is null or p_de = p_vers then
    return 0;
  end if;
  -- Les deux fiches appartiennent à l'entreprise annoncée.
  execute format('select exists (select 1 from public.%I where id = $1 and org_id = $2)', p_de || 's')
    into v_existe using p_de_id, p_org;
  if not v_existe then return 0; end if;
  execute format('select exists (select 1 from public.%I where id = $1 and org_id = $2)', p_vers || 's')
    into v_existe using p_vers_id, p_org;
  if not v_existe then return 0; end if;

  for r in execute format($q$
    select v.*, fc.id as champ_cible, fc.field_type as type_cible
      from public.custom_field_values v
      join public.custom_fields fs on fs.id = v.field_id
      join public.custom_fields fc on fc.org_id = v.org_id and fc.object_type::text = $3
                                  and fc.key = fs.key and fc.field_type = fs.field_type and fc.archived_at is null
     where v.org_id = $1 and v.%I = $2
       and not exists (select 1 from public.custom_field_values x where x.field_id = fc.id and x.%I = $4)
  $q$, p_de || '_id', p_vers || '_id')
  using p_org, p_de_id, p_vers, p_vers_id
  loop
    v_option := null;
    if r.value_option_id is not null then
      select oc.id into v_option
        from public.custom_field_options os
        join public.custom_field_options oc on oc.field_id = r.champ_cible
                                           and lower(oc.label) = lower(os.label) and oc.archived_at is null
       where os.id = r.value_option_id
       limit 1;
      -- Option sans équivalent dans la liste cible : rien à copier pour ce champ.
      if v_option is null then continue; end if;
    end if;

    execute format($i$
      insert into public.custom_field_values (org_id, field_id, object_type, %I, value_text, value_number,
        value_money_cents, value_currency, value_date, value_timestamp, value_option_id, value_boolean)
      values ($1, $2, $3::public.cf_object_type, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      returning id
    $i$, p_vers || '_id')
    into v_nouvelle
    using r.org_id, r.champ_cible, p_vers, p_vers_id, r.value_text, r.value_number,
      r.value_money_cents, r.value_currency, r.value_date, r.value_timestamp, v_option, r.value_boolean;

    if r.type_cible = 'dropdown_multi' then
      insert into public.custom_field_value_options (org_id, field_id, value_id, option_id)
      select r.org_id, r.champ_cible, v_nouvelle, oc.id
        from public.custom_field_value_options vo
        join public.custom_field_options os on os.id = vo.option_id
        join public.custom_field_options oc on oc.field_id = r.champ_cible
                                           and lower(oc.label) = lower(os.label) and oc.archived_at is null
       where vo.value_id = r.id
      on conflict do nothing;
    end if;
    v_nb := v_nb + 1;
  end loop;
  return v_nb;
end $function$;

create or replace function public.cf_copier_valeurs_deal_vers_job(p_deal uuid, p_job uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_nb integer := 0;
  r record;
  v_nouvelle uuid;
begin
  for r in
    select v.*, fj.id as champ_job, fj.field_type as type_job
      from public.custom_field_values v
      join public.custom_fields fd on fd.id = v.field_id
      join public.custom_fields fj on fj.org_id = v.org_id and fj.object_type = 'job'
                                  and fj.key = fd.key and fj.field_type = fd.field_type and fj.archived_at is null
     where v.deal_id = p_deal
       and not exists (select 1 from public.custom_field_values x where x.field_id = fj.id and x.job_id = p_job)
  loop
    insert into public.custom_field_values (org_id, field_id, object_type, job_id, value_text, value_number,
      value_money_cents, value_currency, value_date, value_timestamp, value_option_id, value_boolean)
    values (r.org_id, r.champ_job, 'job', p_job, r.value_text, r.value_number, r.value_money_cents,
      r.value_currency, r.value_date, r.value_timestamp,
      -- une option se retrouve par son libellé dans la liste du champ job
      (select oj.id from public.custom_field_options od
         join public.custom_field_options oj on oj.field_id = r.champ_job and lower(oj.label) = lower(od.label) and oj.archived_at is null
        where od.id = r.value_option_id limit 1),
      r.value_boolean)
    returning id into v_nouvelle;
    if r.type_job = 'dropdown_multi' then
      insert into public.custom_field_value_options (org_id, field_id, value_id, option_id)
      select r.org_id, r.champ_job, v_nouvelle, oj.id
        from public.custom_field_value_options vo
        join public.custom_field_options od on od.id = vo.option_id
        join public.custom_field_options oj on oj.field_id = r.champ_job and lower(oj.label) = lower(od.label) and oj.archived_at is null
       where vo.value_id = r.id
      on conflict do nothing;
    end if;
    v_nb := v_nb + 1;
  end loop;
  return v_nb;
end $function$;

-- ── Lecture « lisible » (export des données d'un client) ─────────────────────
create or replace function public.cf_valeurs_lisibles(p_client uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'object_type', v.object_type,
           'entity_id', coalesce(v.client_id, v.deal_id, v.job_id, v.quote_id, v.invoice_id),
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
      or v.invoice_id in (select i.id from public.invoices i where i.client_id = p_client);
$function$;

-- ── Tri par un champ (cochées d'abord en décroissant, après en croissant) ─────
create or replace function public.cf_ordre_ids(p_field uuid, p_asc boolean default true)
 returns setof uuid
 language sql
 stable
 security invoker
 set search_path to ''
as $function$
  select coalesce(v.client_id, v.deal_id, v.job_id, v.quote_id, v.invoice_id)
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

-- ── Filtres (moteur SQL) ─────────────────────────────────────────────────────
create or replace function public.cf_condition_sql(p_champ public.custom_fields, c jsonb, p_fuseau text, p_col text)
 returns text
 language plpgsql
 stable
 set search_path to ''
as $function$
declare
  op text := c->>'op';
  v_col text;
  v_val text := c->>'value';
  v_val2 text := c->>'value2';
  v_n integer := coalesce(nullif(c->>'n', '')::integer, 0);
  v_unit text := coalesce(c->>'unit', 'days');
  v_interval text;
  v_date_seule boolean;
  v_expr text;
  v_aujourdhui text;
  v_ids text;
  v_absence boolean := op in ('is_empty', 'is_not', 'not_contains', 'neq', 'none_of');
begin
  if v_unit not in ('days', 'weeks', 'months') then
    raise exception 'Unité inconnue : %', v_unit using errcode = '22023';
  end if;
  if v_n < 0 or v_n > 3650 then raise exception 'N hors bornes.' using errcode = '22023'; end if;
  v_interval := format('interval %L', v_n || ' ' || v_unit);

  -- Opérateurs permis par type (miroir de OPERATEURS_PAR_TYPE, src/lib/champs/filtres.ts).
  if op is null or not (op = any (case
      when p_champ.field_type in ('single_line', 'multi_line', 'email', 'phone', 'url')
        then array['is', 'is_not', 'contains', 'not_contains', 'is_empty', 'is_not_empty']
      when p_champ.field_type in ('number', 'monetary')
        then array['eq', 'neq', 'gt', 'lt', 'between', 'is_empty', 'is_not_empty']
      when p_champ.field_type in ('dropdown_single', 'dropdown_multi')
        then array['any_of', 'none_of', 'is_empty', 'is_not_empty']
      when p_champ.field_type = 'checkbox'
        then array['is']
      when p_champ.field_type = 'file'
        then array['is_empty', 'is_not_empty']
      else array['today', 'yesterday', 'in_last', 'more_than_ago', 'less_than_ago', 'before', 'after', 'between', 'is_empty', 'is_not_empty']
    end)) then
    raise exception 'Opérateur « % » invalide pour un champ %.', op, p_champ.field_type using errcode = '22023';
  end if;

  if op = 'is_empty' or op = 'is_not_empty' then
    v_expr := 'true';
  else
  case p_champ.field_type
    when 'single_line', 'multi_line', 'email', 'phone', 'url' then
      v_col := 'v.value_normalized';
      if p_champ.field_type = 'phone' then
        v_val := coalesce(public.cf_normaliser_telephone(v_val), lower(btrim(coalesce(v_val, ''))));
      else
        v_val := lower(btrim(regexp_replace(coalesce(v_val, ''), '\s+', ' ', 'g')));
      end if;
      v_expr := case op
        when 'is' then format('%s = %L', v_col, v_val)
        when 'is_not' then format('%s = %L', v_col, v_val)
        when 'contains' then format('%s like %L', v_col, '%' || replace(replace(v_val, '%', '\%'), '_', '\_') || '%')
        when 'not_contains' then format('%s like %L', v_col, '%' || replace(replace(v_val, '%', '\%'), '_', '\_') || '%')
      end;
    when 'checkbox' then
      -- « est non » = pas cochée, y compris jamais remplie : l'absence d'un « oui ».
      if lower(coalesce(v_val, '')) not in ('true', 'false') then
        raise exception 'Valeur manquante pour « % » (oui ou non).', op using errcode = '22023';
      end if;
      v_absence := lower(v_val) = 'false';
      v_expr := 'v.value_boolean = true';
    when 'number', 'monetary' then
      v_col := case when p_champ.field_type = 'number' then 'v.value_number' else 'v.value_money_cents' end;
      -- Les montants arrivent en cents, comme partout dans Lume.
      if v_val is null or (op = 'between' and v_val2 is null) then
        raise exception 'Valeur manquante pour « % ».', op using errcode = '22023';
      end if;
      perform v_val::numeric; perform coalesce(v_val2, '0')::numeric;
      v_expr := case op
        when 'eq' then format('%s = %s', v_col, v_val::numeric)
        when 'neq' then format('%s = %s', v_col, v_val::numeric)
        when 'gt' then format('%s > %s', v_col, v_val::numeric)
        when 'lt' then format('%s < %s', v_col, v_val::numeric)
        when 'between' then format('%s between %s and %s', v_col, least(v_val::numeric, v_val2::numeric), greatest(v_val::numeric, v_val2::numeric))
      end;
    when 'dropdown_single', 'dropdown_multi' then
      select string_agg(format('%L::uuid', x), ',') into v_ids
        from jsonb_array_elements_text(case when jsonb_typeof(c->'value') = 'array' then c->'value' else jsonb_build_array(c->>'value') end) x;
      if v_ids is null then raise exception 'Aucune option choisie.' using errcode = '22023'; end if;
      if p_champ.field_type = 'dropdown_single' then
        v_expr := case op
          when 'any_of' then format('v.value_option_id in (%s)', v_ids)
          when 'none_of' then format('v.value_option_id in (%s)', v_ids)
        end;
      else
        v_expr := case op
          when 'any_of' then format('v.id in (select vo.value_id from public.custom_field_value_options vo where vo.field_id = %L and vo.option_id in (%s))', p_champ.id, v_ids)
          when 'none_of' then format('v.id in (select vo.value_id from public.custom_field_value_options vo where vo.field_id = %L and vo.option_id in (%s))', p_champ.id, v_ids)
        end;
      end if;
    when 'date' then
      v_date_seule := not coalesce((p_champ.config->>'include_time')::boolean, false);
      -- On compare des DATES LOCALES : une date+heure est ramenée au jour
      -- civil du fuseau de l'entreprise, jamais au jour UTC.
      v_col := case when v_date_seule then 'v.value_date'
                    else format('(v.value_timestamp at time zone %L)', p_fuseau) end;
      v_aujourdhui := format('(now() at time zone %L)', p_fuseau);
      if op in ('before', 'after', 'between') and (v_val is null or (op = 'between' and v_val2 is null)) then
        raise exception 'Date manquante pour « % ».', op using errcode = '22023';
      end if;
      if v_val is not null then perform v_val::date; end if;
      if v_val2 is not null then perform v_val2::date; end if;
      v_expr := case op
        when 'today' then format('%s::date = %s::date', v_col, v_aujourdhui)
        when 'yesterday' then format('%s::date = (%s::date - 1)', v_col, v_aujourdhui)
        -- « dans les N derniers » : de maintenant-N à maintenant (inclus).
        when 'in_last' then case when v_date_seule
          then format('%s between (%s - %s)::date and %s::date', v_col, v_aujourdhui, v_interval, v_aujourdhui)
          else format('%s between (%s - %s) and %s', v_col, v_aujourdhui, v_interval, v_aujourdhui) end
        -- « il y a plus de N » : strictement avant maintenant-N.
        when 'more_than_ago' then case when v_date_seule
          then format('%s < (%s - %s)::date', v_col, v_aujourdhui, v_interval)
          else format('%s < (%s - %s)', v_col, v_aujourdhui, v_interval) end
        -- « il y a moins de N » : après maintenant-N (le futur compte).
        when 'less_than_ago' then case when v_date_seule
          then format('%s >= (%s - %s)::date', v_col, v_aujourdhui, v_interval)
          else format('%s >= (%s - %s)', v_col, v_aujourdhui, v_interval) end
        when 'before' then format('%s::date < %L::date', v_col, v_val)
        when 'after' then format('%s::date > %L::date', v_col, v_val)
        when 'between' then format('%s::date between least(%L::date, %L::date) and greatest(%L::date, %L::date)', v_col, v_val, v_val2, v_val, v_val2)
      end;
  end case;
  end if;
  if v_expr is null then
    raise exception 'Opérateur « % » invalide pour un champ %.', op, p_champ.field_type using errcode = '22023';
  end if;
  return format('e.id %s (select v.%I from public.custom_field_values v where v.field_id = %L and v.%I is not null and %s)',
    case when v_absence then 'not in' else 'in' end, p_col, p_champ.id, p_col, v_expr);
end $function$;

-- ── Fichiers des champs « Fichier » ──────────────────────────────────────────
-- Privé ; 25 Mo ; documents et images courants (pas d'exécutable, pas de HTML).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('custom-field-files', 'custom-field-files', false, 26214400, array[
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic',
  'text/plain', 'text/csv',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
]::text[])
on conflict (id) do nothing;

-- Mêmes règles que les autres buckets privés : le premier dossier est l'entreprise.
drop policy if exists "custom_field_files_select_own_org" on storage.objects;
create policy "custom_field_files_select_own_org" on storage.objects for select to authenticated
  using (bucket_id = 'custom-field-files' and public.has_org_membership((select auth.uid()), public.lume_storage_object_org(name)));
drop policy if exists "custom_field_files_insert_own_org" on storage.objects;
create policy "custom_field_files_insert_own_org" on storage.objects for insert to authenticated
  with check (bucket_id = 'custom-field-files' and public.has_org_membership((select auth.uid()), public.lume_storage_object_org(name)));
drop policy if exists "custom_field_files_update_own_org" on storage.objects;
create policy "custom_field_files_update_own_org" on storage.objects for update to authenticated
  using (bucket_id = 'custom-field-files' and public.has_org_membership((select auth.uid()), public.lume_storage_object_org(name)))
  with check (bucket_id = 'custom-field-files' and public.has_org_membership((select auth.uid()), public.lume_storage_object_org(name)));
drop policy if exists "custom_field_files_delete_own_org" on storage.objects;
create policy "custom_field_files_delete_own_org" on storage.objects for delete to authenticated
  using (bucket_id = 'custom-field-files' and public.has_org_membership((select auth.uid()), public.lume_storage_object_org(name)));
