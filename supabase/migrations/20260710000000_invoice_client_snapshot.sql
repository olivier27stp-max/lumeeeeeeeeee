-- =============================================================================
-- Migration 1/N — Snapshot client sur les factures (PRÉREQUIS Décision 4)
-- =============================================================================
-- Objectif : permettre de DÉTACHER un client de ses factures (ON DELETE SET NULL)
-- sans rendre la facture anonyme, et sans violer le NOT NULL actuel.
--
-- Cette migration est PUREMENT ADDITIVE : aucune suppression, aucune FK modifiée.
-- Elle prépare le terrain. La FK invoices.client_id sera modifiée dans une
-- migration ULTÉRIEURE, après backfill confirmé + ajustement du code applicatif.
--
-- Réversibilité : voir bloc DOWN en commentaire en bas.
-- État au moment de l'écriture : 12 factures, toutes avec client existant, 0 orphelin.
-- =============================================================================

BEGIN;

-- 1) Colonnes snapshot (figées à l'émission de la facture, indépendantes du client)
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS client_name_snapshot  text,
  ADD COLUMN IF NOT EXISTS client_email_snapshot text;

COMMENT ON COLUMN public.invoices.client_name_snapshot  IS
  'Nom du client figé à l''émission. Survit à la suppression du client (conservation fiscale + Loi 25). Rempli par l''app à la création.';
COMMENT ON COLUMN public.invoices.client_email_snapshot IS
  'Courriel du client figé à l''émission. Survit à la suppression du client.';

-- 2) Backfill des factures existantes depuis clients
--    Nom d'affichage = company si display_as_company, sinon "first last".
UPDATE public.invoices i
SET
  client_name_snapshot = COALESCE(
    NULLIF(
      CASE
        WHEN c.display_as_company AND c.company IS NOT NULL AND c.company <> '' THEN c.company
        ELSE NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), '')
      END, ''),
    c.company,
    'Client supprimé'
  ),
  client_email_snapshot = c.email
FROM public.clients c
WHERE c.id = i.client_id
  AND i.client_name_snapshot IS NULL;  -- idempotent : ne réécrit pas si déjà rempli

COMMIT;

-- =============================================================================
-- VÉRIFICATION post-migration (à lancer manuellement, lecture seule) :
--   SELECT count(*) AS total,
--          count(*) FILTER (WHERE client_name_snapshot IS NOT NULL) AS avec_snapshot
--   FROM public.invoices;
--   -> attendu : total = avec_snapshot (toutes remplies)
-- =============================================================================

-- =============================================================================
-- DOWN (rollback manuel si besoin) :
--   ALTER TABLE public.invoices
--     DROP COLUMN IF EXISTS client_name_snapshot,
--     DROP COLUMN IF EXISTS client_email_snapshot;
-- =============================================================================
