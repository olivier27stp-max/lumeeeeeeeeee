-- « Facture en retard » : une seule entrée par facture et par palier (J+1, J+3,
-- J+5, J+15, J+30) dans activity_log.
--
-- Le planificateur se souvenait de ce qu'il avait émis en mémoire seulement :
-- chaque redéploiement (des dizaines le 2026-09-25) réécrivait la même entrée
-- sur la même facture. Le code vérifie maintenant activity_log avant
-- d'émettre, mais deux instances peuvent encore vérifier au même instant —
-- seule la base peut garantir l'unicité.
--
-- 1. Retire les doublons existants (garde la plus ancienne de chaque paire
--    facture/palier). activity_log n'a pas de deleted_at : ce sont des lignes
--    de journal répétées, sans autre référence.
-- 2. Pose l'index unique partiel. Le serveur (eventBus) traite le refus
--    23505 comme « déjà émis » et n'envoie pas l'événement.

BEGIN;

DELETE FROM public.activity_log a
USING (
  SELECT id,
         row_number() OVER (
           PARTITION BY entity_id, metadata->>'days_overdue'
           ORDER BY created_at, id
         ) AS rang
  FROM public.activity_log
  WHERE event_type = 'invoice_overdue'
) d
WHERE a.id = d.id
  AND d.rang > 1;

CREATE UNIQUE INDEX IF NOT EXISTS activity_log_invoice_overdue_unique
  ON public.activity_log (entity_id, (metadata->>'days_overdue'))
  WHERE event_type = 'invoice_overdue';

COMMIT;
