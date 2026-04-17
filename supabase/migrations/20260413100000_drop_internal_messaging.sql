-- ============================================================
-- Drop internal messaging tables (Fil interne feature removed)
-- ============================================================

-- Drop tables first (CASCADE removes dependent policies/triggers)
DROP TABLE IF EXISTS public.internal_messages CASCADE;
DROP TABLE IF EXISTS public.internal_conversation_participants CASCADE;
DROP TABLE IF EXISTS public.internal_conversations CASCADE;

-- Drop functions after tables are gone
DROP FUNCTION IF EXISTS public.internal_message_after_insert() CASCADE;
DROP FUNCTION IF EXISTS public.is_conversation_participant(uuid, uuid) CASCADE;
