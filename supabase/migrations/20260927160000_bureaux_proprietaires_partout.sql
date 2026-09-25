-- Bureaux : un propriétaire de la compagnie a accès à TOUS ses bureaux.
--
-- Bug (2026-09-25, Coquin lavage) : Olivier a créé le bureau « Vision Lavage »
-- le 2026-09-07 ; seul le créateur recevait une adhésion. Le co-propriétaire
-- (William) n'a jamais eu accès, et aucun écran ne permettait de le lui donner.
-- Depuis le 2026-09-13 le formulaire propose une case « accès », mais décochée
-- par défaut, et un propriétaire ajouté plus tard n'aurait pas eu les bureaux
-- existants non plus.
--
-- Règle : propriétaire actif d'un bureau = propriétaire de tous les bureaux du
-- même company_group. Posée en base pour couvrir tous les chemins
-- (create-office, invitation, changement de rôle, Creator Space).
--   (a) nouveau propriétaire dans X → ajouté aux autres bureaux du groupe ;
--   (b) premier propriétaire d'un nouveau bureau X → les propriétaires des
--       autres bureaux sont ajoutés à X.
-- ON CONFLICT DO NOTHING : une adhésion existante n'est jamais modifiée —
-- un retrait volontaire (status inactif) ou un autre rôle est respecté.
-- Sièges : comptés en utilisateurs DISTINCTS du groupe → aucun coût.

create or replace function public.propager_proprietaires_bureaux()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_groupe uuid;
begin
  -- Les insertions faites ici relancent le trigger : une seule passe suffit.
  if pg_trigger_depth() > 1 then return new; end if;
  if new.role <> 'owner' or coalesce(new.status, 'active') <> 'active' then return new; end if;

  select company_group_id into v_groupe from public.orgs where id = new.org_id;
  if v_groupe is null then return new; end if;

  -- (a) ce propriétaire → les autres bureaux du groupe
  insert into public.memberships (user_id, org_id, role, status, full_name, avatar_url)
  select new.user_id, o.id, 'owner', 'active', new.full_name, new.avatar_url
    from public.orgs o
   where o.company_group_id = v_groupe
     and o.id <> new.org_id
     and o.deleted_at is null
  on conflict (user_id, org_id) do nothing;

  -- (b) les propriétaires des autres bureaux → ce bureau
  insert into public.memberships (user_id, org_id, role, status, full_name, avatar_url)
  select distinct on (m.user_id) m.user_id, new.org_id, 'owner', 'active', m.full_name, m.avatar_url
    from public.memberships m
    join public.orgs o on o.id = m.org_id
   where o.company_group_id = v_groupe
     and o.id <> new.org_id
     and o.deleted_at is null
     and m.role = 'owner'
     and coalesce(m.status, 'active') = 'active'
     and m.user_id <> new.user_id
  order by m.user_id, m.created_at
  on conflict (user_id, org_id) do nothing;

  return new;
end;
$$;
revoke all on function public.propager_proprietaires_bureaux() from public, anon, authenticated;

drop trigger if exists trg_propager_proprietaires_bureaux on public.memberships;
create trigger trg_propager_proprietaires_bureaux
  after insert or update of role, status on public.memberships
  for each row execute function public.propager_proprietaires_bureaux();

-- Rattrapage : chaque propriétaire actif reçoit les bureaux de son groupe
-- où il n'a encore aucune adhésion (prod : William → Vision Lavage).
insert into public.memberships (user_id, org_id, role, status, full_name, avatar_url)
select distinct on (m.user_id, cible.id) m.user_id, cible.id, 'owner', 'active', m.full_name, m.avatar_url
  from public.memberships m
  join public.orgs source on source.id = m.org_id and source.deleted_at is null
  join public.orgs cible  on cible.company_group_id = source.company_group_id
                         and cible.id <> source.id
                         and cible.deleted_at is null
 where source.company_group_id is not null
   and m.role = 'owner'
   and coalesce(m.status, 'active') = 'active'
order by m.user_id, cible.id, m.created_at
on conflict (user_id, org_id) do nothing;
