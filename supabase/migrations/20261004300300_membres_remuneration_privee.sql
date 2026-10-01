-- Confidentialité des membres (STATS_AUDIT.md, bug S-3).
--
-- La RLS de team_members / memberships est par LIGNE : tout membre de l'entreprise lit les fiches
-- de ses collègues — y compris leur taux horaire (hourly_rate_cents, labour_cost_hourly) et leur
-- date de naissance (birth_date). Un technicien pouvait donc lire le salaire de tous les autres.
--
-- Correction par COLONNE : authenticated/anon perdent SELECT sur ces trois colonnes et gardent
-- toutes les autres. Les écrans qui en ont besoin passent par membres_remuneration(p_org) :
--   · sa propre fiche : toujours ;
--   · celles des autres : team.update (gérer l'équipe), financial.view_margins (rentabilité) ou
--     financial.view_reports (la paie — même clé que l'outil set_hourly_rate de Lumi) ;
--   · la date de naissance d'un autre : team.update seulement.
-- L'écriture (UPDATE/INSERT) n'est pas touchée : elle reste gouvernée par la RLS existante.
--
-- ⚠️ Conséquence durable : une colonne AJOUTÉE plus tard à ces deux tables n'est pas lisible par
-- authenticated tant qu'on ne lui fait pas « grant select (col) ». Un select('*') côté client sur
-- ces tables échoue (42501) — toujours nommer les colonnes. check:db-coherence le vérifie.
begin;

do $$
declare
  t text;
  cols text;
begin
  foreach t in array array['team_members', 'memberships'] loop
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
      from pg_attribute a
     where a.attrelid = format('public.%I', t)::regclass
       and a.attnum > 0 and not a.attisdropped
       and a.attname not in ('hourly_rate_cents', 'labour_cost_hourly', 'birth_date');
    execute format('revoke select on public.%I from anon, authenticated', t);
    execute format('grant select (%s) on public.%I to anon, authenticated', cols, t);
  end loop;
end $$;

-- v_org_members (security_invoker, lue par aucun code) projetait memberships.hourly_rate_cents et
-- labour_cost_hourly : avec les grants par colonne, TOUTE lecture de la vue échouait (42501), même
-- un count(*). Mêmes colonnes, mêmes types, valeurs NULL — grants et dépendances inchangés.
create or replace view public.v_org_members with (security_invoker = true) as
 SELECT m.org_id,
    m.user_id,
    COALESCE(NULLIF(btrim(p.full_name), ''::text), NULLIF(btrim(m.full_name), ''::text)) AS full_name,
    COALESCE(p.avatar_url, m.avatar_url) AS avatar_url,
    m.role,
    m.status,
    m.scope,
    m.team_id,
    m.language,
    m.show_on_leaderboard,
    m.permissions,
    m.permissions_custom,
    NULL::integer AS hourly_rate_cents,
    NULL::numeric(10,2) AS labour_cost_hourly,
    m.compensation_mode,
    m.working_hours,
    m.communication_preferences,
    m.suspended_at,
    m.mfa_required,
    m.password_reset_required,
    m.last_login,
    m.created_at,
    m.updated_at
   FROM (memberships m
     LEFT JOIN profiles p ON ((p.id = m.user_id)));

create or replace function public.membres_remuneration(p_org uuid)
returns table (
  team_member_id uuid,
  user_id uuid,
  hourly_rate_cents integer,
  labour_cost_hourly numeric,
  birth_date date
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with droits as (
    select auth.uid() as uid,
           has_org_membership(auth.uid(), p_org) as membre,
           member_has_permission(auth.uid(), p_org, 'team.update') as equipe,
           member_has_permission(auth.uid(), p_org, 'financial.view_margins')
             or member_has_permission(auth.uid(), p_org, 'financial.view_reports') as marges
  )
  select tm.id,
         tm.user_id,
         tm.hourly_rate_cents,
         tm.labour_cost_hourly,
         case when tm.user_id = d.uid or d.equipe then tm.birth_date end
    from public.team_members tm
    cross join droits d
   where tm.org_id = p_org
     and d.uid is not null
     and d.membre
     and (tm.user_id = d.uid or d.equipe or d.marges);
$$;

comment on function public.membres_remuneration(uuid) is
  'Taux horaire et date de naissance des membres : sa propre fiche, ou toutes avec team.update / financial.view_margins / financial.view_reports (naissance : team.update). Seul accès client à ces colonnes (grants par colonne).';

revoke all on function public.membres_remuneration(uuid) from public, anon;
grant execute on function public.membres_remuneration(uuid) to authenticated, service_role;

commit;
