-- ═══════════════════════════════════════════════════════════════
-- Champs personnalisés v2 — le modèle GoHighLevel, en intègre
--
-- POURQUOI UN NOUVEAU MODÈLE (et pas une extension de custom_columns)
--   L'audit du 2026-09-24 a trouvé l'ancien système mort en pratique :
--   · aucune valeur n'a JAMAIS pu s'enregistrer : setValue (src) et l'outil
--     MCP set_custom_field font un upsert `onConflict: column_id,record_id`,
--     alors que l'index (column_id, record_id) a été remplacé par
--     (org_id, column_id, record_id) le 2026-07-51 → 42P10 à chaque écriture.
--     Prod : 0 valeur, 2 définitions, toutes deux supprimées.
--   · l'écran de réglages (CustomFieldsSettings.tsx) n'était monté nulle part.
--   · record_id est polymorphe : aucune FK, orphelins détectés après coup.
--   Rien à préserver côté données ; tout à préserver côté contrats (MCP,
--   Lumi). On bâtit donc le modèle cible, on recopie l'ancien registre
--   (backfill idempotent, section 9) et on laisse custom_columns en place,
--   en lecture seule de fait, jusqu'à validation.
--
-- LES GARANTIES SONT DANS LA BASE, pas dans le code :
--   · une valeur pointe UNE entité, par une vraie FK composite (org_id, x)
--     → aucune référence inter-entreprise possible, cascade à la suppression ;
--   · la valeur porte l'object_type de son champ, par FK composite aussi :
--     une valeur de champ « job » ne peut pas se poser sur un client ;
--   · une option choisie appartient au champ, par FK (org_id, field_id, id) ;
--   · la clé est immuable (les modèles et automatisations en dépendent) ;
--   · les conversions de type dangereuses sont refusées par trigger.
--
-- Les FK composites en SET NULL nomment LEUR colonne : `on delete set null
-- (folder_id)`. Sans la liste, Postgres remet aussi org_id à NULL — c'est
-- exactement le défaut trouvé sur deals.job_id (migration suivante).
-- ═══════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';

-- ───────────────────────────────────────────────────────────────
-- 1. Types
-- ───────────────────────────────────────────────────────────────
do $$ begin
  create type public.cf_object_type as enum ('client', 'deal', 'job', 'quote', 'invoice');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.cf_field_type as enum (
    'single_line', 'multi_line', 'number', 'monetary', 'phone', 'email',
    'date', 'dropdown_single', 'dropdown_multi'
  );
exception when duplicate_object then null; end $$;

-- ───────────────────────────────────────────────────────────────
-- 2. Registre des clés standard (miroir de src/lib/champs/standard.ts —
--    tests/champs-perso-standard-parite.test.ts compare les deux).
--    Une clé personnalisée ne peut pas porter le nom d'un champ natif :
--    {client_cf_email} et le courriel du client seraient indiscernables
--    pour la personne qui écrit un modèle.
-- ───────────────────────────────────────────────────────────────
create or replace function public.cf_cles_standard(p_object public.cf_object_type)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_object
    when 'client'  then array['first_name','last_name','name','company','email','phone','address','city','province','postal_code','status','source','notes','created_at','updated_at']
    when 'deal'    then array['title','stage','pipeline','source','assigned_user','amount','probability','expected_close_date','lost_reason','status','created_at','updated_at']
    when 'job'     then array['title','job_number','status','client','address','scheduled_at','total','notes','created_at','updated_at']
    when 'quote'   then array['title','quote_number','status','client','total','valid_until','notes','created_at','updated_at']
    when 'invoice' then array['invoice_number','status','client','total','due_date','balance','notes','created_at','updated_at']
  end;
$$;

-- Slug d'un libellé : minuscules, sans accents, [a-z0-9_], commence par une lettre.
create or replace function public.cf_slug(p_label text)
returns text
language sql
stable
set search_path = ''
as $$
  select left(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(extensions.unaccent(coalesce(p_label, ''))), '[^a-z0-9]+', '_', 'g'),
      '^[_0-9]+|_+$', '', 'g'),
    '^$', 'champ'),
  50);
$$;

-- ───────────────────────────────────────────────────────────────
-- 3. Dossiers
-- ───────────────────────────────────────────────────────────────
create table if not exists public.custom_field_folders (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  object_type public.cf_object_type not null,
  name        text not null,
  position    integer not null default 0,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint custom_field_folders_name_len check (length(btrim(name)) between 1 and 100),
  constraint custom_field_folders_org_id_id_uq unique (org_id, id),
  constraint custom_field_folders_org_obj_id_uq unique (org_id, object_type, id)
);

create unique index if not exists custom_field_folders_nom_uniq
  on public.custom_field_folders (org_id, object_type, lower(btrim(name)));

-- ───────────────────────────────────────────────────────────────
-- 4. Définitions
-- ───────────────────────────────────────────────────────────────
create table if not exists public.custom_fields (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  object_type public.cf_object_type not null,
  folder_id   uuid,
  key         text not null,
  label       text not null,
  placeholder text,
  help_text   text,
  field_type  public.cf_field_type not null,
  config      jsonb not null default '{}'::jsonb,
  is_required boolean not null default false,
  is_searchable boolean not null default false,
  is_unique   boolean not null default false,
  position    integer not null default 0,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz,
  -- Trace de la reprise depuis custom_columns (backfill idempotent).
  legacy_column_id uuid unique,
  constraint custom_fields_org_id_id_uq unique (org_id, id),
  constraint custom_fields_org_obj_id_uq unique (org_id, object_type, id),
  constraint custom_fields_cle_uq unique (org_id, object_type, key),
  constraint custom_fields_key_format check (key ~ '^[a-z][a-z0-9_]{0,49}$'),
  constraint custom_fields_label_len check (length(btrim(label)) between 1 and 100),
  constraint custom_fields_placeholder_len check (placeholder is null or length(placeholder) <= 200),
  constraint custom_fields_help_text_len check (help_text is null or length(help_text) <= 200),
  constraint custom_fields_config_objet check (jsonb_typeof(config) = 'object'),
  -- L'unicité n'a de sens que sur une valeur comparable telle quelle.
  constraint custom_fields_unique_types check (
    not is_unique or field_type in ('single_line', 'email', 'phone', 'number')
  ),
  -- Le dossier appartient à la même entreprise ET au même objet.
  constraint custom_fields_folder_fk foreign key (org_id, object_type, folder_id)
    references public.custom_field_folders (org_id, object_type, id)
    on delete set null (folder_id)
);

create index if not exists custom_fields_folder_idx on public.custom_fields (folder_id) where folder_id is not null;
create index if not exists custom_fields_org_obj_idx on public.custom_fields (org_id, object_type, position);

-- ───────────────────────────────────────────────────────────────
-- 5. Options de listes
-- ───────────────────────────────────────────────────────────────
create table if not exists public.custom_field_options (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  field_id    uuid not null,
  label       text not null,
  color       text,
  position    integer not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint custom_field_options_label_len check (length(btrim(label)) between 1 and 100),
  constraint custom_field_options_color_format check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  constraint custom_field_options_org_field_id_uq unique (org_id, field_id, id),
  constraint custom_field_options_field_fk foreign key (org_id, field_id)
    references public.custom_fields (org_id, id) on delete cascade
);

create index if not exists custom_field_options_field_idx on public.custom_field_options (field_id, position);
create unique index if not exists custom_field_options_label_uniq
  on public.custom_field_options (field_id, lower(btrim(label))) where archived_at is null;

-- ───────────────────────────────────────────────────────────────
-- 6. Valeurs
-- ───────────────────────────────────────────────────────────────
create table if not exists public.custom_field_values (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  field_id        uuid not null,
  object_type     public.cf_object_type not null,
  client_id       uuid,
  deal_id         uuid,
  job_id          uuid,
  quote_id        uuid,
  invoice_id      uuid,
  value_text      text,
  value_number    numeric,
  value_money_cents bigint,
  value_currency  char(3),
  value_date      date,
  value_timestamp timestamptz,
  value_option_id uuid,
  value_normalized text,
  unique_enforced boolean not null default false,
  version         integer not null default 1,
  updated_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint custom_field_values_value_text_len check (value_text is null or length(value_text) <= 5000),
  constraint custom_field_values_org_field_id_uq unique (org_id, field_id, id),
  -- Exactement UNE entité, et c'est celle de l'object_type.
  constraint custom_field_values_une_entite check (num_nonnulls(client_id, deal_id, job_id, quote_id, invoice_id) = 1),
  constraint custom_field_values_entite_du_type check (
    case object_type
      when 'client'  then client_id  is not null
      when 'deal'    then deal_id    is not null
      when 'job'     then job_id     is not null
      when 'quote'   then quote_id   is not null
      when 'invoice' then invoice_id is not null
    end
  ),
  -- Le champ appartient à la même entreprise ET au même objet.
  -- RESTRICT : une définition qui porte des valeurs ne se supprime pas par
  -- accident ; la purge passe par cf_purger_champ().
  constraint custom_field_values_field_fk foreign key (org_id, object_type, field_id)
    references public.custom_fields (org_id, object_type, id) on delete restrict,
  constraint custom_field_values_option_fk foreign key (org_id, field_id, value_option_id)
    references public.custom_field_options (org_id, field_id, id) on delete restrict,
  constraint custom_field_values_client_fk  foreign key (org_id, client_id)  references public.clients  (org_id, id) on delete cascade,
  constraint custom_field_values_deal_fk    foreign key (org_id, deal_id)    references public.deals    (org_id, id) on delete cascade,
  constraint custom_field_values_job_fk     foreign key (org_id, job_id)     references public.jobs     (org_id, id) on delete cascade,
  constraint custom_field_values_quote_fk   foreign key (org_id, quote_id)   references public.quotes   (org_id, id) on delete cascade,
  constraint custom_field_values_invoice_fk foreign key (org_id, invoice_id) references public.invoices (org_id, id) on delete cascade
);

create unique index if not exists custom_field_values_client_uniq  on public.custom_field_values (field_id, client_id)  where client_id  is not null;
create unique index if not exists custom_field_values_deal_uniq    on public.custom_field_values (field_id, deal_id)    where deal_id    is not null;
create unique index if not exists custom_field_values_job_uniq     on public.custom_field_values (field_id, job_id)     where job_id     is not null;
create unique index if not exists custom_field_values_quote_uniq   on public.custom_field_values (field_id, quote_id)   where quote_id   is not null;
create unique index if not exists custom_field_values_invoice_uniq on public.custom_field_values (field_id, invoice_id) where invoice_id is not null;
-- Index des FK côté entité (cascade rapide + lecture d'une fiche).
create index if not exists custom_field_values_client_idx  on public.custom_field_values (client_id)  where client_id  is not null;
create index if not exists custom_field_values_deal_idx    on public.custom_field_values (deal_id)    where deal_id    is not null;
create index if not exists custom_field_values_job_idx     on public.custom_field_values (job_id)     where job_id     is not null;
create index if not exists custom_field_values_quote_idx   on public.custom_field_values (quote_id)   where quote_id   is not null;
create index if not exists custom_field_values_invoice_idx on public.custom_field_values (invoice_id) where invoice_id is not null;
create index if not exists custom_field_values_org_field_idx on public.custom_field_values (org_id, field_id);
create index if not exists custom_field_values_option_idx on public.custom_field_values (value_option_id) where value_option_id is not null;
-- Tri et filtres par valeur (pipeline : nombre, montant, date).
create index if not exists custom_field_values_field_nombre_idx on public.custom_field_values (field_id, value_number) where value_number is not null;
create index if not exists custom_field_values_field_argent_idx on public.custom_field_values (field_id, value_money_cents) where value_money_cents is not null;
create index if not exists custom_field_values_field_date_idx on public.custom_field_values (field_id, value_date) where value_date is not null;
create index if not exists custom_field_values_field_ts_idx on public.custom_field_values (field_id, value_timestamp) where value_timestamp is not null;
-- Unicité sur la forme normalisée (courriel en minuscules, téléphone E.164).
create unique index if not exists custom_field_values_unique_uniq
  on public.custom_field_values (field_id, value_normalized)
  where unique_enforced and value_normalized is not null;
-- Recherche « contient » sur les champs cherchables.
create index if not exists custom_field_values_trgm_idx
  on public.custom_field_values using gin (value_normalized extensions.gin_trgm_ops);

-- Listes à choix multiples.
create table if not exists public.custom_field_value_options (
  org_id    uuid not null,
  field_id  uuid not null,
  value_id  uuid not null,
  option_id uuid not null,
  primary key (value_id, option_id),
  constraint custom_field_value_options_value_fk foreign key (org_id, field_id, value_id)
    references public.custom_field_values (org_id, field_id, id) on delete cascade,
  constraint custom_field_value_options_option_fk foreign key (org_id, field_id, option_id)
    references public.custom_field_options (org_id, field_id, id) on delete restrict
);
create index if not exists custom_field_value_options_option_idx on public.custom_field_value_options (option_id);

-- Champs affichés sur les cartes, par pipeline (ordre = position).
create table if not exists public.custom_field_pipeline_cards (
  org_id      uuid not null,
  pipeline_id uuid not null,
  field_id    uuid not null,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  primary key (pipeline_id, field_id),
  constraint custom_field_pipeline_cards_pipeline_fk foreign key (org_id, pipeline_id)
    references public.pipelines_ventes (org_id, id) on delete cascade,
  -- Seuls les champs d'opportunité vont sur une carte d'opportunité.
  object_type public.cf_object_type not null default 'deal' check (object_type = 'deal'),
  constraint custom_field_pipeline_cards_field_fk foreign key (org_id, object_type, field_id)
    references public.custom_fields (org_id, object_type, id) on delete cascade
);
create index if not exists custom_field_pipeline_cards_field_idx on public.custom_field_pipeline_cards (field_id);

-- ───────────────────────────────────────────────────────────────
-- 7. Triggers
-- ───────────────────────────────────────────────────────────────
drop trigger if exists custom_field_folders_updated_at on public.custom_field_folders;
create trigger custom_field_folders_updated_at before update on public.custom_field_folders
  for each row execute function public.set_updated_at();
drop trigger if exists custom_field_options_updated_at on public.custom_field_options;
create trigger custom_field_options_updated_at before update on public.custom_field_options
  for each row execute function public.set_updated_at();

-- Téléphone → E.164, Canada par défaut. NULL si ce n'est pas un numéro.
create or replace function public.cf_normaliser_telephone(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_chiffres text := regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g');
begin
  if btrim(coalesce(p, '')) like '+%' then
    if length(v_chiffres) between 8 and 15 then return '+' || v_chiffres; end if;
    return null;
  end if;
  if length(v_chiffres) = 10 then return '+1' || v_chiffres; end if;
  if length(v_chiffres) = 11 and left(v_chiffres, 1) = '1' then return '+' || v_chiffres; end if;
  return null;
end $$;

-- Définition : clé générée et immuable, objet immuable, conversions sûres seulement.
create or replace function public.cf_champ_avant_ecriture()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_base text;
  v_cle text;
  v_n integer := 1;
begin
  if tg_op = 'INSERT' then
    v_base := public.cf_slug(coalesce(nullif(new.key, ''), new.label));
    v_cle := v_base;
    -- Suffixe si la clé est prise (y compris par un champ archivé) ou réservée.
    while v_cle = any (public.cf_cles_standard(new.object_type))
       or exists (select 1 from public.custom_fields f
                   where f.org_id = new.org_id and f.object_type = new.object_type and f.key = v_cle) loop
      v_n := v_n + 1;
      v_cle := left(v_base, 46) || '_' || v_n;
    end loop;
    -- Une clé demandée explicitement n'est jamais renommée en silence.
    if nullif(new.key, '') is not null and v_cle <> new.key then
      raise exception 'La clé « % » est déjà utilisée ou réservée.', new.key using errcode = '23505';
    end if;
    new.key := v_cle;
    return new;
  end if;

  if new.key is distinct from old.key then
    raise exception 'La clé d''un champ est immuable (les modèles et automatisations en dépendent).' using errcode = '22023';
  end if;
  if new.object_type is distinct from old.object_type then
    raise exception 'L''objet d''un champ est immuable.' using errcode = '22023';
  end if;
  if new.field_type is distinct from old.field_type
     and not (
       (old.field_type, new.field_type) in (
         ('single_line'::public.cf_field_type, 'multi_line'::public.cf_field_type),
         ('multi_line'::public.cf_field_type, 'single_line'::public.cf_field_type),
         ('number'::public.cf_field_type, 'monetary'::public.cf_field_type),
         ('dropdown_single'::public.cf_field_type, 'dropdown_multi'::public.cf_field_type)
       )
     ) then
    raise exception 'Conversion de type refusée : % → %.', old.field_type, new.field_type using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists custom_fields_avant_ecriture on public.custom_fields;
create trigger custom_fields_avant_ecriture before insert or update on public.custom_fields
  for each row execute function public.cf_champ_avant_ecriture();

-- Après un changement de type ou d'unicité : les valeurs suivent.
create or replace function public.cf_champ_apres_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.field_type is distinct from old.field_type then
    if old.field_type = 'number' and new.field_type = 'monetary' then
      update public.custom_field_values
         set value_money_cents = round(value_number * 100)::bigint,
             value_currency = coalesce(nullif(new.config->>'currency', ''), 'CAD'),
             value_number = null
       where field_id = new.id and value_number is not null;
    elsif old.field_type = 'dropdown_single' and new.field_type = 'dropdown_multi' then
      insert into public.custom_field_value_options (org_id, field_id, value_id, option_id)
      select v.org_id, v.field_id, v.id, v.value_option_id
        from public.custom_field_values v
       where v.field_id = new.id and v.value_option_id is not null
      on conflict do nothing;
      update public.custom_field_values set value_option_id = null
       where field_id = new.id and value_option_id is not null;
    elsif old.field_type = 'multi_line' and new.field_type = 'single_line' then
      -- Une ligne ne garde pas de retour à la ligne.
      update public.custom_field_values
         set value_text = regexp_replace(value_text, '\s*\n\s*', ' ', 'g')
       where field_id = new.id and value_text ~ '\n';
    end if;
  end if;
  if new.is_unique is distinct from old.is_unique then
    update public.custom_field_values set unique_enforced = new.is_unique where field_id = new.id;
  end if;
  return null;
end $$;

drop trigger if exists custom_fields_apres_maj on public.custom_fields;
create trigger custom_fields_apres_maj after update of field_type, is_unique on public.custom_fields
  for each row execute function public.cf_champ_apres_maj();

-- Valeur : la bonne colonne typée, validée et normalisée. Le service serveur
-- valide déjà ; la base re-valide pour qu'aucun chemin (SQL direct, MCP,
-- automatisation) ne puisse écrire une valeur incohérente.
create or replace function public.cf_valeur_avant_ecriture()
returns trigger
language plpgsql
set search_path = ''
as $$
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
  if f.field_type in ('single_line', 'multi_line', 'phone', 'email') then
    if num_nonnulls(new.value_number, new.value_money_cents, new.value_date, new.value_timestamp, new.value_option_id) > 0 then
      raise exception '« % » attend du texte.', f.label using errcode = '22023';
    end if;
  elsif f.field_type = 'number' then
    if num_nonnulls(new.value_text, new.value_money_cents, new.value_date, new.value_timestamp, new.value_option_id) > 0 then
      raise exception '« % » attend un nombre.', f.label using errcode = '22023';
    end if;
  elsif f.field_type = 'monetary' then
    if num_nonnulls(new.value_text, new.value_number, new.value_date, new.value_timestamp, new.value_option_id) > 0 then
      raise exception '« % » attend un montant.', f.label using errcode = '22023';
    end if;
  elsif f.field_type = 'date' then
    if num_nonnulls(new.value_text, new.value_number, new.value_money_cents, new.value_option_id) > 0
       or (coalesce((f.config->>'include_time')::boolean, false) and new.value_date is not null)
       or (not coalesce((f.config->>'include_time')::boolean, false) and new.value_timestamp is not null) then
      raise exception '« % » attend une date%.', f.label,
        case when coalesce((f.config->>'include_time')::boolean, false) then ' et une heure' else '' end
        using errcode = '22023';
    end if;
  elsif f.field_type = 'dropdown_single' then
    if num_nonnulls(new.value_text, new.value_number, new.value_money_cents, new.value_date, new.value_timestamp) > 0 then
      raise exception '« % » attend une option de la liste.', f.label using errcode = '22023';
    end if;
  elsif f.field_type = 'dropdown_multi' then
    if num_nonnulls(new.value_text, new.value_number, new.value_money_cents, new.value_date, new.value_timestamp, new.value_option_id) > 0 then
      raise exception '« % » attend des options de la liste.', f.label using errcode = '22023';
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
  end if;
  if f.field_type <> 'monetary' then new.value_currency := null; end if;

  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
    new.updated_at := now();
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

drop trigger if exists custom_field_values_avant_ecriture on public.custom_field_values;
create trigger custom_field_values_avant_ecriture before insert or update on public.custom_field_values
  for each row execute function public.cf_valeur_avant_ecriture();

-- Une option à choix multiple ne se pose que sur une valeur de liste multiple.
create or replace function public.cf_option_multiple_avant_ecriture()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.custom_fields f
                  where f.id = new.field_id and f.field_type = 'dropdown_multi') then
    raise exception 'Ce champ n''est pas une liste à choix multiples.' using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists custom_field_value_options_avant_ecriture on public.custom_field_value_options;
create trigger custom_field_value_options_avant_ecriture before insert or update on public.custom_field_value_options
  for each row execute function public.cf_option_multiple_avant_ecriture();

-- Une option utilisée ne se supprime pas : elle s'archive. La FK RESTRICT
-- l'empêche déjà ; ce trigger transforme le refus en archivage, pour que
-- « supprimer » dans l'éditeur fasse la bonne chose sans aller-retour.
create or replace function public.cf_option_avant_suppression()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Pendant une purge de champ (cascade), on laisse faire.
  if not exists (select 1 from public.custom_fields f where f.id = old.field_id) then
    return old;
  end if;
  if exists (select 1 from public.custom_field_values v where v.value_option_id = old.id)
     or exists (select 1 from public.custom_field_value_options vo where vo.option_id = old.id) then
    update public.custom_field_options set archived_at = coalesce(archived_at, now()) where id = old.id;
    return null;
  end if;
  return old;
end $$;

drop trigger if exists custom_field_options_avant_suppression on public.custom_field_options;
create trigger custom_field_options_avant_suppression before delete on public.custom_field_options
  for each row execute function public.cf_option_avant_suppression();

-- ───────────────────────────────────────────────────────────────
-- 8. RLS
--   Définitions (dossiers, champs, options) : lecture pour tout membre,
--   écriture = permission « settings.update » de la page Rôles.
--   Valeurs : visibles SI l'entité parente l'est — le EXISTS relance la RLS
--   du parent (pipeline visible, montants masqués…) au lieu de la recopier.
--   Écriture : la permission de mise à jour de l'objet parent.
-- ───────────────────────────────────────────────────────────────
alter table public.custom_field_folders enable row level security;
alter table public.custom_fields enable row level security;
alter table public.custom_field_options enable row level security;
alter table public.custom_field_values enable row level security;
alter table public.custom_field_value_options enable row level security;
alter table public.custom_field_pipeline_cards enable row level security;

revoke all on public.custom_field_folders, public.custom_fields, public.custom_field_options,
  public.custom_field_values, public.custom_field_value_options, public.custom_field_pipeline_cards
  from anon;
grant select, insert, update, delete on public.custom_field_folders, public.custom_fields, public.custom_field_options,
  public.custom_field_values, public.custom_field_value_options, public.custom_field_pipeline_cards
  to authenticated;
grant all on public.custom_field_folders, public.custom_fields, public.custom_field_options,
  public.custom_field_values, public.custom_field_value_options, public.custom_field_pipeline_cards
  to service_role;

-- Définitions
do $$
declare t text;
begin
  foreach t in array array['custom_field_folders', 'custom_fields', 'custom_field_options', 'custom_field_pipeline_cards'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.has_org_membership((select auth.uid()), org_id))', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.member_has_permission((select auth.uid()), org_id, ''settings.update''))', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.member_has_permission((select auth.uid()), org_id, ''settings.update'')) with check (public.member_has_permission((select auth.uid()), org_id, ''settings.update''))', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.member_has_permission((select auth.uid()), org_id, ''settings.update''))', t || '_delete', t);
  end loop;
end $$;

-- Visibilité du parent, sous la RLS de l'appelant.
create or replace function public.cf_parent_visible(
  p_org uuid, p_client uuid, p_deal uuid, p_job uuid, p_quote uuid, p_invoice uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when p_client  is not null then exists (select 1 from public.clients  e where e.org_id = p_org and e.id = p_client)
    when p_deal    is not null then exists (select 1 from public.deals    e where e.org_id = p_org and e.id = p_deal)
    when p_job     is not null then exists (select 1 from public.jobs     e where e.org_id = p_org and e.id = p_job)
    when p_quote   is not null then exists (select 1 from public.quotes   e where e.org_id = p_org and e.id = p_quote)
    when p_invoice is not null then exists (select 1 from public.invoices e where e.org_id = p_org and e.id = p_invoice)
    else false
  end;
$$;

-- Clé de permission d'écriture par objet (mêmes clés que les policies des parents).
create or replace function public.cf_cle_permission_ecriture(p_object public.cf_object_type)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_object
    when 'client' then 'clients.update'
    when 'deal' then 'leads.update'
    when 'job' then 'jobs.update'
    when 'quote' then 'quotes.update'
    when 'invoice' then 'invoices.update'
  end;
$$;

-- LECTURE : « le parent m'est visible », écrit en sous-requêtes NON corrélées.
-- Postgres les calcule UNE fois par requête (hashed SubPlan) au lieu d'appeler
-- une fonction par ligne : mesuré sur 10 000 deals × 20 champs, le filtre du
-- pipeline passait de 9,2 s (cf_parent_visible + has_org_membership par
-- ligne) à quelques dizaines de ms. La RLS du parent s'applique dans la
-- sous-requête (pipeline visible, montants masqués…). L'appartenance à l'org
-- n'a pas à être revérifiée : un parent visible l'implique (sa propre RLS),
-- et la FK composite garantit que la valeur est dans la même org.
-- Les OR court-circuitent : une valeur de deal ne calcule jamais l'ensemble
-- des clients.
drop policy if exists custom_field_values_select on public.custom_field_values;
create policy custom_field_values_select on public.custom_field_values for select to authenticated
  using (
       (client_id  is not null and client_id  in (select e.id from public.clients  e))
    or (deal_id    is not null and deal_id    in (select e.id from public.deals    e))
    or (job_id     is not null and job_id     in (select e.id from public.jobs     e))
    or (quote_id   is not null and quote_id   in (select e.id from public.quotes   e))
    or (invoice_id is not null and invoice_id in (select e.id from public.invoices e))
  );
drop policy if exists custom_field_values_insert on public.custom_field_values;
create policy custom_field_values_insert on public.custom_field_values for insert to authenticated
  with check (public.member_has_permission((select auth.uid()), org_id, public.cf_cle_permission_ecriture(object_type))
              and public.cf_parent_visible(org_id, client_id, deal_id, job_id, quote_id, invoice_id));
drop policy if exists custom_field_values_update on public.custom_field_values;
create policy custom_field_values_update on public.custom_field_values for update to authenticated
  using (public.member_has_permission((select auth.uid()), org_id, public.cf_cle_permission_ecriture(object_type))
         and public.cf_parent_visible(org_id, client_id, deal_id, job_id, quote_id, invoice_id))
  with check (public.member_has_permission((select auth.uid()), org_id, public.cf_cle_permission_ecriture(object_type))
              and public.cf_parent_visible(org_id, client_id, deal_id, job_id, quote_id, invoice_id));
drop policy if exists custom_field_values_delete on public.custom_field_values;
create policy custom_field_values_delete on public.custom_field_values for delete to authenticated
  using (public.member_has_permission((select auth.uid()), org_id, public.cf_cle_permission_ecriture(object_type))
         and public.cf_parent_visible(org_id, client_id, deal_id, job_id, quote_id, invoice_id));

-- Options multiples : suivent leur valeur.
drop policy if exists custom_field_value_options_select on public.custom_field_value_options;
create policy custom_field_value_options_select on public.custom_field_value_options for select to authenticated
  using (exists (select 1 from public.custom_field_values v where v.id = value_id));
drop policy if exists custom_field_value_options_write on public.custom_field_value_options;
create policy custom_field_value_options_write on public.custom_field_value_options for all to authenticated
  using (exists (select 1 from public.custom_field_values v where v.id = value_id
                  and public.member_has_permission((select auth.uid()), v.org_id, public.cf_cle_permission_ecriture(v.object_type))))
  with check (exists (select 1 from public.custom_field_values v where v.id = value_id
                  and public.member_has_permission((select auth.uid()), v.org_id, public.cf_cle_permission_ecriture(v.object_type))));

-- ───────────────────────────────────────────────────────────────
-- 9. Opérations sensibles (SECURITY INVOKER : la RLS s'applique)
-- ───────────────────────────────────────────────────────────────

-- Dossier + N champs + leurs options, en UNE transaction : tout ou rien.
-- p_champs : [{label, field_type, key?, placeholder?, help_text?, is_required?,
--              config?, options?: [{label, color?}]}]
create or replace function public.cf_creer_dossier(
  p_org uuid, p_object public.cf_object_type, p_nom text, p_champs jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_dossier uuid;
  v_champ uuid;
  c jsonb;
  o jsonb;
  v_pos integer;
  v_opos integer;
begin
  if jsonb_typeof(coalesce(p_champs, '[]'::jsonb)) <> 'array' then
    raise exception 'p_champs doit être une liste.' using errcode = '22023';
  end if;
  select coalesce(max(position) + 1, 0) into v_pos from public.custom_field_folders
   where org_id = p_org and object_type = p_object;
  insert into public.custom_field_folders (org_id, object_type, name, position)
  values (p_org, p_object, btrim(p_nom), v_pos)
  returning id into v_dossier;

  select coalesce(max(position) + 1, 0) into v_pos from public.custom_fields
   where org_id = p_org and object_type = p_object;
  for c in select * from jsonb_array_elements(coalesce(p_champs, '[]'::jsonb)) loop
    insert into public.custom_fields (org_id, object_type, folder_id, key, label, placeholder, help_text,
                                      field_type, config, is_required, position)
    values (p_org, p_object, v_dossier, coalesce(c->>'key', ''), btrim(c->>'label'),
            nullif(c->>'placeholder', ''), nullif(c->>'help_text', ''),
            (c->>'field_type')::public.cf_field_type, coalesce(c->'config', '{}'::jsonb),
            coalesce((c->>'is_required')::boolean, false), v_pos)
    returning id into v_champ;
    v_pos := v_pos + 1;
    v_opos := 0;
    for o in select * from jsonb_array_elements(coalesce(c->'options', '[]'::jsonb)) loop
      insert into public.custom_field_options (org_id, field_id, label, color, position)
      values (p_org, v_champ, btrim(o->>'label'), nullif(o->>'color', ''), v_opos);
      v_opos := v_opos + 1;
    end loop;
  end loop;
  return v_dossier;
end $$;

-- Un champ + ses options, atomiquement. Renvoie l'id du champ.
create or replace function public.cf_creer_champ(
  p_org uuid, p_object public.cf_object_type, p_folder uuid, p_champ jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_champ uuid;
  v_pos integer;
  o jsonb;
  v_opos integer := 0;
begin
  select coalesce(max(position) + 1, 0) into v_pos from public.custom_fields
   where org_id = p_org and object_type = p_object;
  insert into public.custom_fields (org_id, object_type, folder_id, key, label, placeholder, help_text,
                                    field_type, config, is_required, is_searchable, position)
  values (p_org, p_object, p_folder, coalesce(p_champ->>'key', ''), btrim(p_champ->>'label'),
          nullif(p_champ->>'placeholder', ''), nullif(p_champ->>'help_text', ''),
          (p_champ->>'field_type')::public.cf_field_type, coalesce(p_champ->'config', '{}'::jsonb),
          coalesce((p_champ->>'is_required')::boolean, false),
          coalesce((p_champ->>'is_searchable')::boolean, false), v_pos)
  returning id into v_champ;
  for o in select * from jsonb_array_elements(coalesce(p_champ->'options', '[]'::jsonb)) loop
    insert into public.custom_field_options (org_id, field_id, label, color, position)
    values (p_org, v_champ, btrim(o->>'label'), nullif(o->>'color', ''), v_opos);
    v_opos := v_opos + 1;
  end loop;
  return v_champ;
end $$;

-- Remplace la liste d'options d'un champ, atomiquement.
--   p_options : [{id?, label, color?}] dans l'ordre voulu.
--   · id connu → renommée/recolorée/réordonnée (les valeurs pointent l'id :
--     renommer ne casse rien) ;
--   · sans id → créée ;
--   · absente de la liste → supprimée si inutilisée, ARCHIVÉE sinon.
create or replace function public.cf_maj_options(p_field uuid, p_options jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  f public.custom_fields%rowtype;
  o jsonb;
  v_pos integer := 0;
  v_gardees uuid[] := '{}';
  v_id uuid;
begin
  select * into f from public.custom_fields where id = p_field;
  if not found then raise exception 'Champ introuvable.' using errcode = 'P0002'; end if;
  if f.field_type not in ('dropdown_single', 'dropdown_multi') then
    raise exception 'Ce champ n''a pas de liste d''options.' using errcode = '22023';
  end if;
  -- Libérer les libellés d'abord : « A,B » → « B,A » ne doit pas heurter l'unicité.
  update public.custom_field_options set label = label || ' ' || id::text
   where field_id = p_field and archived_at is null;
  for o in select * from jsonb_array_elements(coalesce(p_options, '[]'::jsonb)) loop
    v_id := nullif(o->>'id', '')::uuid;
    if v_id is not null and exists (select 1 from public.custom_field_options where id = v_id and field_id = p_field) then
      update public.custom_field_options
         set label = btrim(o->>'label'), color = nullif(o->>'color', ''), position = v_pos, archived_at = null
       where id = v_id;
    else
      insert into public.custom_field_options (org_id, field_id, label, color, position)
      values (f.org_id, p_field, btrim(o->>'label'), nullif(o->>'color', ''), v_pos)
      returning id into v_id;
    end if;
    v_gardees := v_gardees || v_id;
    v_pos := v_pos + 1;
  end loop;
  -- Retirées : le trigger archive celles qui sont utilisées.
  delete from public.custom_field_options
   where field_id = p_field and archived_at is null and not (id = any (v_gardees));
  -- Une option archivée garde son libellé d'origine.
  update public.custom_field_options
     set label = regexp_replace(label, ' [0-9a-f-]{36}$', '')
   where field_id = p_field and label ~ ' [0-9a-f-]{36}$';
end $$;

-- Écrire (ou vider) UNE valeur, atomiquement et de façon idempotente.
--   p_cols : colonnes typées préparées par le service (null = vider).
--   p_version : version attendue (verrou optimiste), null = sans contrôle.
--   Rejouer la même écriture ne change rien et ne bouge pas la version :
--   un envoi hors ligne rejoué deux fois donne UN seul résultat.
-- Renvoie {changed, conflict, version, old}.
create or replace function public.cf_ecrire_valeur(
  p_field uuid, p_entity uuid, p_cols jsonb, p_options uuid[] default null, p_version integer default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
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
      updated_by = (select auth.uid())
    where id = v.id
    returning * into v_nouv;
  else
    execute format(
      'insert into public.custom_field_values (org_id, field_id, object_type, %I, value_text, value_number,
         value_money_cents, value_currency, value_date, value_timestamp, value_option_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *', v_col)
      into v_nouv
      using f.org_id, p_field, f.object_type, p_entity, p_cols->>'value_text', (p_cols->>'value_number')::numeric,
            (p_cols->>'value_money_cents')::bigint, nullif(p_cols->>'value_currency', ''),
            (p_cols->>'value_date')::date, (p_cols->>'value_timestamp')::timestamptz, (p_cols->>'value_option_id')::uuid;
  end if;

  if f.field_type = 'dropdown_multi' then
    delete from public.custom_field_value_options
     where value_id = v_nouv.id and not (option_id = any (coalesce(p_options, '{}')));
    insert into public.custom_field_value_options (org_id, field_id, value_id, option_id)
    select f.org_id, f.id, v_nouv.id, x from unnest(coalesce(p_options, '{}')) x
    on conflict do nothing;
  end if;

  return jsonb_build_object('changed', true, 'conflict', false, 'version', v_nouv.version, 'old', v_ancien);
end $$;

-- Doublons d'un champ (forme normalisée) — ce qui bloque l'unicité.
create or replace function public.cf_doublons(p_field uuid)
returns table (value_normalized text, nb bigint, entites uuid[])
language sql
stable
security invoker
set search_path = ''
as $$
  select v.value_normalized, count(*),
         array_agg(coalesce(v.client_id, v.deal_id, v.job_id, v.quote_id, v.invoice_id))
    from public.custom_field_values v
   where v.field_id = p_field and v.value_normalized is not null
   group by v.value_normalized
  having count(*) > 1
   order by count(*) desc
   limit 50;
$$;

-- Activer/désactiver l'unicité. Refuse s'il existe des doublons et les renvoie.
create or replace function public.cf_activer_unique(p_field uuid, p_actif boolean)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_doublons jsonb;
begin
  if p_actif then
    -- Verrou : aucune valeur ne s'écrit sur ce champ pendant la vérification.
    perform 1 from public.custom_fields where id = p_field for update;
    select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) into v_doublons from public.cf_doublons(p_field) d;
    if jsonb_array_length(v_doublons) > 0 then
      return jsonb_build_object('ok', false, 'doublons', v_doublons);
    end if;
  end if;
  update public.custom_fields set is_unique = p_actif where id = p_field;
  if not found then
    raise exception 'Champ introuvable.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('ok', true, 'doublons', '[]'::jsonb);
end $$;

-- Rapport d'impact avant une purge : ce qui référence le champ.
create or replace function public.cf_impact_champ(p_field uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  f public.custom_fields%rowtype;
  v_tag text;
begin
  select * into f from public.custom_fields where id = p_field;
  if not found then raise exception 'Champ introuvable.' using errcode = 'P0002'; end if;
  v_tag := f.object_type::text || '_cf_' || f.key;
  return jsonb_build_object(
    'valeurs', (select count(*) from public.custom_field_values v where v.field_id = p_field),
    'automatisations', (
      select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name)), '[]'::jsonb)
        from public.automation_rules r
       where r.org_id = f.org_id
         and (coalesce(r.conditions::text, '') || coalesce(r.actions::text, '') || coalesce(r.steps::text, ''))
             like '%' || p_field::text || '%'
    ),
    'modeles', (
      select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name)), '[]'::jsonb)
        from public.email_templates t
       where t.org_id = f.org_id
         and (coalesce(t.subject, '') || coalesce(t.body, '')) like '%' || v_tag || '%'
    ),
    'pipelines', (
      select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name)), '[]'::jsonb)
        from public.custom_field_pipeline_cards c
        join public.pipelines_ventes p on p.id = c.pipeline_id
       where c.field_id = p_field
    ),
    'formulaires', (
      select coalesce(jsonb_agg(jsonb_build_object('id', rf.id, 'name', rf.title)), '[]'::jsonb)
        from public.request_forms rf
       where rf.org_id = f.org_id and rf.deleted_at is null
         and jsonb_typeof(rf.custom_fields) = 'array'
         and exists (select 1 from jsonb_array_elements(rf.custom_fields) x where x->>'cf_field_id' = p_field::text)
    )
  );
end $$;

-- Purge définitive : l'appelant confirme le nombre de valeurs qu'il a vu.
-- Bloquée tant qu'une automatisation utilise le champ.
create or replace function public.cf_purger_champ(p_field uuid, p_valeurs_confirmees bigint)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_impact jsonb;
  v_nb bigint;
begin
  if not exists (select 1 from public.custom_fields where id = p_field
                    and public.member_has_permission((select auth.uid()), org_id, 'settings.update')) then
    raise exception 'Champ introuvable ou permission manquante.' using errcode = '42501';
  end if;
  v_impact := public.cf_impact_champ(p_field);
  if jsonb_array_length(v_impact->'automatisations') > 0 then
    raise exception 'Ce champ est utilisé par % automatisation(s) : retire-le d''abord.',
      jsonb_array_length(v_impact->'automatisations') using errcode = '55006';
  end if;
  v_nb := (v_impact->>'valeurs')::bigint;
  if v_nb is distinct from p_valeurs_confirmees then
    raise exception 'Le nombre de valeurs a changé (% au lieu de %) : relis le rapport.', v_nb, p_valeurs_confirmees
      using errcode = '40001';
  end if;
  -- La RLS des valeurs s'applique : si l'appelant ne voit pas toutes les
  -- valeurs (factures masquées…), le décompte diffère et on s'arrête là.
  delete from public.custom_field_values where field_id = p_field;
  if exists (select 1 from public.custom_field_values where field_id = p_field) then
    raise exception 'Certaines valeurs ne te sont pas visibles : purge impossible.' using errcode = '42501';
  end if;
  delete from public.custom_fields where id = p_field;
  return v_impact;
end $$;

-- ───────────────────────────────────────────────────────────────
-- 10. Filtres (moteur SQL — miroir de src/lib/champs/filtres.ts,
--     mêmes opérateurs, dates dans le fuseau de l'entreprise)
--
--   p_conditions : [{field_id, op, value?, value2?, n?, unit?}]  (ET logique)
--   Renvoie les ids d'entités qui satisfont TOUTES les conditions.
-- ───────────────────────────────────────────────────────────────
-- Fuseau de l'entreprise, America/Toronto par défaut ou s'il est invalide.
-- On ESSAIE la conversion plutôt que de chercher dans pg_timezone_names :
-- cette vue relit la base des fuseaux sur disque à chaque appel (mesuré :
-- des secondes sous charge sur le filtre du pipeline).
create or replace function public.cf_fuseau(p_org uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text;
begin
  select nullif(btrim(cs.timezone), '') into v from public.company_settings cs where cs.org_id = p_org limit 1;
  if v is null then return 'America/Toronto'; end if;
  begin
    perform now() at time zone v;
    return v;
  exception when others then
    return 'America/Toronto';
  end;
end $$;

-- Une condition → UNE clause ensembliste sur l'entité `e` :
--   e.id in     (select v.<col> … where <prédicat>)   pour une présence ;
--   e.id not in (select v.<col> … where <prédicat>)   pour une absence
--   (« est vide », « n'est pas », « ne contient pas », « ≠ », « n'est aucun
--   de ») — le complément de la version positive, pour qu'une fiche SANS
--   valeur satisfasse bien « est vide » ou « n'est pas X ».
-- Sous-requêtes non corrélées → calculées une fois (hashed SubPlan).
drop function if exists public.cf_condition_sql(public.custom_fields, jsonb, text);
create or replace function public.cf_condition_sql(p_champ public.custom_fields, c jsonb, p_fuseau text, p_col text)
returns text
language plpgsql
stable
set search_path = ''
as $$
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
      when p_champ.field_type in ('single_line', 'multi_line', 'email', 'phone')
        then array['is', 'is_not', 'contains', 'not_contains', 'is_empty', 'is_not_empty']
      when p_champ.field_type in ('number', 'monetary')
        then array['eq', 'neq', 'gt', 'lt', 'between', 'is_empty', 'is_not_empty']
      when p_champ.field_type in ('dropdown_single', 'dropdown_multi')
        then array['any_of', 'none_of', 'is_empty', 'is_not_empty']
      else array['today', 'yesterday', 'in_last', 'more_than_ago', 'less_than_ago', 'before', 'after', 'between', 'is_empty', 'is_not_empty']
    end)) then
    raise exception 'Opérateur « % » invalide pour un champ %.', op, p_champ.field_type using errcode = '22023';
  end if;

  if op = 'is_empty' or op = 'is_not_empty' then
    v_expr := 'true';
  else
  case p_champ.field_type
    when 'single_line', 'multi_line', 'email', 'phone' then
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
end $$;

-- Le filtre en deux temps (mesuré : 10 000 deals × 20 champs) :
--   1. cf_filtrer_brut (SECURITY DEFINER) calcule les ids qui satisfont les
--      conditions SANS RLS — index par champ, sous-requêtes ensemblistes —
--      après avoir vérifié que l'appelant est membre de l'org. Il ne renvoie
--      que des identifiants, de SA propre entreprise.
--   2. cf_filtrer (SECURITY INVOKER) ne garde que ceux que l'appelant VOIT :
--      la RLS du parent (pipeline visible, montants masqués…) n'est évaluée
--      que sur les lignes retenues, par clé primaire — au lieu de l'être sur
--      les 10 000 deals, deux ou trois fois (9,2 s avant, voir le script
--      scripts/qa/champs-perso-perf.sql).
create or replace function public.cf_filtrer_brut(
  p_org uuid, p_object public.cf_object_type, p_conditions jsonb, p_ids uuid[] default null
)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
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
  v_table := case p_object when 'client' then 'clients' when 'deal' then 'deals' when 'job' then 'jobs'
                           when 'quote' then 'quotes' when 'invoice' then 'invoices' end;
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
end $$;

create or replace function public.cf_filtrer(
  p_org uuid, p_object public.cf_object_type, p_conditions jsonb, p_ids uuid[] default null
)
returns setof uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_ids uuid[] := array(select public.cf_filtrer_brut(p_org, p_object, p_conditions, p_ids));
begin
  -- Visibilité : la RLS du parent, sur les seules lignes retenues.
  return query execute format('select e.id from public.%I e where e.id = any($1) and e.org_id = $2',
    case p_object when 'client' then 'clients' when 'deal' then 'deals' when 'job' then 'jobs'
                  when 'quote' then 'quotes' when 'invoice' then 'invoices' end)
    using v_ids, p_org;
end $$;

-- Recherche globale : les valeurs des champs marqués « cherchable ».
create or replace function public.cf_rechercher(p_org uuid, p_q text, p_limit integer default 20)
returns table (object_type public.cf_object_type, entity_id uuid, field_id uuid, field_label text, value_text text)
language sql
stable
security invoker
set search_path = ''
as $$
  select v.object_type, coalesce(v.client_id, v.deal_id, v.job_id, v.quote_id, v.invoice_id), f.id, f.label,
         coalesce(v.value_text, v.value_normalized)
    from public.custom_field_values v
    join public.custom_fields f on f.id = v.field_id
   where v.org_id = p_org
     and f.is_searchable and f.archived_at is null
     and length(btrim(coalesce(p_q, ''))) >= 2
     and v.value_normalized like '%' || replace(replace(lower(btrim(p_q)), '%', '\%'), '_', '\_') || '%'
   order by v.updated_at desc
   limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

-- ───────────────────────────────────────────────────────────────
-- 11. Opportunité gagnée → job : les valeurs suivent, sans rien perdre.
--   Quand un deal reçoit un job_id, chaque valeur du deal est recopiée sur
--   le champ JOB de même clé et de même type, s'il existe et si le job n'a
--   pas déjà une valeur. Les valeurs du CLIENT n'ont rien à copier : le job
--   pointe le même client.
-- ───────────────────────────────────────────────────────────────
create or replace function public.cf_copier_valeurs_deal_vers_job(p_deal uuid, p_job uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
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
      value_money_cents, value_currency, value_date, value_timestamp, value_option_id)
    values (r.org_id, r.champ_job, 'job', p_job, r.value_text, r.value_number, r.value_money_cents,
      r.value_currency, r.value_date, r.value_timestamp,
      -- une option se retrouve par son libellé dans la liste du champ job
      (select oj.id from public.custom_field_options od
         join public.custom_field_options oj on oj.field_id = r.champ_job and lower(oj.label) = lower(od.label) and oj.archived_at is null
        where od.id = r.value_option_id limit 1))
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
end $$;

create or replace function public.cf_deal_job_lie()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.job_id is not null and new.job_id is distinct from old.job_id then
    begin
      perform public.cf_copier_valeurs_deal_vers_job(new.id, new.job_id);
    exception when others then
      -- Ne jamais bloquer la liaison deal → job pour une copie de champ.
      raise warning 'cf_copier_valeurs_deal_vers_job(%, %) : %', new.id, new.job_id, sqlerrm;
    end;
  end if;
  return null;
end $$;

drop trigger if exists deals_cf_copier_vers_job on public.deals;
create trigger deals_cf_copier_vers_job after update of job_id on public.deals
  for each row execute function public.cf_deal_job_lie();

-- ───────────────────────────────────────────────────────────────
-- 12. Privilèges des fonctions (moindre privilège, anon exclu nommément)
-- ───────────────────────────────────────────────────────────────
revoke all on function public.cf_cles_standard(public.cf_object_type) from public, anon;
grant execute on function public.cf_cles_standard(public.cf_object_type) to authenticated, service_role;
revoke all on function public.cf_slug(text) from public, anon;
grant execute on function public.cf_slug(text) to authenticated, service_role;
revoke all on function public.cf_normaliser_telephone(text) from public, anon;
grant execute on function public.cf_normaliser_telephone(text) to authenticated, service_role;
revoke all on function public.cf_champ_avant_ecriture() from public, anon, authenticated;
revoke all on function public.cf_champ_apres_maj() from public, anon, authenticated;
revoke all on function public.cf_valeur_avant_ecriture() from public, anon, authenticated;
revoke all on function public.cf_option_multiple_avant_ecriture() from public, anon, authenticated;
revoke all on function public.cf_option_avant_suppression() from public, anon, authenticated;
revoke all on function public.cf_deal_job_lie() from public, anon, authenticated;
revoke all on function public.cf_parent_visible(uuid, uuid, uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.cf_parent_visible(uuid, uuid, uuid, uuid, uuid, uuid) to authenticated, service_role;
revoke all on function public.cf_cle_permission_ecriture(public.cf_object_type) from public, anon;
grant execute on function public.cf_cle_permission_ecriture(public.cf_object_type) to authenticated, service_role;
revoke all on function public.cf_creer_dossier(uuid, public.cf_object_type, text, jsonb) from public, anon;
grant execute on function public.cf_creer_dossier(uuid, public.cf_object_type, text, jsonb) to authenticated, service_role;
revoke all on function public.cf_creer_champ(uuid, public.cf_object_type, uuid, jsonb) from public, anon;
grant execute on function public.cf_creer_champ(uuid, public.cf_object_type, uuid, jsonb) to authenticated, service_role;
revoke all on function public.cf_maj_options(uuid, jsonb) from public, anon;
grant execute on function public.cf_maj_options(uuid, jsonb) to authenticated, service_role;
revoke all on function public.cf_ecrire_valeur(uuid, uuid, jsonb, uuid[], integer) from public, anon;
grant execute on function public.cf_ecrire_valeur(uuid, uuid, jsonb, uuid[], integer) to authenticated, service_role;
revoke all on function public.cf_doublons(uuid) from public, anon;
grant execute on function public.cf_doublons(uuid) to authenticated, service_role;
revoke all on function public.cf_activer_unique(uuid, boolean) from public, anon;
grant execute on function public.cf_activer_unique(uuid, boolean) to authenticated, service_role;
revoke all on function public.cf_impact_champ(uuid) from public, anon;
grant execute on function public.cf_impact_champ(uuid) to authenticated, service_role;
revoke all on function public.cf_purger_champ(uuid, bigint) from public, anon;
grant execute on function public.cf_purger_champ(uuid, bigint) to authenticated, service_role;
revoke all on function public.cf_fuseau(uuid) from public, anon;
grant execute on function public.cf_fuseau(uuid) to authenticated, service_role;
revoke all on function public.cf_condition_sql(public.custom_fields, jsonb, text, text) from public, anon;
grant execute on function public.cf_condition_sql(public.custom_fields, jsonb, text, text) to authenticated, service_role;
revoke all on function public.cf_filtrer_brut(uuid, public.cf_object_type, jsonb, uuid[]) from public, anon;
grant execute on function public.cf_filtrer_brut(uuid, public.cf_object_type, jsonb, uuid[]) to authenticated, service_role;
revoke all on function public.cf_filtrer(uuid, public.cf_object_type, jsonb, uuid[]) from public, anon;
grant execute on function public.cf_filtrer(uuid, public.cf_object_type, jsonb, uuid[]) to authenticated, service_role;
revoke all on function public.cf_rechercher(uuid, text, integer) from public, anon;
grant execute on function public.cf_rechercher(uuid, text, integer) to authenticated, service_role;
revoke all on function public.cf_copier_valeurs_deal_vers_job(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cf_copier_valeurs_deal_vers_job(uuid, uuid) to service_role;

-- ───────────────────────────────────────────────────────────────
-- 13. Loi 25 — les valeurs sont des renseignements personnels possibles.
--   Export : le bloc « custom_fields » regroupe les valeurs du client et de
--   ses deals, jobs, devis et factures, avec leur libellé.
--   Effacement : les valeurs du client et de ses deals sont supprimées (les
--   jobs/factures restent des pièces comptables, comme aujourd'hui).
--   Corps repris À L'IDENTIQUE de la prod (md5 vérifié le 2026-09-24),
--   seul le bloc marqué « champs personnalisés » est ajouté.
-- ───────────────────────────────────────────────────────────────
create or replace function public.cf_valeurs_lisibles(p_client uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'object_type', v.object_type,
           'entity_id', coalesce(v.client_id, v.deal_id, v.job_id, v.quote_id, v.invoice_id),
           'field', f.label, 'key', f.key, 'type', f.field_type,
           'value', coalesce(v.value_text, v.value_number::text, v.value_money_cents::text, v.value_date::text,
                             v.value_timestamp::text, o.label,
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
$$;
revoke all on function public.cf_valeurs_lisibles(uuid) from public, anon, authenticated;
grant execute on function public.cf_valeurs_lisibles(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.export_client_data(p_client_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid;
  v_result jsonb;
begin
  select org_id into v_org from public.clients where id = p_client_id;
  if v_org is null then
    raise exception 'Client not found';
  end if;

  -- Appel utilisateur : garde d'appartenance. Appel serveur (auth.uid() NULL) :
  -- l'autorisation est faite en amont dans server/routes/dsr.ts.
  if auth.uid() is not null and not public.has_org_membership(auth.uid(), v_org) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'exported_at', now(),
    'client_id',   p_client_id,
    'client',      (select to_jsonb(c) from public.clients c where c.id = p_client_id),
    'contact',     (select to_jsonb(co) from public.contacts co where co.id = (select contact_id from public.clients where id = p_client_id)),
    'jobs',        (select coalesce(jsonb_agg(to_jsonb(j)), '[]'::jsonb) from public.jobs j where j.client_id = p_client_id),
    'invoices',    (select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) from public.invoices i where i.client_id = p_client_id),
    'payments',    (select coalesce(jsonb_agg(to_jsonb(pm)), '[]'::jsonb) from public.payments pm where pm.client_id = p_client_id),
    'consents',    (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.consents c where c.subject_type='client' and c.subject_id = p_client_id),
    -- champs personnalisés (2026-09-26)
    'custom_fields', public.cf_valeurs_lisibles(p_client_id)
  ) into v_result;

  insert into public.audit_events(org_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, auth.uid(), 'dsr_export', 'client', p_client_id, '{}'::jsonb);

  return v_result;
end $function$;

CREATE OR REPLACE FUNCTION public.anonymize_client(p_client_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- champs personnalisés (2026-09-26) : valeurs du client et de ses deals.
  delete from public.custom_field_values
   where client_id = p_client_id
      or deal_id in (select d.id from public.deals d where d.client_id = p_client_id);

  insert into public.audit_events(org_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, auth.uid(), 'anonymize', 'client', p_client_id, jsonb_build_object('method','dsr_erasure'));
end $function$;

-- Privilèges inchangés par rapport à la prod (authenticated + service_role).
revoke all on function public.export_client_data(uuid) from public, anon;
grant execute on function public.export_client_data(uuid) to authenticated, service_role;
revoke all on function public.anonymize_client(uuid) from public, anon;
grant execute on function public.anonymize_client(uuid) to authenticated, service_role;

-- ───────────────────────────────────────────────────────────────
-- 14. Reprise de l'ancien registre (custom_columns → custom_fields)
--   Idempotente : legacy_column_id unique, « on conflict do nothing ».
--   Les définitions supprimées arrivent ARCHIVÉES (rien ne disparaît).
--   Correspondance des types :
--     text/url → single_line · number/rating → number · currency → monetary
--     email → email · phone → phone · date → date
--     dropdown/status/label → dropdown_single (options = config.options|statuses)
--     checkbox → dropdown_single « Oui / Non »
-- ───────────────────────────────────────────────────────────────
insert into public.custom_fields (org_id, object_type, key, label, field_type, config, is_required,
                                  position, created_at, archived_at, legacy_column_id)
select c.org_id,
       (case c.entity when 'clients' then 'client' when 'jobs' then 'job' when 'invoices' then 'invoice' when 'deals' then 'deal' end)::public.cf_object_type,
       '',
       left(c.name, 100),
       (case c.col_type
          when 'text' then 'single_line' when 'url' then 'single_line'
          when 'number' then 'number' when 'rating' then 'number'
          when 'currency' then 'monetary' when 'email' then 'email' when 'phone' then 'phone'
          when 'date' then 'date'
          else 'dropdown_single' end)::public.cf_field_type,
       case when c.col_type = 'currency' then jsonb_build_object('currency', coalesce(c.config->>'currency_code', 'CAD'))
            else '{}'::jsonb end,
       c.required, c.position, c.created_at,
       case when c.deleted_at is not null then c.deleted_at end,
       c.id
  from public.custom_columns c
 order by c.created_at
on conflict (legacy_column_id) do nothing;

insert into public.custom_field_options (org_id, field_id, label, color, position)
select f.org_id, f.id, left(o.value, 100),
       case when o.color ~ '^#[0-9a-fA-F]{6}$' then o.color end,
       o.ord - 1
  from public.custom_fields f
  join public.custom_columns c on c.id = f.legacy_column_id
  cross join lateral (
    select x->>'value' as value, x->>'color' as color, ord
      from jsonb_array_elements(
             case when c.col_type = 'status' then coalesce(c.config->'statuses', '[]'::jsonb)
                  when c.col_type = 'checkbox' then '[{"value":"Oui"},{"value":"Non"}]'::jsonb
                  else coalesce(c.config->'options', '[]'::jsonb) end
           ) with ordinality as t(x, ord)
     where nullif(btrim(x->>'value'), '') is not null
  ) o
 where c.col_type in ('dropdown', 'status', 'label', 'checkbox')
   and not exists (select 1 from public.custom_field_options e where e.field_id = f.id)
on conflict do nothing;

-- Valeurs : 0 en prod comme en staging (aucune n'a jamais pu s'écrire),
-- mais la reprise est écrite quand même, idempotente, pour qu'une base où
-- des valeurs existeraient ne perde rien.
insert into public.custom_field_values (org_id, field_id, object_type, client_id, deal_id, job_id, invoice_id,
  value_text, value_number, value_money_cents, value_date, value_option_id)
select v.org_id, f.id, f.object_type,
       case when f.object_type = 'client' then v.record_id end,
       case when f.object_type = 'deal' then v.record_id end,
       case when f.object_type = 'job' then v.record_id end,
       case when f.object_type = 'invoice' then v.record_id end,
       case when f.field_type in ('single_line', 'email', 'phone') then v.value_text end,
       case when f.field_type = 'number' then v.value_number end,
       case when f.field_type = 'monetary' then round(v.value_number * 100)::bigint end,
       case when f.field_type = 'date' then v.value_date end,
       case when f.field_type = 'dropdown_single' then (
         select o.id from public.custom_field_options o
          where o.field_id = f.id
            and lower(o.label) = lower(coalesce(v.value_text,
                  case v.value_boolean when true then 'Oui' when false then 'Non' end))
          limit 1) end
  from public.custom_column_values v
  join public.custom_fields f on f.legacy_column_id = v.column_id
 where (f.object_type = 'client' and exists (select 1 from public.clients e where e.id = v.record_id and e.org_id = v.org_id))
    or (f.object_type = 'deal' and exists (select 1 from public.deals e where e.id = v.record_id and e.org_id = v.org_id))
    or (f.object_type = 'job' and exists (select 1 from public.jobs e where e.id = v.record_id and e.org_id = v.org_id))
    or (f.object_type = 'invoice' and exists (select 1 from public.invoices e where e.id = v.record_id and e.org_id = v.org_id))
on conflict do nothing;

comment on table public.custom_columns is
  'ANCIEN registre des champs personnalisés — remplacé par custom_fields (2026-09-26). Conservé en lecture seule jusqu''à validation ; plus aucun code ne l''écrit.';
comment on table public.custom_fields is
  'Champs personnalisés v2 (modèle GoHighLevel) : définitions par objet (client, deal, job, quote, invoice). Clé immuable ; purge via cf_purger_champ().';
comment on table public.custom_field_values is
  'Valeurs des champs personnalisés : une ligne = (champ, UNE entité), FK composites vers l''entité (cascade). Colonne typée selon field_type, validée par trigger.';

commit;
