-- ORDER_HINT: 1/2 — timestamp collision with 20260403000000_template_defaults.sql
-- (Issue C-001, audit 2026-04-21). Apply this file BEFORE the sibling.
-- Lexicographic order by full filename matches intended order. Do NOT rename (would break applied-migration checksums).

-- ═══════════════════════════════════════════════════════════════
-- Recurring Jobs: recurrence rules + job templates
-- ═══════════════════════════════════════════════════════════════

-- ─── Job Templates ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id),
  created_by  uuid NOT NULL REFERENCES auth.users(id),
  title       text NOT NULL DEFAULT '',
  description text,
  job_type    text DEFAULT 'one_off',
  line_items  jsonb DEFAULT '[]'::jsonb,
  tags        text[] DEFAULT '{}',
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_templates_org ON job_templates(org_id);

-- ─── Recurrence Rules ──────────────────────────────────────────
-- Attached to a job to make it repeat.
CREATE TABLE IF NOT EXISTS job_recurrence_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  org_id          uuid NOT NULL REFERENCES orgs(id),
  frequency       text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly', 'custom')),
  interval_days   int DEFAULT 7,
  day_of_week     int[], -- 0=Sun, 1=Mon ... 6=Sat (for weekly)
  day_of_month    int,   -- 1-31 (for monthly)
  start_date      date NOT NULL,
  end_date        date, -- null = forever
  max_occurrences int,  -- null = unlimited
  occurrences_created int DEFAULT 0,
  next_run_at     timestamptz,
  is_active       boolean DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_recurrence_job  ON job_recurrence_rules(job_id);
CREATE INDEX IF NOT EXISTS idx_job_recurrence_next ON job_recurrence_rules(next_run_at) WHERE is_active = true;

-- ─── RLS ───────────────────────────────────────────────────────

ALTER TABLE job_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "job_templates_org" ON job_templates
  FOR ALL USING (
    EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = job_templates.org_id AND m.user_id = auth.uid())
  );

ALTER TABLE job_recurrence_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "job_recurrence_org" ON job_recurrence_rules
  FOR ALL USING (
    EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = job_recurrence_rules.org_id AND m.user_id = auth.uid())
  );

-- ─── Realtime ──────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE job_templates;
ALTER PUBLICATION supabase_realtime ADD TABLE job_recurrence_rules;
