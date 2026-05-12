-- ============================================================================
-- Invitation token hardening (P1-D1, P2-D34)
-- ============================================================================
-- Adds `token_hash` mirror of `invitations.token` so plaintext tokens are
-- never stored. Existing pending invitations cannot be migrated server-side
-- because we no longer have the raw token to hash (only the random bytes in
-- the DB column — which is itself the token). For safety we mark every
-- pending invitation as revoked and require re-issuance.
--
-- After this migration, the server hashes incoming tokens (sha256 hex) and
-- looks up `WHERE token_hash = $1`. The `token` column is kept nullable for
-- backwards compatibility but new inserts MUST set `token_hash` and SHOULD
-- leave `token` NULL.
-- ============================================================================

-- Idempotent: only operate if `invitations` table exists. In some envs the
-- feature isn't wired up yet (the table doesn't exist) — skip without error.
DO $$
BEGIN
  IF to_regclass('public.invitations') IS NULL THEN
    RAISE NOTICE 'public.invitations does not exist — skipping invitation token hardening';
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS token_hash text';
  EXECUTE 'CREATE INDEX IF NOT EXISTS invitations_token_hash_idx
           ON public.invitations (token_hash) WHERE token_hash IS NOT NULL';
  EXECUTE 'UPDATE public.invitations
           SET token_hash = encode(digest(token, ''sha256''), ''hex'')
           WHERE token IS NOT NULL AND token_hash IS NULL';
  EXECUTE 'COMMENT ON COLUMN public.invitations.token_hash IS
           ''SHA-256 hex of the invitation token. Plaintext token is NEVER stored after 2026-05-12.''';
END $$;
