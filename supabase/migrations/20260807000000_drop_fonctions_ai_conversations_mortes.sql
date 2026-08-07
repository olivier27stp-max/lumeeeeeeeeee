-- ============================================================================
-- Suppression de deux fonctions orphelines qui référencent `ai_conversations`.
--
-- POURQUOI
-- La table `public.ai_conversations` n'existe pas (aucune table `ai*` en base).
-- Ces deux fonctions la lisent quand même : elles planteraient en 42P01 si on
-- les appelait. C'est le motif de « référence orpheline » que CLAUDE.md dit de
-- traquer — le même qui avait laissé des fonctions cassées ~1 mois sans que
-- personne s'en aperçoive.
--
-- VÉRIFIÉ AVANT SUPPRESSION (2026-08-07, prod ET staging)
--   • aucun trigger attaché  (ai_on_message_insert est une fonction de trigger
--     sans trigger : pg_trigger = 0)
--   • aucune autre fonction ne les appelle  (balayage de pg_get_functiondef)
--   • aucune policy, aucune vue, aucun job pg_cron ne les cite
--   • aucune référence dans src/ ni server/ (rpc_ai_recent_conversations
--     n'apparaît que dans sa propre migration de création, 20260317000000)
--
-- Réversible : les corps d'origine sont dans 20260317000000_ai_conversations.sql
-- et 20260321000000_mega_security_performance_fix.sql. Les rejouer n'aurait de
-- sens qu'accompagné de la table `ai_conversations`, qui n'existe plus.
-- ============================================================================

drop function if exists public.ai_on_message_insert();
drop function if exists public.rpc_ai_recent_conversations(p_limit integer, p_offset integer);
