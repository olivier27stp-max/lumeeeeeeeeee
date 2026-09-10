-- ═══════════════════════════════════════════════════════════════
-- team_members suit memberships — plus jamais une équipe fantôme
-- ─────────────────────────────────────────────────────────────
-- Constaté en prod le 2026-09-10 : 1 ligne team_members pour 10 membres.
-- Le propriétaire n'y est jamais inséré à la création de l'org, ni les
-- invités à l'acceptation d'une invitation (memberships seulement). Or la
-- paie (taux horaires), la rentabilité, le leaderboard, la météo terrain et
-- la conformité d'équipe lisent team_members : ils voyaient une équipe vide.
-- Le sélecteur « Assigné à » a été réécrit sur memberships (audit QA n°6) ;
-- ici on répare la table elle-même, pour tous les modules.
--
-- Règle : une ligne team_members par membership, créée et mise à jour par
-- trigger (rôle, statut), rattrapage des membres existants. team_members
-- garde ce qui lui est propre (taux horaire, adresse, disponibilités…).

-- 1. sales_rep est un rôle de membership : team_members doit l'accepter.
alter table public.team_members drop constraint if exists team_members_role_check;
alter table public.team_members
  add constraint team_members_role_check
  check (role = any (array['owner'::text, 'admin'::text, 'sales_rep'::text, 'technician'::text]));

-- 2. Une seule fiche par (org, utilisateur) — sans ça, le trigger ne peut
--    pas être idempotent et les modules pourraient compter deux fois.
create unique index if not exists team_members_org_user_key
  on public.team_members (org_id, user_id)
  where user_id is not null;

-- 3. La fonction de synchronisation.
create or replace function public.sync_team_member_from_membership()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
  v_nom   text;
  v_first text := '';
  v_last  text := '';
  v_role  text;
  v_status text;
begin
  if tg_op = 'DELETE' then
    update public.team_members
       set status = 'inactive', updated_at = now()
     where org_id = old.org_id and user_id = old.user_id and status <> 'inactive';
    return old;
  end if;

  if new.user_id is null then return new; end if;

  v_role := case when new.role in ('owner', 'admin', 'sales_rep', 'technician') then new.role else 'technician' end;
  v_status := case when coalesce(new.status, 'active') = 'active' then 'active' else 'inactive' end;

  -- Identité : courriel depuis auth.users, nom depuis profiles (comme
  -- get_user_id_by_email, la lecture d'auth.users passe par SECURITY DEFINER).
  select email into v_email from auth.users where id = new.user_id;
  -- Membership orphelin (utilisateur supprimé d'auth) : pas de fiche.
  if v_email is null then return new; end if;
  select full_name into v_nom from public.profiles where id = new.user_id;
  if v_nom is not null and btrim(v_nom) <> '' then
    v_first := split_part(btrim(v_nom), ' ', 1);
    v_last  := btrim(substr(btrim(v_nom), length(v_first) + 1));
  end if;

  insert into public.team_members (org_id, user_id, email, first_name, last_name, phone, role, status)
  values (new.org_id, new.user_id, coalesce(v_email, ''), v_first, v_last, '', v_role, v_status)
  on conflict (org_id, user_id) where user_id is not null
  do update set
    role   = excluded.role,
    status = excluded.status,
    email  = case when public.team_members.email = '' then excluded.email else public.team_members.email end,
    first_name = case when public.team_members.first_name = '' then excluded.first_name else public.team_members.first_name end,
    last_name  = case when public.team_members.last_name  = '' then excluded.last_name  else public.team_members.last_name  end,
    updated_at = now();
  return new;
end;
$$;

revoke all on function public.sync_team_member_from_membership() from public, anon, authenticated;

drop trigger if exists trg_team_members_suit_memberships on public.memberships;
create trigger trg_team_members_suit_memberships
  after insert or update of role, status, user_id or delete on public.memberships
  for each row execute function public.sync_team_member_from_membership();

-- 4. Rattrapage : tous les membres actuels sans fiche (ou avec fiche à compléter).
insert into public.team_members (org_id, user_id, email, first_name, last_name, phone, role, status)
select m.org_id,
       m.user_id,
       coalesce(u.email, ''),
       coalesce(split_part(btrim(p.full_name), ' ', 1), ''),
       coalesce(btrim(substr(btrim(p.full_name), length(split_part(btrim(p.full_name), ' ', 1)) + 1)), ''),
       '',
       case when m.role in ('owner', 'admin', 'sales_rep', 'technician') then m.role else 'technician' end,
       case when coalesce(m.status, 'active') = 'active' then 'active' else 'inactive' end
  from public.memberships m
  join auth.users u on u.id = m.user_id          -- orphelins ignorés
  left join public.profiles p on p.id = m.user_id
 where m.user_id is not null
on conflict (org_id, user_id) where user_id is not null
do update set
  role = excluded.role,
  status = excluded.status,
  email = case when public.team_members.email = '' then excluded.email else public.team_members.email end,
  first_name = case when public.team_members.first_name = '' then excluded.first_name else public.team_members.first_name end,
  last_name = case when public.team_members.last_name = '' then excluded.last_name else public.team_members.last_name end;

comment on trigger trg_team_members_suit_memberships on public.memberships is
  'Une fiche team_members par membership : créée à l''arrivée, rôle/statut suivis, inactive au départ. Les champs propres à team_members (taux, adresse, horaires) ne sont jamais écrasés.';
