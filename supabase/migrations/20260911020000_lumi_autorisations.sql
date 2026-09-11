-- « Toujours confirmer ce type d'action » : la préférence vivait dans le
-- navigateur (localStorage). Elle suit maintenant l'utilisateur, par org et
-- par outil, et c'est le SERVEUR qui exécute directement une écriture
-- autorisée (la carte s'affiche « Confirmée auto », réversible depuis la
-- carte ou la page Lumi).
create table if not exists public.lumi_autorisations (
  org_id      uuid not null references public.orgs(id) on delete cascade,
  user_id     uuid not null,
  tool        text not null,
  created_at  timestamptz not null default now(),
  primary key (org_id, user_id, tool)
);
comment on table public.lumi_autorisations is
  'Écritures Lumi que cet utilisateur a choisi de ne plus confirmer une à une (« Toujours confirmer »). Une ligne = un outil autorisé.';

alter table public.lumi_autorisations enable row level security;
alter table public.lumi_autorisations force row level security;

drop policy if exists "lumi_autorisations_service" on public.lumi_autorisations;
create policy "lumi_autorisations_service" on public.lumi_autorisations
  as permissive for all to service_role using (true) with check (true);

drop policy if exists "lumi_autorisations_own" on public.lumi_autorisations;
create policy "lumi_autorisations_own" on public.lumi_autorisations
  as permissive for select to authenticated
  using (user_id = (select auth.uid()) and public.has_org_membership((select auth.uid()), org_id));
