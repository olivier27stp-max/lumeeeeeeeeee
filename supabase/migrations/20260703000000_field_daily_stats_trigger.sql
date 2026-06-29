-- Keep field_daily_stats in sync with field_house_events automatically.
--
-- WHY: the desktop reads the pre-aggregated field_daily_stats table, but the
-- mobile app logs field_house_events DIRECTLY via Supabase (it doesn't go
-- through the server route that used to bump the aggregate). So mobile-logged
-- door activity never reached field_daily_stats and the two clients showed
-- different numbers. This trigger makes field_daily_stats a faithful aggregate
-- of the events regardless of who writes them, so desktop (reads the table) and
-- mobile (aggregates raw events) converge. Idempotent.

CREATE OR REPLACE FUNCTION public.fn_field_daily_stats_apply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d date := (NEW.created_at AT TIME ZONE 'UTC')::date;
BEGIN
  INSERT INTO public.field_daily_stats (org_id, user_id, date,
    knocks, no_answers, leads, quotes_sent, sales, callbacks)
  VALUES (NEW.org_id, NEW.user_id, d,
    CASE WHEN NEW.event_type = 'knock'      THEN 1 ELSE 0 END,
    CASE WHEN NEW.event_type = 'no_answer'  THEN 1 ELSE 0 END,
    CASE WHEN NEW.event_type = 'lead'       THEN 1 ELSE 0 END,
    CASE WHEN NEW.event_type = 'quote_sent' THEN 1 ELSE 0 END,
    CASE WHEN NEW.event_type = 'sale'       THEN 1 ELSE 0 END,
    CASE WHEN NEW.event_type = 'callback'   THEN 1 ELSE 0 END)
  ON CONFLICT (org_id, user_id, date) DO UPDATE SET
    knocks      = public.field_daily_stats.knocks      + EXCLUDED.knocks,
    no_answers  = public.field_daily_stats.no_answers  + EXCLUDED.no_answers,
    leads       = public.field_daily_stats.leads       + EXCLUDED.leads,
    quotes_sent = public.field_daily_stats.quotes_sent + EXCLUDED.quotes_sent,
    sales       = public.field_daily_stats.sales       + EXCLUDED.sales,
    callbacks   = public.field_daily_stats.callbacks   + EXCLUDED.callbacks;

  -- Recompute conversion rate (sales / knocks).
  UPDATE public.field_daily_stats
     SET conversion_rate = CASE WHEN knocks > 0
            THEN ROUND((sales::numeric / knocks::numeric) * 100, 2) ELSE 0 END
   WHERE org_id = NEW.org_id AND user_id = NEW.user_id AND date = d;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_field_daily_stats_apply ON public.field_house_events;
CREATE TRIGGER trg_field_daily_stats_apply
  AFTER INSERT ON public.field_house_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_field_daily_stats_apply();

-- One-time backfill: rebuild field_daily_stats from all existing events so
-- historical mobile activity is reflected immediately.
INSERT INTO public.field_daily_stats (org_id, user_id, date,
  knocks, no_answers, leads, quotes_sent, sales, callbacks, conversion_rate)
SELECT e.org_id, e.user_id, (e.created_at AT TIME ZONE 'UTC')::date AS d,
  COUNT(*) FILTER (WHERE e.event_type = 'knock'),
  COUNT(*) FILTER (WHERE e.event_type = 'no_answer'),
  COUNT(*) FILTER (WHERE e.event_type = 'lead'),
  COUNT(*) FILTER (WHERE e.event_type = 'quote_sent'),
  COUNT(*) FILTER (WHERE e.event_type = 'sale'),
  COUNT(*) FILTER (WHERE e.event_type = 'callback'),
  CASE WHEN COUNT(*) FILTER (WHERE e.event_type = 'knock') > 0
    THEN ROUND((COUNT(*) FILTER (WHERE e.event_type = 'sale')::numeric
              / COUNT(*) FILTER (WHERE e.event_type = 'knock')::numeric) * 100, 2)
    ELSE 0 END
FROM public.field_house_events e
GROUP BY e.org_id, e.user_id, (e.created_at AT TIME ZONE 'UTC')::date
ON CONFLICT (org_id, user_id, date) DO UPDATE SET
  knocks          = EXCLUDED.knocks,
  no_answers      = EXCLUDED.no_answers,
  leads           = EXCLUDED.leads,
  quotes_sent     = EXCLUDED.quotes_sent,
  sales           = EXCLUDED.sales,
  callbacks       = EXCLUDED.callbacks,
  conversion_rate = EXCLUDED.conversion_rate;
