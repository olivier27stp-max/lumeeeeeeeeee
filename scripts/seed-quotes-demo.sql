-- ============================================================================
-- SEED : 3 devis fictifs (DEMO / DONNÉES DE TEST)
-- ----------------------------------------------------------------------------
-- À exécuter dans l'éditeur SQL Supabase. Idempotent (réexécutable sans risque).
--
-- Crée 3 devis dans public.quotes + leurs lignes dans public.quote_line_items.
-- Montants en cents, devise CAD, taxes TPS+TVQ (14.975 %) — contexte Québec.
--
-- Repères :
--   - L'org cible est résolue via l'email du propriétaire (memberships).
--   - Chaque devis est rattaché à un client existant de l'org si disponible,
--     sinon client_id reste NULL (context_type = 'lead').
--   - Les devis sont tagués via quote_number préfixé 'DEMO-Q-' pour le nettoyage
--     (voir le bloc CLEANUP en bas).
-- ============================================================================

DO $$
DECLARE
  v_org      uuid;
  v_owner    uuid;
  v_clients  uuid[];
  v_qid      uuid;
BEGIN
  -- --- Résolution de l'organisation (auto, sans dépendre de l'email) -------
  -- Org : celle qui a le plus de clients (sinon la première org existante).
  SELECT org_id INTO v_org FROM (
    SELECT c.org_id, count(*) AS n
    FROM public.clients c
    GROUP BY c.org_id
    ORDER BY n DESC
    LIMIT 1
  ) t;
  IF v_org IS NULL THEN
    SELECT id INTO v_org FROM public.organizations ORDER BY created_at NULLS LAST LIMIT 1;
  END IF;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Aucune organisation trouvée dans la base.';
  END IF;

  -- Propriétaire : owner/admin de cette org, sinon n'importe quel membre.
  SELECT user_id INTO v_owner
  FROM public.memberships
  WHERE org_id = v_org
  ORDER BY (role IN ('owner','admin')) DESC, created_at NULLS LAST
  LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Aucun membre trouvé pour l''org %.', v_org;
  END IF;

  -- Jusqu'à 3 clients existants de l'org (NULL si aucun)
  SELECT array_agg(id) INTO v_clients FROM (
    SELECT id FROM public.clients
    WHERE org_id = v_org AND coalesce(status,'') <> 'lead'
    ORDER BY created_at NULLS LAST
    LIMIT 3
  ) c;

  -- Nettoyage des devis demo précédents (idempotence)
  DELETE FROM public.quotes
  WHERE org_id = v_org AND quote_number LIKE 'DEMO-Q-%';

  -- ======================================================================
  -- DEVIS 1 — Déneigement saisonnier  (statut : sent)
  --   Sous-total 1 175,00 $ | Taxes 175,96 $ | Total 1 350,96 $
  -- ======================================================================
  INSERT INTO public.quotes (
    org_id, quote_number, title, client_id, status, context_type,
    created_by, salesperson_id, valid_until,
    subtotal_cents, tax_rate_label, tax_rate, tax_cents, total_cents, currency,
    notes
  ) VALUES (
    v_org, 'DEMO-Q-001', 'Contrat de déneigement saisonnier 2026-2027',
    v_clients[1], 'sent', CASE WHEN v_clients[1] IS NULL THEN 'lead' ELSE 'client' END,
    v_owner, v_owner, (now() + interval '21 days')::date,
    117500, 'TPS+TVQ (14.975%)', 14.975, 17596, 135096, 'CAD',
    'Déneigement de l''entrée double + trottoir. Service prioritaire avant 7h00.'
  ) RETURNING id INTO v_qid;

  INSERT INTO public.quote_line_items
    (quote_id, name, description, quantity, unit_price_cents, total_cents, sort_order, item_type)
  VALUES
    (v_qid, 'Forfait déneigement saisonnier', 'Saison complète, entrée double + trottoir', 1, 95000, 95000, 0, 'service'),
    (v_qid, 'Épandage sel / abrasif', 'Sur appel, par passage', 5, 4500, 22500, 1, 'service');

  -- ======================================================================
  -- DEVIS 2 — Entretien paysager  (statut : draft, rabais 10 %)
  --   Sous-total 1 100,00 $ | Rabais 110,00 $ | Taxes 148,25 $ | Total 1 138,25 $
  -- ======================================================================
  INSERT INTO public.quotes (
    org_id, quote_number, title, client_id, status, context_type,
    created_by, salesperson_id, valid_until,
    subtotal_cents, discount_type, discount_value, discount_cents,
    tax_rate_label, tax_rate, tax_cents, total_cents, currency,
    notes
  ) VALUES (
    v_org, 'DEMO-Q-002', 'Forfait entretien paysager — saison estivale',
    v_clients[2], 'draft', CASE WHEN v_clients[2] IS NULL THEN 'lead' ELSE 'client' END,
    v_owner, v_owner, (now() + interval '30 days')::date,
    110000, 'percentage', 10, 11000,
    'TPS+TVQ (14.975%)', 14.975, 14825, 113825, 'CAD',
    'Rabais fidélité 10 % appliqué. Visites hebdomadaires de mai à août.'
  ) RETURNING id INTO v_qid;

  INSERT INTO public.quote_line_items
    (quote_id, name, description, quantity, unit_price_cents, total_cents, sort_order, item_type)
  VALUES
    (v_qid, 'Tonte de pelouse hebdomadaire', '12 visites', 12, 5000, 60000, 0, 'service'),
    (v_qid, 'Taille de haies', 'Avant + arrière cour', 1, 18000, 18000, 1, 'service'),
    (v_qid, 'Aménagement plate-bande', 'Paillis + plantes vivaces', 1, 32000, 32000, 2, 'service');

  -- ======================================================================
  -- DEVIS 3 — Lavage extérieur  (statut : approved)
  --   Sous-total 490,00 $ | Taxes 73,38 $ | Total 563,38 $
  -- ======================================================================
  INSERT INTO public.quotes (
    org_id, quote_number, title, client_id, status, context_type,
    created_by, salesperson_id, valid_until, approved_at,
    subtotal_cents, tax_rate_label, tax_rate, tax_cents, total_cents, currency,
    notes
  ) VALUES (
    v_org, 'DEMO-Q-003', 'Lavage de vitres, gouttières et pression',
    v_clients[3], 'approved', CASE WHEN v_clients[3] IS NULL THEN 'lead' ELSE 'client' END,
    v_owner, v_owner, (now() + interval '14 days')::date, now(),
    49000, 'TPS+TVQ (14.975%)', 14.975, 7338, 56338, 'CAD',
    'Approuvé par le client. À planifier dans les 2 prochaines semaines.'
  ) RETURNING id INTO v_qid;

  INSERT INTO public.quote_line_items
    (quote_id, name, description, quantity, unit_price_cents, total_cents, sort_order, item_type)
  VALUES
    (v_qid, 'Lavage de vitres résidentiel', 'Intérieur + extérieur', 1, 22000, 22000, 0, 'service'),
    (v_qid, 'Nettoyage de gouttières', 'Périmètre complet', 1, 15000, 15000, 1, 'service'),
    (v_qid, 'Lavage à pression — entrée', 'Pavé uni + balcon', 1, 12000, 12000, 2, 'service');

  RAISE NOTICE '✅ 3 devis fictifs insérés (DEMO-Q-001..003) pour org %', v_org;
END $$;

-- ============================================================================
-- CLEANUP (décommenter pour supprimer les données demo) :
--   Les lignes sont supprimées en cascade via quote_line_items.quote_id.
-- ----------------------------------------------------------------------------
-- DELETE FROM public.quotes WHERE quote_number LIKE 'DEMO-Q-%';
-- ============================================================================
