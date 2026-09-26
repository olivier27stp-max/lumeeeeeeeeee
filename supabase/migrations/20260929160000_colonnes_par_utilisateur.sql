-- Champs personnalisés — refonte « comme GoHighLevel », PR 3 : « Gérer les champs »
-- des listes (Clients, Jobs…).
--
-- 1) table_view_preferences : les colonnes d'une liste, PAR UTILISATEUR et PAR
--    OBJET, dans l'entreprise active. Liste ordonnée d'identifiants de colonne :
--    colonne standard (« adresse », « statut »…) ou champ (« cf:<uuid> »).
--    Clé étrangère composite vers l'adhésion (user_id, org_id) : quitter
--    l'entreprise emporte ses préférences, et on ne peut pas en écrire pour une
--    entreprise dont on n'est pas membre.
--    RLS : chacun ne lit et n'écrit QUE les siennes (pas même un propriétaire
--    ne voit celles des autres — c'est un réglage d'affichage personnel).
--
-- 2) cf_ordre_ids : trier une liste par un champ personnalisé. PostgREST ne sait
--    pas ordonner une table par une ligne liée « un à plusieurs » ; la fonction
--    rend les fiches QUI ONT une valeur, dans l'ordre de cette valeur (typée :
--    nombre, montant, date, position de l'option, texte sans casse). Le client
--    place ensuite les fiches sans valeur à la fin. SECURITY INVOKER : la RLS de
--    custom_field_values s'applique, rien ne sort de l'entreprise.

create table if not exists public.table_view_preferences (
  org_id uuid not null,
  user_id uuid not null,
  object_type text not null,
  columns jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint table_view_preferences_pkey primary key (org_id, user_id, object_type),
  constraint table_view_preferences_membre foreign key (user_id, org_id)
    references public.memberships (user_id, org_id) on delete cascade,
  constraint table_view_preferences_objet check (object_type in ('client', 'deal', 'job', 'quote', 'invoice')),
  constraint table_view_preferences_colonnes check (
    jsonb_typeof(columns) = 'array' and jsonb_array_length(columns) <= 80
  )
);

comment on table public.table_view_preferences is
  'Colonnes d''une liste (ordre + visibles) par utilisateur, entreprise et objet. Réglage d''affichage personnel.';

alter table public.table_view_preferences enable row level security;
alter table public.table_view_preferences force row level security;

drop policy if exists table_view_preferences_select on public.table_view_preferences;
create policy table_view_preferences_select on public.table_view_preferences
  for select to authenticated
  using (user_id = (select auth.uid()) and public.has_org_membership((select auth.uid()), org_id));

drop policy if exists table_view_preferences_insert on public.table_view_preferences;
create policy table_view_preferences_insert on public.table_view_preferences
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.has_org_membership((select auth.uid()), org_id));

drop policy if exists table_view_preferences_update on public.table_view_preferences;
create policy table_view_preferences_update on public.table_view_preferences
  for update to authenticated
  using (user_id = (select auth.uid()) and public.has_org_membership((select auth.uid()), org_id))
  with check (user_id = (select auth.uid()) and public.has_org_membership((select auth.uid()), org_id));

drop policy if exists table_view_preferences_delete on public.table_view_preferences;
create policy table_view_preferences_delete on public.table_view_preferences
  for delete to authenticated
  using (user_id = (select auth.uid()) and public.has_org_membership((select auth.uid()), org_id));

revoke all on public.table_view_preferences from anon, authenticated;
grant select, insert, update, delete on public.table_view_preferences to authenticated;
grant all on public.table_view_preferences to service_role;

drop trigger if exists table_view_preferences_updated_at on public.table_view_preferences;
create or replace function public.table_view_preferences_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.table_view_preferences_touch() from public, anon, authenticated;
create trigger table_view_preferences_updated_at before update on public.table_view_preferences
  for each row execute function public.table_view_preferences_touch();

-- Tri par un champ.
create or replace function public.cf_ordre_ids(p_field uuid, p_asc boolean default true)
returns setof uuid
language sql
stable
security invoker
set search_path = ''
as $$
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
     case when p_asc then lower(coalesce(v.value_text, v.value_normalized)) end asc nulls last,
     case when not p_asc then lower(coalesce(v.value_text, v.value_normalized)) end desc nulls last,
     v.created_at desc
   limit 10000
$$;

revoke all on function public.cf_ordre_ids(uuid, boolean) from public, anon;
grant execute on function public.cf_ordre_ids(uuid, boolean) to authenticated, service_role;
