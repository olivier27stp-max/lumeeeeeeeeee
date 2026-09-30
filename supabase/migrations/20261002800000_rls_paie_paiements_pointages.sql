-- La base suit enfin la page Rôles pour l'argent des employés et les pointages.
--
-- Constat (catalogue de tâches Lumi, 2026-09-29) — mesuré par rôle via PostgREST :
--  * payments : lisible par TOUT membre (has_org_membership) — un technicien,
--    à qui la page Rôles retire tout accès financier, lisait les paiements des
--    clients. Les factures et soumissions, elles, suivent déjà
--    membre_voit_les_montants() : on aligne les paiements sur la même règle.
--  * payroll_payments / payroll_adjustments : la paie de CHAQUE employé lisible
--    par tous les membres. Désormais : sa propre paie, ou propriétaire/admin.
--  * time_entries : n'importe quel membre pouvait créer, modifier ou supprimer
--    les pointages de n'importe qui, et donc approuver ses propres heures.
--    Désormais : son propre pointage, ou propriétaire/admin ; supprimer et
--    approuver = propriétaire/admin ; un pointage approuvé ne se modifie plus
--    sans eux.
--
-- Les routes de pointage (server/routes/timesheets.ts) et la paie
-- (server/routes/payroll.ts) écrivent avec la clé service : non concernées.

begin;

-- ── Paiements : même règle que les factures ────────────────────────────
drop policy if exists payments_select_org on public.payments;
create policy payments_select_org on public.payments
  for select to authenticated
  using (
    has_org_membership((select auth.uid()), org_id)
    and membre_voit_les_montants((select auth.uid()), org_id)
  );

-- ── Paie : la sienne, ou celle de tous pour propriétaire/admin ─────────
drop policy if exists payroll_payments_select on public.payroll_payments;
create policy payroll_payments_select on public.payroll_payments
  for select to authenticated
  using (
    has_org_membership((select auth.uid()), org_id)
    and (user_id = (select auth.uid()) or has_org_admin_role((select auth.uid()), org_id))
  );

drop policy if exists payroll_adjustments_select on public.payroll_adjustments;
create policy payroll_adjustments_select on public.payroll_adjustments
  for select to authenticated
  using (
    has_org_membership((select auth.uid()), org_id)
    and (user_id = (select auth.uid()) or has_org_admin_role((select auth.uid()), org_id))
  );

-- ── Pointages : écrire le sien, ou tous pour propriétaire/admin ────────
drop policy if exists time_entries_insert_org on public.time_entries;
create policy time_entries_insert_org on public.time_entries
  for insert to authenticated
  with check (
    has_org_membership((select auth.uid()), org_id)
    and (employee_id = (select auth.uid()) or has_org_admin_role((select auth.uid()), org_id))
  );

drop policy if exists time_entries_update_org on public.time_entries;
create policy time_entries_update_org on public.time_entries
  for update to authenticated
  using (
    has_org_membership((select auth.uid()), org_id)
    and (employee_id = (select auth.uid()) or has_org_admin_role((select auth.uid()), org_id))
  )
  with check (
    has_org_membership((select auth.uid()), org_id)
    and (employee_id = (select auth.uid()) or has_org_admin_role((select auth.uid()), org_id))
  );

drop policy if exists time_entries_delete_org on public.time_entries;
create policy time_entries_delete_org on public.time_entries
  for delete to authenticated
  using (has_org_admin_role((select auth.uid()), org_id));

-- Approuver des heures = propriétaire/admin. Et un pointage approuvé ne change
-- plus d'heures sans eux (sinon on approuve 8 h et on en paie 10).
create or replace function public.pointage_garde_approbation()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null then return new; end if;  -- clé service (routes serveur)
  if has_org_admin_role(auth.uid(), new.org_id) then return new; end if;

  if tg_op = 'INSERT' then
    if new.approved_at is not null or new.approved_by is not null then
      raise exception 'Seul un propriétaire ou un administrateur peut approuver des heures.' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by then
    raise exception 'Seul un propriétaire ou un administrateur peut approuver des heures.' using errcode = '42501';
  end if;
  if old.approved_at is not null and (
       new.punch_in_at is distinct from old.punch_in_at or new.punch_out_at is distinct from old.punch_out_at
    or new.punch_in is distinct from old.punch_in or new.punch_out is distinct from old.punch_out
    or new.breaks is distinct from old.breaks or new.date is distinct from old.date
  ) then
    raise exception 'Ces heures sont déjà approuvées : un gestionnaire doit les modifier.' using errcode = '42501';
  end if;
  return new;
end;
$function$;

revoke execute on function public.pointage_garde_approbation() from public, anon, authenticated;

drop trigger if exists trg_time_entries_garde_approbation on public.time_entries;
create trigger trg_time_entries_garde_approbation
  before insert or update on public.time_entries
  for each row execute function public.pointage_garde_approbation();

commit;
