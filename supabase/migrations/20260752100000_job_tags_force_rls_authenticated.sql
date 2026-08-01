-- ============================================================================
-- Durcissement job_tags — aligne la table sur le standard des 219 autres (2026-08-01)
-- ============================================================================
-- Constat audit #2 (MEDIUM, non exploitable) : job_tags (migration 20260752000000)
-- avait RLS ACTIVEE mais pas FORCEE, et ses policies visaient le role `public`
-- au lieu de `authenticated`. L'isolation tenait (anon => auth.uid() NULL => set
-- vide => refuse), mais c'etait le seul cloisonnement de la base a devier du
-- standard (FORCE RLS + TO authenticated + wrapping InitPlan).
--
-- Ce fichier : (1) FORCE la RLS, (2) recree les 4 policies en `to authenticated`
-- avec `(select auth.uid())` (cache le plan). Predicat metier inchange.
-- Idempotent. Aucun changement de comportement pour les utilisateurs legitimes.
-- ============================================================================

begin;

alter table public.job_tags force row level security;

drop policy if exists job_tags_select on public.job_tags;
create policy job_tags_select on public.job_tags
  for select to authenticated
  using (org_id in (select m.org_id from public.memberships m where m.user_id = (select auth.uid())));

drop policy if exists job_tags_insert on public.job_tags;
create policy job_tags_insert on public.job_tags
  for insert to authenticated
  with check (org_id in (select m.org_id from public.memberships m where m.user_id = (select auth.uid())));

drop policy if exists job_tags_update on public.job_tags;
create policy job_tags_update on public.job_tags
  for update to authenticated
  using (org_id in (select m.org_id from public.memberships m where m.user_id = (select auth.uid())))
  with check (org_id in (select m.org_id from public.memberships m where m.user_id = (select auth.uid())));

drop policy if exists job_tags_delete on public.job_tags;
create policy job_tags_delete on public.job_tags
  for delete to authenticated
  using (org_id in (select m.org_id from public.memberships m where m.user_id = (select auth.uid())));

commit;
