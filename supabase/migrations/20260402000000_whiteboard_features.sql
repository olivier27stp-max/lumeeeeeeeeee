-- ORDER_HINT: 2/2 — timestamp collision with 20260402000000_quote_templates_v2.sql
-- (Issue C-001, audit 2026-04-21). Apply this file AFTER the sibling.
-- Lexicographic order by full filename matches intended order. Do NOT rename (would break applied-migration checksums).

-- ═══════════════════════════════════════════════════════════════
-- Whiteboard Features: Comments, Votes, Drawings, Permissions
-- Safe to re-run (IF NOT EXISTS + DROP POLICY IF EXISTS)
-- ═══════════════════════════════════════════════════════════════

-- ─── Board Comments (threaded) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS board_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id    uuid NOT NULL REFERENCES note_boards(id) ON DELETE CASCADE,
  item_id     uuid REFERENCES note_items(id) ON DELETE CASCADE,
  parent_id   uuid REFERENCES board_comments(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id),
  user_name   text NOT NULL DEFAULT '',
  content     text NOT NULL DEFAULT '',
  resolved    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_board_comments_board ON board_comments(board_id);
CREATE INDEX IF NOT EXISTS idx_board_comments_item  ON board_comments(item_id);

-- ─── Board Votes ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS board_votes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id    uuid NOT NULL REFERENCES note_boards(id) ON DELETE CASCADE,
  item_id     uuid NOT NULL REFERENCES note_items(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id),
  user_name   text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(board_id, item_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_board_votes_board ON board_votes(board_id);

-- ─── Board Drawings (free draw paths) ─────────────────────────
CREATE TABLE IF NOT EXISTS board_drawings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id      uuid NOT NULL REFERENCES note_boards(id) ON DELETE CASCADE,
  created_by    uuid NOT NULL REFERENCES auth.users(id),
  path_data     text NOT NULL DEFAULT '',
  color         text NOT NULL DEFAULT '#000000',
  stroke_width  real NOT NULL DEFAULT 3,
  opacity       real NOT NULL DEFAULT 1,
  tool          text NOT NULL DEFAULT 'pen',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_board_drawings_board ON board_drawings(board_id);

-- ─── Board Members (permissions) ──────────────────────────────
CREATE TABLE IF NOT EXISTS board_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id    uuid NOT NULL REFERENCES note_boards(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id),
  role        text NOT NULL DEFAULT 'editor' CHECK (role IN ('viewer', 'editor', 'owner')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(board_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_board_members_board ON board_members(board_id);
CREATE INDEX IF NOT EXISTS idx_board_members_user  ON board_members(user_id);

-- ─── RLS Policies (drop + recreate to be idempotent) ──────────

-- Comments
ALTER TABLE board_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "board_comments_select" ON board_comments;
DROP POLICY IF EXISTS "board_comments_insert" ON board_comments;
DROP POLICY IF EXISTS "board_comments_update" ON board_comments;
DROP POLICY IF EXISTS "board_comments_delete" ON board_comments;

CREATE POLICY "board_comments_select" ON board_comments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM note_boards nb
      JOIN memberships m ON m.org_id = nb.org_id AND m.user_id = auth.uid()
      WHERE nb.id = board_comments.board_id
    )
  );

CREATE POLICY "board_comments_insert" ON board_comments
  FOR INSERT WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM note_boards nb
      JOIN memberships m ON m.org_id = nb.org_id AND m.user_id = auth.uid()
      WHERE nb.id = board_comments.board_id
    )
  );

CREATE POLICY "board_comments_update" ON board_comments
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "board_comments_delete" ON board_comments
  FOR DELETE USING (auth.uid() = user_id);

-- Votes
ALTER TABLE board_votes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "board_votes_select" ON board_votes;
DROP POLICY IF EXISTS "board_votes_insert" ON board_votes;
DROP POLICY IF EXISTS "board_votes_delete" ON board_votes;

CREATE POLICY "board_votes_select" ON board_votes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM note_boards nb
      JOIN memberships m ON m.org_id = nb.org_id AND m.user_id = auth.uid()
      WHERE nb.id = board_votes.board_id
    )
  );

CREATE POLICY "board_votes_insert" ON board_votes
  FOR INSERT WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM note_boards nb
      JOIN memberships m ON m.org_id = nb.org_id AND m.user_id = auth.uid()
      WHERE nb.id = board_votes.board_id
    )
  );

CREATE POLICY "board_votes_delete" ON board_votes
  FOR DELETE USING (auth.uid() = user_id);

-- Drawings
ALTER TABLE board_drawings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "board_drawings_select" ON board_drawings;
DROP POLICY IF EXISTS "board_drawings_insert" ON board_drawings;
DROP POLICY IF EXISTS "board_drawings_delete" ON board_drawings;

CREATE POLICY "board_drawings_select" ON board_drawings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM note_boards nb
      JOIN memberships m ON m.org_id = nb.org_id AND m.user_id = auth.uid()
      WHERE nb.id = board_drawings.board_id
    )
  );

CREATE POLICY "board_drawings_insert" ON board_drawings
  FOR INSERT WITH CHECK (
    auth.uid() = created_by AND
    EXISTS (
      SELECT 1 FROM note_boards nb
      JOIN memberships m ON m.org_id = nb.org_id AND m.user_id = auth.uid()
      WHERE nb.id = board_drawings.board_id
    )
  );

CREATE POLICY "board_drawings_delete" ON board_drawings
  FOR DELETE USING (auth.uid() = created_by);

-- Board Members
ALTER TABLE board_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "board_members_select" ON board_members;
DROP POLICY IF EXISTS "board_members_insert" ON board_members;
DROP POLICY IF EXISTS "board_members_delete" ON board_members;

CREATE POLICY "board_members_select" ON board_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM note_boards nb
      JOIN memberships m ON m.org_id = nb.org_id AND m.user_id = auth.uid()
      WHERE nb.id = board_members.board_id
    )
  );

CREATE POLICY "board_members_insert" ON board_members
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM board_members bm
      WHERE bm.board_id = board_members.board_id
        AND bm.user_id = auth.uid()
        AND bm.role = 'owner'
    )
  );

CREATE POLICY "board_members_delete" ON board_members
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM board_members bm
      WHERE bm.board_id = board_members.board_id
        AND bm.user_id = auth.uid()
        AND bm.role = 'owner'
    )
  );

-- ─── Enable realtime for new tables ───────────────────────────
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE board_comments;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE board_votes;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE board_drawings;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
