-- =============================================================================
-- Migration — Harmoniser les FK org_id existantes vers CASCADE (opérationnel)
-- =============================================================================
-- Problème : 20 tables OPÉRATIONNELLES ont une FK org_id en RESTRICT ou NO ACTION,
-- ce qui BLOQUE la suppression d'une org (erreur "violates foreign key constraint")
-- alors que ces données doivent partir avec l'org.
--   - 4 RESTRICT : clients, jobs, pipeline_deals, schedule_events
--   - 16 NO ACTION : confidence_calibration, decision_outcomes, few_shot_examples,
--     field_daily_stats, field_house_events, field_house_profiles, field_pin_templates,
--     field_pins, field_sales_reps, field_sales_teams, field_settings, field_territories,
--     job_recurrence_rules, job_templates, org_knowledge, user_agent_preferences
--
-- On les passe toutes en ON DELETE CASCADE.
-- Le nom de contrainte est résolu DYNAMIQUEMENT (jobs utilise 'jobs_org_fk',
-- pas le nom standard → un DROP en dur planterait).
--
-- IMPORTANT : ces tables n'ont pas d'orphelins (vérifié), donc recréation sûre.
-- Tout en transaction.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  r RECORD;
  tbls text[] := ARRAY[
    'clients','jobs','pipeline_deals','schedule_events',
    'confidence_calibration','decision_outcomes','few_shot_examples','field_daily_stats',
    'field_house_events','field_house_profiles','field_pin_templates','field_pins',
    'field_sales_reps','field_sales_teams','field_settings','field_territories',
    'job_recurrence_rules','job_templates','org_knowledge','user_agent_preferences'
  ];
  t text;
  cname text;
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    -- Trouver le nom réel de la FK org_id -> orgs sur cette table
    SELECT c.conname INTO cname
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
    WHERE c.contype='f'
      AND c.conrelid = ('public.'||t)::regclass
      AND c.confrelid = 'public.orgs'::regclass
      AND a.attname = 'org_id'
    LIMIT 1;

    IF cname IS NULL THEN
      RAISE NOTICE 'Table %: aucune FK org_id trouvée, ignorée.', t;
      CONTINUE;
    END IF;

    -- Si déjà en CASCADE, ne rien faire (idempotent)
    IF EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conname = cname AND c.conrelid = ('public.'||t)::regclass
        AND c.confdeltype = 'c'
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, cname);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE',
      t, t||'_org_id_fkey'
    );
  END LOOP;
END $$;

COMMIT;

-- =============================================================================
-- VÉRIFICATION (lecture seule) — doit retourner 0 ligne :
--   SELECT conrelid::regclass, conname FROM pg_constraint c
--   JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
--   WHERE c.contype='f' AND c.confrelid='public.orgs'::regclass
--     AND a.attname='org_id' AND c.confdeltype IN ('a','r')
--     AND c.conrelid::regclass::text = ANY(ARRAY['clients','jobs','pipeline_deals',...]);
-- =============================================================================
