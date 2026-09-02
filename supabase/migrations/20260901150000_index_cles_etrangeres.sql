-- ============================================================================
-- Index sur les clés étrangères qui n'en avaient pas
-- ============================================================================
-- CONSTAT (2026-09-01, npm run qa:audit-base -- --prod)
-- 11 clés étrangères sans index, à l'identique sur les deux environnements.
--
-- POURQUOI C'EST UN PROBLÈME
-- PostgreSQL n'indexe PAS automatiquement le côté enfant d'une clé étrangère.
-- Deux conséquences, invisibles tant que les tables sont petites :
--
--   1. Supprimer (ou mettre à jour la clé d')une ligne PARENTE force un
--      balayage complet de la table enfant pour vérifier la contrainte.
--      Supprimer un client parcourt donc tout `client_payment_profiles`.
--   2. Toute jointure enfant → parent se fait sans index.
--
-- Le coût grandit avec les données : c'est précisément le genre de défaut qui
-- ne se manifeste qu'en production, avec de vrais clients.
--
-- CE QUE ÇA NE FAIT PAS
-- Un index n'enlève rien, ne modifie aucune donnée, ne change aucun
-- comportement applicatif. Le seul coût est un léger surcroît à l'écriture et
-- un peu d'espace disque — négligeable ici, les tables concernées étant
-- petites ou vides.
--
-- `if not exists` partout : ré-exécutable sans effet de bord.
-- ============================================================================

-- ── Tables actives ──────────────────────────────────────────────────
-- Celles-ci portent de vraies données : ce sont elles qui gagnent le plus.

create index if not exists idx_fk_client_payment_profiles_client
  on public.client_payment_profiles (client_id);

create index if not exists idx_fk_provisioning_events_subscription
  on public.provisioning_events (subscription_id);

create index if not exists idx_fk_team_schedule_audit_team
  on public.team_schedule_audit (team_id);

create index if not exists idx_fk_field_pin_entity_links_house
  on public.field_pin_entity_links (house_id);

-- ── Tables du terrain, aujourd'hui vides ────────────────────────────
-- Indexées maintenant : le jour où la fonctionnalité démarre, le défaut
-- n'existe pas.

create index if not exists idx_fk_job_materials_org
  on public.job_materials (org_id);

create index if not exists idx_fk_job_time_logs_org
  on public.job_time_logs (org_id);

-- ── Module de migration de données ──────────────────────────────────
-- Ce module importe des CRM entiers : ses tables grossiront vite et par
-- lots. C'est exactement le cas où un index manquant se paie cher.

create index if not exists idx_fk_migration_field_mappings_file
  on public.migration_field_mappings (file_id);

create index if not exists idx_fk_migration_file_columns_migration
  on public.migration_file_columns (migration_id);

create index if not exists idx_fk_migration_import_records_staging
  on public.migration_import_records (staging_record_id);

create index if not exists idx_fk_migration_issues_column
  on public.migration_issues (column_id);

create index if not exists idx_fk_migration_issues_staging
  on public.migration_issues (staging_record_id);

-- ── Vérification ────────────────────────────────────────────────────
-- Après cette migration, plus aucune clé étrangère à colonne unique ne doit
-- rester sans index.
do $$
declare
  restant int;
begin
  select count(*) into restant
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public'
     and c.contype = 'f'
     and array_length(c.conkey, 1) = 1
     and not exists (
       select 1 from pg_index i
        where i.indrelid = c.conrelid
          and i.indkey[0] = c.conkey[1]
     );

  if restant > 0 then
    raise warning 'Il reste % clé(s) étrangère(s) sans index.', restant;
  else
    raise notice 'Toutes les clés étrangères à colonne unique sont indexées.';
  end if;
end $$;
