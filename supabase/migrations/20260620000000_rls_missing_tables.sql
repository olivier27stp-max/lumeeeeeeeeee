-- ============================================================================
-- RLS policies for tables that were missing them
-- Ensures org-level data isolation for multi-tenant security
-- ============================================================================

-- 1. alert_rules
ALTER TABLE IF EXISTS public.alert_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS alert_rules_select_org ON public.alert_rules;
DROP POLICY IF EXISTS alert_rules_insert_org ON public.alert_rules;
DROP POLICY IF EXISTS alert_rules_update_org ON public.alert_rules;
DROP POLICY IF EXISTS alert_rules_delete_org ON public.alert_rules;
CREATE POLICY alert_rules_select_org ON public.alert_rules FOR SELECT USING (has_org_membership(auth.uid(), org_id));
CREATE POLICY alert_rules_insert_org ON public.alert_rules FOR INSERT WITH CHECK (has_org_membership(auth.uid(), org_id));
CREATE POLICY alert_rules_update_org ON public.alert_rules FOR UPDATE USING (has_org_membership(auth.uid(), org_id));
CREATE POLICY alert_rules_delete_org ON public.alert_rules FOR DELETE USING (has_org_membership(auth.uid(), org_id));

-- 2. audit_events
ALTER TABLE IF EXISTS public.audit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_events_select_org ON public.audit_events;
DROP POLICY IF EXISTS audit_events_insert_org ON public.audit_events;
CREATE POLICY audit_events_select_org ON public.audit_events FOR SELECT USING (has_org_membership(auth.uid(), org_id));
CREATE POLICY audit_events_insert_org ON public.audit_events FOR INSERT WITH CHECK (has_org_membership(auth.uid(), org_id));

-- 3. director_generations
ALTER TABLE IF EXISTS public.director_generations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS director_generations_select_org ON public.director_generations;
DROP POLICY IF EXISTS director_generations_insert_org ON public.director_generations;
DROP POLICY IF EXISTS director_generations_update_org ON public.director_generations;
DROP POLICY IF EXISTS director_generations_delete_org ON public.director_generations;
CREATE POLICY director_generations_select_org ON public.director_generations FOR SELECT USING (has_org_membership(auth.uid(), org_id));
CREATE POLICY director_generations_insert_org ON public.director_generations FOR INSERT WITH CHECK (has_org_membership(auth.uid(), org_id));
CREATE POLICY director_generations_update_org ON public.director_generations FOR UPDATE USING (has_org_membership(auth.uid(), org_id));
CREATE POLICY director_generations_delete_org ON public.director_generations FOR DELETE USING (has_org_membership(auth.uid(), org_id));

-- 4. director_style_dna
ALTER TABLE IF EXISTS public.director_style_dna ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS director_style_dna_select_org ON public.director_style_dna;
DROP POLICY IF EXISTS director_style_dna_insert_org ON public.director_style_dna;
DROP POLICY IF EXISTS director_style_dna_update_org ON public.director_style_dna;
DROP POLICY IF EXISTS director_style_dna_delete_org ON public.director_style_dna;
CREATE POLICY director_style_dna_select_org ON public.director_style_dna FOR SELECT USING (has_org_membership(auth.uid(), org_id));
CREATE POLICY director_style_dna_insert_org ON public.director_style_dna FOR INSERT WITH CHECK (has_org_membership(auth.uid(), org_id));
CREATE POLICY director_style_dna_update_org ON public.director_style_dna FOR UPDATE USING (has_org_membership(auth.uid(), org_id));
CREATE POLICY director_style_dna_delete_org ON public.director_style_dna FOR DELETE USING (has_org_membership(auth.uid(), org_id));

-- 5. director_creative_directions (linked via style_dna_id, uses org_id if available)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'director_creative_directions' AND column_name = 'org_id') THEN
    ALTER TABLE public.director_creative_directions ENABLE ROW LEVEL SECURITY;
    EXECUTE 'CREATE POLICY director_creative_directions_select_org ON public.director_creative_directions FOR SELECT USING (has_org_membership(auth.uid(), org_id))';
    EXECUTE 'CREATE POLICY director_creative_directions_insert_org ON public.director_creative_directions FOR INSERT WITH CHECK (has_org_membership(auth.uid(), org_id))';
    EXECUTE 'CREATE POLICY director_creative_directions_update_org ON public.director_creative_directions FOR UPDATE USING (has_org_membership(auth.uid(), org_id))';
    EXECUTE 'CREATE POLICY director_creative_directions_delete_org ON public.director_creative_directions FOR DELETE USING (has_org_membership(auth.uid(), org_id))';
  END IF;
END $$;

-- 6. director_usage_events
ALTER TABLE IF EXISTS public.director_usage_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS director_usage_events_select_org ON public.director_usage_events;
DROP POLICY IF EXISTS director_usage_events_insert_org ON public.director_usage_events;
CREATE POLICY director_usage_events_select_org ON public.director_usage_events FOR SELECT USING (has_org_membership(auth.uid(), org_id));
CREATE POLICY director_usage_events_insert_org ON public.director_usage_events FOR INSERT WITH CHECK (has_org_membership(auth.uid(), org_id));

-- 7. director_training_jobs
ALTER TABLE IF EXISTS public.director_training_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS director_training_jobs_select_org ON public.director_training_jobs;
DROP POLICY IF EXISTS director_training_jobs_insert_org ON public.director_training_jobs;
DROP POLICY IF EXISTS director_training_jobs_update_org ON public.director_training_jobs;
CREATE POLICY director_training_jobs_select_org ON public.director_training_jobs FOR SELECT USING (has_org_membership(auth.uid(), org_id));
CREATE POLICY director_training_jobs_insert_org ON public.director_training_jobs FOR INSERT WITH CHECK (has_org_membership(auth.uid(), org_id));
CREATE POLICY director_training_jobs_update_org ON public.director_training_jobs FOR UPDATE USING (has_org_membership(auth.uid(), org_id));

-- 8. client_link_backfill_ambiguous (cleanup — drop if no longer needed)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'client_link_backfill_ambiguous') THEN
    DROP TABLE IF EXISTS public.client_link_backfill_ambiguous;
  END IF;
END $$;

-- Add revenue_goal_cents to company_settings if missing
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'company_settings' AND column_name = 'revenue_goal_cents') THEN
    ALTER TABLE public.company_settings ADD COLUMN revenue_goal_cents integer NOT NULL DEFAULT 0;
  END IF;
END $$;
