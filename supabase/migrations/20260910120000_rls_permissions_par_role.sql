-- ═══════════════════════════════════════════════════════════════
-- La RLS porte enfin le RÔLE : factures, devis, paiements et leurs lignes
-- ─────────────────────────────────────────────────────────────
-- Audit bloc 3 (2026-09-10), C1 — vérifié dans pg_policies en prod :
--   invoices_delete_org   : has_org_membership seul (INSERT/UPDATE : owner/admin)
--   quotes_insert/update/delete, payments_insert/update/delete,
--   invoice_items_*, quote_line_items_* : org seulement.
-- Le rôle avait été ajouté sur l'INSERT des factures et oublié sur le
-- DELETE : un technicien ne peut pas créer une facture, mais peut la
-- supprimer — par un simple DELETE /rest/v1/invoices?id=eq.<uuid>. Les RPC
-- (delete_invoice_cascade…) sont gardées, mais PostgREST n'en a pas besoin.
--
-- C2 : 50 des 66 permissions de Réglages → Rôles n'étaient vérifiées nulle
-- part côté serveur ; décocher une case ne faisait que masquer un bouton.
--
-- Ici, UNE fonction, member_has_permission(user, org, clé), reproduit
-- exactement la résolution du serveur (server/lib/rbac.ts hasPermission) :
--   1. propriétaire → tout
--   2. technicien → jamais une permission financière (même surchargée)
--   3. surcharge du membre (memberships.permissions) → sa valeur
--   4. admin → tout sauf users.delete
--   5. gabarit de l'org (role_templates, page Rôles) → sa valeur
--   6. sinon → défauts du rôle (role_permission_defaults, copie de
--      ROLE_PRESETS de src/lib/permissions.ts ; tests/rls-permissions-parite
--      vérifie que les deux ne divergent pas)
-- Les policies d'écriture des tables d'argent l'utilisent avec la clé de la
-- page Rôles : ce qu'on décoche dans l'interface est refusé par la base.

-- ── 1. Défauts par rôle (clés accordées ; absence = refusé) ──
create table if not exists public.role_permission_defaults (
  role        text not null,
  permission  text not null,
  primary key (role, permission)
);
comment on table public.role_permission_defaults is
  'Copie SQL de ROLE_PRESETS (src/lib/permissions.ts) pour sales_rep et technician. owner/admin sont résolus dans member_has_permission(). Régénérée par migration ; tests/rls-permissions-parite.test.ts garde la parité.';

alter table public.role_permission_defaults enable row level security;
alter table public.role_permission_defaults force row level security;
drop policy if exists "role_permission_defaults_read" on public.role_permission_defaults;
create policy "role_permission_defaults_read" on public.role_permission_defaults
  as permissive for select to authenticated using (true);
revoke all on public.role_permission_defaults from anon, authenticated;
grant select on public.role_permission_defaults to authenticated;

delete from public.role_permission_defaults where role in ('sales_rep', 'technician');
insert into public.role_permission_defaults (role, permission) values
('sales_rep', 'calendar.read'),
  ('sales_rep', 'calendar.update'),
  ('sales_rep', 'clients.create'),
  ('sales_rep', 'clients.read'),
  ('sales_rep', 'clients.update'),
  ('sales_rep', 'commissions.read'),
  ('sales_rep', 'door_to_door.access'),
  ('sales_rep', 'door_to_door.convert'),
  ('sales_rep', 'door_to_door.edit'),
  ('sales_rep', 'external_agent.use'),
  ('sales_rep', 'financial.view_pricing'),
  ('sales_rep', 'jobs.create'),
  ('sales_rep', 'jobs.read'),
  ('sales_rep', 'leads.create'),
  ('sales_rep', 'leads.read'),
  ('sales_rep', 'leads.update'),
  ('sales_rep', 'map.access'),
  ('sales_rep', 'messages.read'),
  ('sales_rep', 'messages.send'),
  ('sales_rep', 'quotes.create'),
  ('sales_rep', 'quotes.read'),
  ('sales_rep', 'quotes.send'),
  ('sales_rep', 'quotes.update'),
  ('sales_rep', 'search.global'),
  ('sales_rep', 'settings.read'),
  ('technician', 'calendar.read'),
  ('technician', 'calendar.update'),
  ('technician', 'clients.read'),
  ('technician', 'external_agent.use'),
  ('technician', 'gps.read'),
  ('technician', 'jobs.complete'),
  ('technician', 'jobs.read'),
  ('technician', 'jobs.update'),
  ('technician', 'messages.read'),
  ('technician', 'messages.send'),
  ('technician', 'settings.read'),
  ('technician', 'timesheets.read'),
  ('technician', 'timesheets.update')
on conflict do nothing;

-- ── 2. La fonction ──
create or replace function public.member_has_permission(p_user uuid, p_org uuid, p_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m record;
  t jsonb;
  financiere constant text[] := array['financial.view_pricing', 'financial.view_invoices', 'financial.view_payments', 'financial.view_reports', 'financial.view_analytics', 'financial.view_margins', 'financial.export_data', 'invoices.create', 'invoices.read', 'invoices.update', 'invoices.delete', 'invoices.send', 'payments.read', 'payments.create', 'payments.refund', 'reports.read', 'analytics.view'];
begin
  if p_user is null or p_org is null or p_key is null then return false; end if;

  select role, permissions into m
    from public.memberships
   where user_id = p_user and org_id = p_org and status = 'active'
   limit 1;
  if not found then return false; end if;

  if m.role = 'owner' then return true; end if;
  if m.role = 'technician' and p_key = any(financiere) then return false; end if;

  if m.permissions is not null and m.permissions ? p_key then
    return coalesce((m.permissions ->> p_key)::boolean, false);
  end if;

  if m.role = 'admin' then return p_key <> 'users.delete'; end if;

  select permissions into t
    from public.role_templates
   where org_id = p_org and slug = m.role and is_active
   limit 1;
  if t is not null and t ? p_key then
    return coalesce((t ->> p_key)::boolean, false);
  end if;

  return exists (
    select 1 from public.role_permission_defaults d
     where d.role = m.role and d.permission = p_key
  );
end;
$$;

comment on function public.member_has_permission(uuid, uuid, text) is
  'Même résolution que server/lib/rbac.ts hasPermission() : owner → tout ; technician → jamais financier ; surcharge du membre ; admin → tout sauf users.delete ; gabarit de l''org ; défauts du rôle.';

revoke all on function public.member_has_permission(uuid, uuid, text) from public, anon;
grant execute on function public.member_has_permission(uuid, uuid, text) to authenticated, service_role;

-- ── 3. Les policies d'écriture ──
-- invoices : create / update / delete = clés de la page Rôles
drop policy if exists invoices_insert_org on public.invoices;
create policy invoices_insert_org on public.invoices
  as permissive for insert to authenticated
  with check (public.member_has_permission((select auth.uid()), org_id, 'invoices.create'));

drop policy if exists invoices_update_org on public.invoices;
create policy invoices_update_org on public.invoices
  as permissive for update to authenticated
  using (public.member_has_permission((select auth.uid()), org_id, 'invoices.update'))
  with check (public.member_has_permission((select auth.uid()), org_id, 'invoices.update'));

drop policy if exists invoices_delete_org on public.invoices;
create policy invoices_delete_org on public.invoices
  as permissive for delete to authenticated
  using (public.member_has_permission((select auth.uid()), org_id, 'invoices.delete'));

-- invoice_items suivent la facture (invoices.update)
drop policy if exists invoice_items_insert_org on public.invoice_items;
create policy invoice_items_insert_org on public.invoice_items
  as permissive for insert to authenticated
  with check (public.member_has_permission((select auth.uid()), org_id, 'invoices.update'));
drop policy if exists invoice_items_update_org on public.invoice_items;
create policy invoice_items_update_org on public.invoice_items
  as permissive for update to authenticated
  using (public.member_has_permission((select auth.uid()), org_id, 'invoices.update'))
  with check (public.member_has_permission((select auth.uid()), org_id, 'invoices.update'));
drop policy if exists invoice_items_delete_org on public.invoice_items;
create policy invoice_items_delete_org on public.invoice_items
  as permissive for delete to authenticated
  using (public.member_has_permission((select auth.uid()), org_id, 'invoices.update'));

-- quotes : sales_rep crée et modifie (preset), ne supprime pas
drop policy if exists quotes_insert on public.quotes;
create policy quotes_insert on public.quotes
  as permissive for insert to authenticated
  with check (public.member_has_permission((select auth.uid()), org_id, 'quotes.create'));
drop policy if exists quotes_update on public.quotes;
create policy quotes_update on public.quotes
  as permissive for update to authenticated
  using (public.member_has_permission((select auth.uid()), org_id, 'quotes.update'))
  with check (public.member_has_permission((select auth.uid()), org_id, 'quotes.update'));
drop policy if exists quotes_delete on public.quotes;
create policy quotes_delete on public.quotes
  as permissive for delete to authenticated
  using (public.member_has_permission((select auth.uid()), org_id, 'quotes.delete'));

-- quote_line_items suivent le devis (quotes.update)
drop policy if exists quote_line_items_insert on public.quote_line_items;
create policy quote_line_items_insert on public.quote_line_items
  as permissive for insert to authenticated
  with check (exists (select 1 from public.quotes q where q.id = quote_line_items.quote_id
                        and public.member_has_permission((select auth.uid()), q.org_id, 'quotes.update')));
drop policy if exists quote_line_items_update on public.quote_line_items;
create policy quote_line_items_update on public.quote_line_items
  as permissive for update to authenticated
  using (exists (select 1 from public.quotes q where q.id = quote_line_items.quote_id
                   and public.member_has_permission((select auth.uid()), q.org_id, 'quotes.update')))
  with check (exists (select 1 from public.quotes q where q.id = quote_line_items.quote_id
                        and public.member_has_permission((select auth.uid()), q.org_id, 'quotes.update')));
drop policy if exists quote_line_items_delete on public.quote_line_items;
create policy quote_line_items_delete on public.quote_line_items
  as permissive for delete to authenticated
  using (exists (select 1 from public.quotes q where q.id = quote_line_items.quote_id
                   and public.member_has_permission((select auth.uid()), q.org_id, 'quotes.update')));

-- payments : create pour insérer ; modifier = create ou refund ; supprimer = owner/admin
drop policy if exists payments_insert_org on public.payments;
create policy payments_insert_org on public.payments
  as permissive for insert to authenticated
  with check (public.member_has_permission((select auth.uid()), org_id, 'payments.create'));
drop policy if exists payments_update_org on public.payments;
create policy payments_update_org on public.payments
  as permissive for update to authenticated
  using (public.member_has_permission((select auth.uid()), org_id, 'payments.create')
      or public.member_has_permission((select auth.uid()), org_id, 'payments.refund'))
  with check (public.member_has_permission((select auth.uid()), org_id, 'payments.create')
           or public.member_has_permission((select auth.uid()), org_id, 'payments.refund'));
drop policy if exists payments_delete_org on public.payments;
create policy payments_delete_org on public.payments
  as permissive for delete to authenticated
  using (public.has_org_admin_role((select auth.uid()), org_id));

-- ── 4. La suppression douce est une suppression ──
-- Soft delete = UPDATE de deleted_at : sans ce garde, un membre autorisé à
-- MODIFIER une facture pourrait la « supprimer » d'un PATCH, sans avoir
-- invoices.delete. Le service_role (RPC, serveur) n'est pas concerné.
create or replace function public.garde_suppression_douce()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cle text := tg_argv[0];
  uid uuid := auth.uid();
begin
  if new.deleted_at is not distinct from old.deleted_at then return new; end if;
  if uid is null then return new; end if;  -- service_role / postgres
  if not public.member_has_permission(uid, new.org_id, cle) then
    raise exception 'Permission refusée : % requise pour supprimer', cle
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.garde_suppression_douce() from public, anon, authenticated;

drop trigger if exists trg_invoices_suppression_douce on public.invoices;
create trigger trg_invoices_suppression_douce
  before update of deleted_at on public.invoices
  for each row execute function public.garde_suppression_douce('invoices.delete');

drop trigger if exists trg_quotes_suppression_douce on public.quotes;
create trigger trg_quotes_suppression_douce
  before update of deleted_at on public.quotes
  for each row execute function public.garde_suppression_douce('quotes.delete');
