-- =============================================================================
-- Migration — Foreign keys org_id manquantes (52 tables)
-- =============================================================================
-- Problème : 52 tables ont une colonne org_id SANS contrainte FK → aucun garde-fou,
-- orphelins garantis quand une org est supprimée. C'est la cause racine des
-- orphelins déjà observés (memberships, etc.).
--
-- PRÉREQUIS : la migration de nettoyage des orphelins (20260710020000) doit être
-- passée AVANT celle-ci, sinon l'ajout de FK échoue sur les lignes orphelines.
-- Vérifié : seules 4 tables avaient des orphelins, toutes nettoyées par cette migration-là.
--
-- Stratégie des règles ON DELETE (voir MATRICE_INTEGRITE_REFERENTIELLE.md) :
--   - OPÉRATIONNEL        -> CASCADE   (suppression d'org = efface ces données)
--   - FINANCIER / LÉGAL   -> RESTRICT  (conservation fiscale ; bloque la suppression
--                                       d'org tant que le financier existe → géré par
--                                       une procédure applicative d'archivage)
--   - invoice_templates   -> SET NULL  (templates système globaux, org_id nullable)
--
-- Technique : ADD CONSTRAINT ... NOT VALID (verrou bref, ne scanne pas la table),
-- puis VALIDATE CONSTRAINT (scan sans bloquer les écritures). Idempotent via garde.
-- =============================================================================

-- --- Bloc 1 : FK NOT VALID (rapide) -----------------------------------------
DO $$
DECLARE
  t text;
  -- Tables financières / légales -> RESTRICT (conservation)
  fin text[] := ARRAY[
    'invoices','invoice_items','invoice_send_events','payments','payment_requests',
    'payment_requirements','payment_providers','subscriptions','billing_profiles',
    'billing_receipt_log','processed_checkout_sessions','provisioning_events',
    'org_invoice_sequences','org_billing_settings','connected_accounts'
  ];
  -- Toutes les tables org_id sans FK (au 2026-07-10)
  all_tbls text[] := ARRAY[
    'a2p_registrations','agent_messages','alert_rules','approvals','audit_events',
    'billing_profiles','billing_receipt_log','connected_accounts','contacts','courses',
    'decision_logs','field_pin_entity_links','field_rep_performance','field_schedule_slots',
    'field_territory_assignments','goals','invoice_items','invoice_send_events',
    'invoice_templates','invoices','job_intents','job_line_items','job_time_logs',
    'location_tracking_settings','memberships','notifications','org_billing_settings',
    'org_features','org_invoice_sequences','org_job_counters','payment_providers',
    'payment_requests','payment_requirements','payments','payroll_settings',
    'processed_checkout_sessions','properties','provisioning_events','quote_measurements',
    'quotes','scenario_options','scenario_runs','scheduled_reports','sms_opt_outs',
    'subscriptions','tags','team_availability','team_capabilities','teams',
    'tracking_events','tracking_live_locations','tracking_points'
  ];
  rule text;
BEGIN
  FOREACH t IN ARRAY all_tbls LOOP
    -- ne rien faire si une FK sur org_id existe déjà
    IF EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
      WHERE c.contype='f' AND c.conrelid=('public.'||t)::regclass AND a.attname='org_id'
    ) THEN
      CONTINUE;
    END IF;

    IF t = 'invoice_templates' THEN
      rule := 'SET NULL';                      -- templates système, org_id nullable
    ELSIF t = ANY(fin) THEN
      rule := 'RESTRICT';                       -- conservation financière
    ELSE
      rule := 'CASCADE';                        -- opérationnel
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE %s NOT VALID',
      t, t||'_org_id_fkey', rule
    );
  END LOOP;
END $$;

-- --- Bloc 2 : VALIDATE (scan sans bloquer les écritures) ---------------------
DO $$
DECLARE t text; tbls text[] := ARRAY[
    'a2p_registrations','agent_messages','alert_rules','approvals','audit_events',
    'billing_profiles','billing_receipt_log','connected_accounts','contacts','courses',
    'decision_logs','field_pin_entity_links','field_rep_performance','field_schedule_slots',
    'field_territory_assignments','goals','invoice_items','invoice_send_events',
    'invoice_templates','invoices','job_intents','job_line_items','job_time_logs',
    'location_tracking_settings','memberships','notifications','org_billing_settings',
    'org_features','org_invoice_sequences','org_job_counters','payment_providers',
    'payment_requests','payment_requirements','payments','payroll_settings',
    'processed_checkout_sessions','properties','provisioning_events','quote_measurements',
    'quotes','scenario_options','scenario_runs','scheduled_reports','sms_opt_outs',
    'subscriptions','tags','team_availability','team_capabilities','teams',
    'tracking_events','tracking_live_locations','tracking_points'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', t, t||'_org_id_fkey');
    EXCEPTION WHEN undefined_object THEN
      -- contrainte absente (déjà existante sous un autre nom) : on ignore
      NULL;
    END;
  END LOOP;
END $$;

-- =============================================================================
-- IMPACT À CONNAÎTRE : les FK RESTRICT sur le financier font que
-- "DELETE FROM orgs WHERE id=?" sera BLOQUÉ si l'org a des factures/paiements/etc.
-- C'est VOULU (conservation légale). La suppression d'une org doit donc passer par
-- une procédure applicative : archiver/anonymiser le financier, puis supprimer l'org
-- (le reste partira en CASCADE). À implémenter au temps 2 (soft-delete).
--
-- DOWN : ALTER TABLE public.<t> DROP CONSTRAINT <t>_org_id_fkey;  (pour chaque table)
-- =============================================================================
