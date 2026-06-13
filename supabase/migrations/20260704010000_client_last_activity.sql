-- ============================================================
-- Client-facing "last activity" tracking
-- Adds clients.last_client_activity_at — stamped whenever a client
-- opens any client-facing link (portal, quote/invoice view).
-- ============================================================

BEGIN;

-- 1. Column
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS last_client_activity_at timestamptz;

-- 2. Backfill from existing quote/invoice view history (quote_views.client_id)
UPDATE public.clients c
SET last_client_activity_at = v.last_viewed
FROM (
  SELECT client_id, max(viewed_at) AS last_viewed
  FROM public.quote_views
  WHERE client_id IS NOT NULL
  GROUP BY client_id
) v
WHERE v.client_id = c.id
  AND (c.last_client_activity_at IS NULL OR v.last_viewed > c.last_client_activity_at);

COMMIT;
