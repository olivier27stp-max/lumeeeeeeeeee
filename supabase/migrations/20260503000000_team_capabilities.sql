-- Team capabilities / skills / service types
-- Allows assigning what services each team can perform

CREATE TABLE IF NOT EXISTS public.team_capabilities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  team_id     uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  service_type text NOT NULL,
  skill_tags  text[] DEFAULT '{}',
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_capabilities_team ON public.team_capabilities(team_id);
CREATE INDEX IF NOT EXISTS idx_team_capabilities_org ON public.team_capabilities(org_id);

ALTER TABLE public.team_capabilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY team_capabilities_select ON public.team_capabilities
  FOR SELECT USING (public.has_org_membership(auth.uid(), org_id));
CREATE POLICY team_capabilities_insert ON public.team_capabilities
  FOR INSERT WITH CHECK (public.has_org_membership(auth.uid(), org_id));
CREATE POLICY team_capabilities_update ON public.team_capabilities
  FOR UPDATE USING (public.has_org_membership(auth.uid(), org_id));
CREATE POLICY team_capabilities_delete ON public.team_capabilities
  FOR DELETE USING (public.has_org_membership(auth.uid(), org_id));
