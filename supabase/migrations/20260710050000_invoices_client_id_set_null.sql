-- =============================================================================
-- Migration — invoices.client_id : conserver les factures à la suppression du client
-- =============================================================================
-- AUJOURD'HUI : invoices.client_id -> clients = ON DELETE CASCADE + client_id NOT NULL.
-- => supprimer un client EFFACE ses factures = risque légal (conservation 6-7 ans).
--
-- CIBLE : passer en ON DELETE SET NULL (la facture survit, détachée du client),
-- avec le nom/email du client préservés via les colonnes snapshot.
--
-- ⚠️ DÉPENDANCE STRICTE : la migration 20260710000000 (snapshots) doit être passée
--    ET le code applicatif doit remplir les snapshots à l'émission. Cette migration
--    vérifie que les snapshots existent et sont remplis avant de continuer.
-- =============================================================================

BEGIN;

-- Garde-fou : refuser de tourner si les colonnes snapshot n'existent pas
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='invoices' AND column_name='client_name_snapshot'
  ) THEN
    RAISE EXCEPTION 'PRÉREQUIS MANQUANT: invoices.client_name_snapshot absent. Appliquer 20260710000000 d''abord.';
  END IF;
END $$;

-- Garde-fou : refuser si des factures rattachées à un client n'ont pas de snapshot
DO $$
DECLARE manquants int;
BEGIN
  SELECT count(*) INTO manquants
  FROM public.invoices
  WHERE client_id IS NOT NULL AND client_name_snapshot IS NULL;
  IF manquants > 0 THEN
    RAISE EXCEPTION 'PRÉREQUIS MANQUANT: % factures sans snapshot. Backfill requis avant SET NULL.', manquants;
  END IF;
END $$;

-- 1) Rendre client_id nullable (requis pour SET NULL)
ALTER TABLE public.invoices ALTER COLUMN client_id DROP NOT NULL;

-- 2) Remplacer la FK CASCADE par SET NULL
ALTER TABLE public.invoices DROP CONSTRAINT invoices_client_id_fkey;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;

COMMIT;

-- =============================================================================
-- Résultat : supprimer un client conserve désormais ses factures (client_id -> NULL),
-- le nom/email restent lisibles via les snapshots. Conforme fiscal + Loi 25.
--
-- DOWN : remettre NOT NULL n'est PAS recommandé (des factures peuvent déjà être
-- détachées). Pour rollback de la règle seule :
--   ALTER TABLE public.invoices DROP CONSTRAINT invoices_client_id_fkey;
--   ALTER TABLE public.invoices ADD CONSTRAINT invoices_client_id_fkey
--     FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;
-- =============================================================================
