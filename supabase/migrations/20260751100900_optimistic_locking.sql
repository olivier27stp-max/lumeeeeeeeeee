-- ============================================================================
-- N4.2 — Verrouillage optimiste sur les entites editees a plusieurs
-- ============================================================================
-- Constat audit : `version` existe sur invoices, jobs, quotes, workflows —
-- rien sur les entites d'horaire, pourtant les plus concurrentes d'un CRM de
-- terrain (deux repartiteurs sur le meme planning).
--
-- Sans verrou optimiste, deux sauvegardes a 10 s d'intervalle : la seconde
-- ecrase la premiere EN SILENCE. C'est le bug n°1 des CRM et il ne ressemble
-- jamais a un bug — l'utilisateur croit avoir mal clique.
--
-- Ajout de `version integer not null default 1` + trigger d'increment sur les
-- entites reellement editees a plusieurs.
--
-- COTE APPLICATIF — la colonne seule ne protege rien. L'ecriture doit devenir :
--   update schedule_events
--      set ..., version = version + 1
--    where id = $1 and org_id = $2 and version = $3;
--   -- 0 ligne affectee => conflit : recharger et presenter le diff.
-- Le trigger ci-dessous garantit que version progresse meme si un chemin
-- d'ecriture oublie de le faire, mais il ne peut pas detecter le conflit a la
-- place de la clause `where version = $3`.
-- ============================================================================

set lock_timeout = '5s';

-- ATTENTION — DECOUVERTE A L'APPLICATION :
-- public.bump_row_version() existait DEJA et est utilisee par le trigger
-- invoices_bump_version. Elle est MEILLEURE que ce que cette migration
-- proposait initialement : elle ignore les UPDATE qui ne changent rien
-- (`if new is distinct from old`), donc un UPDATE a blanc n'invalide pas la
-- version detenue par un autre utilisateur.
--
-- On REUTILISE donc la fonction existante au lieu de la remplacer. Creer une
-- deuxieme fonction au comportement different aurait ete exactement le defaut
-- que cet audit denonce ailleurs : deux sources de verite pour une meme regle.
do $$
begin
  if to_regprocedure('public.bump_row_version()') is null then
    raise exception
      'public.bump_row_version() est introuvable : cette migration en depend.';
  end if;
end $$;

comment on function public.bump_row_version() is
  'N4.2 — garantit la progression de `version` et ignore les UPDATE sans '
  'changement. Ne remplace PAS la clause `where version = $n` cote applicatif, '
  'qui seule detecte le conflit.';

do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select unnest(array[
      'schedule_events',            -- planning : le plus concurrent
      'pipeline_deals',             -- glisser-deposer du pipeline
      'team_schedule_assignments',  -- affectations d'equipe
      'team_date_slots',
      'recurring_team_schedules',
      'clients',
      'properties',
      'tasks',
      'service_contracts',
      'job_line_items',
      'invoice_items'
    ]) as tbl
  loop
    -- Table absente (branche non deployee) : on ignore proprement.
    if to_regclass('public.' || r.tbl) is null then
      continue;
    end if;

    if not exists (
      select 1 from pg_attribute
       where attrelid = ('public.' || r.tbl)::regclass
         and attname = 'version' and not attisdropped
    ) then
      execute format(
        'alter table public.%I add column version integer not null default 1', r.tbl);
      n := n + 1;
    end if;

    -- Idempotent : on ne pose le trigger que s'il n'existe pas deja sous un
    -- autre nom (ex. invoices_bump_version, pose par une migration anterieure).
    if not exists (
      select 1 from pg_trigger t
       where t.tgrelid = ('public.' || r.tbl)::regclass
         and not t.tgisinternal
         and t.tgfoid = 'public.bump_row_version()'::regprocedure
    ) then
      execute format('drop trigger if exists bump_%s_version on public.%I', left(r.tbl, 40), r.tbl);
      execute format(
        'create trigger bump_%s_version before update on public.%I '
        'for each row execute function public.bump_row_version()',
        left(r.tbl, 40), r.tbl
      );
    end if;
  end loop;

  raise notice 'N4.2 : colonne version ajoutee sur % table(s), triggers poses.', n;
end $$;

-- ----------------------------------------------------------------------------
-- Les tables qui avaient deja `version` n'avaient pas de trigger : la colonne
-- n'etait donc fiable que si CHAQUE chemin d'ecriture pensait a l'incrementer.
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind = 'r'
       and c.relname in ('invoices', 'jobs', 'quotes', 'workflows')
       and exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'version' and not a.attisdropped)
       -- `invoices` a deja invoices_bump_version : on ne le recree pas.
       and not exists (select 1 from pg_trigger t
                        where t.tgrelid = c.oid and not t.tgisinternal
                          and t.tgfoid = 'public.bump_row_version()'::regprocedure)
  loop
    execute format('drop trigger if exists bump_%s_version on public.%I', r.relname, r.relname);
    execute format(
      'create trigger bump_%s_version before update on public.%I '
      'for each row execute function public.bump_row_version()',
      r.relname, r.relname
    );
  end loop;
end $$;
