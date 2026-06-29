-- Push sender: when a notification is inserted, push it to the recipient's
-- devices via the Expo Push API, using pg_net (no server needed).
--
-- ⚠️ Activates real delivery only once: (1) a PAID Apple Developer account +
-- APNs key are configured, and (2) the app obtains EXPO push tokens (needs an
-- EAS projectId in app.json so getExpoPushTokenAsync returns ExponentPushToken[…]
-- which exp.host accepts). Until then this is a harmless no-op (no Expo tokens
-- stored). Run when activating push.

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.fn_push_on_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net
AS $$
DECLARE
  msgs jsonb;
BEGIN
  -- Build one Expo push message per target device (only Expo tokens).
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'to', pt.token,
      'title', NEW.title,
      'body', COALESCE(NEW.body, ''),
      'sound', 'default'
    )), '[]'::jsonb)
  INTO msgs
  FROM public.push_tokens pt
  WHERE pt.org_id = NEW.org_id
    AND (NEW.user_id IS NULL OR pt.user_id = NEW.user_id)
    AND pt.token LIKE 'ExponentPushToken%';

  IF msgs <> '[]'::jsonb THEN
    PERFORM net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := msgs
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_push_on_notification ON public.notifications;
CREATE TRIGGER trg_push_on_notification
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.fn_push_on_notification();
