-- ════════════════════════════════════════════════════════════════════
-- FIX: sync_lead_stage_from_deal() écrivait toujours 'qualified'
-- ────────────────────────────────────────────────────────────────────
-- La version 20260705000000 (§4c) mappait les ANCIENS slugs ('qualified',
-- 'quote sent', 'contact', 'closed', 'lost') alors que pipeline_deals.stage
-- ne contient que les slugs canoniques depuis 20260703200000
-- (new_prospect, no_response, quote_sent, closed_won, closed_lost).
-- Résultat : le ELSE s'appliquait toujours → chaque changement de stage
-- (drag du kanban inclus) écrivait clients.lead_status = 'qualified',
-- quel que soit le stage cible.
--
-- clients.lead_status utilise le MÊME vocabulaire canonique que les stages
-- (cf. leadsApi toDbStatus, convert-to-job écrit 'closed_won') : on copie
-- donc le slug normalisé tel quel.
--
-- Pas de backfill des lignes corrompues : 'qualified' s'affiche déjà comme
-- « Nouveau prospect » côté UI (STAGE_LABEL_MAP), la valeur s'auto-répare au
-- prochain changement de stage, et un backfill massif redéclencherait
-- trg_clients_sync_field_pin sur tous les leads (risque d'écraser des
-- statuts de pins posés à la main sur la Vente Map).
--
-- ROLLBACK : ré-exécuter la définition §4c de
--   20260705000000_eliminate_leads_table.sql.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sync_lead_stage_from_deal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_stage text;
BEGIN
  IF new.lead_id IS NULL THEN
    RETURN new;
  END IF;

  -- Stage inchangé → ne pas réveiller trg_clients_sync_field_pin pour rien
  IF TG_OP = 'UPDATE' AND new.stage IS NOT DISTINCT FROM old.stage THEN
    RETURN new;
  END IF;

  v_stage := CASE lower(coalesce(new.stage, 'new_prospect'))
    -- Slugs canoniques (seuls admis par pipeline_deals_stage_check)
    WHEN 'new_prospect' THEN 'new_prospect'
    WHEN 'no_response'  THEN 'no_response'
    WHEN 'quote_sent'   THEN 'quote_sent'
    WHEN 'closed_won'   THEN 'closed_won'
    WHEN 'closed_lost'  THEN 'closed_lost'
    -- Slugs legacy (lignes d'avant 20260703200000)
    WHEN 'new'          THEN 'new_prospect'
    WHEN 'follow_up_1'  THEN 'no_response'
    WHEN 'follow_up_2'  THEN 'quote_sent'
    WHEN 'follow_up_3'  THEN 'quote_sent'
    WHEN 'closed'       THEN 'closed_won'
    WHEN 'lost'         THEN 'closed_lost'
    ELSE 'new_prospect'
  END;

  UPDATE public.clients
  SET lead_status = v_stage,
      updated_at = now()
  WHERE id = new.lead_id
    AND org_id = new.org_id
    AND deleted_at IS NULL
    AND lead_status IS DISTINCT FROM v_stage;

  RETURN new;
END;
$fn$;
