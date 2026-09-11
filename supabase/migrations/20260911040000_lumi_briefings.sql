-- Lumi vient à toi : chaque matin, une conversation pré-écrite par Lumi
-- (visites du jour, retards, tâches, nouvelles demandes, textos non lus)
-- pour chaque propriétaire/admin d'une org qui a Lumi, plus une notification
-- qui y mène. Cette table garantit UN briefing par personne et par jour,
-- même si le serveur redémarre ou tourne en double.
create table if not exists public.lumi_briefings (
  org_id          uuid not null references public.orgs(id) on delete cascade,
  user_id         uuid not null,
  jour            date not null,
  conversation_id uuid references public.lumi_conversations(id) on delete set null,
  created_at      timestamptz not null default now(),
  primary key (org_id, user_id, jour)
);
comment on table public.lumi_briefings is
  'Briefing du matin de Lumi : une ligne par (org, personne, jour). Idempotence du cron ; la conversation créée est référencée.';

alter table public.lumi_briefings enable row level security;
alter table public.lumi_briefings force row level security;

drop policy if exists "lumi_briefings_service" on public.lumi_briefings;
create policy "lumi_briefings_service" on public.lumi_briefings
  as permissive for all to service_role using (true) with check (true);

drop policy if exists "lumi_briefings_own" on public.lumi_briefings;
create policy "lumi_briefings_own" on public.lumi_briefings
  as permissive for select to authenticated
  using (user_id = (select auth.uid()) and public.has_org_membership((select auth.uid()), org_id));

-- Chacun peut couper le briefing pour lui-même (réglage par membre).
alter table public.memberships
  add column if not exists lumi_briefing boolean not null default true;
comment on column public.memberships.lumi_briefing is
  'Recevoir le briefing du matin de Lumi (conversation + notification). Par personne.';
