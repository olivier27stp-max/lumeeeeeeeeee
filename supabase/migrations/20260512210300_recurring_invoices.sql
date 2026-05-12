-- Recurring invoice schedules — auto-generate invoices on a cadence
CREATE TABLE IF NOT EXISTS public.recurring_invoice_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  template_invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  subject text NOT NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{description, qty, unit_price_cents}]
  frequency text NOT NULL CHECK (frequency IN ('weekly','biweekly','monthly','quarterly','yearly')),
  start_date date NOT NULL,
  end_date date,
  next_run_date date NOT NULL,
  due_days_offset integer NOT NULL DEFAULT 30,
  auto_send boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  last_invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recurring_invoice_schedules_due_idx
  ON public.recurring_invoice_schedules (next_run_date)
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS recurring_invoice_schedules_org_idx
  ON public.recurring_invoice_schedules (org_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS recurring_invoice_schedules_client_idx
  ON public.recurring_invoice_schedules (client_id);

ALTER TABLE public.recurring_invoice_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ris_org_read ON public.recurring_invoice_schedules;
DROP POLICY IF EXISTS ris_org_write ON public.recurring_invoice_schedules;

CREATE POLICY ris_org_read ON public.recurring_invoice_schedules
  FOR SELECT USING (public.has_org_membership(auth.uid(), org_id));
CREATE POLICY ris_org_write ON public.recurring_invoice_schedules
  FOR ALL
  USING (public.has_org_admin_role(auth.uid(), org_id))
  WITH CHECK (public.has_org_admin_role(auth.uid(), org_id));

NOTIFY pgrst, 'reload schema';
