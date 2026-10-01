-- Restes de l'audit Statistiques (STATS_AUDIT.md §8 « Encore ouvert »).
--
-- 1. M-11 — rpc_insights_budget_vs_actual : fonction MORTE (elle lit la table budget_targets, qui
--    n'existe pas : toute exécution échouait en 42P01). Aucun appelant dans le code ni en SQL.
--
-- 2. Paie sur memberships : la politique d'UPDATE laisse un membre modifier SA propre ligne
--    (langue, préférences…), donc aussi hourly_rate_cents / labour_cost_hourly / compensation_mode.
--    La paie lit team_members, mais la copie d'un membre vers un nouveau bureau reprend ces
--    colonnes (server/routes/orgs.ts, PROFIL_COPIE). Garde, dans le même esprit que
--    enforce_membership_role_change : une session utilisateur ne change ces trois colonnes que si
--    elle a team.update (gérer l'équipe). Le serveur (service_role, auth.uid() nul) n'est pas concerné.
--    Aucun code client n'écrit ces colonnes sur memberships (vérifié par grep).
begin;

drop function if exists public.rpc_insights_budget_vs_actual(uuid, date, date);

create or replace function public.enforce_membership_pay_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.hourly_rate_cents is distinct from old.hourly_rate_cents)
     or (new.labour_cost_hourly is distinct from old.labour_cost_hourly)
     or (new.compensation_mode is distinct from old.compensation_mode) then
    -- Opérations serveur (service_role) : pas de session utilisateur.
    if auth.uid() is null then
      return new;
    end if;
    if not public.member_has_permission(auth.uid(), old.org_id, 'team.update') then
      raise exception 'Seule une personne qui gère l''équipe peut modifier la rémunération.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_membership_pay_change() from public, anon, authenticated;

drop trigger if exists trg_enforce_membership_pay_change on public.memberships;
create trigger trg_enforce_membership_pay_change
  before update on public.memberships
  for each row execute function public.enforce_membership_pay_change();

commit;
