-- ═══════════════════════════════════════════════════════════════
-- Arrêt des purges automatiques de deals (décision Q3, Rafba 2026-09-23)
--
-- Deux tâches planifiées effacent aujourd'hui l'historique de ventes :
--   · `cleanup-expired-pipeline-deals`     — TOUTES LES HEURES : soft-delete
--      les deals gagnés après 2 JOURS et les perdus après 15 jours.
--   · `cleanup_lost_pipeline_deals_daily`  — 03:00, même logique sur les perdus.
--
-- Conséquence mesurée pendant l'audit : au-delà de 48 h, un deal gagné
-- n'existe plus pour les statistiques. La tendance sur 12 semaines, les
-- cohortes du formulaire, la durée du cycle et le taux de closing seraient
-- tous faux — ou vides. C'est incompatible avec l'onglet Statistiques.
--
-- Décision : on ARRÊTE la purge. Gagnés et perdus sont conservés
-- indéfiniment (c'est l'historique de ventes de l'entreprise). Le board
-- reste propre par FILTRAGE D'AFFICHAGE, jamais par effacement — la vue
-- `pipeline_deals_visible` masque déjà les fermés anciens, et le nouveau
-- board fera de même côté requête.
--
-- Les fonctions ne sont PAS supprimées : seules les planifications le sont.
-- On peut donc les rejouer à la main si un ménage ponctuel est voulu, et
-- l'ancien board D2D garde son comportement d'affichage jusqu'à la Phase 3.
--
-- ROLLBACK : replanifier avec
--   select cron.schedule('cleanup-expired-pipeline-deals', '0 * * * *',
--                        'select public.cleanup_expired_pipeline_deals()');
--   select cron.schedule('cleanup_lost_pipeline_deals_daily', '0 3 * * *',
--                        'select public.cleanup_lost_pipeline_deals()');
-- ═══════════════════════════════════════════════════════════════

begin;

do $$
begin
  begin
    perform cron.unschedule('cleanup-expired-pipeline-deals');
  exception when others then
    raise notice 'cleanup-expired-pipeline-deals : déjà absente';
  end;

  begin
    perform cron.unschedule('cleanup_lost_pipeline_deals_daily');
  exception when others then
    raise notice 'cleanup_lost_pipeline_deals_daily : déjà absente';
  end;
exception when others then
  raise notice 'pg_cron indisponible — aucune planification à retirer';
end
$$;

comment on function public.cleanup_expired_pipeline_deals() is
  'DÉPLANIFIÉE le 2026-09-23 (décision Q3) : la purge des gagnés après 2 jours rendait impossible toute statistique historique. Conservée pour un ménage manuel éventuel.';

comment on function public.cleanup_lost_pipeline_deals() is
  'DÉPLANIFIÉE le 2026-09-23 (décision Q3). Conservée pour un ménage manuel éventuel.';

commit;
