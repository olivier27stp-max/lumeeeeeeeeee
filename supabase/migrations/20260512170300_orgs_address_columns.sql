-- Add address columns to public.orgs.
--
-- Used by:
--   - server/lib/twilioProvisioning.ts → resolveRegionForOrg() picks the
--     Twilio area code from the org's region/city/postal_code (Montréal → 514,
--     Toronto → 416, NYC → 212, etc.) so the org gets a number close to home.
--   - server/routes/payments.ts:1487-1499 → propagates the Stripe Checkout
--     billing address onto the org so we don't ask twice.
--
-- Before this migration these reads/writes silently did nothing because the
-- columns didn't exist. Twilio then fell back to "any Canadian number".

ALTER TABLE public.orgs
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS address text;
