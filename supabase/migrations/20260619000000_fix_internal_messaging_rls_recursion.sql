-- ═══════════════════════════════════════════════════════════════
-- Fix: infinite recursion in internal_conversation_participants RLS
--
-- Problem: The SELECT policy on internal_conversation_participants
-- did a sub-SELECT on the SAME table, which re-triggered the same
-- policy → infinite recursion.
--
-- Solution: Create a SECURITY DEFINER function that bypasses RLS
-- to check participation, then use it in all policies that need
-- to verify "is user a participant of this conversation?"
-- ═══════════════════════════════════════════════════════════════

-- 1. Helper function (SECURITY DEFINER = bypasses RLS, no recursion)
CREATE OR REPLACE FUNCTION public.is_conversation_participant(p_conversation_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.internal_conversation_participants
    WHERE conversation_id = p_conversation_id
      AND user_id = p_user_id
  );
$$;

-- 2. Fix participants SELECT policy
DROP POLICY IF EXISTS internal_participants_select ON public.internal_conversation_participants;
CREATE POLICY internal_participants_select ON public.internal_conversation_participants
  FOR SELECT USING (
    public.is_conversation_participant(conversation_id, auth.uid())
  );

-- 3. Fix messages SELECT policy (also referenced the same table)
DROP POLICY IF EXISTS internal_messages_select ON public.internal_messages;
CREATE POLICY internal_messages_select ON public.internal_messages
  FOR SELECT USING (
    public.is_conversation_participant(conversation_id, auth.uid())
  );

-- 4. Fix messages INSERT policy
DROP POLICY IF EXISTS internal_messages_insert ON public.internal_messages;
CREATE POLICY internal_messages_insert ON public.internal_messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid()
    AND public.is_conversation_participant(conversation_id, auth.uid())
  );
