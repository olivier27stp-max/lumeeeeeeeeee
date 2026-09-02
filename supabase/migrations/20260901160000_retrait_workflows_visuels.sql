-- ============================================================================
-- Retrait des 4 tables du constructeur de workflows visuels
-- ============================================================================
-- CONSTAT (2026-09-01, npm run qa:audit-base -- --prod)
--   workflow_nodes  : 0 ligne
--   workflow_edges  : 0 ligne
--   workflow_runs   : 0 ligne
--   workflow_logs   : 0 ligne
-- Vides dans les DEUX environnements, jamais citées par le code applicatif,
-- jamais citées par une fonction ni une vue, et parentes d'aucune table hors
-- de leur propre famille.
--
-- POURQUOI ELLES EXISTENT ENCORE
-- Le constructeur visuel de workflows a été retiré de l'application — voir le
-- commentaire de `server/lib/automationEngine.ts` qui documente ce retrait. Les
-- automatisations passent désormais par `automation_rules` (1 820 règles en
-- production, dont 1 596 actives). Ces 4 tables sont le squelette de la
-- fonctionnalité disparue.
--
-- CE QUE CETTE MIGRATION NE TOUCHE PAS
-- La table `workflows` elle-même est CONSERVÉE : elle contient 31 lignes en
-- production. Plus aucun code ne les lit, mais ce sont des données réelles —
-- leur sort est une décision distincte, à prendre en connaissance de cause,
-- pas un effet de bord d'un nettoyage de tables vides.
--
-- ORDRE DE SUPPRESSION
-- Des dépendances existent à l'intérieur de la famille :
--     workflow_edges → workflow_nodes
--     workflow_logs  → workflow_nodes, workflow_runs
-- On retire donc les enfants avant les parents. Pas de `cascade` : si une
-- dépendance imprévue apparaissait, la migration doit ÉCHOUER plutôt que
-- d'emporter silencieusement autre chose.
--
-- POUR REVENIR EN ARRIÈRE
-- La structure complète est conservée en commentaire à la fin de ce fichier.
--
-- Idempotent : `if exists` partout.
-- ============================================================================

-- Garde-fou : on ne supprime que si les tables sont bien vides. Si des données
-- sont apparues entre l'audit et l'application, on s'arrête.
do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array['workflow_nodes', 'workflow_edges', 'workflow_runs', 'workflow_logs']
  loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('select count(*) from public.%I', t) into n;
    if n > 0 then
      raise exception 'REFUS : public.% contient % ligne(s). Migration écrite pour des tables VIDES.', t, n;
    end if;
  end loop;
  raise notice 'Vérifié : les 4 tables sont vides.';
end $$;

-- Enfants d'abord, parents ensuite.
drop table if exists public.workflow_logs;
drop table if exists public.workflow_edges;
drop table if exists public.workflow_runs;
drop table if exists public.workflow_nodes;

do $$
declare
  restant int;
begin
  select count(*) into restant
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and c.relname in ('workflow_nodes', 'workflow_edges', 'workflow_runs', 'workflow_logs');

  if restant > 0 then
    raise exception 'Il reste % table(s) de workflow visuel.', restant;
  end if;
  raise notice '4 tables du constructeur visuel retirées.';
end $$;

-- ============================================================================
-- STRUCTURE RETIRÉE — extraite de la PRODUCTION le 2026-09-01, telle quelle
-- ============================================================================
-- create table public.workflow_nodes (
--   id uuid default gen_random_uuid() not null,
--   workflow_id uuid not null,
--   node_type text not null,
--   action_type text,
--   label text,
--   config jsonb default '{}'::jsonb not null,
--   position_x double precision default 0 not null,
--   position_y double precision default 0 not null,
--   created_at timestamp with time zone default now() not null
--   constraint workflow_nodes_node_type_check CHECK ((node_type = ANY (ARRAY['trigger'::text, 'condition'::text, 'action'::text, 'delay'::text])))
--   constraint workflow_nodes_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
--   constraint workflow_nodes_pkey PRIMARY KEY (id)
-- );
-- create table public.workflow_edges (
--   id uuid default gen_random_uuid() not null,
--   workflow_id uuid not null,
--   source_id uuid not null,
--   target_id uuid not null,
--   source_handle text,
--   target_handle text,
--   label text,
--   created_at timestamp with time zone default now() not null
--   constraint workflow_edges_source_id_fkey FOREIGN KEY (source_id) REFERENCES workflow_nodes(id) ON DELETE CASCADE
--   constraint workflow_edges_target_id_fkey FOREIGN KEY (target_id) REFERENCES workflow_nodes(id) ON DELETE CASCADE
--   constraint workflow_edges_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
--   constraint workflow_edges_pkey PRIMARY KEY (id)
-- );
-- create table public.workflow_runs (
--   id uuid default gen_random_uuid() not null,
--   workflow_id uuid not null,
--   org_id uuid not null,
--   status text default 'running'::text not null,
--   trigger_data jsonb,
--   started_at timestamp with time zone default now() not null,
--   completed_at timestamp with time zone,
--   duration_ms integer,
--   error_msg text,
--   nodes_executed integer default 0 not null
--   constraint workflow_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])))
--   constraint workflow_runs_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
--   constraint workflow_runs_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
--   constraint workflow_runs_workflow_id_same_org FOREIGN KEY (org_id, workflow_id) REFERENCES workflows(org_id, id)
--   constraint workflow_runs_pkey PRIMARY KEY (id)
-- );
-- create table public.workflow_logs (
--   id uuid default gen_random_uuid() not null,
--   run_id uuid not null,
--   node_id uuid,
--   level text default 'info'::text not null,
--   message text not null,
--   data jsonb,
--   created_at timestamp with time zone default now() not null
--   constraint workflow_logs_level_check CHECK ((level = ANY (ARRAY['info'::text, 'warn'::text, 'error'::text, 'debug'::text])))
--   constraint workflow_logs_node_id_fkey FOREIGN KEY (node_id) REFERENCES workflow_nodes(id) ON DELETE SET NULL
--   constraint workflow_logs_run_id_fkey FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
--   constraint workflow_logs_pkey PRIMARY KEY (id)
-- );
-- ==========================================================================
