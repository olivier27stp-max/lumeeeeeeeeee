-- ============================================================================
-- Module « migration de données » — réalignement de staging sur la production
-- ============================================================================
-- Extrait de la PROD le 2026-09-01 par scripts/qa/extraire-module-migration.mjs
--
-- Ces 15 tables existaient en production mais dans AUCUN fichier du dépôt :
-- elles avaient été créées hors du pipeline de migration (contraire à la règle 2
-- du CLAUDE.md). Ce fichier les réintroduit dans l'historique du projet ET les
-- rejoue sur staging, pour que les deux environnements redeviennent identiques.
--
-- Idempotent : « if not exists » / « drop policy if exists » partout.
-- STRUCTURE UNIQUEMENT — aucune donnée n'est copiée.
-- ============================================================================

-- NOTE sur les versions d'extensions (écart irréductible, ne pas « corriger ») :
--   prod    : vector 0.8.0, pg_net 0.20.3
--   staging : vector 0.8.2, pg_net 0.20.4
-- Les versions de la prod ne sont PAS disponibles sur staging (pg_available_extensions
-- n'y propose que 0.8.2 / 0.20.4) : le projet staging tourne sur une image Supabase plus
-- récente. Les deux bases sont sur PostgreSQL 17.6. Cet écart ne vient donc pas d'une
-- dérive et ne peut pas être résorbé par une migration.
-- Conséquence visible : ~118 fonctions internes de `vector` (halfvec_*, sparsevec_*, …)
-- existent en staging et pas en prod. Aucune fonction métier ne diffère.
create extension if not exists vector;

-- ── data_migrations ───────────────────────────────────────────
create table if not exists public.data_migrations (
  "id" uuid default gen_random_uuid() not null,
  "org_id" uuid not null,
  "source_crm" text default 'other'::text not null,
  "status" text default 'draft'::text not null,
  "categories" text[] default ARRAY['clients'::text, 'properties'::text, 'jobs'::text, 'visits'::text, 'invoices'::text] not null,
  "priority" text default 'normal'::text not null,
  "target_date" date,
  "internal_notes" text,
  "invited_user_id" uuid,
  "invited_email" text,
  "assigned_admin" uuid,
  "assigned_assistant" uuid,
  "freeze_start" timestamp with time zone,
  "freeze_end" timestamp with time zone,
  "freeze_confirmed_at" timestamp with time zone,
  "last_activity_at" timestamp with time zone default now() not null,
  "completed_at" timestamp with time zone,
  "closed_at" timestamp with time zone,
  "created_by" uuid not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "deleted_at" timestamp with time zone
);

-- ── migration_approvals ───────────────────────────────────────
create table if not exists public.migration_approvals (
  "id" uuid default gen_random_uuid() not null,
  "migration_id" uuid not null,
  "report_version" integer default 1 not null,
  "report" jsonb default '{}'::jsonb not null,
  "decision" text not null,
  "confirmed_text" text,
  "comment" text,
  "user_id" uuid not null,
  "ip_address" inet,
  "user_agent" text,
  "created_at" timestamp with time zone default now() not null
);

-- ── migration_audit_logs ──────────────────────────────────────
create table if not exists public.migration_audit_logs (
  "id" uuid default gen_random_uuid() not null,
  "migration_id" uuid not null,
  "action" text not null,
  "actor_id" uuid,
  "actor_role" text,
  "target" text,
  "meta" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null
);

-- ── migration_duplicate_candidates ────────────────────────────
create table if not exists public.migration_duplicate_candidates (
  "id" uuid default gen_random_uuid() not null,
  "migration_id" uuid not null,
  "staging_record_id" uuid not null,
  "existing_table" text not null,
  "existing_id" uuid not null,
  "match_reasons" text[] default '{}'::text[] not null,
  "score" integer default 0 not null,
  "decision" text default 'pending'::text not null,
  "decided_by" uuid,
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

-- ── migration_field_mappings ──────────────────────────────────
create table if not exists public.migration_field_mappings (
  "id" uuid default gen_random_uuid() not null,
  "migration_id" uuid not null,
  "file_id" uuid not null,
  "column_id" uuid not null,
  "target_entity" text,
  "target_field" text,
  "confidence" integer default 0 not null,
  "reason" text,
  "status" text default 'suggested'::text not null,
  "decided_by" uuid,
  "decided_role" text,
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

-- ── migration_file_columns ────────────────────────────────────
create table if not exists public.migration_file_columns (
  "id" uuid default gen_random_uuid() not null,
  "file_id" uuid not null,
  "migration_id" uuid not null,
  "position" integer not null,
  "header" text not null,
  "detected_type" text default 'text'::text not null,
  "empty_ratio" numeric(5,4) default 0 not null,
  "samples_masked" jsonb default '[]'::jsonb not null,
  "created_at" timestamp with time zone default now() not null
);

-- ── migration_files ───────────────────────────────────────────
create table if not exists public.migration_files (
  "id" uuid default gen_random_uuid() not null,
  "migration_id" uuid not null,
  "storage_path" text not null,
  "original_name" text not null,
  "mime_type" text not null,
  "size_bytes" bigint not null,
  "sha256" text not null,
  "kind" text default 'data'::text not null,
  "category_detected" text,
  "encoding" text,
  "delimiter" text,
  "row_count" integer,
  "column_count" integer,
  "security_status" text default 'uploaded'::text not null,
  "security_reason" text,
  "parse_status" text default 'pending'::text not null,
  "parse_error" text,
  "uploaded_by" uuid not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "deleted_at" timestamp with time zone
);

-- ── migration_import_batches ──────────────────────────────────
create table if not exists public.migration_import_batches (
  "id" uuid default gen_random_uuid() not null,
  "migration_id" uuid not null,
  "kind" text default 'test'::text not null,
  "status" text default 'pending'::text not null,
  "totals" jsonb default '{}'::jsonb not null,
  "error" text,
  "started_by" uuid not null,
  "started_at" timestamp with time zone default now() not null,
  "finished_at" timestamp with time zone,
  "rolled_back_at" timestamp with time zone,
  "rolled_back_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

-- ── migration_import_records ──────────────────────────────────
create table if not exists public.migration_import_records (
  "id" uuid default gen_random_uuid() not null,
  "batch_id" uuid not null,
  "migration_id" uuid not null,
  "staging_record_id" uuid not null,
  "entity_table" text not null,
  "entity_id" uuid not null,
  "action" text not null,
  "created_at" timestamp with time zone default now() not null
);

-- ── migration_invitations ─────────────────────────────────────
create table if not exists public.migration_invitations (
  "id" uuid default gen_random_uuid() not null,
  "migration_id" uuid not null,
  "token_hash" text not null,
  "expires_at" timestamp with time zone not null,
  "revoked_at" timestamp with time zone,
  "superseded_at" timestamp with time zone,
  "opened_at" timestamp with time zone,
  "failed_attempts" integer default 0 not null,
  "created_by" uuid not null,
  "created_at" timestamp with time zone default now() not null
);

-- ── migration_issues ──────────────────────────────────────────
create table if not exists public.migration_issues (
  "id" uuid default gen_random_uuid() not null,
  "migration_id" uuid not null,
  "type" text not null,
  "severity" text default 'warning'::text not null,
  "entity_type" text,
  "staging_record_id" uuid,
  "column_id" uuid,
  "title" text not null,
  "details_masked" jsonb default '{}'::jsonb not null,
  "options" jsonb default '[]'::jsonb not null,
  "client_visible" boolean default false not null,
  "client_answer" text,
  "client_answered_at" timestamp with time zone,
  "resolution" text,
  "resolved_by" uuid,
  "resolved_at" timestamp with time zone,
  "escalated" boolean default false not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

-- ── migration_mapping_templates ───────────────────────────────
create table if not exists public.migration_mapping_templates (
  "id" uuid default gen_random_uuid() not null,
  "source_crm" text not null,
  "name" text not null,
  "headers_map" jsonb default '{}'::jsonb not null,
  "created_by" uuid not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

-- ── migration_messages ────────────────────────────────────────
create table if not exists public.migration_messages (
  "id" uuid default gen_random_uuid() not null,
  "migration_id" uuid not null,
  "author_id" uuid not null,
  "author_kind" text not null,
  "body" text not null,
  "created_at" timestamp with time zone default now() not null,
  "read_at" timestamp with time zone
);

-- ── migration_staff_mappings ──────────────────────────────────
create table if not exists public.migration_staff_mappings (
  "id" uuid default gen_random_uuid() not null,
  "migration_id" uuid not null,
  "source_key" text not null,
  "source_label" text not null,
  "user_id" uuid,
  "created_by" uuid not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

-- ── migration_staging_records ─────────────────────────────────
create table if not exists public.migration_staging_records (
  "id" uuid default gen_random_uuid() not null,
  "migration_id" uuid not null,
  "file_id" uuid not null,
  "row_number" integer not null,
  "entity_type" text not null,
  "external_id" text,
  "payload" jsonb default '{}'::jsonb not null,
  "normalized" jsonb,
  "relations" jsonb,
  "status" text default 'pending'::text not null,
  "error" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

-- ── Contraintes ──────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_constraint where conname='data_migrations_pkey' and conrelid='public.data_migrations'::regclass) then
    alter table public.data_migrations add constraint "data_migrations_pkey" PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_approvals_pkey' and conrelid='public.migration_approvals'::regclass) then
    alter table public.migration_approvals add constraint "migration_approvals_pkey" PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_audit_logs_pkey' and conrelid='public.migration_audit_logs'::regclass) then
    alter table public.migration_audit_logs add constraint "migration_audit_logs_pkey" PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_duplicate_candidates_pkey' and conrelid='public.migration_duplicate_candidates'::regclass) then
    alter table public.migration_duplicate_candidates add constraint "migration_duplicate_candidates_pkey" PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_field_mappings_pkey' and conrelid='public.migration_field_mappings'::regclass) then
    alter table public.migration_field_mappings add constraint "migration_field_mappings_pkey" PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_file_columns_pkey' and conrelid='public.migration_file_columns'::regclass) then
    alter table public.migration_file_columns add constraint "migration_file_columns_pkey" PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_files_pkey' and conrelid='public.migration_files'::regclass) then
    alter table public.migration_files add constraint "migration_files_pkey" PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_import_batches_pkey' and conrelid='public.migration_import_batches'::regclass) then
    alter table public.migration_import_batches add constraint "migration_import_batches_pkey" PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_import_records_pkey' and conrelid='public.migration_import_records'::regclass) then
    alter table public.migration_import_records add constraint "migration_import_records_pkey" PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_invitations_pkey' and conrelid='public.migration_invitations'::regclass) then
    alter table public.migration_invitations add constraint "migration_invitations_pkey" PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_issues_pkey' and conrelid='public.migration_issues'::regclass) then
    alter table public.migration_issues add constraint "migration_issues_pkey" PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_mapping_templates_pkey' and conrelid='public.migration_mapping_templates'::regclass) then
    alter table public.migration_mapping_templates add constraint "migration_mapping_templates_pkey" PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_messages_pkey' and conrelid='public.migration_messages'::regclass) then
    alter table public.migration_messages add constraint "migration_messages_pkey" PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_staff_mappings_pkey' and conrelid='public.migration_staff_mappings'::regclass) then
    alter table public.migration_staff_mappings add constraint "migration_staff_mappings_pkey" PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_staging_records_pkey' and conrelid='public.migration_staging_records'::regclass) then
    alter table public.migration_staging_records add constraint "migration_staging_records_pkey" PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_field_mappings_column_id_key' and conrelid='public.migration_field_mappings'::regclass) then
    alter table public.migration_field_mappings add constraint "migration_field_mappings_column_id_key" UNIQUE (column_id);
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_import_records_migration_id_staging_record_id_ent_key' and conrelid='public.migration_import_records'::regclass) then
    alter table public.migration_import_records add constraint "migration_import_records_migration_id_staging_record_id_ent_key" UNIQUE (migration_id, staging_record_id, entity_table);
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_invitations_token_hash_key' and conrelid='public.migration_invitations'::regclass) then
    alter table public.migration_invitations add constraint "migration_invitations_token_hash_key" UNIQUE (token_hash);
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_mapping_templates_source_crm_name_key' and conrelid='public.migration_mapping_templates'::regclass) then
    alter table public.migration_mapping_templates add constraint "migration_mapping_templates_source_crm_name_key" UNIQUE (source_crm, name);
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_staff_mappings_migration_id_source_key_key' and conrelid='public.migration_staff_mappings'::regclass) then
    alter table public.migration_staff_mappings add constraint "migration_staff_mappings_migration_id_source_key_key" UNIQUE (migration_id, source_key);
  end if;
  if not exists (select 1 from pg_constraint where conname='data_migrations_priority_check' and conrelid='public.data_migrations'::regclass) then
    alter table public.data_migrations add constraint "data_migrations_priority_check" CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text])));
  end if;
  if not exists (select 1 from pg_constraint where conname='data_migrations_source_crm_check' and conrelid='public.data_migrations'::regclass) then
    alter table public.data_migrations add constraint "data_migrations_source_crm_check" CHECK ((source_crm = ANY (ARRAY['jobber'::text, 'housecall_pro'::text, 'servicetitan'::text, 'gohighlevel'::text, 'quickbooks'::text, 'other'::text, 'custom_files'::text])));
  end if;
  if not exists (select 1 from pg_constraint where conname='data_migrations_status_check' and conrelid='public.data_migrations'::regclass) then
    alter table public.data_migrations add constraint "data_migrations_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'invitation_sent'::text, 'waiting_for_files'::text, 'files_uploaded'::text, 'parsing'::text, 'mapping'::text, 'human_review'::text, 'waiting_for_client'::text, 'ready_for_test'::text, 'testing'::text, 'test_review'::text, 'waiting_for_approval'::text, 'approved'::text, 'ready_for_final_import'::text, 'importing'::text, 'post_import_validation'::text, 'completed'::text, 'completed_with_warnings'::text, 'failed'::text, 'rolled_back'::text, 'cancelled'::text])));
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_approvals_decision_check' and conrelid='public.migration_approvals'::regclass) then
    alter table public.migration_approvals add constraint "migration_approvals_decision_check" CHECK ((decision = ANY (ARRAY['approved'::text, 'refused'::text, 'changes_requested'::text])));
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_duplicate_candidates_decision_check' and conrelid='public.migration_duplicate_candidates'::regclass) then
    alter table public.migration_duplicate_candidates add constraint "migration_duplicate_candidates_decision_check" CHECK ((decision = ANY (ARRAY['pending'::text, 'create_new'::text, 'merge'::text, 'skip'::text, 'review'::text])));
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_duplicate_candidates_score_check' and conrelid='public.migration_duplicate_candidates'::regclass) then
    alter table public.migration_duplicate_candidates add constraint "migration_duplicate_candidates_score_check" CHECK (((score >= 0) AND (score <= 100)));
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_field_mappings_confidence_check' and conrelid='public.migration_field_mappings'::regclass) then
    alter table public.migration_field_mappings add constraint "migration_field_mappings_confidence_check" CHECK (((confidence >= 0) AND (confidence <= 100)));
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_field_mappings_status_check' and conrelid='public.migration_field_mappings'::regclass) then
    alter table public.migration_field_mappings add constraint "migration_field_mappings_status_check" CHECK ((status = ANY (ARRAY['suggested'::text, 'confirmed'::text, 'corrected'::text, 'rejected'::text, 'needs_review'::text])));
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_files_kind_check' and conrelid='public.migration_files'::regclass) then
    alter table public.migration_files add constraint "migration_files_kind_check" CHECK ((kind = ANY (ARRAY['data'::text, 'archive'::text])));
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_files_parse_status_check' and conrelid='public.migration_files'::regclass) then
    alter table public.migration_files add constraint "migration_files_parse_status_check" CHECK ((parse_status = ANY (ARRAY['pending'::text, 'parsing'::text, 'parsed'::text, 'failed'::text])));
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_files_security_status_check' and conrelid='public.migration_files'::regclass) then
    alter table public.migration_files add constraint "migration_files_security_status_check" CHECK ((security_status = ANY (ARRAY['uploaded'::text, 'scanning'::text, 'safe'::text, 'rejected'::text])));
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_import_batches_kind_check' and conrelid='public.migration_import_batches'::regclass) then
    alter table public.migration_import_batches add constraint "migration_import_batches_kind_check" CHECK ((kind = ANY (ARRAY['test'::text, 'final'::text])));
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_import_batches_status_check' and conrelid='public.migration_import_batches'::regclass) then
    alter table public.migration_import_batches add constraint "migration_import_batches_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text, 'rolled_back'::text])));
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_import_records_action_check' and conrelid='public.migration_import_records'::regclass) then
    alter table public.migration_import_records add constraint "migration_import_records_action_check" CHECK ((action = ANY (ARRAY['created'::text, 'merged'::text, 'skipped'::text])));
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_issues_severity_check' and conrelid='public.migration_issues'::regclass) then
    alter table public.migration_issues add constraint "migration_issues_severity_check" CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'error'::text, 'blocking'::text])));
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_messages_author_kind_check' and conrelid='public.migration_messages'::regclass) then
    alter table public.migration_messages add constraint "migration_messages_author_kind_check" CHECK ((author_kind = ANY (ARRAY['client'::text, 'assistant'::text, 'admin'::text])));
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_staging_records_status_check' and conrelid='public.migration_staging_records'::regclass) then
    alter table public.migration_staging_records add constraint "migration_staging_records_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'ready'::text, 'orphan'::text, 'duplicate'::text, 'error'::text, 'ignored'::text, 'imported'::text, 'merged'::text])));
  end if;
  if not exists (select 1 from pg_constraint where conname='data_migrations_org_id_fkey' and conrelid='public.data_migrations'::regclass) then
    alter table public.data_migrations add constraint "data_migrations_org_id_fkey" FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_approvals_migration_id_fkey' and conrelid='public.migration_approvals'::regclass) then
    alter table public.migration_approvals add constraint "migration_approvals_migration_id_fkey" FOREIGN KEY (migration_id) REFERENCES data_migrations(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_audit_logs_migration_id_fkey' and conrelid='public.migration_audit_logs'::regclass) then
    alter table public.migration_audit_logs add constraint "migration_audit_logs_migration_id_fkey" FOREIGN KEY (migration_id) REFERENCES data_migrations(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_duplicate_candidates_migration_id_fkey' and conrelid='public.migration_duplicate_candidates'::regclass) then
    alter table public.migration_duplicate_candidates add constraint "migration_duplicate_candidates_migration_id_fkey" FOREIGN KEY (migration_id) REFERENCES data_migrations(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_duplicate_candidates_staging_record_id_fkey' and conrelid='public.migration_duplicate_candidates'::regclass) then
    alter table public.migration_duplicate_candidates add constraint "migration_duplicate_candidates_staging_record_id_fkey" FOREIGN KEY (staging_record_id) REFERENCES migration_staging_records(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_field_mappings_column_id_fkey' and conrelid='public.migration_field_mappings'::regclass) then
    alter table public.migration_field_mappings add constraint "migration_field_mappings_column_id_fkey" FOREIGN KEY (column_id) REFERENCES migration_file_columns(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_field_mappings_file_id_fkey' and conrelid='public.migration_field_mappings'::regclass) then
    alter table public.migration_field_mappings add constraint "migration_field_mappings_file_id_fkey" FOREIGN KEY (file_id) REFERENCES migration_files(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_field_mappings_migration_id_fkey' and conrelid='public.migration_field_mappings'::regclass) then
    alter table public.migration_field_mappings add constraint "migration_field_mappings_migration_id_fkey" FOREIGN KEY (migration_id) REFERENCES data_migrations(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_file_columns_file_id_fkey' and conrelid='public.migration_file_columns'::regclass) then
    alter table public.migration_file_columns add constraint "migration_file_columns_file_id_fkey" FOREIGN KEY (file_id) REFERENCES migration_files(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_file_columns_migration_id_fkey' and conrelid='public.migration_file_columns'::regclass) then
    alter table public.migration_file_columns add constraint "migration_file_columns_migration_id_fkey" FOREIGN KEY (migration_id) REFERENCES data_migrations(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_files_migration_id_fkey' and conrelid='public.migration_files'::regclass) then
    alter table public.migration_files add constraint "migration_files_migration_id_fkey" FOREIGN KEY (migration_id) REFERENCES data_migrations(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_import_batches_migration_id_fkey' and conrelid='public.migration_import_batches'::regclass) then
    alter table public.migration_import_batches add constraint "migration_import_batches_migration_id_fkey" FOREIGN KEY (migration_id) REFERENCES data_migrations(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_import_records_batch_id_fkey' and conrelid='public.migration_import_records'::regclass) then
    alter table public.migration_import_records add constraint "migration_import_records_batch_id_fkey" FOREIGN KEY (batch_id) REFERENCES migration_import_batches(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_import_records_migration_id_fkey' and conrelid='public.migration_import_records'::regclass) then
    alter table public.migration_import_records add constraint "migration_import_records_migration_id_fkey" FOREIGN KEY (migration_id) REFERENCES data_migrations(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_import_records_staging_record_id_fkey' and conrelid='public.migration_import_records'::regclass) then
    alter table public.migration_import_records add constraint "migration_import_records_staging_record_id_fkey" FOREIGN KEY (staging_record_id) REFERENCES migration_staging_records(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_invitations_migration_id_fkey' and conrelid='public.migration_invitations'::regclass) then
    alter table public.migration_invitations add constraint "migration_invitations_migration_id_fkey" FOREIGN KEY (migration_id) REFERENCES data_migrations(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_issues_column_id_fkey' and conrelid='public.migration_issues'::regclass) then
    alter table public.migration_issues add constraint "migration_issues_column_id_fkey" FOREIGN KEY (column_id) REFERENCES migration_file_columns(id) ON DELETE SET NULL;
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_issues_migration_id_fkey' and conrelid='public.migration_issues'::regclass) then
    alter table public.migration_issues add constraint "migration_issues_migration_id_fkey" FOREIGN KEY (migration_id) REFERENCES data_migrations(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_issues_staging_record_id_fkey' and conrelid='public.migration_issues'::regclass) then
    alter table public.migration_issues add constraint "migration_issues_staging_record_id_fkey" FOREIGN KEY (staging_record_id) REFERENCES migration_staging_records(id) ON DELETE SET NULL;
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_messages_migration_id_fkey' and conrelid='public.migration_messages'::regclass) then
    alter table public.migration_messages add constraint "migration_messages_migration_id_fkey" FOREIGN KEY (migration_id) REFERENCES data_migrations(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_staff_mappings_migration_id_fkey' and conrelid='public.migration_staff_mappings'::regclass) then
    alter table public.migration_staff_mappings add constraint "migration_staff_mappings_migration_id_fkey" FOREIGN KEY (migration_id) REFERENCES data_migrations(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_staging_records_file_id_fkey' and conrelid='public.migration_staging_records'::regclass) then
    alter table public.migration_staging_records add constraint "migration_staging_records_file_id_fkey" FOREIGN KEY (file_id) REFERENCES migration_files(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname='migration_staging_records_migration_id_fkey' and conrelid='public.migration_staging_records'::regclass) then
    alter table public.migration_staging_records add constraint "migration_staging_records_migration_id_fkey" FOREIGN KEY (migration_id) REFERENCES data_migrations(id) ON DELETE CASCADE;
  end if;
end $$;

-- ── Index ────────────────────────────────────────────────────────
create index if not exists idx_data_migrations_org ON public.data_migrations USING btree (org_id) WHERE (deleted_at IS NULL);
create index if not exists idx_data_migrations_status ON public.data_migrations USING btree (status) WHERE (deleted_at IS NULL);
create index if not exists idx_migration_approvals_migration ON public.migration_approvals USING btree (migration_id, created_at DESC);
create index if not exists idx_migration_audit_migration ON public.migration_audit_logs USING btree (migration_id, created_at DESC);
create index if not exists idx_migration_dupes_migration ON public.migration_duplicate_candidates USING btree (migration_id, decision);
create index if not exists idx_migration_dupes_staging ON public.migration_duplicate_candidates USING btree (staging_record_id);
create index if not exists idx_migration_field_mappings_migration ON public.migration_field_mappings USING btree (migration_id);
create index if not exists idx_migration_file_columns_file ON public.migration_file_columns USING btree (file_id);
create index if not exists idx_migration_files_migration ON public.migration_files USING btree (migration_id) WHERE (deleted_at IS NULL);
create index if not exists idx_migration_files_sha ON public.migration_files USING btree (migration_id, sha256) WHERE (deleted_at IS NULL);
create index if not exists idx_migration_batches_migration ON public.migration_import_batches USING btree (migration_id, created_at DESC);
create index if not exists idx_migration_import_records_batch ON public.migration_import_records USING btree (batch_id);
create index if not exists idx_migration_import_records_entity ON public.migration_import_records USING btree (entity_table, entity_id);
create index if not exists idx_migration_invitations_migration ON public.migration_invitations USING btree (migration_id);
create index if not exists idx_migration_issues_migration ON public.migration_issues USING btree (migration_id, resolved_at);
create index if not exists idx_migration_messages_migration ON public.migration_messages USING btree (migration_id, created_at);
create index if not exists idx_migration_staff_map_migration ON public.migration_staff_mappings USING btree (migration_id);
create index if not exists idx_migration_staging_external ON public.migration_staging_records USING btree (migration_id, entity_type, external_id);
create index if not exists idx_migration_staging_file ON public.migration_staging_records USING btree (file_id);
create index if not exists idx_migration_staging_migration ON public.migration_staging_records USING btree (migration_id, entity_type, status);

-- ── Protection des accès (RLS) ───────────────────────────────────
alter table public.data_migrations enable row level security;
alter table public.data_migrations force row level security;
alter table public.migration_approvals enable row level security;
alter table public.migration_approvals force row level security;
alter table public.migration_audit_logs enable row level security;
alter table public.migration_audit_logs force row level security;
alter table public.migration_duplicate_candidates enable row level security;
alter table public.migration_duplicate_candidates force row level security;
alter table public.migration_field_mappings enable row level security;
alter table public.migration_field_mappings force row level security;
alter table public.migration_file_columns enable row level security;
alter table public.migration_file_columns force row level security;
alter table public.migration_files enable row level security;
alter table public.migration_files force row level security;
alter table public.migration_import_batches enable row level security;
alter table public.migration_import_batches force row level security;
alter table public.migration_import_records enable row level security;
alter table public.migration_import_records force row level security;
alter table public.migration_invitations enable row level security;
alter table public.migration_invitations force row level security;
alter table public.migration_issues enable row level security;
alter table public.migration_issues force row level security;
alter table public.migration_mapping_templates enable row level security;
alter table public.migration_mapping_templates force row level security;
alter table public.migration_messages enable row level security;
alter table public.migration_messages force row level security;
alter table public.migration_staff_mappings enable row level security;
alter table public.migration_staff_mappings force row level security;
alter table public.migration_staging_records enable row level security;
alter table public.migration_staging_records force row level security;

drop policy if exists "data_migrations_service" on public.data_migrations;
create policy "data_migrations_service" on public.data_migrations as permissive for all to service_role
  using (true)
  with check (true);
drop policy if exists "migration_approvals_service" on public.migration_approvals;
create policy "migration_approvals_service" on public.migration_approvals as permissive for all to service_role
  using (true)
  with check (true);
drop policy if exists "migration_audit_logs_service" on public.migration_audit_logs;
create policy "migration_audit_logs_service" on public.migration_audit_logs as permissive for all to service_role
  using (true)
  with check (true);
drop policy if exists "migration_duplicate_candidates_service" on public.migration_duplicate_candidates;
create policy "migration_duplicate_candidates_service" on public.migration_duplicate_candidates as permissive for all to service_role
  using (true)
  with check (true);
drop policy if exists "migration_field_mappings_service" on public.migration_field_mappings;
create policy "migration_field_mappings_service" on public.migration_field_mappings as permissive for all to service_role
  using (true)
  with check (true);
drop policy if exists "migration_file_columns_service" on public.migration_file_columns;
create policy "migration_file_columns_service" on public.migration_file_columns as permissive for all to service_role
  using (true)
  with check (true);
drop policy if exists "migration_files_service" on public.migration_files;
create policy "migration_files_service" on public.migration_files as permissive for all to service_role
  using (true)
  with check (true);
drop policy if exists "migration_import_batches_service" on public.migration_import_batches;
create policy "migration_import_batches_service" on public.migration_import_batches as permissive for all to service_role
  using (true)
  with check (true);
drop policy if exists "migration_import_records_service" on public.migration_import_records;
create policy "migration_import_records_service" on public.migration_import_records as permissive for all to service_role
  using (true)
  with check (true);
drop policy if exists "migration_invitations_service" on public.migration_invitations;
create policy "migration_invitations_service" on public.migration_invitations as permissive for all to service_role
  using (true)
  with check (true);
drop policy if exists "migration_issues_service" on public.migration_issues;
create policy "migration_issues_service" on public.migration_issues as permissive for all to service_role
  using (true)
  with check (true);
drop policy if exists "migration_mapping_templates_service" on public.migration_mapping_templates;
create policy "migration_mapping_templates_service" on public.migration_mapping_templates as permissive for all to service_role
  using (true)
  with check (true);
drop policy if exists "migration_messages_service" on public.migration_messages;
create policy "migration_messages_service" on public.migration_messages as permissive for all to service_role
  using (true)
  with check (true);
drop policy if exists "migration_staff_mappings_service" on public.migration_staff_mappings;
create policy "migration_staff_mappings_service" on public.migration_staff_mappings as permissive for all to service_role
  using (true)
  with check (true);
drop policy if exists "migration_staging_records_service" on public.migration_staging_records;
create policy "migration_staging_records_service" on public.migration_staging_records as permissive for all to service_role
  using (true)
  with check (true);

-- ── Privilèges ───────────────────────────────────────────────────
grant references, select, trigger, truncate on public.data_migrations to anon;
grant delete, insert, references, select, trigger, truncate, update on public.data_migrations to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.data_migrations to service_role;
grant references, select, trigger, truncate on public.migration_approvals to anon;
grant delete, insert, references, select, trigger, truncate, update on public.migration_approvals to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.migration_approvals to service_role;
grant references, select, trigger, truncate on public.migration_audit_logs to anon;
grant delete, insert, references, select, trigger, truncate, update on public.migration_audit_logs to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.migration_audit_logs to service_role;
grant references, select, trigger, truncate on public.migration_duplicate_candidates to anon;
grant delete, insert, references, select, trigger, truncate, update on public.migration_duplicate_candidates to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.migration_duplicate_candidates to service_role;
grant references, select, trigger, truncate on public.migration_field_mappings to anon;
grant delete, insert, references, select, trigger, truncate, update on public.migration_field_mappings to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.migration_field_mappings to service_role;
grant references, select, trigger, truncate on public.migration_file_columns to anon;
grant delete, insert, references, select, trigger, truncate, update on public.migration_file_columns to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.migration_file_columns to service_role;
grant references, select, trigger, truncate on public.migration_files to anon;
grant delete, insert, references, select, trigger, truncate, update on public.migration_files to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.migration_files to service_role;
grant references, select, trigger, truncate on public.migration_import_batches to anon;
grant delete, insert, references, select, trigger, truncate, update on public.migration_import_batches to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.migration_import_batches to service_role;
grant references, select, trigger, truncate on public.migration_import_records to anon;
grant delete, insert, references, select, trigger, truncate, update on public.migration_import_records to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.migration_import_records to service_role;
grant references, select, trigger, truncate on public.migration_invitations to anon;
grant delete, insert, references, select, trigger, truncate, update on public.migration_invitations to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.migration_invitations to service_role;
grant references, select, trigger, truncate on public.migration_issues to anon;
grant delete, insert, references, select, trigger, truncate, update on public.migration_issues to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.migration_issues to service_role;
grant references, select, trigger, truncate on public.migration_mapping_templates to anon;
grant delete, insert, references, select, trigger, truncate, update on public.migration_mapping_templates to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.migration_mapping_templates to service_role;
grant references, select, trigger, truncate on public.migration_messages to anon;
grant delete, insert, references, select, trigger, truncate, update on public.migration_messages to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.migration_messages to service_role;
grant references, select, trigger, truncate on public.migration_staff_mappings to anon;
grant delete, insert, references, select, trigger, truncate, update on public.migration_staff_mappings to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.migration_staff_mappings to service_role;
grant references, select, trigger, truncate on public.migration_staging_records to anon;
grant delete, insert, references, select, trigger, truncate, update on public.migration_staging_records to authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.migration_staging_records to service_role;

-- ── Déclencheurs ─────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_trigger where tgname='trg_data_migrations_set_updated_at' and tgrelid='public.data_migrations'::regclass) then
    execute 'CREATE TRIGGER trg_data_migrations_set_updated_at BEFORE UPDATE ON public.data_migrations FOR EACH ROW EXECUTE FUNCTION set_updated_at()';
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_migration_duplicate_candidates_set_updated_at' and tgrelid='public.migration_duplicate_candidates'::regclass) then
    execute 'CREATE TRIGGER trg_migration_duplicate_candidates_set_updated_at BEFORE UPDATE ON public.migration_duplicate_candidates FOR EACH ROW EXECUTE FUNCTION set_updated_at()';
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_migration_field_mappings_set_updated_at' and tgrelid='public.migration_field_mappings'::regclass) then
    execute 'CREATE TRIGGER trg_migration_field_mappings_set_updated_at BEFORE UPDATE ON public.migration_field_mappings FOR EACH ROW EXECUTE FUNCTION set_updated_at()';
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_migration_files_set_updated_at' and tgrelid='public.migration_files'::regclass) then
    execute 'CREATE TRIGGER trg_migration_files_set_updated_at BEFORE UPDATE ON public.migration_files FOR EACH ROW EXECUTE FUNCTION set_updated_at()';
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_migration_import_batches_set_updated_at' and tgrelid='public.migration_import_batches'::regclass) then
    execute 'CREATE TRIGGER trg_migration_import_batches_set_updated_at BEFORE UPDATE ON public.migration_import_batches FOR EACH ROW EXECUTE FUNCTION set_updated_at()';
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_migration_issues_set_updated_at' and tgrelid='public.migration_issues'::regclass) then
    execute 'CREATE TRIGGER trg_migration_issues_set_updated_at BEFORE UPDATE ON public.migration_issues FOR EACH ROW EXECUTE FUNCTION set_updated_at()';
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_migration_mapping_templates_set_updated_at' and tgrelid='public.migration_mapping_templates'::regclass) then
    execute 'CREATE TRIGGER trg_migration_mapping_templates_set_updated_at BEFORE UPDATE ON public.migration_mapping_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at()';
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_migration_staff_mappings_set_updated_at' and tgrelid='public.migration_staff_mappings'::regclass) then
    execute 'CREATE TRIGGER trg_migration_staff_mappings_set_updated_at BEFORE UPDATE ON public.migration_staff_mappings FOR EACH ROW EXECUTE FUNCTION set_updated_at()';
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_migration_staging_records_set_updated_at' and tgrelid='public.migration_staging_records'::regclass) then
    execute 'CREATE TRIGGER trg_migration_staging_records_set_updated_at BEFORE UPDATE ON public.migration_staging_records FOR EACH ROW EXECUTE FUNCTION set_updated_at()';
  end if;
end $$;

-- ── Dossier de fichiers ──────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('migration-files', 'migration-files', false, 52428800, null)
  on conflict (id) do nothing;

-- ── Commentaires ─────────────────────────────────────────────────
comment on table public.data_migrations is 'Projet de migration assistée ancien CRM → workspace Lume. Accès serveur uniquement (RLS deny-all).';
comment on table public.migration_approvals is 'Décision du client sur une version précise du rapport d''import test (approbation explicite journalisée).';
comment on table public.migration_audit_logs is 'Journal d''audit de la migration (création, lien, accès, téléversements, décisions, imports…). Jamais de jeton ni de PII complète dans meta.';
comment on table public.migration_duplicate_candidates is 'Doublon potentiel entre une ligne de staging et un dossier actif existant du workspace.';
comment on table public.migration_field_mappings is 'Correspondance proposée/validée entre une colonne importée et un champ Lume.';
comment on table public.migration_file_columns is 'Colonne d''un fichier analysé. samples_masked ne contient que des valeurs masquées (jamais de PII complète).';
comment on table public.migration_files is 'Fichier source téléversé pour une migration (CSV de données ou PDF d''archive).';
comment on table public.migration_import_batches is 'Lot d''importation. Un lot final regroupe toutes les entités créées et permet un rollback ciblé (soft-delete).';
comment on table public.migration_import_records is 'Provenance de chaque entité importée : (migration, ligne source, table, id créé). Garantit l''idempotence et la reprise.';
comment on table public.migration_invitations is 'Jeton d''invitation au portail de migration. Le jeton brut n''est jamais stocké (SHA-256 seulement).';
comment on table public.migration_issues is 'Problème détecté pendant l''analyse/correspondance, envoyé en validation humaine. details_masked sans PII complète.';
comment on table public.migration_mapping_templates is 'Gabarit de correspondance colonnes → champs Lume, réutilisable par CRM source. Structure seulement, jamais de données client.';
comment on table public.migration_messages is 'Fil de clarification entre le client et l''équipe Lume pour une migration.';
comment on table public.migration_staff_mappings is 'Correspondance employé historique (texte source) → membre Lume pour une migration. user_id NULL = historique non assigné.';
comment on table public.migration_staging_records is 'Ligne source parsée et normalisée en zone de staging, isolée des données actives du workspace.';

-- ── Vérification ─────────────────────────────────────────────────
do $$ declare n int; begin
  select count(*) into n from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
   where ns.nspname='public' and c.relkind='r' and (c.relname like 'migration\_%' or c.relname = 'data_migrations');
  if n <> 15 then raise exception 'Attendu 15 tables, trouvé %', n; end if;
  raise notice 'Module de migration : 15 tables en place.';
end $$;
