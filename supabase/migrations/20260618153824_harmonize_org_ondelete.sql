-- Harmonise 20 FK org_id existantes (RESTRICT/NO ACTION -> CASCADE). Idempotent. Prod 2026-06-18.
DO $$
DECLARE
  cname text;
  t text;
  tbls text[] := ARRAY[
    'clients','jobs','pipeline_deals','schedule_events',
    'confidence_calibration','decision_outcomes','few_shot_examples','field_daily_stats',
    'field_house_events','field_house_profiles','field_pin_templates','field_pins',
    'field_sales_reps','field_sales_teams','field_settings','field_territories',
    'job_recurrence_rules','job_templates','org_knowledge','user_agent_preferences'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    SELECT c.conname INTO cname
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
    WHERE c.contype='f'
      AND c.conrelid = ('public.'||t)::regclass
      AND c.confrelid = 'public.orgs'::regclass
      AND a.attname = 'org_id'
    LIMIT 1;

    IF cname IS NULL THEN CONTINUE; END IF;

    -- déjà en CASCADE -> rien à faire
    IF EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conname = cname AND c.conrelid = ('public.'||t)::regclass AND c.confdeltype = 'c'
    ) THEN CONTINUE; END IF;

    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, cname);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE',
      t, t||'_org_id_fkey'
    );
  END LOOP;
END $$;
