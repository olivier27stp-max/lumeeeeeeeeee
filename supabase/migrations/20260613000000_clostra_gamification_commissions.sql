-- ============================================================================
-- Clostra Integration: Gamification, Commissions, Feed, Field Sessions
-- Adds D2D field sales features from Clostra into Lume CRM
-- All tables use org_id for multi-tenancy and RLS via has_org_membership()
-- ============================================================================

-- ============================================================================
-- 1. BADGES — Badge definitions
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fs_badges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  slug            text NOT NULL,
  name_en         text NOT NULL,
  name_fr         text NOT NULL,
  description_en  text,
  description_fr  text,
  icon            text,
  color           text,
  category        text,
  criteria        jsonb DEFAULT '{}',
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  UNIQUE(org_id, slug)
);

ALTER TABLE public.fs_badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fs_badges_select" ON public.fs_badges
  FOR SELECT TO authenticated USING (
    org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
  );

CREATE POLICY "fs_badges_modify" ON public.fs_badges
  FOR ALL TO authenticated USING (
    org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  ) WITH CHECK (
    org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- ============================================================================
-- 2. REP BADGES — Badges earned by team members
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fs_rep_badges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  badge_id    uuid NOT NULL REFERENCES public.fs_badges(id) ON DELETE CASCADE,
  earned_at   timestamptz NOT NULL DEFAULT now(),
  metadata    jsonb DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fs_rep_badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fs_rep_badges_select" ON public.fs_rep_badges
  FOR SELECT TO authenticated USING (
    org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
  );

CREATE POLICY "fs_rep_badges_insert" ON public.fs_rep_badges
  FOR INSERT TO authenticated WITH CHECK (
    org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- ============================================================================
-- 3. REP STAT SNAPSHOTS — Materialized performance snapshots
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fs_rep_stat_snapshots (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period                text NOT NULL CHECK (period IN ('daily', 'weekly', 'monthly')),
  period_start          date NOT NULL,
  period_end            date NOT NULL,
  doors_knocked         int NOT NULL DEFAULT 0,
  conversations         int NOT NULL DEFAULT 0,
  demos_set             int NOT NULL DEFAULT 0,
  demos_held            int NOT NULL DEFAULT 0,
  quotes_sent           int NOT NULL DEFAULT 0,
  closes                int NOT NULL DEFAULT 0,
  revenue               numeric NOT NULL DEFAULT 0,
  follow_ups_completed  int NOT NULL DEFAULT 0,
  conversion_rate       numeric NOT NULL DEFAULT 0,
  average_ticket        numeric NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, period, period_start)
);

CREATE INDEX idx_fs_rep_stat_snapshots_user_period
  ON public.fs_rep_stat_snapshots(user_id, period, period_start);

ALTER TABLE public.fs_rep_stat_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fs_rep_stat_snapshots_select" ON public.fs_rep_stat_snapshots
  FOR SELECT TO authenticated USING (
    org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
  );

CREATE POLICY "fs_rep_stat_snapshots_modify" ON public.fs_rep_stat_snapshots
  FOR ALL TO authenticated USING (
    org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  ) WITH CHECK (
    org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- ============================================================================
-- 4. CHALLENGES — Team/individual challenges
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fs_challenges (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name_en           text NOT NULL,
  name_fr           text NOT NULL,
  description_en    text,
  description_fr    text,
  type              text NOT NULL CHECK (type IN ('daily', 'weekly')),
  metric_slug       text NOT NULL,
  target_value      numeric,
  start_date        date NOT NULL,
  end_date          date NOT NULL,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  prize_description text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

ALTER TABLE public.fs_challenges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fs_challenges_select" ON public.fs_challenges
  FOR SELECT TO authenticated USING (
    org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
  );

CREATE POLICY "fs_challenges_modify" ON public.fs_challenges
  FOR ALL TO authenticated USING (
    org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  ) WITH CHECK (
    org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- ============================================================================
-- 5. CHALLENGE PARTICIPANTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fs_challenge_participants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id    uuid NOT NULL REFERENCES public.fs_challenges(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  current_value   numeric NOT NULL DEFAULT 0,
  completed_at    timestamptz,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(challenge_id, user_id)
);

ALTER TABLE public.fs_challenge_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fs_challenge_participants_select" ON public.fs_challenge_participants
  FOR SELECT TO authenticated USING (
    challenge_id IN (
      SELECT id FROM public.fs_challenges
      WHERE org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "fs_challenge_participants_insert" ON public.fs_challenge_participants
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "fs_challenge_participants_update" ON public.fs_challenge_participants
  FOR UPDATE TO authenticated USING (
    challenge_id IN (
      SELECT id FROM public.fs_challenges
      WHERE org_id IN (
        SELECT org_id FROM public.memberships
        WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
      )
    )
  );

-- ============================================================================
-- 6. BATTLES — Rep vs rep or team vs team
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fs_battles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                text NOT NULL,
  type                text NOT NULL CHECK (type IN ('rep_vs_rep', 'team_vs_team')),
  metric_slug         text NOT NULL,
  challenger_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  challenger_team_id  uuid,
  opponent_user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  opponent_team_id    uuid,
  challenger_score    numeric NOT NULL DEFAULT 0,
  opponent_score      numeric NOT NULL DEFAULT 0,
  start_date          date NOT NULL,
  end_date            date NOT NULL,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'cancelled')),
  winner_user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  winner_team_id      uuid,
  prize_description   text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

ALTER TABLE public.fs_battles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fs_battles_select" ON public.fs_battles
  FOR SELECT TO authenticated USING (
    org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
  );

CREATE POLICY "fs_battles_modify" ON public.fs_battles
  FOR ALL TO authenticated USING (
    org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  ) WITH CHECK (
    org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- ============================================================================
-- 7. FEED POSTS — Social feed
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fs_feed_posts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type            text NOT NULL CHECK (type IN ('win', 'milestone', 'badge', 'challenge', 'battle', 'manual')),
  visibility      text NOT NULL DEFAULT 'company' CHECK (visibility IN ('company', 'team')),
  team_id         uuid,
  title           text,
  body            text,
  image_url       text,
  reference_type  text,
  reference_id    uuid,
  is_pinned       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX idx_fs_feed_posts_org_created ON public.fs_feed_posts(org_id, created_at DESC);

ALTER TABLE public.fs_feed_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fs_feed_posts_select" ON public.fs_feed_posts
  FOR SELECT TO authenticated USING (
    org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
    AND deleted_at IS NULL
  );

CREATE POLICY "fs_feed_posts_insert" ON public.fs_feed_posts
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid()
    AND org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
  );

CREATE POLICY "fs_feed_posts_update" ON public.fs_feed_posts
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "fs_feed_posts_delete" ON public.fs_feed_posts
  FOR DELETE TO authenticated USING (
    user_id = auth.uid()
    OR org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- ============================================================================
-- 8. FEED REACTIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fs_feed_reactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     uuid NOT NULL REFERENCES public.fs_feed_posts(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji       text NOT NULL CHECK (emoji IN ('fire', 'clap', 'trophy', 'heart')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(post_id, user_id)
);

ALTER TABLE public.fs_feed_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fs_feed_reactions_select" ON public.fs_feed_reactions
  FOR SELECT TO authenticated USING (
    post_id IN (
      SELECT id FROM public.fs_feed_posts
      WHERE org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "fs_feed_reactions_insert" ON public.fs_feed_reactions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "fs_feed_reactions_delete" ON public.fs_feed_reactions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ============================================================================
-- 9. FEED COMMENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fs_feed_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     uuid NOT NULL REFERENCES public.fs_feed_posts(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fs_feed_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fs_feed_comments_select" ON public.fs_feed_comments
  FOR SELECT TO authenticated USING (
    post_id IN (
      SELECT id FROM public.fs_feed_posts
      WHERE org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "fs_feed_comments_insert" ON public.fs_feed_comments
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "fs_feed_comments_update" ON public.fs_feed_comments
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "fs_feed_comments_delete" ON public.fs_feed_comments
  FOR DELETE TO authenticated USING (
    user_id = auth.uid()
    OR post_id IN (
      SELECT id FROM public.fs_feed_posts
      WHERE org_id IN (
        SELECT org_id FROM public.memberships
        WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
      )
    )
  );

-- ============================================================================
-- 10. COMMISSION RULES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fs_commission_rules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  description           text,
  type                  text NOT NULL CHECK (type IN ('flat', 'percentage', 'tiered')),
  flat_amount           numeric,
  percentage            numeric,
  tiers                 jsonb DEFAULT '[]',
  applies_to_role       text,
  applies_to_user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_active             boolean NOT NULL DEFAULT true,
  priority              int NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

ALTER TABLE public.fs_commission_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fs_commission_rules_select" ON public.fs_commission_rules
  FOR SELECT TO authenticated USING (
    org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
  );

CREATE POLICY "fs_commission_rules_modify" ON public.fs_commission_rules
  FOR ALL TO authenticated USING (
    org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  ) WITH CHECK (
    org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- ============================================================================
-- 11. COMMISSION ENTRIES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fs_commission_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rule_id         uuid NOT NULL REFERENCES public.fs_commission_rules(id) ON DELETE RESTRICT,
  lead_id         uuid,
  job_id          uuid,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'reversed')),
  amount          numeric NOT NULL,
  base_amount     numeric NOT NULL DEFAULT 0,
  description     text,
  approved_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at     timestamptz,
  paid_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX idx_fs_commission_entries_user_status
  ON public.fs_commission_entries(user_id, status);

ALTER TABLE public.fs_commission_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fs_commission_entries_select" ON public.fs_commission_entries
  FOR SELECT TO authenticated USING (
    user_id = auth.uid()
    OR org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "fs_commission_entries_modify" ON public.fs_commission_entries
  FOR ALL TO authenticated USING (
    org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  ) WITH CHECK (
    org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- ============================================================================
-- 12. FIELD SESSIONS — Field session lifecycle
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fs_field_sessions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id                 uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  territory_id            uuid,
  status                  text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),
  started_at              timestamptz NOT NULL DEFAULT now(),
  paused_at               timestamptz,
  completed_at            timestamptz,
  total_duration_minutes  int,
  doors_knocked           int NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_fs_field_sessions_user_status
  ON public.fs_field_sessions(user_id, status);

ALTER TABLE public.fs_field_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fs_field_sessions_select" ON public.fs_field_sessions
  FOR SELECT TO authenticated USING (
    user_id = auth.uid()
    OR org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "fs_field_sessions_insert" ON public.fs_field_sessions
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid()
    AND org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
  );

CREATE POLICY "fs_field_sessions_update" ON public.fs_field_sessions
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- ============================================================================
-- 13. GPS POINTS — GPS breadcrumb trail
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fs_gps_points (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL REFERENCES public.fs_field_sessions(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lat               double precision NOT NULL,
  lng               double precision NOT NULL,
  accuracy          numeric,
  altitude          numeric,
  speed             numeric,
  heading           numeric,
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_fs_gps_points_session ON public.fs_gps_points(session_id, recorded_at);

ALTER TABLE public.fs_gps_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fs_gps_points_select" ON public.fs_gps_points
  FOR SELECT TO authenticated USING (
    user_id = auth.uid()
    OR session_id IN (
      SELECT id FROM public.fs_field_sessions
      WHERE org_id IN (
        SELECT org_id FROM public.memberships
        WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
      )
    )
  );

CREATE POLICY "fs_gps_points_insert" ON public.fs_gps_points
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- ============================================================================
-- 14. CHECK-IN RECORDS — Check-in / check-out
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fs_check_in_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id      uuid REFERENCES public.fs_field_sessions(id) ON DELETE SET NULL,
  type            text NOT NULL CHECK (type IN ('check_in', 'check_out')),
  lat             double precision NOT NULL,
  lng             double precision NOT NULL,
  accuracy        numeric,
  photo_url       text,
  notes           text,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fs_check_in_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fs_check_in_records_select" ON public.fs_check_in_records
  FOR SELECT TO authenticated USING (
    user_id = auth.uid()
    OR org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "fs_check_in_records_insert" ON public.fs_check_in_records
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- ============================================================================
-- 15. SEED: Default badges for new orgs (inserted via service role)
-- These can be created per-org on first visit to the gamification page.
-- ============================================================================

-- No seed data here — badges are created dynamically per org when the
-- gamification feature is first enabled, using the default badge set
-- defined in the server-side gamification engine.
