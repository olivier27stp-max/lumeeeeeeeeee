-- Atomic increment for conversation unread_count (avoids race conditions)
CREATE OR REPLACE FUNCTION public.increment_unread_count(p_conversation_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE public.conversations
  SET unread_count = COALESCE(unread_count, 0) + 1,
      last_message_at = now()
  WHERE id = p_conversation_id;
$$;

-- Unique constraint on provider_message_id to prevent duplicate messages from Twilio retries
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_provider_message_id_unique
  ON public.messages (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- Ensure notifications table has the columns needed for SMS inbound
-- (is_read alias for ActivityCenter compatibility)
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false;

-- Auto-set is_read when read_at is set
CREATE OR REPLACE FUNCTION public.sync_notification_is_read()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.read_at IS NOT NULL AND NEW.is_read = false THEN
    NEW.is_read := true;
  END IF;
  IF NEW.is_read = true AND NEW.read_at IS NULL THEN
    NEW.read_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_notification_is_read ON public.notifications;
CREATE TRIGGER trg_sync_notification_is_read
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_notification_is_read();
