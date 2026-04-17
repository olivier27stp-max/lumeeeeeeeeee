-- D2D Pipeline Enhancements
-- ===========================
-- Adds rep assignment, secondary status, and D2D-specific fields to pipeline_deals.
-- Also adds quote_id to field_house_profiles for full CRM linking.

-- 1. Add rep_id to pipeline_deals (which rep owns this deal)
ALTER TABLE public.pipeline_deals ADD COLUMN IF NOT EXISTS rep_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Add secondary status layer (hot/cold/follow-up/etc.)
ALTER TABLE public.pipeline_deals ADD COLUMN IF NOT EXISTS d2d_status text DEFAULT 'pending';
ALTER TABLE public.pipeline_deals ADD CONSTRAINT pipeline_deals_d2d_status_check
  CHECK (d2d_status IS NULL OR d2d_status IN ('pending', 'follow_up', 'hot', 'cold', 'no_answer'));

-- 3. Add lost_reason for closed_lost deals
ALTER TABLE public.pipeline_deals ADD COLUMN IF NOT EXISTS lost_reason text;

-- 4. Add pin_id link (which D2D pin generated this deal)
ALTER TABLE public.pipeline_deals ADD COLUMN IF NOT EXISTS pin_id uuid;

-- 5. Add quote_id to pipeline_deals (which quote is linked)
ALTER TABLE public.pipeline_deals ADD COLUMN IF NOT EXISTS quote_id uuid;

-- 6. Add quote_id to field_house_profiles (link house to quote)
ALTER TABLE public.field_house_profiles ADD COLUMN IF NOT EXISTS quote_id uuid;

-- 7. Add invoice_id to field_house_profiles if not exists
ALTER TABLE public.field_house_profiles ADD COLUMN IF NOT EXISTS invoice_id uuid;

-- 8. Index for rep filtering
CREATE INDEX IF NOT EXISTS idx_pipeline_deals_rep_id ON public.pipeline_deals (rep_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_deals_d2d_status ON public.pipeline_deals (d2d_status);
CREATE INDEX IF NOT EXISTS idx_pipeline_deals_quote_id ON public.pipeline_deals (quote_id);

-- 9. Add source column to track where the deal came from
ALTER TABLE public.pipeline_deals ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';
-- source values: 'manual', 'd2d', 'web_form', 'referral'
