-- SECURITY FIX: the quotes_public_view_token policy let the `anon` role SELECT
-- ANY non-deleted quote (USING view_token IS NOT NULL) — not a specific token —
-- so an unauthenticated client could enumerate every org's quotes (client names,
-- prices). The public quote-approval page (/quote/:token) reads through the
-- SERVER route GET /api/quotes/public/:token (service role), NOT the anon client,
-- so this policy is unnecessary. Drop it. Authenticated org members still read
-- quotes via the org-membership policy (quotes_select). Idempotent.

DROP POLICY IF EXISTS quotes_public_view_token ON public.quotes;
