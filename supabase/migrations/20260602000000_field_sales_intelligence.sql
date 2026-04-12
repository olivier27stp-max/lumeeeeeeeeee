-- ============================================================================
-- Field Sales Intelligence System — Full Schema Upgrade
-- Adds: AI scoring, company operating profile, scheduling intelligence,
--        follow-up engine, territory assignment AI, daily planning,
--        automation layer, recommendation storage
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Company Operating Profile
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.company_operating_profile (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  industry_type  text NOT NULL DEFAULT 'general',
  avg_job_duration_minutes  integer NOT NULL DEFAULT 120,
  avg_jobs_per_day          integer NOT NULL DEFAULT 4,
  max_travel_radius_km      numeric NOT NULL DEFAULT 50,
  weight_proximity          numeric NOT NULL DEFAULT 0.3,
  weight_team_availability  numeric NOT NULL DEFAULT 0.25,
  weight_value              numeric NOT NULL DEFAULT 0.25,
  weight_recency            numeric NOT NULL DEFAULT 0.2,
  preferred_reknock_delay_days integer NOT NULL DEFAULT 7,
  scheduling_pattern_type   text NOT NULL DEFAULT 'clustered',
  peak_hours_start          time NOT NULL DEFAULT '09:00',
  peak_hours_end            time NOT NULL DEFAULT '17:00',
  operating_days            integer[] NOT NULL DEFAULT '{1,2,3,4,5}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id)
);

-- ---------------------------------------------------------------------------
-- 2. Upgrade field_territories with scoring columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.field_territories
  ADD COLUMN IF NOT EXISTS coverage_percent   numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS territory_score    numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fatigue_score      numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_pins         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active_leads       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS close_rate         numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_scored_at     timestamptz;

-- ---------------------------------------------------------------------------
-- 3. Upgrade field_house_profiles (pins) with AI scoring columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.field_house_profiles
  ADD COLUMN IF NOT EXISTS reknock_priority_score numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fatigue_score          numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_next_action         text,
  ADD COLUMN IF NOT EXISTS ai_score_explanation   text,
  ADD COLUMN IF NOT EXISTS client_id              uuid,
  ADD COLUMN IF NOT EXISTS lead_id                uuid,
  ADD COLUMN IF NOT EXISTS quote_id               uuid,
  ADD COLUMN IF NOT EXISTS job_id                 uuid,
  ADD COLUMN IF NOT EXISTS last_scored_at         timestamptz;

-- ---------------------------------------------------------------------------
-- 4. AI Recommendations Storage
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_ai_recommendations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL,
  entity_type    text NOT NULL,  -- territory, pin, schedule, follow_up, daily_plan
  entity_id      uuid,
  target_user_id uuid,
  type           text NOT NULL,  -- reknock, follow_up, schedule_slot, territory_priority, daily_plan
  score          numeric NOT NULL DEFAULT 0,
  explanation    text NOT NULL DEFAULT '',
  payload_json   jsonb NOT NULL DEFAULT '{}',
  status         text NOT NULL DEFAULT 'active',  -- active, dismissed, completed, expired
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_sales_ai_recs_org_type ON public.sales_ai_recommendations(org_id, type, status);
CREATE INDEX IF NOT EXISTS idx_sales_ai_recs_user ON public.sales_ai_recommendations(target_user_id, status);
CREATE INDEX IF NOT EXISTS idx_sales_ai_recs_expires ON public.sales_ai_recommendations(expires_at) WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- 5. Territory Assignment History (AI learning)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_territory_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  territory_id    uuid NOT NULL,
  user_id         uuid NOT NULL,
  assigned_at     timestamptz NOT NULL DEFAULT now(),
  unassigned_at   timestamptz,
  performance_score numeric NOT NULL DEFAULT 0,
  knocks_during   integer NOT NULL DEFAULT 0,
  leads_during    integer NOT NULL DEFAULT 0,
  sales_during    integer NOT NULL DEFAULT 0,
  close_rate      numeric NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_field_terr_assign_org ON public.field_territory_assignments(org_id, territory_id);
CREATE INDEX IF NOT EXISTS idx_field_terr_assign_user ON public.field_territory_assignments(user_id);

-- ---------------------------------------------------------------------------
-- 6. Rep Performance Cache (for AI matching)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_rep_performance (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  user_id         uuid NOT NULL,
  territory_id    uuid,
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  total_knocks    integer NOT NULL DEFAULT 0,
  total_leads     integer NOT NULL DEFAULT 0,
  total_sales     integer NOT NULL DEFAULT 0,
  total_callbacks integer NOT NULL DEFAULT 0,
  total_no_answer integer NOT NULL DEFAULT 0,
  close_rate      numeric NOT NULL DEFAULT 0,
  avg_knocks_per_day numeric NOT NULL DEFAULT 0,
  revenue_cents   bigint NOT NULL DEFAULT 0,
  computed_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id, territory_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_field_rep_perf_org ON public.field_rep_performance(org_id, user_id);

-- ---------------------------------------------------------------------------
-- 7. Scheduling Intelligence Cache
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_schedule_slots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  user_id         uuid,
  slot_date       date NOT NULL,
  start_time      timestamptz NOT NULL,
  end_time        timestamptz NOT NULL,
  score           numeric NOT NULL DEFAULT 0,
  explanation     text NOT NULL DEFAULT '',
  nearby_jobs     integer NOT NULL DEFAULT 0,
  nearby_pins     integer NOT NULL DEFAULT 0,
  is_peak_hour    boolean NOT NULL DEFAULT false,
  computed_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_field_sched_slots_org ON public.field_schedule_slots(org_id, slot_date);

-- ---------------------------------------------------------------------------
-- 8. Auto-pin linkage tracking
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_pin_entity_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  house_id        uuid NOT NULL,
  entity_type     text NOT NULL,  -- client, lead, quote, job, invoice
  entity_id       uuid NOT NULL,
  linked_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, house_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_field_pin_links_house ON public.field_pin_entity_links(house_id);
CREATE INDEX IF NOT EXISTS idx_field_pin_links_entity ON public.field_pin_entity_links(entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- 9. RLS Policies
-- ---------------------------------------------------------------------------

-- company_operating_profile
ALTER TABLE public.company_operating_profile ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'cop_org_access' AND tablename = 'company_operating_profile') THEN
    CREATE POLICY cop_org_access ON public.company_operating_profile
      FOR ALL USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));
  END IF;
END $$;

-- sales_ai_recommendations
ALTER TABLE public.sales_ai_recommendations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'ai_recs_org_access' AND tablename = 'sales_ai_recommendations') THEN
    CREATE POLICY ai_recs_org_access ON public.sales_ai_recommendations
      FOR ALL USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));
  END IF;
END $$;

-- field_territory_assignments
ALTER TABLE public.field_territory_assignments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fta_org_access' AND tablename = 'field_territory_assignments') THEN
    CREATE POLICY fta_org_access ON public.field_territory_assignments
      FOR ALL USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));
  END IF;
END $$;

-- field_rep_performance
ALTER TABLE public.field_rep_performance ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'frp_org_access' AND tablename = 'field_rep_performance') THEN
    CREATE POLICY frp_org_access ON public.field_rep_performance
      FOR ALL USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));
  END IF;
END $$;

-- field_schedule_slots
ALTER TABLE public.field_schedule_slots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fss_org_access' AND tablename = 'field_schedule_slots') THEN
    CREATE POLICY fss_org_access ON public.field_schedule_slots
      FOR ALL USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));
  END IF;
END $$;

-- field_pin_entity_links
ALTER TABLE public.field_pin_entity_links ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fpel_org_access' AND tablename = 'field_pin_entity_links') THEN
    CREATE POLICY fpel_org_access ON public.field_pin_entity_links
      FOR ALL USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 10. Helper function: compute haversine distance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.haversine_distance(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) RETURNS double precision
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  R constant double precision := 6371000;
  dlat double precision;
  dlng double precision;
  a double precision;
BEGIN
  dlat := radians(lat2 - lat1);
  dlng := radians(lng2 - lng1);
  a := sin(dlat/2)^2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng/2)^2;
  RETURN R * 2 * atan2(sqrt(a), sqrt(1 - a));
END;
$$;

-- ---------------------------------------------------------------------------
-- Done
-- ---------------------------------------------------------------------------
