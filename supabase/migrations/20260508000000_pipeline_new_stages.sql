-- Migration: Update pipeline stages from
--   [new, follow_up_1, follow_up_2, follow_up_3, closed, lost]
-- to:
--   [new_prospect, no_response, quote_sent, closed_won, closed_lost]

BEGIN;

-- 1. Migrate existing deal stages to new values
UPDATE pipeline_deals SET stage = 'new_prospect'  WHERE stage = 'new';
UPDATE pipeline_deals SET stage = 'no_response'   WHERE stage = 'follow_up_1';
UPDATE pipeline_deals SET stage = 'quote_sent'    WHERE stage IN ('follow_up_2', 'follow_up_3');
UPDATE pipeline_deals SET stage = 'closed_won'    WHERE stage = 'closed';
UPDATE pipeline_deals SET stage = 'closed_lost'   WHERE stage = 'lost';

-- 2. Drop old CHECK constraint and add new one
ALTER TABLE pipeline_deals DROP CONSTRAINT IF EXISTS pipeline_deals_stage_check;
ALTER TABLE pipeline_deals ADD CONSTRAINT pipeline_deals_stage_check
  CHECK (stage IN ('new_prospect', 'no_response', 'quote_sent', 'closed_won', 'closed_lost'));

-- 3. Migrate lead statuses
UPDATE leads SET status = 'new_prospect'  WHERE status = 'new';
UPDATE leads SET status = 'no_response'   WHERE status = 'follow_up_1';
UPDATE leads SET status = 'quote_sent'    WHERE status IN ('follow_up_2', 'follow_up_3');
UPDATE leads SET status = 'closed_won'    WHERE status = 'closed';
UPDATE leads SET status = 'closed_lost'   WHERE status = 'lost';

-- 4. Update set_deal_stage RPC to handle new stage names
CREATE OR REPLACE FUNCTION set_deal_stage(p_deal_id uuid, p_stage text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  UPDATE pipeline_deals
  SET stage      = p_stage,
      updated_at = v_now,
      won_at     = CASE WHEN p_stage = 'closed_won'  THEN v_now ELSE won_at END,
      lost_at    = CASE WHEN p_stage = 'closed_lost' THEN v_now ELSE lost_at END
  WHERE id = p_deal_id;
END;
$$;

-- 5. Recreate pipeline_deals_visible view with new stage names
CREATE OR REPLACE VIEW pipeline_deals_visible AS
SELECT *
FROM pipeline_deals
WHERE deleted_at IS NULL
  AND NOT (
    stage = 'closed_won' AND won_at < now() - interval '2 days'
  )
  AND NOT (
    stage = 'closed_lost' AND lost_at < now() - interval '15 days'
  );

COMMIT;
