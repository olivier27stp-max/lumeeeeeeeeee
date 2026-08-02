-- ============================================================================
-- D5 — Wrap auth.uid() -> (select auth.uid()) sur 33 policies (lint perf 0003)
-- Audit métadonnées, 2026-08-01. ALTER POLICY = expression seulement, sémantique
-- identique. Fail-safe (rollback si malformé).
-- ============================================================================
-- D5 — wrap auth.uid() -> (select auth.uid()) sur 33 policies (perf lint 0003)
-- ALTER POLICY (expression seulement) : sémantique identique, roles/cmd inchangés.

alter policy "course_assignments_insert" on public.course_assignments with check ((EXISTS ( SELECT 1
   FROM courses
  WHERE ((courses.id = course_assignments.course_id) AND has_org_admin_role((select auth.uid()), courses.org_id)))));
alter policy "course_lessons_insert" on public.course_lessons with check ((EXISTS ( SELECT 1
   FROM (course_modules m
     JOIN courses c ON ((c.id = m.course_id)))
  WHERE ((m.id = course_lessons.module_id) AND has_org_admin_role((select auth.uid()), c.org_id)))));
alter policy "course_modules_insert" on public.course_modules with check ((EXISTS ( SELECT 1
   FROM courses
  WHERE ((courses.id = course_modules.course_id) AND has_org_admin_role((select auth.uid()), courses.org_id)))));
alter policy "courses_insert" on public.courses with check (has_org_admin_role((select auth.uid()), org_id));
alter policy "email_accounts_insert_own" on public.email_accounts with check (((user_id = (select auth.uid())) AND (org_id IN ( SELECT m.org_id
   FROM memberships m
  WHERE (m.user_id = (select auth.uid()))))));
alter policy "fs_challenge_participants_insert" on public.fs_challenge_participants with check (((user_id = (select auth.uid())) AND (challenge_id IN ( SELECT fs_challenges.id
   FROM fs_challenges
  WHERE (fs_challenges.org_id IN ( SELECT memberships.org_id
           FROM memberships
          WHERE (memberships.user_id = (select auth.uid()))))))));
alter policy "memberships_bootstrap_window" on public.memberships with check ((has_org_admin_role((select auth.uid()), org_id) OR org_is_within_bootstrap_window(org_id)));
alter policy "memberships_insert_org" on public.memberships with check ((has_org_admin_role((select auth.uid()), org_id) OR ((user_id = (select auth.uid())) AND (lower(COALESCE(role, ''::text)) = 'owner'::text) AND org_has_no_members(org_id))));
alter policy "qmc_delete" on public.quote_measurement_camera using (has_org_membership((select auth.uid()), org_id));
alter policy "qmc_insert" on public.quote_measurement_camera with check (has_org_membership((select auth.uid()), org_id));
alter policy "qmc_select" on public.quote_measurement_camera using (has_org_membership((select auth.uid()), org_id));
alter policy "qmc_update" on public.quote_measurement_camera using (has_org_membership((select auth.uid()), org_id)) with check (has_org_membership((select auth.uid()), org_id));
alter policy "rts_insert" on public.recurring_team_schedules with check ((org_id IN ( SELECT m.org_id
   FROM memberships m
  WHERE ((m.user_id = (select auth.uid())) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));
alter policy "tsa_insert" on public.team_schedule_assignments with check ((org_id IN ( SELECT m.org_id
   FROM memberships m
  WHERE ((m.user_id = (select auth.uid())) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));
alter policy "tsaud_insert" on public.team_schedule_audit with check ((org_id IN ( SELECT m.org_id
   FROM memberships m
  WHERE (m.user_id = (select auth.uid())))));
alter policy "tor_insert" on public.time_off_requests with check (((org_id IN ( SELECT m.org_id
   FROM memberships m
  WHERE ((m.user_id = (select auth.uid())) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))) OR ((user_id = (select auth.uid())) AND (status = 'pending'::text) AND (org_id IN ( SELECT m.org_id
   FROM memberships m
  WHERE (m.user_id = (select auth.uid())))))));
alter policy "attachments_delete_own_org" on storage.objects using (((bucket_id = 'attachments'::text) AND has_org_membership((select auth.uid()), lume_storage_object_org(name))));
alter policy "attachments_insert_own_org" on storage.objects with check (((bucket_id = 'attachments'::text) AND has_org_membership((select auth.uid()), lume_storage_object_org(name))));
alter policy "attachments_select_own_org" on storage.objects using (((bucket_id = 'attachments'::text) AND has_org_membership((select auth.uid()), lume_storage_object_org(name))));
alter policy "attachments_update_own_org" on storage.objects using (((bucket_id = 'attachments'::text) AND has_org_membership((select auth.uid()), lume_storage_object_org(name)))) with check (((bucket_id = 'attachments'::text) AND has_org_membership((select auth.uid()), lume_storage_object_org(name))));
alter policy "company_logos_delete_own_org" on storage.objects using (((bucket_id = 'company-logos'::text) AND has_org_membership((select auth.uid()), lume_storage_object_org(name))));
alter policy "company_logos_insert_own_org" on storage.objects with check (((bucket_id = 'company-logos'::text) AND has_org_membership((select auth.uid()), lume_storage_object_org(name))));
alter policy "company_logos_update_own_org" on storage.objects using (((bucket_id = 'company-logos'::text) AND has_org_membership((select auth.uid()), lume_storage_object_org(name)))) with check (((bucket_id = 'company-logos'::text) AND has_org_membership((select auth.uid()), lume_storage_object_org(name))));
alter policy "director_storage_delete" on storage.objects using (((bucket_id = 'director-panel'::text) AND ((select auth.uid()) IS NOT NULL)));
alter policy "director_storage_insert" on storage.objects with check (((bucket_id = 'director-panel'::text) AND ((select auth.uid()) IS NOT NULL)));
alter policy "director_storage_select" on storage.objects using (((bucket_id = 'director-panel'::text) AND ((select auth.uid()) IS NOT NULL)));
alter policy "director_storage_update" on storage.objects using (((bucket_id = 'director-panel'::text) AND ((select auth.uid()) IS NOT NULL)));
alter policy "job_photos_delete_own_org" on storage.objects using (((bucket_id = 'job-photos'::text) AND has_org_membership((select auth.uid()), lume_storage_object_org(name))));
alter policy "job_photos_insert_own_org" on storage.objects with check (((bucket_id = 'job-photos'::text) AND has_org_membership((select auth.uid()), lume_storage_object_org(name))));
alter policy "job_photos_select_own_org" on storage.objects using (((bucket_id = 'job-photos'::text) AND has_org_membership((select auth.uid()), lume_storage_object_org(name))));
alter policy "job_photos_update_own_org" on storage.objects using (((bucket_id = 'job-photos'::text) AND has_org_membership((select auth.uid()), lume_storage_object_org(name)))) with check (((bucket_id = 'job-photos'::text) AND has_org_membership((select auth.uid()), lume_storage_object_org(name))));
alter policy "users can update their own avatar" on storage.objects using (((bucket_id = 'avatars'::text) AND (((select auth.uid()))::text = (storage.foldername(name))[1])));
alter policy "users can upload their own avatar" on storage.objects with check (((bucket_id = 'avatars'::text) AND (((select auth.uid()))::text = (storage.foldername(name))[1])));

-- 33 ALTER générés.
