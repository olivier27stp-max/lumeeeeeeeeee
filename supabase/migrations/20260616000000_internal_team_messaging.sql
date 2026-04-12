-- ============================================================
-- Internal Team Messaging (Sales Feed / "Fill")
-- Separate from client SMS messaging
-- ============================================================

BEGIN;

-- 1. Internal conversations (1:1 or group threads between team members)
CREATE TABLE IF NOT EXISTS public.internal_conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  title           text,
  is_group        boolean NOT NULL DEFAULT false,
  created_by      uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  last_message_text text,
  last_message_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_internal_convos_org ON public.internal_conversations(org_id);
CREATE INDEX IF NOT EXISTS idx_internal_convos_last ON public.internal_conversations(org_id, last_message_at DESC);

ALTER TABLE public.internal_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY internal_conversations_select ON public.internal_conversations
  FOR SELECT USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));
CREATE POLICY internal_conversations_insert ON public.internal_conversations
  FOR INSERT WITH CHECK (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));
CREATE POLICY internal_conversations_update ON public.internal_conversations
  FOR UPDATE USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));

-- 2. Participants of each internal conversation
CREATE TABLE IF NOT EXISTS public.internal_conversation_participants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.internal_conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  unread_count    integer NOT NULL DEFAULT 0,
  last_read_at    timestamptz,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_internal_participants_user ON public.internal_conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_internal_participants_convo ON public.internal_conversation_participants(conversation_id);

ALTER TABLE public.internal_conversation_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY internal_participants_select ON public.internal_conversation_participants
  FOR SELECT USING (user_id = auth.uid() OR conversation_id IN (
    SELECT conversation_id FROM public.internal_conversation_participants WHERE user_id = auth.uid()
  ));
CREATE POLICY internal_participants_insert ON public.internal_conversation_participants
  FOR INSERT WITH CHECK (true);
CREATE POLICY internal_participants_update ON public.internal_conversation_participants
  FOR UPDATE USING (user_id = auth.uid());

-- 3. Internal messages
CREATE TABLE IF NOT EXISTS public.internal_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.internal_conversations(id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  message_text    text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_internal_messages_convo ON public.internal_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_internal_messages_sender ON public.internal_messages(sender_id);

ALTER TABLE public.internal_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY internal_messages_select ON public.internal_messages
  FOR SELECT USING (conversation_id IN (
    SELECT conversation_id FROM public.internal_conversation_participants WHERE user_id = auth.uid()
  ));
CREATE POLICY internal_messages_insert ON public.internal_messages
  FOR INSERT WITH CHECK (sender_id = auth.uid() AND conversation_id IN (
    SELECT conversation_id FROM public.internal_conversation_participants WHERE user_id = auth.uid()
  ));

-- 4. Trigger: update conversation last_message on new message
CREATE OR REPLACE FUNCTION public.internal_message_after_insert()
RETURNS trigger AS $$
BEGIN
  UPDATE public.internal_conversations
  SET last_message_text = NEW.message_text,
      last_message_at = NEW.created_at,
      updated_at = NEW.created_at
  WHERE id = NEW.conversation_id;

  -- Increment unread for all participants except sender
  UPDATE public.internal_conversation_participants
  SET unread_count = unread_count + 1
  WHERE conversation_id = NEW.conversation_id
    AND user_id != NEW.sender_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_internal_message_after_insert ON public.internal_messages;
CREATE TRIGGER trg_internal_message_after_insert
  AFTER INSERT ON public.internal_messages
  FOR EACH ROW EXECUTE FUNCTION public.internal_message_after_insert();

COMMIT;
