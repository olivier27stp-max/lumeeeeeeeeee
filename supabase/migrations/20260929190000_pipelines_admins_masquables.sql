-- ═══════════════════════════════════════════════════════════════
-- Pipelines : les ADMINISTRATEURS aussi peuvent être exclus d'un pipeline
--
-- DEMANDE (Rafba, 2026-09-28) : « même les admins on devrait pouvoir choisir
-- s'ils voient ou pas ». Jusqu'ici `peut_voir_pipeline` laissait passer tout
-- administrateur, quelle que soit la liste d'accès.
--
-- NOUVELLE RÈGLE
--   · Propriétaire : voit et modifie TOUT, toujours. C'est le filet : sans
--     lui, un pipeline caché à tous les admins ne pourrait plus être rouvert.
--   · Administrateur : soumis à la liste « Voir » comme les autres membres.
--     S'il voit un pipeline, il peut le modifier (c'est son rôle).
--   · Autres membres : « Voir » et « Modifier » cochés un par un (inchangé).
--   · Liste vide = pipeline ouvert à toute l'équipe (inchangé).
--
-- `peut_voir_pipeline` protège pipelines_ventes, pipeline_stages ET deals
-- (policies *_select_org) : cacher un pipeline cache aussi ses deals.
--
-- TROU FERMÉ AU PASSAGE. La policy d'écriture de `pipeline_acces` admettait
-- tout administrateur : un admin exclu d'un pipeline pouvait se remettre
-- dans la liste par l'API. Désormais il faut VOIR le pipeline pour en gérer
-- les accès. Idem pour dupliquer, copier, supprimer, réordonner et désigner
-- par défaut : on n'agit pas sur un pipeline qu'on ne voit pas.
--
-- ADDITIF : aucune donnée touchée, aucune colonne. Fonctions et policies.
-- ROLLBACK : rejouer les définitions de 20260925230000_pipelines_facon_ghl.sql
-- (peut_modifier_pipeline, les 5 RPC) + celle de peut_voir_pipeline d'avant
-- (branche « Administrateur : voit tout, toujours ») et la policy
-- pipeline_acces_admin_write (has_org_admin_role seul).
-- ═══════════════════════════════════════════════════════════════

begin;

create or replace function public.est_proprietaire(p_user uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select exists (
    select 1 from public.memberships m
    where m.user_id = p_user and m.org_id = p_org
      and m.role = 'owner' and coalesce(m.status, 'active') = 'active'
  );
$fn$;
revoke all on function public.est_proprietaire(uuid, uuid) from public, anon;
grant execute on function public.est_proprietaire(uuid, uuid) to authenticated;

create or replace function public.peut_voir_pipeline(p_user uuid, p_pipeline uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select exists (
    select 1 from public.pipelines_ventes p
    where p.id = p_pipeline
      and public.has_org_membership(p_user, p.org_id)
      and (
        -- Propriétaire : toujours.
        public.est_proprietaire(p_user, p.org_id)
        -- Aucune liste : ouvert à toute l'équipe.
        or not exists (select 1 from public.pipeline_acces a where a.pipeline_id = p.id)
        -- Nommé dans la liste (administrateurs compris, désormais).
        or exists (select 1 from public.pipeline_acces a where a.pipeline_id = p.id and a.user_id = p_user)
      )
  );
$fn$;
revoke all on function public.peut_voir_pipeline(uuid, uuid) from public, anon;
grant execute on function public.peut_voir_pipeline(uuid, uuid) to authenticated;

create or replace function public.peut_modifier_pipeline(p_user uuid, p_pipeline uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select exists (
    select 1 from public.pipelines_ventes p
    where p.id = p_pipeline
      and public.has_org_membership(p_user, p.org_id)
      and (
        public.est_proprietaire(p_user, p.org_id)
        -- Administrateur : s'il voit le pipeline, il le modifie.
        or (public.has_org_admin_role(p_user, p.org_id) and public.peut_voir_pipeline(p_user, p.id))
        -- Autre membre : seulement si « Modifier » lui a été donné.
        or exists (
          select 1 from public.pipeline_acces a
          where a.pipeline_id = p.id and a.user_id = p_user and a.peut_modifier
        )
      )
  );
$fn$;
revoke all on function public.peut_modifier_pipeline(uuid, uuid) from public, anon;
grant execute on function public.peut_modifier_pipeline(uuid, uuid) to authenticated;

-- Gérer les accès d'un pipeline : administrateur QUI LE VOIT (ou propriétaire).
drop policy if exists pipeline_acces_admin_write on public.pipeline_acces;
create policy pipeline_acces_admin_write on public.pipeline_acces
  for all to authenticated
  using (has_org_admin_role((select auth.uid()), org_id) and peut_voir_pipeline((select auth.uid()), pipeline_id))
  with check (has_org_admin_role((select auth.uid()), org_id) and peut_voir_pipeline((select auth.uid()), pipeline_id));

-- Réordonner : chacun réordonne CE QU'IL VOIT. Les pipelines qui lui sont
-- cachés gardent leur place ; les siens s'échangent les positions qu'ils
-- occupaient déjà. Exiger la liste complète refuserait tout réordonnancement
-- à un admin exclu d'un seul pipeline.
create or replace function public.pipeline_reordonner(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_org uuid := current_org_id();
  v_uid uuid := auth.uid();
  v_places integer[];
begin
  if v_org is null or v_uid is null then raise exception 'Aucune session'; end if;
  if not has_org_admin_role(v_uid, v_org) then
    raise exception 'Seuls les administrateurs peuvent réordonner les pipelines';
  end if;
  if (select array_agg(id order by id) from public.pipelines_ventes
      where org_id = v_org and archived_at is null and peut_voir_pipeline(v_uid, id))
     is distinct from
     (select array_agg(x order by x) from unnest(p_ids) as x) then
    raise exception 'La liste ne correspond pas aux pipelines de ce bureau';
  end if;

  select array_agg(position order by position) into v_places
  from public.pipelines_ventes where id = any (p_ids);

  update public.pipelines_ventes p
  set position = v_places[o.rang], updated_at = now()
  from unnest(p_ids) with ordinality as o(id, rang)
  where p.id = o.id and p.org_id = v_org;

  perform public.pipeline_resynchroniser_defaut(v_org);
end;
$fn$;
revoke all on function public.pipeline_reordonner(uuid[]) from public, anon;
grant execute on function public.pipeline_reordonner(uuid[]) to authenticated;

-- Dupliquer, copier, supprimer, désigner par défaut : seulement ce qu'on voit.
create or replace function public.pipeline_dupliquer(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_org uuid := current_org_id();
  v_uid uuid := auth.uid();
  v_nom text;
begin
  if v_org is null or v_uid is null then raise exception 'Aucune session'; end if;
  if not has_org_admin_role(v_uid, v_org) then
    raise exception 'Seuls les administrateurs peuvent dupliquer un pipeline';
  end if;
  select name into v_nom from public.pipelines_ventes
  where id = p_id and org_id = v_org and archived_at is null;
  if v_nom is null then raise exception 'Pipeline introuvable'; end if;
  if not peut_voir_pipeline(v_uid, p_id) then raise exception 'Pipeline introuvable'; end if;
  return public._pipeline_copier(p_id, v_org, v_nom || ' (copie)', v_uid);
end;
$fn$;
revoke all on function public.pipeline_dupliquer(uuid) from public, anon;
grant execute on function public.pipeline_dupliquer(uuid) to authenticated;

create or replace function public.pipeline_copier_vers_bureaux(p_id uuid, p_orgs uuid[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_org uuid := current_org_id();
  v_uid uuid := auth.uid();
  v_nom text;
  v_cible uuid;
  v_n integer := 0;
begin
  if v_org is null or v_uid is null then raise exception 'Aucune session'; end if;
  if not has_org_admin_role(v_uid, v_org) then
    raise exception 'Seuls les administrateurs peuvent copier un pipeline';
  end if;
  select name into v_nom from public.pipelines_ventes
  where id = p_id and org_id = v_org and archived_at is null;
  if v_nom is null then raise exception 'Pipeline introuvable'; end if;
  if not peut_voir_pipeline(v_uid, p_id) then raise exception 'Pipeline introuvable'; end if;
  if coalesce(array_length(p_orgs, 1), 0) = 0 then
    raise exception 'Choisissez au moins un bureau';
  end if;

  foreach v_cible in array p_orgs loop
    if v_cible = v_org then continue; end if;
    -- Chaque bureau cible est vérifié : administrer celui-ci ne donne aucun
    -- droit sur un autre.
    if not has_org_admin_role(v_uid, v_cible) then
      raise exception 'Vous n''êtes pas administrateur d''un des bureaux choisis';
    end if;
    perform public._pipeline_copier(p_id, v_cible, v_nom, v_uid);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$fn$;
revoke all on function public.pipeline_copier_vers_bureaux(uuid, uuid[]) from public, anon;
grant execute on function public.pipeline_copier_vers_bureaux(uuid, uuid[]) to authenticated;

create or replace function public.pipeline_supprimer(p_id uuid, p_dest_pipeline uuid default null, p_dest_etape uuid default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_org uuid := current_org_id();
  v_uid uuid := auth.uid();
  v_deals integer;
begin
  if v_org is null or v_uid is null then raise exception 'Aucune session'; end if;
  if not has_org_admin_role(v_uid, v_org) then
    raise exception 'Seuls les administrateurs peuvent supprimer un pipeline';
  end if;
  if not exists (select 1 from public.pipelines_ventes where id = p_id and org_id = v_org and archived_at is null) then
    raise exception 'Pipeline introuvable';
  end if;
  if not peut_voir_pipeline(v_uid, p_id) then raise exception 'Pipeline introuvable'; end if;
  if (select count(*) from public.pipelines_ventes where org_id = v_org and archived_at is null) <= 1 then
    raise exception 'Impossible de supprimer le dernier pipeline';
  end if;

  select count(*) into v_deals from public.deals
  where pipeline_id = p_id and org_id = v_org and deleted_at is null;

  if v_deals > 0 then
    if p_dest_pipeline is null or p_dest_etape is null then
      raise exception 'Ce pipeline contient % deal(s) : choisissez le pipeline et l''étape où les déplacer', v_deals;
    end if;
    if p_dest_pipeline = p_id then
      raise exception 'Choisissez un AUTRE pipeline comme destination';
    end if;
    if not exists (
      select 1 from public.pipeline_stages s
      join public.pipelines_ventes p on p.id = s.pipeline_id
      where s.id = p_dest_etape and s.pipeline_id = p_dest_pipeline
        and s.org_id = v_org and s.archived_at is null and s.kind = 'open'
        and p.archived_at is null
        and peut_voir_pipeline(v_uid, p.id)
    ) then
      raise exception 'Étape de destination invalide : choisissez une étape ouverte du pipeline de destination';
    end if;

    -- Geste administratif : aucune automatisation ne doit partir chez ces clients.
    perform set_config('lume.deplacement_administratif', 'on', true);
    update public.deals
    set pipeline_id = p_dest_pipeline, stage_id = p_dest_etape, updated_at = now()
    where pipeline_id = p_id and org_id = v_org and deleted_at is null;
    perform set_config('lume.deplacement_administratif', 'off', true);
  end if;

  -- Les formulaires qui visaient ce pipeline repartent vers le défaut.
  update public.request_forms set pipeline_id = null where pipeline_id = p_id;

  update public.pipelines_ventes
  set archived_at = now(), is_default = false, updated_at = now()
  where id = p_id;

  perform public.pipeline_resynchroniser_defaut(v_org);
  return v_deals;
end;
$fn$;
revoke all on function public.pipeline_supprimer(uuid, uuid, uuid) from public, anon;
grant execute on function public.pipeline_supprimer(uuid, uuid, uuid) to authenticated;

create or replace function public.pipeline_definir_defaut(p_pipeline_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_org uuid;
  v_ids uuid[];
begin
  select org_id into v_org from public.pipelines_ventes
  where id = p_pipeline_id and archived_at is null;
  if v_org is null or v_org is distinct from current_org_id() then
    raise exception 'Pipeline introuvable';
  end if;
  if not has_org_admin_role(auth.uid(), v_org) then
    raise exception 'Changement refusé : seuls les administrateurs peuvent changer le pipeline par défaut';
  end if;
  if not peut_voir_pipeline(auth.uid(), p_pipeline_id) then raise exception 'Pipeline introuvable'; end if;

  select array_agg(id order by (id = p_pipeline_id) desc, position, created_at, id) into v_ids
  from public.pipelines_ventes where org_id = v_org and archived_at is null;

  update public.pipelines_ventes p
  set position = o.rang::integer, updated_at = now()
  from unnest(v_ids) with ordinality as o(id, rang)
  where p.id = o.id;

  perform public.pipeline_resynchroniser_defaut(v_org);
end;
$fn$;
revoke all on function public.pipeline_definir_defaut(uuid) from public, anon;
grant execute on function public.pipeline_definir_defaut(uuid) to authenticated;

commit;
