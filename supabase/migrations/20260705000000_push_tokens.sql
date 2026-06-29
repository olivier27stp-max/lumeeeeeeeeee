-- Device push tokens for real push notifications (Expo Push). The MOBILE side
-- still needs `npx expo install expo-notifications` + a native rebuild to obtain
-- a token, and a SERVER sender (Expo Push API) to deliver — but the storage is
-- ready here. One row per (user, device token). Idempotent.

CREATE TABLE IF NOT EXISTS public.push_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL DEFAULT auth.uid(),
  token       text NOT NULL,
  platform    text CHECK (platform IN ('ios', 'android', 'web')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS push_tokens_org_idx ON public.push_tokens (org_id);

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_tokens_select ON public.push_tokens;
CREATE POLICY push_tokens_select ON public.push_tokens
  FOR SELECT USING (public.has_org_membership(auth.uid(), org_id));

DROP POLICY IF EXISTS push_tokens_upsert ON public.push_tokens;
CREATE POLICY push_tokens_upsert ON public.push_tokens
  FOR INSERT WITH CHECK (user_id = auth.uid() AND public.has_org_membership(auth.uid(), org_id));

DROP POLICY IF EXISTS push_tokens_update ON public.push_tokens;
CREATE POLICY push_tokens_update ON public.push_tokens
  FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS push_tokens_delete ON public.push_tokens;
CREATE POLICY push_tokens_delete ON public.push_tokens
  FOR DELETE USING (user_id = auth.uid());
