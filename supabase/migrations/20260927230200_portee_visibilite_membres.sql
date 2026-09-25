-- Portée de visibilité d'un membre DANS un bureau (multi-bureaux, phase 4).
--
-- memberships.scope existait (self / assigned / team / company) mais n'était
-- appliqué NULLE PART : ni en base, ni côté serveur, ni à l'écran. Tout le
-- monde voyait tout son bureau. Cette migration :
--
--   1. ALIGNE les valeurs sur ce que chacun voit aujourd'hui : toutes les
--      adhésions et invitations en attente passent à 'company' (la portée
--      réellement appliquée jusqu'ici). Aucun accès ne se perd au déploiement.
--      La défaut devient 'company' partout ; restreindre est un choix explicite
--      d'un propriétaire/admin (page Équipe).
--   2. APPLIQUE la portée en base par des policies RESTRICTIVE (s'ajoutent aux
--      policies existantes, n'élargissent rien) sur clients, jobs, soumissions,
--      factures, tâches, rendez-vous, conversations et messages :
--        company (et tout propriétaire/admin) : tout le bureau ;
--        team : ce qui appartient à quelqu'un de mon équipe, ou à mon équipe ;
--        self / assigned : ce que j'ai créé, ce qui m'est assigné ou vendu, et
--          les clients de ces travaux (sinon une job assignée n'aurait plus de client).
--      USING seulement (WITH CHECK true) : on peut créer, et confier une fiche
--      à quelqu'un d'autre même si on ne la voit plus ensuite.
--   3. Le service_role (serveur, cron) n'est pas concerné (RLS contournée) :
--      les routes serveur qui listent avec la clé de service filtrent elles-mêmes
--      (recherche globale : server/lib/portee-recherche.ts).
--
-- Chaque policy teste d'abord les colonnes de LA LIGNE (créée par, assignée à…) :
-- une fonction STABLE lit l'instantané du début de l'instruction et ne verrait
-- pas une ligne qu'on vient d'insérer (INSERT … RETURNING échouerait).
--
-- Performances : chaque policy compare à des ENSEMBLES calculés une fois par
-- requête (« in (select …) » sans corrélation → initplan), pas une fonction
-- par ligne. Pour un propriétaire, le premier test (bureau complet) suffit.

-- ─── 1. Aligner les valeurs ────────────────────────────────────────────────
update public.memberships set scope = 'company' where scope is distinct from 'company';
alter table public.memberships alter column scope set default 'company';

update public.invitations set scope = 'company' where status = 'pending' and scope is distinct from 'company';
alter table public.invitations alter column scope set default 'company';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'memberships_scope_check') then
    alter table public.memberships
      add constraint memberships_scope_check check (scope in ('self', 'assigned', 'team', 'company'));
  end if;
end $$;

-- ─── 2. Ensembles de visibilité (par personne) ─────────────────────────────
-- Fonctions internes paramétrées par p_user : réservées au serveur (service_role).
-- Les policies passent par les enveloppes sans argument (auth.uid()) plus bas.

-- Bureaux que la personne voit EN ENTIER (propriétaire/admin, ou portée company).
create or replace function public._portee_bureaux_complets(p_user uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select m.org_id from public.memberships m
  where m.user_id = p_user and m.status = 'active'
    and (m.role in ('owner', 'admin') or coalesce(m.scope, 'company') = 'company');
$$;

-- Bureaux où la personne est RESTREINTE, avec sa portée.
create or replace function public._portee_restreinte(p_user uuid)
returns table(org_id uuid, scope text) language sql stable security definer set search_path = public as $$
  select m.org_id, m.scope from public.memberships m
  where m.user_id = p_user and m.status = 'active'
    and m.role not in ('owner', 'admin') and m.scope in ('self', 'assigned', 'team');
$$;

-- Mes équipes (bureaux en portée team) : équipe principale + équipes assignées.
create or replace function public._portee_equipes(p_user uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select m.team_id from public.memberships m
  join public._portee_restreinte(p_user) r on r.org_id = m.org_id and r.scope = 'team'
  where m.user_id = p_user and m.team_id is not null
  union
  select ta.team_id from public.team_assignments ta
  join public._portee_restreinte(p_user) r on r.org_id = ta.org_id and r.scope = 'team'
  where ta.user_id = p_user;
$$;

-- Personnes dont je vois les fiches : moi, et mes coéquipiers (portée team).
create or replace function public._portee_personnes(p_user uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select p_user
  union
  select m.user_id from public.memberships m
  where m.status = 'active' and m.team_id in (select public._portee_equipes(p_user))
  union
  select ta.user_id from public.team_assignments ta
  where ta.team_id in (select public._portee_equipes(p_user));
$$;

-- Jobs visibles dans mes bureaux restreints.
create or replace function public._portee_jobs(p_user uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  with p as (select public._portee_personnes(p_user) as u),
       e as (select public._portee_equipes(p_user) as t),
       b as (select org_id from public._portee_restreinte(p_user))
  select j.id from public.jobs j
  where j.org_id in (select org_id from b)
    and (j.created_by in (select u from p) or j.salesperson_id in (select u from p)
         or j.assigned_user_id in (select u from p) or j.team_id in (select t from e))
  union
  select se.job_id from public.schedule_events se
  where se.org_id in (select org_id from b) and se.job_id is not null
    and (se.assigned_user in (select u from p) or se.team_id in (select t from e));
$$;

-- Clients visibles dans mes bureaux restreints : les miens, et ceux de mes travaux.
create or replace function public._portee_clients(p_user uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  with p as (select public._portee_personnes(p_user) as u),
       b as (select org_id from public._portee_restreinte(p_user))
  select c.id from public.clients c
  where c.org_id in (select org_id from b)
    and (c.created_by in (select u from p) or c.assigned_to in (select u from p))
  union
  select j.client_id from public.jobs j
  where j.client_id is not null and j.id in (select public._portee_jobs(p_user))
  union
  select q.client_id from public.quotes q
  where q.org_id in (select org_id from b) and q.client_id is not null
    and (q.created_by in (select u from p) or q.salesperson_id in (select u from p))
  union
  select i.client_id from public.invoices i
  where i.org_id in (select org_id from b) and i.client_id is not null
    and (i.created_by in (select u from p) or i.salesperson_id in (select u from p));
$$;

revoke all on function public._portee_bureaux_complets(uuid) from public, anon, authenticated;
revoke all on function public._portee_restreinte(uuid) from public, anon, authenticated;
revoke all on function public._portee_equipes(uuid) from public, anon, authenticated;
revoke all on function public._portee_personnes(uuid) from public, anon, authenticated;
revoke all on function public._portee_jobs(uuid) from public, anon, authenticated;
revoke all on function public._portee_clients(uuid) from public, anon, authenticated;
grant execute on function public._portee_bureaux_complets(uuid) to service_role;
grant execute on function public._portee_restreinte(uuid) to service_role;
grant execute on function public._portee_equipes(uuid) to service_role;
grant execute on function public._portee_personnes(uuid) to service_role;
grant execute on function public._portee_jobs(uuid) to service_role;
grant execute on function public._portee_clients(uuid) to service_role;

-- Enveloppes pour les policies : toujours la personne connectée, jamais un autre.
create or replace function public.portee_bureaux_complets() returns setof uuid
  language sql stable security definer set search_path = public as $$ select public._portee_bureaux_complets(auth.uid()) $$;
create or replace function public.portee_equipes() returns setof uuid
  language sql stable security definer set search_path = public as $$ select public._portee_equipes(auth.uid()) $$;
create or replace function public.portee_personnes() returns setof uuid
  language sql stable security definer set search_path = public as $$ select public._portee_personnes(auth.uid()) $$;
create or replace function public.portee_jobs() returns setof uuid
  language sql stable security definer set search_path = public as $$ select public._portee_jobs(auth.uid()) $$;
create or replace function public.portee_clients() returns setof uuid
  language sql stable security definer set search_path = public as $$ select public._portee_clients(auth.uid()) $$;

revoke all on function public.portee_bureaux_complets() from public, anon;
revoke all on function public.portee_equipes() from public, anon;
revoke all on function public.portee_personnes() from public, anon;
revoke all on function public.portee_jobs() from public, anon;
revoke all on function public.portee_clients() from public, anon;
grant execute on function public.portee_bureaux_complets() to authenticated, service_role;
grant execute on function public.portee_equipes() to authenticated, service_role;
grant execute on function public.portee_personnes() to authenticated, service_role;
grant execute on function public.portee_jobs() to authenticated, service_role;
grant execute on function public.portee_clients() to authenticated, service_role;

-- ─── 3. Policies RESTRICTIVE ───────────────────────────────────────────────
drop policy if exists portee_membre on public.clients;
create policy portee_membre on public.clients as restrictive for all to authenticated
  using (org_id in (select public.portee_bureaux_complets())
         or created_by in (select public.portee_personnes()) or assigned_to in (select public.portee_personnes())
         or id in (select public.portee_clients()))
  with check (true);

drop policy if exists portee_membre on public.jobs;
create policy portee_membre on public.jobs as restrictive for all to authenticated
  using (org_id in (select public.portee_bureaux_complets())
         or created_by in (select public.portee_personnes()) or salesperson_id in (select public.portee_personnes())
         or assigned_user_id in (select public.portee_personnes()) or team_id in (select public.portee_equipes())
         or id in (select public.portee_jobs()))
  with check (true);

drop policy if exists portee_membre on public.quotes;
create policy portee_membre on public.quotes as restrictive for all to authenticated
  using (org_id in (select public.portee_bureaux_complets())
         or created_by in (select public.portee_personnes()) or salesperson_id in (select public.portee_personnes())
         or client_id in (select public.portee_clients()) or job_id in (select public.portee_jobs()))
  with check (true);

drop policy if exists portee_membre on public.invoices;
create policy portee_membre on public.invoices as restrictive for all to authenticated
  using (org_id in (select public.portee_bureaux_complets())
         or created_by in (select public.portee_personnes()) or salesperson_id in (select public.portee_personnes())
         or client_id in (select public.portee_clients()) or job_id in (select public.portee_jobs()))
  with check (true);

drop policy if exists portee_membre on public.tasks;
create policy portee_membre on public.tasks as restrictive for all to authenticated
  using (org_id in (select public.portee_bureaux_complets())
         or created_by in (select public.portee_personnes()) or assignee_user_id in (select public.portee_personnes())
         or team_id in (select public.portee_equipes()) or job_id in (select public.portee_jobs()))
  with check (true);

drop policy if exists portee_membre on public.schedule_events;
create policy portee_membre on public.schedule_events as restrictive for all to authenticated
  using (org_id in (select public.portee_bureaux_complets())
         or created_by in (select public.portee_personnes()) or assigned_user in (select public.portee_personnes())
         or team_id in (select public.portee_equipes()) or job_id in (select public.portee_jobs()))
  with check (true);

drop policy if exists portee_membre on public.conversations;
create policy portee_membre on public.conversations as restrictive for all to authenticated
  using (org_id in (select public.portee_bureaux_complets())
         or assigned_to in (select public.portee_personnes()) or client_id in (select public.portee_clients()))
  with check (true);

-- Messages : ceux des conversations que je vois (la RLS de conversations s'applique dans la sous-requête).
drop policy if exists portee_membre on public.messages;
create policy portee_membre on public.messages as restrictive for all to authenticated
  using (org_id in (select public.portee_bureaux_complets())
         or conversation_id in (select c.id from public.conversations c))
  with check (true);

comment on function public._portee_clients(uuid) is
  'Clients visibles pour p_user dans ses bureaux à portée restreinte (self/assigned/team) : les siens, et ceux de ses jobs/soumissions/factures. Serveur seulement.';
