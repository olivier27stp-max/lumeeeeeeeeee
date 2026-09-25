-- Prix du catalogue par bureau (plan multi-bureaux, étape 8 ; Q6 par défaut :
-- même catalogue pour l'entreprise, le bureau peut changer le PRIX et
-- MASQUER un service qu'il n'offre pas).
--
-- Le catalogue reste unique (predefined_services, partagé par l'entreprise).
-- Une ligne ici = un réglage local d'UN bureau pour UN service :
--   prix_cents nul   → le prix de l'entreprise s'applique ;
--   offert = false   → le service est masqué dans ce bureau.
-- Pas de ligne → comportement d'avant (prix et disponibilité de l'entreprise).

create table if not exists public.predefined_services_bureau (
  service_id uuid not null references public.predefined_services(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  prix_cents integer check (prix_cents is null or prix_cents >= 0),
  offert boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (service_id, org_id)
);
create index if not exists predefined_services_bureau_org_idx on public.predefined_services_bureau (org_id);
comment on table public.predefined_services_bureau is
  'Réglage local d''un service du catalogue d''entreprise dans UN bureau : prix propre (nul = prix de l''entreprise) et disponibilité.';

alter table public.predefined_services_bureau enable row level security;
alter table public.predefined_services_bureau force row level security;

drop policy if exists predefined_services_bureau_select on public.predefined_services_bureau;
create policy predefined_services_bureau_select on public.predefined_services_bureau
  for select to authenticated
  using (public.has_org_membership((select auth.uid()), org_id));

drop policy if exists predefined_services_bureau_ecriture on public.predefined_services_bureau;
create policy predefined_services_bureau_ecriture on public.predefined_services_bureau
  for all to authenticated
  using (public.has_org_admin_role((select auth.uid()), org_id))
  with check (public.has_org_admin_role((select auth.uid()), org_id));

-- Même défense que les 186 autres tables par bureau (20260927200000) : une
-- nouvelle table ne la reçoit pas toute seule.
drop policy if exists bureau_actif on public.predefined_services_bureau;
create policy bureau_actif on public.predefined_services_bureau
  as restrictive for all to authenticated
  using ((select public.bureau_actif_demande()) is null or org_id is null or org_id = (select public.bureau_actif_demande()))
  with check ((select public.bureau_actif_demande()) is null or org_id is null or org_id = (select public.bureau_actif_demande()));

revoke all on public.predefined_services_bureau from anon;
grant select, insert, update, delete on public.predefined_services_bureau to authenticated;
grant all on public.predefined_services_bureau to service_role;
