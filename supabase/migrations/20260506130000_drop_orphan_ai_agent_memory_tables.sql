-- Drop orphan AI / agent / memory tables (no code references in src/ or server/).
--
-- WHY: Audit 2026-05-06 confirmed these 7 tables are not used by any frontend
-- or backend code. They originated from earlier iterations of the Memory Graph
-- and AI conversations modules that have since been removed/replaced.
-- agent_messages is preserved (used by server/routes/agent-auth.ts).
--
-- WHAT: DROP IF EXISTS with CASCADE for FK / policy / trigger cleanup.
-- No down migration; git history serves as rollback.

BEGIN;

DROP TABLE IF EXISTS public.agent_corrections CASCADE;
DROP TABLE IF EXISTS public.ai_tool_calls     CASCADE;
DROP TABLE IF EXISTS public.ai_messages       CASCADE;
DROP TABLE IF EXISTS public.ai_conversations  CASCADE;
DROP TABLE IF EXISTS public.memory_events     CASCADE;
DROP TABLE IF EXISTS public.memory_entities   CASCADE;
DROP TABLE IF EXISTS public.agent_sessions    CASCADE;

COMMIT;
