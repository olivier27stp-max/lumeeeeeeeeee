-- ═══════════════════════════════════════════════════════════════
-- SÉCURITÉ : gardes sur TOUTES les suppressions du CRM (suite de
-- 20260717200000_cascade_delete_guards qui couvrait client/job/lead).
--
-- Inventaire complet des fonctions destructrices (audit 2026-07-17) :
--   • delete_invoice_cascade / delete_quote_cascade : HARD DELETE,
--     SECURITY DEFINER, AUCUNE garde → même trou cross-tenant que les
--     cascades clients. Gardées ici.
--   • batch_soft_delete_clients : soft-delete de MASSE sans garde →
--     un membre de n'importe quelle org pouvait masquer d'un coup tous
--     les clients d'une autre org. Gardée ici.
--   • hard_delete_client : simple wrapper de delete_client_cascade →
--     déjà couvert transitivement par 20260717200000 (rien à faire).
--   • soft_delete_client / _conditional / soft_delete_job / soft_delete_lead,
--     request/cancel_hard_delete_member : déjà gardées (owner/admin) — OK.
--   • Fonctions d'entretien globales (crons) : réservées au service_role
--     ci-dessous — aucun code client ne les appelle (vérifié).
--
-- Convention de garde : si auth.uid() est présent (appel client via
-- PostgREST), exiger owner/admin de p_org_id. Si null → service_role
-- (serveur Express), de confiance. anon révoqué.
-- ═══════════════════════════════════════════════════════════════

-- 1. delete_invoice_cascade — corps identique à 20260615, garde ajoutée.
CREATE OR REPLACE FUNCTION public.delete_invoice_cascade(
  p_org_id uuid,
  p_invoice_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_org_admin_role(auth.uid(), p_org_id) THEN
    RAISE EXCEPTION 'Only owner/admin can permanently delete invoices' USING errcode = '42501';
  END IF;

  -- Delete payments linked to this invoice
  DELETE FROM public.payments WHERE invoice_id = p_invoice_id AND org_id = p_org_id;

  -- DB ON DELETE CASCADE handles: invoice_items
  DELETE FROM public.invoices WHERE id = p_invoice_id AND org_id = p_org_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_invoice_cascade(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_invoice_cascade(uuid, uuid) TO authenticated, service_role;

-- 2. delete_quote_cascade — corps identique à 20260615, garde ajoutée.
CREATE OR REPLACE FUNCTION public.delete_quote_cascade(
  p_org_id uuid,
  p_quote_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_org_admin_role(auth.uid(), p_org_id) THEN
    RAISE EXCEPTION 'Only owner/admin can permanently delete quotes' USING errcode = '42501';
  END IF;

  -- DB ON DELETE CASCADE handles: quote_line_items, quote_sections,
  -- quote_send_log, quote_status_history, quote_attachments
  DELETE FROM public.quotes WHERE id = p_quote_id AND org_id = p_org_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_quote_cascade(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_quote_cascade(uuid, uuid) TO authenticated, service_role;

-- 3. batch_soft_delete_clients — corps identique à 20260306, garde ajoutée
--    (owner/admin, aligné sur soft_delete_client qui l'exige déjà).
CREATE OR REPLACE FUNCTION public.batch_soft_delete_clients(
  p_org_id uuid,
  p_client_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  v_now timestamptz := now();
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_org_admin_role(auth.uid(), p_org_id) THEN
    RAISE EXCEPTION 'Only owner/admin can archive clients' USING errcode = '42501';
  END IF;

  UPDATE clients
  SET deleted_at = v_now, updated_at = v_now
  WHERE id = ANY(p_client_ids)
    AND org_id = p_org_id
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Also soft-delete related jobs
  UPDATE jobs
  SET deleted_at = v_now, updated_at = v_now
  WHERE client_id = ANY(p_client_ids)
    AND org_id = p_org_id
    AND deleted_at IS NULL;

  RETURN jsonb_build_object('archived_clients', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.batch_soft_delete_clients(uuid, uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.batch_soft_delete_clients(uuid, uuid[]) TO authenticated, service_role;

-- 4. Fonctions d'entretien globales → service_role SEULEMENT.
--    Elles balaient TOUTES les orgs (marquer les leads perdus, anonymiser,
--    purger) : aucun utilisateur ne doit pouvoir les déclencher. Chaque
--    revoke est tolérant (signature absente = fonction pas encore posée).
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.anonymize_old_soft_deleted_clients(int)',
    'public.cleanup_lost_leads_10d()',
    'public.cleanup_expired_pipeline_deals()',
    'public.cleanup_lost_pipeline_deals()',
    'public.purge_expired_portal_tokens()',
    'public.purge_old_audit_events(int)',
    'public.purge_old_failed_logins()',
    'public.cleanup_expired_oauth_states()',
    'public.cleanup_rate_limits()',
    'public.security_maintenance()'
  ] LOOP
    BEGIN
      EXECUTE 'REVOKE ALL ON FUNCTION ' || fn || ' FROM public, anon, authenticated';
      EXECUTE 'GRANT EXECUTE ON FUNCTION ' || fn || ' TO service_role';
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'fonction absente, ignorée: %', fn;
    END;
  END LOOP;
END $$;
