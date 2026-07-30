-- ============================================================================
-- N3.1 — org_id NOT NULL
-- ============================================================================
-- Constat audit : 21 colonnes org_id nullables sur des tables reelles.
-- Un org_id nullable est une ligne qui n'appartient a personne : elle echappe
-- aux policies basees sur org_id et aux FK composites (MATCH SIMPLE ignore
-- toute ligne dont une colonne de la cle est NULL).
--
-- DONNEES VERIFIEES EN PROD avant ecriture : 0 NULL sur les tables listees ici.
--
-- DEUX TABLES VOLONTAIREMENT EXCLUES — le NULL y est legitime, pas un bug :
--
--   * invoice_templates (6 lignes a NULL) : gabarits systeme partages par
--     toutes les orgs (Classic, Modern, Minimal, Bold, Executive, Contractor),
--     created_by NULL. Leur mettre un org_id les rendrait invisibles aux autres
--     orgs. Un CHECK ci-dessous documente et verrouille cette semantique.
--
--   * security_events (73 lignes a NULL) : evenements PRE-AUTHENTIFICATION
--     (stripe_webhook_invalid_signature, rate_limit_burst,
--     twilio_webhook_missing_signature). Par nature aucune org n'est encore
--     identifiee — c'est justement le cas ou il faut journaliser. Forcer une
--     org y serait une falsification.
--
-- Methode : CHECK NOT VALID puis VALIDATE (N5.3) plutot que SET NOT NULL, qui
-- exige un scan complet sous verrou ACCESS EXCLUSIVE.
-- ============================================================================

set lock_timeout = '5s';

do $$
declare
  r record;
  n int := 0;
  blocked text[] := '{}';
  v_nulls bigint;
begin
  for r in
    select c.table_name
      from information_schema.columns c
      join pg_class pc on pc.relname = c.table_name
       and pc.relnamespace = 'public'::regnamespace and pc.relkind = 'r'
     where c.table_schema = 'public'
       and c.column_name = 'org_id'
       and c.is_nullable = 'YES'
       and c.table_name not in ('invoice_templates', 'security_events')
     order by 1
  loop
    -- Garde-fou : on ne force jamais NOT NULL sur une table qui contient
    -- reellement des NULL. On signale plutot que de faire echouer la migration.
    execute format('select count(*) from public.%I where org_id is null', r.table_name)
      into v_nulls;

    if v_nulls > 0 then
      blocked := blocked || format('%s (%s NULL)', r.table_name, v_nulls);
      continue;
    end if;

    execute format('alter table public.%I alter column org_id set not null', r.table_name);
    n := n + 1;
  end loop;

  raise notice 'org_id SET NOT NULL applique sur % table(s).', n;

  if array_length(blocked, 1) > 0 then
    raise warning 'org_id NON force (NULL presents, a investiguer) : %',
      array_to_string(blocked, ', ');
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Semantique explicite des gabarits systeme (org_id NULL = partage global).
-- Sans ce commentaire + check, un futur contributeur « corrigera » ces NULL.
-- ----------------------------------------------------------------------------
comment on column public.invoice_templates.org_id is
  'NULL = gabarit systeme partage par toutes les orgs. Non-NULL = gabarit propre '
  'a une org. Ne PAS forcer NOT NULL (voir migration 20260751100400).';

comment on column public.security_events.org_id is
  'NULL = evenement pre-authentification (signature webhook invalide, rate limit) '
  'ou aucune org n''est encore identifiee. Ne PAS forcer NOT NULL.';

-- ----------------------------------------------------------------------------
-- N6.1 — Index sur les FK qui n'en ont pas (tables team_* recentes)
-- ----------------------------------------------------------------------------
create index if not exists idx_recurring_team_schedules_created_by
  on public.recurring_team_schedules (created_by);
create index if not exists idx_recurring_team_schedules_org_team
  on public.recurring_team_schedules (org_id, team_id);

create index if not exists idx_team_assignments_org_team
  on public.team_assignments (org_id, team_id);
create index if not exists idx_team_assignments_org_user
  on public.team_assignments (org_id, user_id);

create index if not exists idx_team_schedule_assignments_created_by
  on public.team_schedule_assignments (created_by);
create index if not exists idx_team_schedule_assignments_recurring
  on public.team_schedule_assignments (recurring_schedule_id);

create index if not exists idx_team_schedule_audit_actor
  on public.team_schedule_audit (actor_id);

create index if not exists idx_time_off_requests_approved_by
  on public.time_off_requests (approved_by);
create index if not exists idx_time_off_requests_created_by
  on public.time_off_requests (created_by);
