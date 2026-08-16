-- ============================================================================
-- BASELINE — tout ce que pg_dump ne contient PAS (généré depuis la PROD, 2026-08-03)
-- ----------------------------------------------------------------------------
-- Extensions, buckets de stockage + leurs policies, publication temps réel,
-- tâches planifiées, et le trigger de création de compte sur auth.users.
-- Oublier ce fichier = un environnement qui a l'air correct mais où les
-- fichiers, le temps réel et les jobs de fond ne marchent pas.
--
-- À exécuter APRÈS 01_schema.sql.
-- ============================================================================

-- ── Extensions ──
create extension if not exists btree_gist with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema public;
create extension if not exists pg_stat_statements with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists supabase_vault with schema vault;
create extension if not exists unaccent with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

-- ── Trigger de création de compte (schéma auth) ──
CREATE OR REPLACE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── Buckets de stockage ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('attachments', 'attachments', false, 52428800, null) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('avatars', 'avatars', true, null, null) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('company-logos', 'company-logos', true, null, null) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('director-panel', 'director-panel', false, 104857600, array['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm']::text[]) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('job-photos', 'job-photos', false, null, null) on conflict (id) do nothing;

-- ── Policies sur storage.objects ──
drop policy if exists "attachments_delete_own_org" on storage.objects;
create policy "attachments_delete_own_org" on storage.objects for delete to authenticated using (((bucket_id = 'attachments'::text) AND has_org_membership(( SELECT auth.uid() AS uid), lume_storage_object_org(name))));
drop policy if exists "attachments_insert_own_org" on storage.objects;
create policy "attachments_insert_own_org" on storage.objects for insert to authenticated with check (((bucket_id = 'attachments'::text) AND has_org_membership(( SELECT auth.uid() AS uid), lume_storage_object_org(name))));
drop policy if exists "attachments_select_own_org" on storage.objects;
create policy "attachments_select_own_org" on storage.objects for select to authenticated using (((bucket_id = 'attachments'::text) AND has_org_membership(( SELECT auth.uid() AS uid), lume_storage_object_org(name))));
drop policy if exists "attachments_update_own_org" on storage.objects;
create policy "attachments_update_own_org" on storage.objects for update to authenticated using (((bucket_id = 'attachments'::text) AND has_org_membership(( SELECT auth.uid() AS uid), lume_storage_object_org(name)))) with check (((bucket_id = 'attachments'::text) AND has_org_membership(( SELECT auth.uid() AS uid), lume_storage_object_org(name))));
drop policy if exists "company_logos_delete_own_org" on storage.objects;
create policy "company_logos_delete_own_org" on storage.objects for delete to authenticated using (((bucket_id = 'company-logos'::text) AND has_org_membership(( SELECT auth.uid() AS uid), lume_storage_object_org(name))));
drop policy if exists "company_logos_insert_own_org" on storage.objects;
create policy "company_logos_insert_own_org" on storage.objects for insert to authenticated with check (((bucket_id = 'company-logos'::text) AND has_org_membership(( SELECT auth.uid() AS uid), lume_storage_object_org(name))));
drop policy if exists "company_logos_update_own_org" on storage.objects;
create policy "company_logos_update_own_org" on storage.objects for update to authenticated using (((bucket_id = 'company-logos'::text) AND has_org_membership(( SELECT auth.uid() AS uid), lume_storage_object_org(name)))) with check (((bucket_id = 'company-logos'::text) AND has_org_membership(( SELECT auth.uid() AS uid), lume_storage_object_org(name))));
drop policy if exists "director_storage_delete" on storage.objects;
create policy "director_storage_delete" on storage.objects for delete to public using (((bucket_id = 'director-panel'::text) AND (( SELECT auth.uid() AS uid) IS NOT NULL)));
drop policy if exists "director_storage_insert" on storage.objects;
create policy "director_storage_insert" on storage.objects for insert to public with check (((bucket_id = 'director-panel'::text) AND (( SELECT auth.uid() AS uid) IS NOT NULL)));
drop policy if exists "director_storage_select" on storage.objects;
create policy "director_storage_select" on storage.objects for select to public using (((bucket_id = 'director-panel'::text) AND (( SELECT auth.uid() AS uid) IS NOT NULL)));
drop policy if exists "director_storage_update" on storage.objects;
create policy "director_storage_update" on storage.objects for update to public using (((bucket_id = 'director-panel'::text) AND (( SELECT auth.uid() AS uid) IS NOT NULL)));
drop policy if exists "job_photos_delete_own_org" on storage.objects;
create policy "job_photos_delete_own_org" on storage.objects for delete to authenticated using (((bucket_id = 'job-photos'::text) AND has_org_membership(( SELECT auth.uid() AS uid), lume_storage_object_org(name))));
drop policy if exists "job_photos_insert_own_org" on storage.objects;
create policy "job_photos_insert_own_org" on storage.objects for insert to authenticated with check (((bucket_id = 'job-photos'::text) AND has_org_membership(( SELECT auth.uid() AS uid), lume_storage_object_org(name))));
drop policy if exists "job_photos_select_own_org" on storage.objects;
create policy "job_photos_select_own_org" on storage.objects for select to authenticated using (((bucket_id = 'job-photos'::text) AND has_org_membership(( SELECT auth.uid() AS uid), lume_storage_object_org(name))));
drop policy if exists "job_photos_update_own_org" on storage.objects;
create policy "job_photos_update_own_org" on storage.objects for update to authenticated using (((bucket_id = 'job-photos'::text) AND has_org_membership(( SELECT auth.uid() AS uid), lume_storage_object_org(name)))) with check (((bucket_id = 'job-photos'::text) AND has_org_membership(( SELECT auth.uid() AS uid), lume_storage_object_org(name))));
drop policy if exists "users can update their own avatar" on storage.objects;
create policy "users can update their own avatar" on storage.objects for update to public using (((bucket_id = 'avatars'::text) AND ((( SELECT auth.uid() AS uid))::text = (storage.foldername(name))[1])));
drop policy if exists "users can upload their own avatar" on storage.objects;
create policy "users can upload their own avatar" on storage.objects for insert to public with check (((bucket_id = 'avatars'::text) AND ((( SELECT auth.uid() AS uid))::text = (storage.foldername(name))[1])));

-- ── Publication temps réel ──
do $$
declare t text;
begin
  foreach t in array array['activity_log', 'clients', 'conversations', 'invoices', 'job_intents', 'job_recurrence_rules', 'job_templates', 'jobs', 'messages', 'notes', 'notifications', 'pipeline_deals', 'quotes', 'recurring_team_schedules', 'schedule_events', 'team_schedule_assignments', 'teams', 'time_entries', 'time_off_requests', 'tracking_live_locations'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ── Tâches planifiées (pg_cron) ──
select cron.schedule('cleanup_lost_pipeline_deals_daily', '0 3 * * *', $c$select public.cleanup_lost_pipeline_deals();$c$);
select cron.schedule('cleanup-expired-pipeline-deals', '0 * * * *', $c$select public.cleanup_expired_pipeline_deals()$c$);
select cron.schedule('lume_invariant_checks', '40 4 * * *', $c$select public.run_invariant_checks()$c$);
select cron.schedule('lume_purge_audit_events', '15 3 * * *', $c$select public.purge_old_audit_events(1095)$c$);
select cron.schedule('lume_purge_location_data', '30 4 * * *', $c$select public.purge_old_location_data(180)$c$);
select cron.schedule('lume_purge_oauth_states', '25 * * * *', $c$select public.cleanup_expired_oauth_states()$c$);
select cron.schedule('lume_release_sms_numbers', '10 8 * * *', $c$select public.trigger_sms_number_release()$c$);
select cron.schedule('lume_retention_job', '0 4 * * *', $c$select public.run_retention_job()$c$);
select cron.schedule('lume_sync_auth_telemetry', '*/15 * * * *', $c$select public.sync_auth_telemetry()$c$);
select cron.schedule('security-canary-nightly', '17 4 * * *', $c$select public.run_security_canary()$c$);

-- ── Secrets attendus par certaines fonctions (à créer manuellement) ──
-- La prod n'en a AUCUN : purge_old_location_data / trigger_sms_number_release
-- lisent vault.decrypted_secrets ('cron_secret', 'app_base_url') et retombent
-- silencieusement si absents. Créer via le dashboard si ces jobs doivent agir.

