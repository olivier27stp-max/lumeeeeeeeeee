-- Restore quote_sequences table referenced by rpc_create_quote.
-- The table was defined in 20260430000000_quotes_system.sql but is missing in
-- production (cause unknown — possibly manual drop or partial migration).
-- Runtime error: `relation "public.quote_sequences" does not exist`
-- which makes EVERY quote creation fail in prod.

CREATE TABLE IF NOT EXISTS public.quote_sequences (
  org_id      uuid PRIMARY KEY REFERENCES public.orgs(id) ON DELETE CASCADE,
  last_value  integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.quote_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quote_sequences_all ON public.quote_sequences;
CREATE POLICY quote_sequences_all ON public.quote_sequences
  FOR ALL USING (public.has_org_membership(auth.uid(), org_id))
  WITH CHECK (public.has_org_membership(auth.uid(), org_id));

-- Same for invoice_sequences in case it's missing too (the May 21 audit
-- marked it for drop; check it exists, restore if not).
CREATE TABLE IF NOT EXISTS public.invoice_sequences (
  org_id      uuid PRIMARY KEY REFERENCES public.orgs(id) ON DELETE CASCADE,
  last_value  integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.invoice_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_sequences_all ON public.invoice_sequences;
CREATE POLICY invoice_sequences_all ON public.invoice_sequences
  FOR ALL USING (public.has_org_membership(auth.uid(), org_id))
  WITH CHECK (public.has_org_membership(auth.uid(), org_id));

NOTIFY pgrst, 'reload schema';
