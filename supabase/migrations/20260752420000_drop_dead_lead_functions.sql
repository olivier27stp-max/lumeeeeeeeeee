-- ============================================================================
-- Nettoyage : drop du cluster de fonctions mortes référençant leads (supprimée)
-- 2026-08-02
-- ============================================================================
-- Reliquats du modèle « leads » (migré vers pipeline_deals). Toutes vérifiées :
--   - 0 trigger attaché
--   - 0 appel dans le code app (src/ + server/)
--   - 0 appelant en base, sauf convert_lead_to_client dont le seul appelant est
--     on_pipeline_deal_stage_change (lui-même mort, non attaché à un trigger ;
--     le vrai handler de stage est sync_lead_stage_from_deal).
-- Elles sont déjà cassées (référencent public.leads inexistante) => les dropper
-- est strictement sûr. Ordre : appelant avant appelé.
-- ============================================================================

begin;

drop function if exists public.on_pipeline_deal_stage_change();
drop function if exists public.convert_lead_to_client(uuid);

drop function if exists public.create_job_from_lead(uuid, uuid, jsonb);
drop function if exists public.create_job_from_lead(uuid, uuid, text, text, timestamptz, timestamptz);
drop function if exists public.create_job_from_lead(uuid, uuid, text, text, timestamptz, timestamptz, uuid);

drop function if exists public.create_lead_with_client(uuid, jsonb);
drop function if exists public.soft_delete_client_conditional(uuid, uuid);

commit;
