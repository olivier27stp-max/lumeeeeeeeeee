-- Peer payout visibility: by default reps CAN see each other's commission
-- totals (motivational, like Enzy), with an org setting to turn it off.
-- Adds field_settings.show_peer_payouts (default true) and widens the
-- fs_commission_entries SELECT policy to allow peers when the setting is on.
-- Idempotent.

ALTER TABLE public.field_settings
  ADD COLUMN IF NOT EXISTS show_peer_payouts boolean NOT NULL DEFAULT true;

DROP POLICY IF EXISTS "fs_commission_entries_select" ON public.fs_commission_entries;
CREATE POLICY "fs_commission_entries_select" ON public.fs_commission_entries
  FOR SELECT TO authenticated USING (
    -- your own
    user_id = auth.uid()
    -- owner/admin see everything
    OR org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
    -- peers see each other's when the org enabled it
    OR EXISTS (
      SELECT 1 FROM public.field_settings fs
      WHERE fs.org_id = fs_commission_entries.org_id
        AND fs.show_peer_payouts = true
        AND fs.org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
    )
  );
