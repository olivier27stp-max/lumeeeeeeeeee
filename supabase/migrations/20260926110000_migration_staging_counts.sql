-- Compteurs de staging par entité et statut pour la fiche d'une migration
-- (console Creator Space › Migrations et portail client).
--
-- Avant : les routes rapatriaient toutes les lignes de migration_staging_records
-- pour compter en Node → plafond PostgREST de 1 000 lignes (compteurs FAUX dès
-- qu'une migration dépasse 1 000 lignes, sans erreur) et fiche lente sous
-- charge (~10 s constatées le 2026-09-23 pendant un import test).
--
-- Le GROUP BY se fait ici, sur l'index idx_migration_staging_migration
-- (migration_id, entity_type, status) posé par 20260820000000. Le code garde un
-- repli paginé exact tant que cette fonction n'est pas appliquée
-- (server/lib/migration/compteurs.ts).
create or replace function public.migration_staging_counts(p_migration_id uuid)
returns table (entity_type text, status text, n bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.entity_type, r.status, count(*)::bigint as n
  from public.migration_staging_records r
  where r.migration_id = p_migration_id
  group by r.entity_type, r.status
$$;

comment on function public.migration_staging_counts(uuid) is
  'Lignes de staging d''une migration par entité et statut (fiche console + portail). Service role seulement.';

revoke all on function public.migration_staging_counts(uuid) from public, anon, authenticated;
grant execute on function public.migration_staging_counts(uuid) to service_role;
