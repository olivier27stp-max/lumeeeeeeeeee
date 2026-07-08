-- ============================================================
-- 🔴 CRITIQUE — Correctifs de fuite inter-tenant (RLS)
-- Audit 2026-07-08. NON APPLIQUÉ. Requiert approbation humaine (Règle 2).
-- Les deux fuites ci-dessous ont été PROUVÉES en prod (voir REPORT).
-- ============================================================

begin;

-- ────────────────────────────────────────────────────────────
-- FIX #1 — Vue `properties_active` fuit TOUS les tenants
-- ------------------------------------------------------------
-- Prouvé : un user authentifié d'un org voit `properties` = 1 org (RLS ok),
-- mais `properties_active` = 48 propriétés / 14 orgs (adresses + GPS de tous).
-- Cause : la vue n'a pas `security_invoker` → tourne en tant que postgres
-- (BYPASSRLS). Les 10 autres vues ont déjà `security_invoker=on` ; celle-ci
-- a été oubliée. Fix = l'aligner sur les autres.
alter view public.properties_active set (security_invoker = on);
-- Rollback : alter view public.properties_active reset (security_invoker);
--   (⚠️ le rollback RÉOUVRE la fuite — ne roll back que si ça casse une lecture
--    légitime, et dans ce cas corriger l'appelant, pas la sécurité.)

-- ────────────────────────────────────────────────────────────
-- FIX #2 — `satisfaction_surveys` : lecture anonyme de tous les tenants
-- ------------------------------------------------------------
-- La policy `surveys_select_anon` = SELECT pour le rôle `anon` avec USING(true)
-- → n'importe quel visiteur non authentifié peut lister TOUS les sondages
-- (feedback, rating, client_id, job_id, org_id) de tous les tenants via
-- l'API publique. Or l'app lit/écrit ces sondages UNIQUEMENT côté serveur
-- (server/routes/surveys.ts, via service_role qui bypasse RLS). Donc cette
-- policy anon n'est pas utilisée par l'app — on la retire.
drop policy if exists surveys_select_anon on public.satisfaction_surveys;
-- Rollback : create policy surveys_select_anon on public.satisfaction_surveys
--              for select to anon using (true);
-- NOTE dev : si la page publique de sondage lit la table DIRECTEMENT en anon
-- (via supabase-js dans le navigateur) plutôt que via /api, alors remplacer
-- par une policy scopée au token au lieu de retirer :
--   using (token = current_setting('request.jwt.claims', true)::json ->> 'token')
-- (à valider — le code actuel passe par le serveur, donc drop = safe.)

commit;

-- ── Vérification post-fix (à lancer en tant que rôle authenticated d'un org) ──
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<user_uuid>","role":"authenticated"}';
--   select count(distinct org_id) from properties_active;  -- doit = 1 (plus 14)
-- rollback;
