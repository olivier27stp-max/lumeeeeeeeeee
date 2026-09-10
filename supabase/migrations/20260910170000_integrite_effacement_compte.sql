-- ═══════════════════════════════════════════════════════════════
-- P1-A + P1-B + P1-C — débloquer l'effacement d'un compte utilisateur
--                       + poser les FK d'intégrité manquantes
-- ───────────────────────────────────────────────────────────────
-- Audit intégrité (Viktor 2026-09-10), vérifié sur la prod réelle :
--  P1-A : data_export_log.user_id NOT NULL + FK NO ACTION → bloque deleteUser.
--         Le journal est immuable (traçabilité de fuite) : on garde la ligne,
--         on rend user_id nullable et la FK SET NULL.
--  P1-B : 20 FK vers auth.users en NO ACTION (vérifié : 20). Elles bloquent la
--         suppression du compte. 13 nullables → SET NULL ; 4 field_* (la ligne
--         n'existe que pour ce rep) → CASCADE ; 3 contenus d'org (notes,
--         note_history, job_templates) → colonne rendue nullable puis SET NULL.
--  P1-C : memberships.user_id (0 orphelin en prod) et client_payment_profiles.
--         org_id (0 ligne) n'avaient AUCUNE FK. On les pose → CASCADE.
--
-- Toutes les tables/colonnes/contraintes ont été vérifiées présentes en prod.
-- ═══════════════════════════════════════════════════════════════

-- ── P1-A : data_export_log ──
alter table public.data_export_log alter column user_id drop not null;
alter table public.data_export_log drop constraint if exists data_export_log_user_id_fkey;
alter table public.data_export_log
  add constraint data_export_log_user_id_fkey foreign key (user_id)
  references auth.users(id) on delete set null;
comment on column public.data_export_log.user_id is
  'Auteur de l''export. NULL = compte supprimé depuis (FK ON DELETE SET NULL). La ligne reste pour la traçabilité de fuite.';

-- ── P1-B : 13 colonnes nullables → SET NULL ──
alter table public.activity_log drop constraint activity_log_actor_id_fkey,
  add constraint activity_log_actor_id_fkey foreign key (actor_id) references auth.users(id) on delete set null;
alter table public.app_connections drop constraint app_connections_connected_by_fkey,
  add constraint app_connections_connected_by_fkey foreign key (connected_by) references auth.users(id) on delete set null;
alter table public.company_settings drop constraint company_settings_created_by_fkey,
  add constraint company_settings_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
alter table public.dsar_requests drop constraint dsar_requests_requested_by_fkey,
  add constraint dsar_requests_requested_by_fkey foreign key (requested_by) references auth.users(id) on delete set null;
alter table public.email_templates drop constraint email_templates_created_by_fkey,
  add constraint email_templates_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
alter table public.field_house_profiles drop constraint field_house_profiles_assigned_user_id_fkey,
  add constraint field_house_profiles_assigned_user_id_fkey foreign key (assigned_user_id) references auth.users(id) on delete set null;
alter table public.incident_timeline drop constraint incident_timeline_actor_id_fkey,
  add constraint incident_timeline_actor_id_fkey foreign key (actor_id) references auth.users(id) on delete set null;
alter table public.integration_audit_logs drop constraint integration_audit_logs_user_id_fkey,
  add constraint integration_audit_logs_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null;
alter table public.quote_templates drop constraint quote_templates_created_by_fkey,
  add constraint quote_templates_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
alter table public.request_forms drop constraint request_forms_created_by_fkey,
  add constraint request_forms_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
alter table public.security_incidents drop constraint security_incidents_detected_by_fkey,
  add constraint security_incidents_detected_by_fkey foreign key (detected_by) references auth.users(id) on delete set null;
alter table public.specific_notes drop constraint specific_notes_created_by_fkey,
  add constraint specific_notes_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
alter table public.team_members drop constraint team_members_deletion_requested_by_fkey,
  add constraint team_members_deletion_requested_by_fkey foreign key (deletion_requested_by) references auth.users(id) on delete set null;

-- ── P1-B : 4 tables terrain → CASCADE (la ligne n'existe que pour ce rep) ──
alter table public.field_daily_stats drop constraint field_daily_stats_user_id_fkey,
  add constraint field_daily_stats_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.field_house_events drop constraint field_house_events_user_id_fkey,
  add constraint field_house_events_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.field_pins drop constraint field_pins_user_id_fkey,
  add constraint field_pins_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.field_sales_reps drop constraint field_sales_reps_user_id_fkey,
  add constraint field_sales_reps_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

-- ── P1-B : 3 contenus d'org → colonne nullable puis SET NULL ──
alter table public.notes alter column created_by drop not null;
alter table public.note_history alter column edited_by drop not null;
alter table public.job_templates alter column created_by drop not null;
alter table public.notes drop constraint notes_created_by_fkey,
  add constraint notes_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
alter table public.note_history drop constraint note_history_edited_by_fkey,
  add constraint note_history_edited_by_fkey foreign key (edited_by) references auth.users(id) on delete set null;
alter table public.job_templates drop constraint job_templates_created_by_fkey,
  add constraint job_templates_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;

-- ── P1-C : FK d'intégrité manquantes ──
-- Purge d'abord les orphelins (droits d'accès fantômes : membership pointant
-- vers un user_id inexistant). En prod = 0 (vérifié) ; sur staging/bases
-- anonymisées il peut y en avoir. Idempotent et sûr.
delete from public.memberships m
 where not exists (select 1 from auth.users u where u.id = m.user_id);
delete from public.client_payment_profiles cpp
 where not exists (select 1 from public.orgs o where o.id = cpp.org_id);

alter table public.memberships
  add constraint memberships_user_id_fkey foreign key (user_id)
  references auth.users(id) on delete cascade;
alter table public.client_payment_profiles
  add constraint client_payment_profiles_org_id_fkey foreign key (org_id)
  references public.orgs(id) on delete cascade;
