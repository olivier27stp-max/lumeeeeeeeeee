-- Payroll configuration — one row per org.
-- Drives pay-period boundaries that tie commissions (fs_commission_entries)
-- and worked hours (time_entries) into a single "what's coming on my next
-- paycheque" view for reps, and a configuration surface for admins.

CREATE TABLE IF NOT EXISTS public.payroll_settings (
  org_id          uuid PRIMARY KEY,
  -- How often pay periods repeat.
  pay_period_type text NOT NULL DEFAULT 'biweekly'
    CHECK (pay_period_type IN ('weekly', 'biweekly', 'semimonthly', 'monthly')),
  -- Reference date marking the start of a known pay period. Used to project
  -- weekly/biweekly cycles forward and backward. Ignored for semimonthly
  -- (always 1–15 / 16–end) and monthly (always 1st–end).
  anchor_date     date NOT NULL DEFAULT current_date,
  -- Days after a period ENDS that employees actually get paid (e.g. period
  -- ends Fri, paid the following Fri = 7).
  pay_day_offset  integer NOT NULL DEFAULT 5 CHECK (pay_day_offset >= 0 AND pay_day_offset <= 31),
  -- IANA timezone the period boundaries are interpreted in.
  timezone        text NOT NULL DEFAULT 'America/Toronto',
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payroll_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_settings_select_org ON public.payroll_settings;
CREATE POLICY payroll_settings_select_org ON public.payroll_settings
  FOR SELECT USING (has_org_membership((SELECT auth.uid()), org_id));

DROP POLICY IF EXISTS payroll_settings_insert_org ON public.payroll_settings;
CREATE POLICY payroll_settings_insert_org ON public.payroll_settings
  FOR INSERT WITH CHECK (has_org_membership((SELECT auth.uid()), org_id));

DROP POLICY IF EXISTS payroll_settings_update_org ON public.payroll_settings;
CREATE POLICY payroll_settings_update_org ON public.payroll_settings
  FOR UPDATE USING (has_org_membership((SELECT auth.uid()), org_id));

DROP POLICY IF EXISTS payroll_settings_delete_org ON public.payroll_settings;
CREATE POLICY payroll_settings_delete_org ON public.payroll_settings
  FOR DELETE USING (has_org_membership((SELECT auth.uid()), org_id));
