/* ═══════════════════════════════════════════════════════════════
   AI Training Loop — Tables for outcome tracking, calibration,
   user preferences, error corrections, and few-shot evolution
   ═══════════════════════════════════════════════════════════════ */

-- 1. Decision Outcomes — Did the recommendation actually work?
CREATE TABLE IF NOT EXISTS decision_outcomes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  decision_log_id uuid REFERENCES decision_logs(id),
  session_id    uuid REFERENCES agent_sessions(id),
  message_id    uuid REFERENCES agent_messages(id),

  -- What was recommended
  domain        text,                          -- scheduling, pricing, team_assignment, etc.
  action_type   text,                          -- create_job, assign_team, send_invoice, etc.
  confidence    numeric(5,2),                  -- agent's predicted confidence (0-100)

  -- What actually happened
  outcome       text NOT NULL DEFAULT 'pending', -- pending, success, partial, failure, rejected, ignored
  outcome_score numeric(5,2),                  -- 0-100 actual success score
  outcome_note  text,                          -- user explanation of what happened

  -- Business impact (filled async by background job)
  revenue_impact_cents bigint DEFAULT 0,       -- +/- revenue change attributed to this decision
  time_saved_minutes   int DEFAULT 0,          -- estimated time saved

  -- Tracking
  user_id       uuid REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,                   -- when outcome was recorded

  CONSTRAINT valid_outcome CHECK (outcome IN ('pending', 'success', 'partial', 'failure', 'rejected', 'ignored'))
);

CREATE INDEX idx_decision_outcomes_org ON decision_outcomes(org_id);
CREATE INDEX idx_decision_outcomes_domain ON decision_outcomes(org_id, domain);
CREATE INDEX idx_decision_outcomes_resolved ON decision_outcomes(org_id, resolved_at) WHERE resolved_at IS NOT NULL;

-- 2. Confidence Calibration — Track predicted vs actual over time
CREATE TABLE IF NOT EXISTS confidence_calibration (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  domain        text NOT NULL,                 -- scheduling, pricing, team_assignment, etc.

  -- Rolling stats (updated by background job)
  total_predictions    int NOT NULL DEFAULT 0,
  correct_predictions  int NOT NULL DEFAULT 0, -- outcome = success or partial
  avg_predicted_conf   numeric(5,2) DEFAULT 0, -- average confidence agent gave
  avg_actual_success   numeric(5,2) DEFAULT 0, -- actual success rate
  calibration_factor   numeric(5,3) DEFAULT 1.0, -- multiply agent confidence by this

  -- Per-confidence bucket (for reliability diagram)
  bucket_0_20    int DEFAULT 0,  bucket_0_20_correct    int DEFAULT 0,
  bucket_20_40   int DEFAULT 0,  bucket_20_40_correct   int DEFAULT 0,
  bucket_40_60   int DEFAULT 0,  bucket_40_60_correct   int DEFAULT 0,
  bucket_60_80   int DEFAULT 0,  bucket_60_80_correct   int DEFAULT 0,
  bucket_80_100  int DEFAULT 0,  bucket_80_100_correct  int DEFAULT 0,

  last_recalculated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(org_id, domain)
);

-- 3. User Preferences — Learn each user's decision-making style
CREATE TABLE IF NOT EXISTS user_agent_preferences (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  user_id       uuid NOT NULL REFERENCES auth.users(id),

  -- Communication style (learned from interactions)
  preferred_detail_level text DEFAULT 'medium', -- brief, medium, detailed
  preferred_language     text DEFAULT 'en',
  preferred_tone         text DEFAULT 'professional', -- casual, professional, direct

  -- Decision patterns (learned from approvals)
  avg_response_time_ms   bigint DEFAULT 0,      -- how fast they approve
  approval_rate          numeric(5,2) DEFAULT 0, -- % of recommendations approved
  preferred_option_style text DEFAULT 'balanced', -- fastest, cheapest, balanced, quality

  -- Domain preferences (JSON: { domain: { approval_rate, avg_confidence_needed } })
  domain_preferences     jsonb DEFAULT '{}',

  -- Interaction patterns
  total_interactions     int DEFAULT 0,
  total_approvals        int DEFAULT 0,
  total_rejections       int DEFAULT 0,
  total_thumbs_up        int DEFAULT 0,
  total_thumbs_down      int DEFAULT 0,
  last_interaction_at    timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE(org_id, user_id)
);

-- 4. Error Corrections — User explains why a response was wrong
CREATE TABLE IF NOT EXISTS agent_corrections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  user_id       uuid NOT NULL REFERENCES auth.users(id),
  session_id    uuid REFERENCES agent_sessions(id),
  message_id    uuid REFERENCES agent_messages(id),

  -- What was wrong
  original_response text NOT NULL,             -- the agent's response that was wrong
  domain            text,                      -- which domain

  -- The correction
  correction_type   text NOT NULL,             -- 'wrong_answer', 'wrong_tone', 'missing_context', 'hallucination', 'outdated'
  correction_text   text NOT NULL,             -- user's explanation
  correct_answer    text,                      -- what the answer should have been (optional)

  -- Learning impact
  applied           boolean DEFAULT false,     -- has this been incorporated into prompts?
  applied_at        timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_corrections_org ON agent_corrections(org_id);
CREATE INDEX idx_agent_corrections_domain ON agent_corrections(org_id, domain);
CREATE INDEX idx_agent_corrections_unapplied ON agent_corrections(org_id) WHERE applied = false;

-- 5. Few-Shot Training Examples — Evolved, weighted, domain-specific
CREATE TABLE IF NOT EXISTS few_shot_examples (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  domain        text NOT NULL,                 -- scheduling, pricing, general, etc.

  -- The example
  user_message  text NOT NULL,
  agent_response text NOT NULL,

  -- Quality signals
  source        text NOT NULL DEFAULT 'thumbs_up', -- thumbs_up, manual, correction, outcome
  quality_score numeric(5,2) NOT NULL DEFAULT 5.0, -- 0-10 (weighted by recency, feedback, outcome)
  feedback_type text DEFAULT 'positive',        -- positive, negative (anti-example)

  -- Metadata
  original_message_id uuid,
  original_session_id uuid,

  -- Decay
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  use_count     int DEFAULT 0,

  -- Active flag
  is_active     boolean DEFAULT true
);

CREATE INDEX idx_few_shot_org_domain ON few_shot_examples(org_id, domain, is_active);
CREATE INDEX idx_few_shot_quality ON few_shot_examples(org_id, quality_score DESC) WHERE is_active = true;

-- 6. RLS Policies
ALTER TABLE decision_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE confidence_calibration ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_agent_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE few_shot_examples ENABLE ROW LEVEL SECURITY;

-- Service role has full access (all training operations go through backend)
CREATE POLICY "service_full_access" ON decision_outcomes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_full_access" ON confidence_calibration FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_full_access" ON user_agent_preferences FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_full_access" ON agent_corrections FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_full_access" ON few_shot_examples FOR ALL USING (true) WITH CHECK (true);

-- 7. Function: Recalculate confidence calibration for an org+domain
CREATE OR REPLACE FUNCTION recalculate_calibration(p_org uuid, p_domain text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total int; v_correct int;
  v_avg_pred numeric; v_avg_actual numeric;
BEGIN
  SELECT
    count(*),
    count(*) FILTER (WHERE outcome IN ('success', 'partial')),
    coalesce(avg(confidence), 0),
    coalesce(avg(CASE WHEN outcome = 'success' THEN 100 WHEN outcome = 'partial' THEN 60 ELSE 0 END), 0)
  INTO v_total, v_correct, v_avg_pred, v_avg_actual
  FROM decision_outcomes
  WHERE org_id = p_org AND domain = p_domain AND outcome != 'pending';

  IF v_total = 0 THEN RETURN; END IF;

  INSERT INTO confidence_calibration (org_id, domain, total_predictions, correct_predictions, avg_predicted_conf, avg_actual_success, calibration_factor)
  VALUES (p_org, p_domain, v_total, v_correct, v_avg_pred, v_avg_actual,
    CASE WHEN v_avg_pred > 0 THEN least(2.0, greatest(0.1, v_avg_actual / v_avg_pred)) ELSE 1.0 END)
  ON CONFLICT (org_id, domain) DO UPDATE SET
    total_predictions = v_total,
    correct_predictions = v_correct,
    avg_predicted_conf = v_avg_pred,
    avg_actual_success = v_avg_actual,
    calibration_factor = CASE WHEN v_avg_pred > 0 THEN least(2.0, greatest(0.1, v_avg_actual / v_avg_pred)) ELSE 1.0 END,
    last_recalculated_at = now();

  -- Update buckets
  UPDATE confidence_calibration SET
    bucket_0_20 = (SELECT count(*) FROM decision_outcomes WHERE org_id=p_org AND domain=p_domain AND confidence < 20 AND outcome != 'pending'),
    bucket_0_20_correct = (SELECT count(*) FROM decision_outcomes WHERE org_id=p_org AND domain=p_domain AND confidence < 20 AND outcome IN ('success','partial')),
    bucket_20_40 = (SELECT count(*) FROM decision_outcomes WHERE org_id=p_org AND domain=p_domain AND confidence >= 20 AND confidence < 40 AND outcome != 'pending'),
    bucket_20_40_correct = (SELECT count(*) FROM decision_outcomes WHERE org_id=p_org AND domain=p_domain AND confidence >= 20 AND confidence < 40 AND outcome IN ('success','partial')),
    bucket_40_60 = (SELECT count(*) FROM decision_outcomes WHERE org_id=p_org AND domain=p_domain AND confidence >= 40 AND confidence < 60 AND outcome != 'pending'),
    bucket_40_60_correct = (SELECT count(*) FROM decision_outcomes WHERE org_id=p_org AND domain=p_domain AND confidence >= 40 AND confidence < 60 AND outcome IN ('success','partial')),
    bucket_60_80 = (SELECT count(*) FROM decision_outcomes WHERE org_id=p_org AND domain=p_domain AND confidence >= 60 AND confidence < 80 AND outcome != 'pending'),
    bucket_60_80_correct = (SELECT count(*) FROM decision_outcomes WHERE org_id=p_org AND domain=p_domain AND confidence >= 60 AND confidence < 80 AND outcome IN ('success','partial')),
    bucket_80_100 = (SELECT count(*) FROM decision_outcomes WHERE org_id=p_org AND domain=p_domain AND confidence >= 80 AND outcome != 'pending'),
    bucket_80_100_correct = (SELECT count(*) FROM decision_outcomes WHERE org_id=p_org AND domain=p_domain AND confidence >= 80 AND outcome IN ('success','partial'))
  WHERE org_id = p_org AND domain = p_domain;
END;
$$;
